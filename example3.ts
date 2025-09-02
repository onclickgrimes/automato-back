import { Instagram, InstagramConfig } from './src';
import * as fs from 'fs';
import * as path from 'path';
import knex from 'knex';
const knexConfig = require('./knexfile');
import * as crypto from 'crypto';

// Mapa para armazenar conexões de banco por username
const databaseConnections = new Map<string, any>();

// Função para obter conexão do banco específica do username
function getDatabaseConnection(username: string) {
  if (!databaseConnections.has(username)) {
    const config = {
      ...knexConfig.development,
      connection: {
        filename: `./database_${username}.sqlite`
      }
    };
    const db = knex(config);
    databaseConnections.set(username, db);
  }
  return databaseConnections.get(username);
}

// Interfaces para Workflow
interface WorkflowAction {
  type: 'sendDirectMessage' | 'likePost' | 'followUser' | 'unfollowUser' | 'monitorMessages' | 'monitorPosts' | 'comment' | 'delay';
  params: {
    user?: string;
    message?: string;
    postId?: string;
    postUrl?: string;
    username?: string;
    comment?: string;
    duration?: number; // em milissegundos
    includeRequests?: boolean;
    checkInterval?: number;
    onNewMessage?: (data: any) => void;
    onNewPost?: (data: any) => void;
  };
  description?: string;
}

interface WorkflowStep {
  id: string;
  name: string;
  actions: WorkflowAction[];
  condition?: {
    type: 'success' | 'failure' | 'always';
    previousStep?: string;
  };
  retry?: {
    maxAttempts: number;
    delayMs: number;
  };
}

interface Workflow {
  id: string;
  name: string;
  description?: string;
  username: string; // Username da instância do Instagram
  steps: WorkflowStep[];
  config?: {
    stopOnError?: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    timeout?: number; // timeout global em milissegundos
  };
}

interface WorkflowResult {
  workflowId: string;
  success: boolean;
  executedSteps: string[];
  failedSteps: string[];
  results: { [stepId: string]: any };
  error?: string;
  executionTime: number;
  startTime: Date;
  endTime: Date;
}

// Mapa para armazenar instâncias ativas do Instagram
const activeInstances = new Map<string, Instagram>();

// Funções auxiliares do banco de dados (mantidas do original)
async function createUser(username: string, userData: { id: string; avatar?: string; username: string; name?: string; email?: string; telefone?: string }) {
  try {
    const db = getDatabaseConnection(username);
    const [user] = await db('users').insert(userData).onConflict('id').merge();
    return user;
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    throw error;
  }
}

async function createChat(username: string, chatData: { id: string; user_id: string; reply?: boolean }) {
  try {
    const db = getDatabaseConnection(username);
    const [chat] = await db('chats').insert(chatData).onConflict('id').merge();
    return chat;
  } catch (error) {
    console.error('Erro ao criar chat:', error);
    throw error;
  }
}

async function createMessage(username: string, messageData: { chat_id: string; text: string; user_id: string; from_me: boolean; answered?: boolean; timestamp?: Date }) {
  try {
    const db = getDatabaseConnection(username);
    const [message] = await db('messages').insert(messageData);
    return message;
  } catch (error) {
    console.error('Erro ao criar mensagem:', error);
    throw error;
  }
}

// Função para inicializar o banco de dados de um username
async function initializeDatabaseForUser(username: string) {
  try {
    const db = getDatabaseConnection(username);
    await db.migrate.latest();
    console.log(`✅ Banco de dados inicializado para ${username}`);
  } catch (error) {
    console.error(`❌ Erro ao inicializar banco para ${username}:`, error);
    throw error;
  }
}

// Função para obter estado atual do chat
async function getChatState(username: string, chatId: string) {
  try {
    const db = getDatabaseConnection(username);
    const state = await db('chat_states').where('chat_id', chatId).first();
    
    console.log(`🔍 [DEBUG] Estado do chat recuperado:`);
    console.log(`   - Username: ${username}`);
    console.log(`   - Chat ID: ${chatId}`);
    console.log(`   - Estado encontrado: ${!!state}`);
    
    if (state) {
      console.log(`   - Tem snapshot: ${!!state.last_message_snapshot}`);
      console.log(`   - Última verificação: ${state.last_check}`);
    }
    
    return state || { chat_id: chatId, last_message_snapshot: null };
  } catch (error) {
    console.error('Erro ao obter estado do chat:', error);
    return { chat_id: chatId, last_message_snapshot: null };
  }
}

// Função para atualizar estado do chat
async function updateChatState(username: string, chatId: string, snapshot: string) {
  try {
    const db = getDatabaseConnection(username);
    
    console.log(`💾 [DEBUG] Atualizando estado do chat:`);
    console.log(`   - Username: ${username}`);
    console.log(`   - Chat ID: ${chatId}`);
    console.log(`   - Novo snapshot: ${snapshot.substring(0, 100)}...`);
    
    await db('chat_states')
      .insert({
        chat_id: chatId,
        last_message_snapshot: snapshot,
        last_check: new Date(),
        updated_at: new Date()
      })
      .onConflict('chat_id')
      .merge({
        last_message_snapshot: snapshot,
        last_check: new Date(),
        updated_at: new Date()
      });
      
    console.log(`   ✅ Estado do chat atualizado com sucesso`);
  } catch (error) {
    console.error('Erro ao atualizar estado do chat:', error);
  }
}

// Função para criar snapshot das mensagens
function createMessageSnapshot(messages: any[]): string {
  const lastMessages = messages.slice(-5).map((msg) => ({
    author: msg.author,
    text: msg.text.substring(0, 100),
    fromMe: msg.fromMe,
  }));
  return JSON.stringify(lastMessages);
}

// Função para detectar mensagens novas
function detectNewMessages(currentMessages: any[], lastSnapshot: string | null) {
  console.log(`🔍 [DEBUG] Detectando mensagens novas:`);
  console.log(`   - Mensagens atuais: ${currentMessages.length}`);
  console.log(`   - Tem snapshot anterior: ${!!lastSnapshot}`);

  if (!lastSnapshot) {
    console.log(`   ✅ Primeira execução - todas as mensagens são novas`);
    return {
      newMessages: currentMessages,
      snapshot: createMessageSnapshot(currentMessages),
    };
  }

  const currentSnapshot = createMessageSnapshot(currentMessages);
  const lastMessages = JSON.parse(lastSnapshot) as any[];
  const currentLastMessages = JSON.parse(currentSnapshot) as any[];

  // Compara os snapshots
  if (JSON.stringify(lastMessages) === JSON.stringify(currentLastMessages)) {
    console.log(`   🔄 Snapshots idênticos - nenhuma mensagem nova`);
    return {
      newMessages: [],
      snapshot: currentSnapshot,
    };
  }

  console.log(`   🆕 Snapshots diferentes - reprocessando todas as mensagens`);
  return {
    newMessages: currentMessages,
    snapshot: currentSnapshot,
  };
}

async function saveMessageToDatabase(username: string, messageData: any) {
  try {
    console.log(`💾 Verificando mensagens novas para ${username}...`);
    
    // Obter estado atual do chat
    const chatState = await getChatState(username, messageData.chatId);
    
    // Detectar apenas mensagens novas
    const { newMessages, snapshot } = detectNewMessages(
      messageData.messages || [],
      chatState.last_message_snapshot
    );
    
    if (newMessages.length === 0) {
      console.log(`🔄 Nenhuma mensagem nova detectada para ${username}`);
      return;
    }
    
    console.log(`🆕 ${newMessages.length} mensagens novas detectadas para ${username}`);
    
    // Criar ou atualizar usuário
    const userData = {
      id: messageData.username,
      username: messageData.username,
      avatar: messageData.profileImageUrl,
      name: messageData.name,
    };
    
    if (messageData.profileImageUrl) userData.avatar = messageData.profileImageUrl;
    if (messageData.name) userData.name = messageData.name;
    await createUser(username, userData);

    // Criar ou atualizar chat
    const chatData = {
      id: messageData.chatId,
      user_id: messageData.username,
      reply: true
    };
    await createChat(username, chatData);

    // Salvar apenas as mensagens novas
    for (const message of newMessages) {
      const messageUserId = message.author === 'me' ? username : messageData.username;
      
      const messageRecord = {
        chat_id: messageData.chatId,
        text: message.text,
        user_id: messageUserId,
        from_me: message.fromMe,
        answered: false,
        timestamp: new Date()
      };
      
      try {
        await createMessage(username, messageRecord);
        console.log(`💾 Nova mensagem salva: ${message.text.substring(0, 30)}... (from: ${message.author})`);
      } catch (error) {
        console.error(`❌ Erro ao criar mensagem:`, error);
      }
    }
    
    // Atualizar estado do chat
    await updateChatState(
      username,
      messageData.chatId,
      snapshot
    );
    
    console.log(`✅ ${newMessages.length} mensagens novas salvas para ${username}`);

  } catch (error) {
    console.error(`❌ Erro ao salvar mensagem no banco para ${username}:`, error);
  }
}

// Classe principal para processamento de workflows
class WorkflowProcessor {
  private results: Map<string, WorkflowResult> = new Map();

  /**
   * Inicializa uma instância do Instagram se não existir
   */
  private async ensureInstagramInstance(username: string, config?: InstagramConfig): Promise<Instagram> {
    if (!activeInstances.has(username)) {
      if (!config) {
        throw new Error(`Instância do Instagram não encontrada para ${username} e nenhuma configuração foi fornecida`);
      }

      const ig = new Instagram(config);
      await ig.init();
      
      if (!ig.loggedIn) {
        throw new Error(`Falha na autenticação para ${username}`);
      }

      await initializeDatabaseForUser(username);
      activeInstances.set(username, ig);
      console.log(`✅ Instância do Instagram criada para ${username}`);
    }

    return activeInstances.get(username)!;
  }

  /**
   * Executa uma ação específica do workflow
   */
  private async executeAction(action: WorkflowAction, instance: Instagram, username: string): Promise<any> {
    console.log(`🔄 Executando ação: ${action.type}`);
    
    switch (action.type) {
      case 'sendDirectMessage':
        if (!action.params.user || !action.params.message) {
          throw new Error('Parâmetros user e message são obrigatórios para sendDirectMessage');
        }
        return await instance.sendDirectMessage(action.params.user, action.params.message);

      case 'likePost':
        if (!action.params.postId && !action.params.postUrl) {
          throw new Error('Parâmetro postId ou postUrl é obrigatório para likePost');
        }
        const postId = action.params.postId || action.params.postUrl;
        return await instance.likePost(postId!);

      case 'followUser':
        if (!action.params.username) {
          throw new Error('Parâmetro username é obrigatório para followUser');
        }
        return await instance.followUser(action.params.username);

      case 'unfollowUser':
        if (!action.params.username) {
          throw new Error('Parâmetro username é obrigatório para unfollowUser');
        }
        return await instance.unfollowUser(action.params.username);

      case 'comment':
        if (!action.params.postId || !action.params.comment) {
          throw new Error('Parâmetros postId e comment são obrigatórios para comment');
        }
        return await instance.commentPost(action.params.postId, action.params.comment);

      case 'monitorMessages':
        const messageOptions = {
          checkInterval: action.params.checkInterval || 5000,
          includeRequests: action.params.includeRequests || false,
          onNewMessage: action.params.onNewMessage || ((data: any) => {
            console.log('📨 Nova mensagem detectada:', data);
            saveMessageToDatabase(username, data);
          })
        };
        return await instance.monitorNewMessages(messageOptions);

      case 'monitorPosts':
        if (!action.params.username) {
          throw new Error('Parâmetro username é obrigatório para monitorPosts');
        }
        const postOptions = {
          checkInterval: action.params.checkInterval || 10000,
          onNewPost: action.params.onNewPost || ((data: any) => {
            console.log('📝 Novo post detectado:', data);
          })
        };
        return await instance.monitorNewPostsFromUsers({
          usernames: [action.params.username],
          ...postOptions
        });

      case 'delay':
        if (!action.params.duration) {
          throw new Error('Parâmetro duration é obrigatório para delay');
        }
        console.log(`⏳ Aguardando ${action.params.duration}ms...`);
        await new Promise(resolve => setTimeout(resolve, action.params.duration));
        return { success: true, duration: action.params.duration };

      default:
        throw new Error(`Tipo de ação não suportado: ${action.type}`);
    }
  }

  /**
   * Executa um step do workflow
   */
  private async executeStep(step: WorkflowStep, instance: Instagram, username: string, previousResults: { [stepId: string]: any }): Promise<any> {
    console.log(`📋 Executando step: ${step.name} (${step.id})`);
    
    // Verifica condições
    if (step.condition) {
      const shouldExecute = this.evaluateCondition(step.condition, previousResults);
      if (!shouldExecute) {
        console.log(`⏭️ Step ${step.id} pulado devido à condição`);
        return { skipped: true, reason: 'condition_not_met' };
      }
    }

    const stepResults: any[] = [];
    let attempts = 0;
    const maxAttempts = step.retry?.maxAttempts || 1;
    const retryDelay = step.retry?.delayMs || 1000;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`🔄 Tentativa ${attempts}/${maxAttempts} para step ${step.id}`);

        // Executa todas as ações do step
        for (const action of step.actions) {
          const actionResult = await this.executeAction(action, instance, username);
          stepResults.push({
            action: action.type,
            params: action.params,
            result: actionResult,
            success: true
          });
          console.log(`✅ Ação ${action.type} executada com sucesso`);
        }

        return {
          stepId: step.id,
          stepName: step.name,
          success: true,
          attempts: attempts,
          results: stepResults
        };

      } catch (error) {
        console.error(`❌ Erro na tentativa ${attempts} do step ${step.id}:`, error);
        
        if (attempts >= maxAttempts) {
          return {
            stepId: step.id,
            stepName: step.name,
            success: false,
            attempts: attempts,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
            results: stepResults
          };
        }

        if (attempts < maxAttempts) {
          console.log(`⏳ Aguardando ${retryDelay}ms antes da próxima tentativa...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
  }

  /**
   * Avalia condições para execução de steps
   */
  private evaluateCondition(condition: { type: 'success' | 'failure' | 'always'; previousStep?: string }, previousResults: { [stepId: string]: any }): boolean {
    if (condition.type === 'always') {
      return true;
    }

    if (!condition.previousStep) {
      return true;
    }

    const previousResult = previousResults[condition.previousStep];
    if (!previousResult) {
      return false;
    }

    if (condition.type === 'success') {
      return previousResult.success === true;
    }

    if (condition.type === 'failure') {
      return previousResult.success === false;
    }

    return false;
  }

  /**
   * Executa um workflow completo
   */
  async executeWorkflow(workflow: Workflow, instagramConfig?: InstagramConfig): Promise<WorkflowResult> {
    const startTime = new Date();
    const result: WorkflowResult = {
      workflowId: workflow.id,
      success: false,
      executedSteps: [],
      failedSteps: [],
      results: {},
      executionTime: 0,
      startTime,
      endTime: new Date()
    };

    try {
      console.log(`🚀 Iniciando execução do workflow: ${workflow.name} (${workflow.id})`);
      
      // Garantir que a instância do Instagram existe
      const instance = await this.ensureInstagramInstance(workflow.username, instagramConfig);
      
      // Configurar timeout global se especificado
      let timeoutHandle: NodeJS.Timeout | null = null;
      if (workflow.config?.timeout) {
        timeoutHandle = setTimeout(() => {
          throw new Error(`Timeout do workflow: ${workflow.config!.timeout}ms excedido`);
        }, workflow.config.timeout);
      }

      // Executar steps sequencialmente
      for (const step of workflow.steps) {
        try {
          const stepResult = await this.executeStep(step, instance, workflow.username, result.results);
          
          result.results[step.id] = stepResult;
          
          if (stepResult.success) {
            result.executedSteps.push(step.id);
            console.log(`✅ Step ${step.id} executado com sucesso`);
          } else if (!stepResult.skipped) {
            result.failedSteps.push(step.id);
            console.error(`❌ Step ${step.id} falhou`);
            
            // Parar execução se configurado para parar em erro
            if (workflow.config?.stopOnError !== false) {
              console.log(`🛑 Parando execução devido a erro no step ${step.id}`);
              break;
            }
          }
        } catch (error) {
          result.failedSteps.push(step.id);
          result.results[step.id] = {
            stepId: step.id,
            stepName: step.name,
            success: false,
            error: error instanceof Error ? error.message : 'Erro desconhecido'
          };
          
          console.error(`❌ Erro crítico no step ${step.id}:`, error);
          
          if (workflow.config?.stopOnError !== false) {
            break;
          }
        }
      }

      // Limpar timeout
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // Determinar sucesso geral
      result.success = result.failedSteps.length === 0 && result.executedSteps.length > 0;
      
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error(`❌ Erro na execução do workflow ${workflow.id}:`, error);
    }

    result.endTime = new Date();
    result.executionTime = result.endTime.getTime() - result.startTime.getTime();
    
    // Armazenar resultado
    this.results.set(workflow.id, result);
    
    console.log(`🏁 Workflow ${workflow.id} finalizado:`);
    console.log(`   - Sucesso: ${result.success}`);
    console.log(`   - Steps executados: ${result.executedSteps.length}`);
    console.log(`   - Steps falharam: ${result.failedSteps.length}`);
    console.log(`   - Tempo de execução: ${result.executionTime}ms`);
    
    return result;
  }

  /**
   * Obtém resultado de um workflow executado
   */
  getWorkflowResult(workflowId: string): WorkflowResult | undefined {
    return this.results.get(workflowId);
  }

  /**
   * Lista todos os resultados de workflows
   */
  getAllResults(): WorkflowResult[] {
    return Array.from(this.results.values());
  }

  /**
   * Limpa resultados antigos
   */
  clearResults(): void {
    this.results.clear();
  }
}

// Instância global do processador de workflows
const workflowProcessor = new WorkflowProcessor();

/**
 * Função principal para executar workflow a partir de JSON
 */
export async function executeWorkflowFromJSON(workflowJSON: string | Workflow, instagramConfig?: InstagramConfig): Promise<WorkflowResult> {
  try {
    const workflow: Workflow = typeof workflowJSON === 'string' ? JSON.parse(workflowJSON) : workflowJSON;
    
    // Validar estrutura do workflow
    if (!workflow.id || !workflow.name || !workflow.username || !workflow.steps) {
      throw new Error('Workflow inválido: campos obrigatórios (id, name, username, steps) estão faltando');
    }

    if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
      throw new Error('Workflow deve conter pelo menos um step');
    }

    // Validar steps
    for (const step of workflow.steps) {
      if (!step.id || !step.name || !step.actions || !Array.isArray(step.actions)) {
        throw new Error(`Step inválido: ${step.id || 'sem ID'} - campos obrigatórios (id, name, actions) estão faltando`);
      }

      if (step.actions.length === 0) {
        throw new Error(`Step ${step.id} deve conter pelo menos uma ação`);
      }

      // Validar ações
      for (const action of step.actions) {
        if (!action.type || !action.params) {
          throw new Error(`Ação inválida no step ${step.id}: campos type e params são obrigatórios`);
        }
      }
    }

    console.log(`📋 Workflow validado: ${workflow.name}`);
    return await workflowProcessor.executeWorkflow(workflow, instagramConfig);
    
  } catch (error) {
    console.error('❌ Erro ao executar workflow:', error);
    throw error;
  }
}

/**
 * Função para obter resultado de workflow
 */
export function getWorkflowResult(workflowId: string): WorkflowResult | undefined {
  return workflowProcessor.getWorkflowResult(workflowId);
}

/**
 * Função para listar todos os resultados
 */
export function getAllWorkflowResults(): WorkflowResult[] {
  return workflowProcessor.getAllResults();
}

/**
 * Função para limpar resultados
 */
export function clearWorkflowResults(): void {
  workflowProcessor.clearResults();
}

/**
 * Função para parar uma instância específica
 */
export async function stopInstagramInstance(username: string): Promise<boolean> {
  const instance = activeInstances.get(username);
  if (!instance) {
    return false;
  }

  try {
    await instance.close();
    activeInstances.delete(username);
    console.log(`✅ Instância ${username} parada com sucesso`);
    return true;
  } catch (error) {
    console.error(`❌ Erro ao parar instância ${username}:`, error);
    return false;
  }
}

/**
 * Função para listar instâncias ativas
 */
export function getActiveInstances(): string[] {
  return Array.from(activeInstances.keys());
}

// Exemplo de uso
if (require.main === module) {
  // Exemplo de workflow JSON
  const exampleWorkflow: Workflow = {
    id: 'example-workflow-001',
    name: 'Workflow de Exemplo',
    description: 'Exemplo de workflow para demonstração',
    username: 'meu_usuario_instagram',
    config: {
      stopOnError: true,
      logLevel: 'info',
      timeout: 300000 // 5 minutos
    },
    steps: [
      {
        id: 'step-1',
        name: 'Enviar mensagem de bom dia',
        actions: [
          {
            type: 'sendDirectMessage',
            params: {
              user: 'amigo_usuario',
              message: 'Bom dia! Como você está?'
            },
            description: 'Enviar mensagem de bom dia para amigo'
          }
        ]
      },
      {
        id: 'step-2',
        name: 'Curtir posts recentes',
        condition: {
          type: 'success',
          previousStep: 'step-1'
        },
        actions: [
          {
            type: 'likePost',
            params: {
              postUrl: 'https://www.instagram.com/p/ABC123/'
            },
            description: 'Curtir post específico'
          },
          {
            type: 'delay',
            params: {
              duration: 2000
            },
            description: 'Aguardar 2 segundos'
          }
        ],
        retry: {
          maxAttempts: 3,
          delayMs: 1000
        }
      },
      {
        id: 'step-3',
        name: 'Iniciar monitoramento',
        actions: [
          {
            type: 'monitorMessages',
            params: {
              checkInterval: 10000,
              includeRequests: true
            },
            description: 'Monitorar novas mensagens a cada 10 segundos'
          }
        ]
      }
    ]
  };

  // Configuração do Instagram (exemplo)
  const instagramConfig: InstagramConfig = {
    username: 'meu_usuario_instagram',
    password: 'minha_senha',
    headless: false
  };

  // Executar workflow de exemplo
  console.log('🚀 Executando workflow de exemplo...');
  executeWorkflowFromJSON(exampleWorkflow, instagramConfig)
    .then(result => {
      console.log('✅ Workflow executado:', result);
    })
    .catch(error => {
      console.error('❌ Erro na execução:', error);
    });
}

// Exportar tipos para uso externo
export {
  Workflow,
  WorkflowStep,
  WorkflowAction,
  WorkflowResult,
  InstagramConfig
};