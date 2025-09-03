import { Instagram, InstagramConfig } from './src';
import { PostsDatabase } from './src/PostsDatabase';
import knex from 'knex';
import axios from 'axios';

// Interfaces para Workflow
export interface WorkflowAction {
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
    maxExecutions?: number;
    maxPostsPerUser?: number;
    onNewMessage?: (data: any) => void;
    onNewPost?: (data: any) => void;
  };
  description?: string;
}

export interface WorkflowStep {
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

export interface Workflow {
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

export interface WorkflowResult {
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

// Classe principal para processamento de workflows
export class WorkflowProcessor {
  private results: Map<string, WorkflowResult> = new Map();
  private activeInstances: Map<string, Instagram>;
  private initializeDatabaseForUser: (username: string) => Promise<void>;
  private saveMessageToDatabase: (username: string, messageData: any) => Promise<void>;
  private supabaseEndpoint: string;
  private frontendEndpoint: string;

  constructor(
    activeInstances: Map<string, Instagram>,
    initializeDatabaseForUser: (username: string) => Promise<void>,
    saveMessageToDatabase: (username: string, messageData: any) => Promise<void>,
    frontendEndpoint: string = 'http://localhost:3000',
    supabaseRoute: string = '/api/instagram-accounts/posts'
  ) {
    this.activeInstances = activeInstances;
    this.initializeDatabaseForUser = initializeDatabaseForUser;
    this.saveMessageToDatabase = saveMessageToDatabase;
    this.frontendEndpoint = frontendEndpoint;
    this.supabaseEndpoint = `${frontendEndpoint}${supabaseRoute}`;
  }

  /**
   * Inicializa uma instância do Instagram se não existir
   */
  private async ensureInstagramInstance(username: string, config?: InstagramConfig): Promise<Instagram> {
    if (!this.activeInstances.has(username)) {
      if (!config) {
        throw new Error(`Instância do Instagram não encontrada para ${username} e nenhuma configuração foi fornecida`);
      }

      const ig = new Instagram(config);
      await ig.init();
      
      if (!ig.loggedIn) {
        throw new Error(`Falha na autenticação para ${username}`);
      }

      // Adiciona verificação de conexão
      if (!ig.isBrowserConnected()) {
        throw new Error(`Navegador não está conectado para ${username}`);
      }

      if(!ig.isPageActive()){
        throw new Error(`Página não está ativa para ${username}`);
      }

      await this.initializeDatabaseForUser(username);
      this.activeInstances.set(username, ig);
      console.log(`✅ Instância do Instagram criada para ${username}`);
    }

    return this.activeInstances.get(username)!;
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
            this.saveMessageToDatabase(username, data);
          })
        };
        return await instance.monitorNewMessages(messageOptions);

      case 'monitorPosts':
        if (!action.params.username) {
          throw new Error('Parâmetro username é obrigatório para monitorPosts');
        }
        const postOptions = {
          checkInterval: action.params.checkInterval || 10000,
          maxPostsPerUser: action.params.maxPostsPerUser || 6,  
          maxExecutions: action.params.maxExecutions || 1000,
          onNewPosts: action.params.onNewPost || (async (posts: any[]) => {
            console.log(`📝 ${posts.length} novos posts detectados`);
            if (posts.length > 0) {
              try {
                const resultado = await PostsDatabase.savePosts(posts, username);
                console.log(`💾 Salvamento: ${resultado.saved} novos, ${resultado.duplicates} atualizados`);
                
                // Enviar dados para o Supabase via frontend
                if (resultado.saved > 0 || resultado.duplicates > 0) {
                  await this.syncPostsToSupabase(posts, username);
                }
              } catch (error: any) {
                console.error('❌ Erro ao salvar posts no banco:', error.message);
              }
            }
          })
        };
        const collectedPosts = await instance.monitorNewPostsFromUsers({
          usernames: [action.params.username],
          ...postOptions
        });
        
        // Salva todos os posts coletados no final
        if (collectedPosts.length > 0) {
          try {
            const resultadoFinal = await PostsDatabase.savePosts(collectedPosts, username);
            console.log(`💾 Salvamento final: ${resultadoFinal.saved} novos, ${resultadoFinal.duplicates} atualizados`);
            
            // Enviar dados para o Supabase via frontend
            if (resultadoFinal.saved > 0 || resultadoFinal.duplicates > 0) {
              await this.syncPostsToSupabase(collectedPosts, username);
            }
          } catch (error: any) {
            console.error('❌ Erro ao salvar posts coletados no banco:', error.message);
          }
        }
        
        return { 
          success: true, 
          postsCollected: collectedPosts.length,
          posts: collectedPosts 
        };

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

      // Verificar se a página está ativa
      if (!await instance.isPageActive()) {
        throw new Error(`Página do usuário ${workflow.username} não está ativa`);
      }
      
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

  /**
   * Para a execução de um workflow (se possível)
   */
  async stopWorkflow(workflowId: string): Promise<boolean> {
    const result = this.results.get(workflowId);
    if (!result) {
      return false;
    }
    
    // Marcar como parado (implementação básica)
    result.error = 'Workflow interrompido pelo usuário';
    result.endTime = new Date();
    result.executionTime = result.endTime.getTime() - result.startTime.getTime();
    
    console.log(`🛑 Workflow ${workflowId} foi interrompido`);
    return true;
  }

  /**
   * Sincroniza posts salvos no SQLite com o Supabase via frontend
   */
  private async syncPostsToSupabase(posts: any[], username: string): Promise<void> {
    try {
      console.log(`🔄 Sincronizando ${posts.length} posts com Supabase para ${username}...`);
      
      const payload = {
        user_id: "dc780220-2c99-4bfb-9302-c1e983c40152",
        username: username,
        posts: posts.map(post => ({
          url: post.url,
          post_id: post.post_id || post.url.match(/\/(p|reel)\/([^/]+)\//)?.[2] || post.url,
          username: post.username,
          likes: post.likes || 0,
          comments: post.comments || 0,
          post_date: post.post_date || post.date,
          liked_by_users: Array.isArray(post.liked_by_users) ? post.liked_by_users : JSON.parse(post.liked_by_users || "[]"),
          followed_likers: post.followedLikers || false
        }))
      };
      console.log(`📝 Payload para sincronização:`, payload);
      const response = await axios.post(this.supabaseEndpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'your_secure_api_key_here_change_this'
        },
        timeout: 30000 // 30 segundos de timeout
      });
      
      if (response.status === 200 || response.status === 201) {
        console.log(`✅ Posts sincronizados com Supabase: ${posts.length} posts enviados`);
        console.log(`📊 Resposta do Supabase:`, response.data);
      } else {
        console.warn(`⚠️ Resposta inesperada do Supabase: ${response.status}`);
      }
      
    } catch (error: any) {
      console.error('❌ Erro ao sincronizar posts com Supabase:', {
        message: error.message,
        endpoint: this.supabaseEndpoint,
        postsCount: posts.length,
        username: username
      });
      
      // Log detalhado do erro para debug
      if (error.response) {
        console.error('📋 Detalhes da resposta de erro:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        });
      } else if (error.request) {
        console.error('📋 Erro de rede - sem resposta do servidor');
      }
    }
  }

  /**
   * Configura o endpoint do Supabase
   */
  setSupabaseEndpoint(frontendEndpoint: string, supabaseRoute: string = '/api/posts/sync'): void {
    this.frontendEndpoint = frontendEndpoint;
    this.supabaseEndpoint = `${frontendEndpoint}${supabaseRoute}`;
    console.log(`🔧 Endpoint do Supabase configurado: ${this.supabaseEndpoint}`);
  }
}

/**
 * Função utilitária para validar estrutura do workflow
 */
export function validateWorkflow(workflow: Workflow): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!workflow.id || !workflow.name || !workflow.username || !workflow.steps) {
    errors.push('Workflow inválido: campos obrigatórios (id, name, username, steps) estão faltando');
  }

  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push('Workflow deve ter pelo menos um step');
  }

  // Validar cada step
  workflow.steps?.forEach((step, index) => {
    if (!step.id || !step.name || !step.actions) {
      errors.push(`Step ${index + 1}: campos obrigatórios (id, name, actions) estão faltando`);
    }

    if (!Array.isArray(step.actions) || step.actions.length === 0) {
      errors.push(`Step ${index + 1}: deve ter pelo menos uma ação`);
    }

    // Validar cada ação
    step.actions?.forEach((action, actionIndex) => {
      if (!action.type) {
        errors.push(`Step ${index + 1}, Ação ${actionIndex + 1}: tipo de ação é obrigatório`);
      }

      const validTypes = ['sendDirectMessage', 'likePost', 'followUser', 'unfollowUser', 'monitorMessages', 'monitorPosts', 'comment', 'delay'];
      if (action.type && !validTypes.includes(action.type)) {
        errors.push(`Step ${index + 1}, Ação ${actionIndex + 1}: tipo de ação '${action.type}' não é válido`);
      }
    });
  });

  return {
    valid: errors.length === 0,
    errors
  };
}