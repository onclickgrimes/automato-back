import { Instagram, InstagramConfig, PostData } from './src';
import { PostsDatabase } from './src/PostsDatabase';
import { MessageProcessor } from './src/MessageProcessor';
import { AIService } from './src/AIService';
import knex from 'knex';
import axios from 'axios';

// Interfaces para Workflow
export interface WorkflowAction {
  type: 'sendDirectMessage' | 'likePost' | 'followUser' | 'unfollowUser' | 'monitorMessages' | 'monitorPosts' | 'comment' | 'delay' | 'startMessageProcessor' | 'stopMessageProcessor' | 'uploadPhoto';
  params: {
    user?: string; // Usuário p quem será enviada a mensagem - Usado no sendDirectMessage
    message?: string; // Conteúdo da mensagem para o usuário - Usado no sendDirectMessage
    postId?: string; //Url do post que vai ser curtido - Usado no likePost e comment
    username?: string; // Nome do usuário que vai sofrer a ação - Usado no followUser, unfollowUser e monitorPosts
    usernames?: string[]; // Array de nomes de usuários - Usado no monitorPosts
    comment?: string; // Mensagem a ser escrita no comentário - Usado no commentPost()
    duration?: number; // Delay em milissegundos - Usado no delay no executeAction() (switch/case)
    includeRequests?: boolean; // Verifica a caixa de Solicitações de mansagens? - Usado em monitorNewMessages()
    checkInterval?: number; // Intervalo de verificação em milissegundos - Usado em monitorNewPostsFromUsers()
    maxExecutions?: number; // Número de loops que monitorar posts deve fazer - Usado em monitorNewPostsFromUsers()
    maxPostsPerUser?: number; // Número de primeiros posts que o loop deve extrair - Usado em monitorNewPostsFromUsers()
    imagePath?: string; // Caminho da foto a ser enviada - Usado em uploadPhoto()
    caption?: string; // Legenda da foto a ser enviada - Usado em uploadPhoto()
    onNewMessage?: (data: any) => void;
    onNewPost?: (data: any) => void;
    // Parâmetros para MessageProcessor
    aiConfig?: {
      openaiApiKey?: string;
      googleApiKey?: string;
      temperature?: number;
      maxTokens?: number;
    };
    processingConfig?: {
      checkInterval?: number;
      maxMessagesPerBatch?: number;
      delayBetweenReplies?: { min: number; max: number };
      enableHumanization?: boolean;
    };
  };
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
  instanceName: string; // Nome da instância do Instagram
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
  private activeMessageProcessors: Map<string, MessageProcessor> = new Map();
  private initializeDatabaseForUser: (username: string) => Promise<void>;
  private saveMessageToDatabase: (username: string, messageData: any) => Promise<void>;
  private supabaseEndpoint: string;
  private frontendEndpoint: string;
  private logCallback: ((username: string, logEntry: any) => void) | undefined;

  constructor(
    activeInstances: Map<string, Instagram>,
    initializeDatabaseForUser: (username: string) => Promise<void>,
    saveMessageToDatabase: (username: string, messageData: any) => Promise<void>,
    frontendEndpoint: string = 'http://localhost:3000',
    supabaseRoute: string = '/api/instagram-accounts/posts',
    logCallback?: (username: string, logEntry: any) => void
  ) {
    this.activeInstances = activeInstances;
    this.initializeDatabaseForUser = initializeDatabaseForUser;
    this.saveMessageToDatabase = saveMessageToDatabase;
    this.frontendEndpoint = frontendEndpoint;
    this.supabaseEndpoint = `${frontendEndpoint}${supabaseRoute}`;
    this.logCallback = logCallback;
  }

  /**
   * Envia log para o frontend via SSE
   */
  private sendLog(username: string, level: 'info' | 'success' | 'warning' | 'error', message: string) {
    if (this.logCallback) {
      this.logCallback(username, { level, message });
    }
    console.log(`[${username}] ${level.toUpperCase()}: ${message}`);
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

      if (!ig.isPageActive()) {
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
    this.sendLog(username, 'info', `🔄 Executando ação: ${action.type}`);

    switch (action.type) {
      case 'sendDirectMessage':
        if (!action.params.user || !action.params.message) {
          this.sendLog(username, 'error', '❌ Parâmetros user e message são obrigatórios para sendDirectMessage');
          throw new Error('Parâmetros user e message são obrigatórios para sendDirectMessage');
        }
        
        this.sendLog(username, 'info', `💬 Enviando mensagem para @${action.params.user}`);
        
        // Verificar se já existe uma conversa ativa com este usuário
        try {
          const knexInstance = require('knex')({
            client: 'sqlite3',
            connection: {
              filename: `./database_${username}.sqlite`
            },
            useNullAsDefault: true
          });
          
          // Buscar chat existente pelo user_id (que é o username do Instagram)
          const existingChat = await knexInstance('chats')
            .where('user_id', action.params.user)
            .first();
          
          await knexInstance.destroy();
          
          if (existingChat) {
            this.sendLog(username, 'info', `💬 Conversa existente encontrada para @${action.params.user}`);
            const result = await instance.replyMessage(existingChat.id, action.params.message);
            this.sendLog(username, 'success', `✅ Mensagem enviada para @${action.params.user}`);
            return result;
          } else {
            this.sendLog(username, 'info', `📩 Nova conversa para @${action.params.user}`);
            const result = await instance.sendDirectMessage(action.params.user, action.params.message);
            this.sendLog(username, 'success', `✅ Mensagem enviada para @${action.params.user}`);
            return result;
          }
        } catch (dbError) {
          this.sendLog(username, 'warning', 'Erro ao verificar conversa existente, tentando mensagem direta');
          console.warn(`⚠️ Erro ao consultar banco de dados para @${action.params.user}, usando sendDirectMessage como fallback:`, dbError);
          const result = await instance.sendDirectMessage(action.params.user, action.params.message);
          this.sendLog(username, 'success', `✅ Mensagem enviada para @${action.params.user}`);
          return result;
        }

      case 'likePost':
        if (!action.params.postId) {
          this.sendLog(username, 'error', '❌ postId ou postUrl é obrigatório para likePost');
          throw new Error('Parâmetro postId ou postUrl é obrigatório para likePost');
        }
        this.sendLog(username, 'info', `❤️ Curtindo post...`);
        const postId = action.params.postId
        const likeResult = await instance.likePost(postId!);
        this.sendLog(username, 'success', `✅ Post curtido com sucesso`);
        return likeResult;

      case 'followUser':
        if (!action.params.username) {
          this.sendLog(username, 'error', '❌ username é obrigatório para followUser');
          throw new Error('Parâmetro username é obrigatório para followUser');
        }
        this.sendLog(username, 'info', `👤 Seguindo @${action.params.username}...`);
        const followResult = await instance.followUser(action.params.username);
        this.sendLog(username, 'success', `✅ Agora seguindo @${action.params.username}`);
        return followResult;

      case 'unfollowUser':
        if (!action.params.username) {
          this.sendLog(username, 'error', '❌ username é obrigatório para unfollowUser');
          throw new Error('Parâmetro username é obrigatório para unfollowUser');
        }
        this.sendLog(username, 'info', `👤 Deixando de seguir @${action.params.username}...`);
        const unfollowResult = await instance.unfollowUser(action.params.username);
        this.sendLog(username, 'success', `✅ Deixou de seguir @${action.params.username}`);
        return unfollowResult;

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
        instance.switchMessagesMonitoring(true);
        
        this.sendLog(username, 'info', '📬 Iniciando monitoramento de mensagens');
        
        try {
          const result = await instance.monitorNewMessages(messageOptions);
          this.sendLog(username, 'success', '✅ Monitoramento de mensagens concluído');
          return result;
        } catch (error: any) {
          // Verifica se o erro é devido à desconexão do navegador/página
          const browserConnected = await instance.isBrowserConnected();
          const pageActive = await instance.isPageActive();
          
          if (!browserConnected || !pageActive) {
            this.sendLog(username, 'warning', '🔌 Conexão com o navegador perdida. Monitoramento de mensagens interrompido.');
            throw new Error('Conexão com o navegador perdida');
          }
          
          // Se não for erro de conectividade, relança o erro original
          throw error;
        }

      case 'monitorPosts':
        // Determinar quais usuários monitorar - prioriza usernames se presente
        let usersToMonitor: string[];
        if (action.params.usernames && action.params.usernames.length > 0) {
          usersToMonitor = action.params.usernames;
          this.sendLog(username, 'info', `📸 Monitorando posts de ${usersToMonitor.length} usuários: ${usersToMonitor.join(', ')}`);
        } else if (action.params.username) {
          usersToMonitor = [action.params.username];
          this.sendLog(username, 'info', `📸 Monitorando posts de @${action.params.username}`);
        } else {
          this.sendLog(username, 'error', '❌ username ou usernames é obrigatório para monitorPosts');
          throw new Error('Parâmetro username ou usernames é obrigatório para monitorPosts');
        }
        
        const postOptions = {
          checkInterval: action.params.checkInterval || 10000,
          maxPostsPerUser: action.params.maxPostsPerUser || 6,
          maxExecutions: action.params.maxExecutions || 1,
          onNewPosts: action.params.onNewPost || (async (posts: any[]) => {
            this.sendLog(username, 'info', `📝 ${posts.length} novos posts detectados`);
            console.log(`📝 ${posts.length} novos posts detectados`);
            if (posts.length > 0) {
              try {
                const resultado = await PostsDatabase.savePosts(posts, username);
                this.sendLog(username, 'success', `💾 Salvamento: ${resultado.saved} novos, ${resultado.duplicates} atualizados`);
                console.log(`💾 Salvamento: ${resultado.saved} novos, ${resultado.duplicates} atualizados`);

                // Enviar dados para o Supabase via frontend
                if (resultado.saved > 0 || resultado.duplicates > 0) {
                  await this.syncPostsToSupabase(posts, username);
                }
              } catch (error: any) {
                this.sendLog(username, 'error', `❌ Erro ao salvar posts no banco: ${error.message}`);
                console.error('❌ Erro ao salvar posts no banco:', error.message);
              }
            }
          })
        };
        
        this.sendLog(username, 'info', `🔄 Iniciando monitoramento com intervalo de ${postOptions.checkInterval}ms`);
        
        let collectedPosts: any[] = [];
        try {
          collectedPosts = await instance.monitorNewPostsFromUsers({
            usernames: usersToMonitor,
            ...postOptions
          });
        } catch (error: any) {
          // Verifica se o erro é devido à desconexão do navegador/página
          const browserConnected = await instance.isBrowserConnected();
          const pageActive = await instance.isPageActive();
          
          if (!browserConnected || !pageActive) {
            this.sendLog(username, 'warning', '🔌 Conexão com o navegador perdida. Monitoramento interrompido.');
            throw new Error('Conexão com o navegador perdida');
          }
          
          // Se não for erro de conectividade, relança o erro original
          throw error;
        }

        // Salva todos os posts coletados no final
        if (collectedPosts.length > 0) {
          try {
            this.sendLog(username, 'info', `💾 Salvando ${collectedPosts.length} posts coletados no banco...`);
            const resultadoFinal = await PostsDatabase.savePosts(collectedPosts, username);
            this.sendLog(username, 'success', `💾 Salvamento final: ${resultadoFinal.saved} novos, ${resultadoFinal.duplicates} atualizados`);
            console.log(`💾 Salvamento final: ${resultadoFinal.saved} novos, ${resultadoFinal.duplicates} atualizados`);

            // Enviar dados para o Supabase via frontend
            if (resultadoFinal.saved > 0 || resultadoFinal.duplicates > 0) {
              this.sendLog(username, 'info', '🔄 Sincronizando posts com Supabase...');
              await this.syncPostsToSupabase(collectedPosts, username);
              this.sendLog(username, 'success', '✅ Posts sincronizados com Supabase');
            }
          } catch (error: any) {
            this.sendLog(username, 'error', `❌ Erro ao salvar posts coletados no banco: ${error.message}`);
            console.error('❌ Erro ao salvar posts coletados no banco:', error.message);
          }
        } else {
          this.sendLog(username, 'info', '📭 Nenhum post novo foi coletado');
        }

        this.sendLog(username, 'success', `✅ Monitoramento concluído. Total de posts coletados: ${collectedPosts.length}`);
        return {
          success: true,
          postsCollected: collectedPosts.length,
          posts: collectedPosts,
          monitoredUsers: usersToMonitor
        };

      case 'delay':
        if (!action.params.duration) {
          throw new Error('Parâmetro duration é obrigatório para delay');
        }
        this.sendLog(username, 'info', `⏳ Aguardando ${action.params.duration}ms...`);
        await new Promise(resolve => setTimeout(resolve, action.params.duration));
        this.sendLog(username, 'success', `✅ Delay de ${action.params.duration}ms concluído`);
        return { success: true, duration: action.params.duration };

      case 'startMessageProcessor':
        // Configurações padrão para IA
        const aiConfig = {
          openaiApiKey: action.params.aiConfig?.openaiApiKey || process.env.OPENAI_API_KEY,
          googleApiKey: action.params.aiConfig?.googleApiKey || process.env.GOOGLE_API_KEY,
          temperature: action.params.aiConfig?.temperature || 0.7,
          maxTokens: action.params.aiConfig?.maxTokens || 150
        };

        // Configurações padrão para processamento
        const processingConfig = {
          checkInterval: action.params.processingConfig?.checkInterval || 30000, // 30 segundos
          maxMessagesPerBatch: action.params.processingConfig?.maxMessagesPerBatch || 5,
          delayBetweenReplies: action.params.processingConfig?.delayBetweenReplies || { min: 2000, max: 8000 },
          enableHumanization: action.params.processingConfig?.enableHumanization !== false
        };

        // Verificar se já existe um MessageProcessor ativo para este usuário
        if (this.activeMessageProcessors.has(username)) {
          console.log(`⚠️ MessageProcessor já está ativo para ${username}`);
          return { success: false, message: 'MessageProcessor já está ativo para este usuário' };
        }

        try {
          // Validar e criar instância do AIService
          const validatedAiConfig = {
            openaiApiKey: aiConfig.openaiApiKey || process.env.OPENAI_API_KEY || '',
            googleApiKey: aiConfig.googleApiKey || process.env.GOOGLE_AI_API_KEY || '',
            temperature: aiConfig.temperature || 0.7,
            maxTokens: aiConfig.maxTokens || 150
          };
          
          if (!validatedAiConfig.openaiApiKey && !validatedAiConfig.googleApiKey) {
            throw new Error('Pelo menos uma chave de API (OpenAI ou Google AI) deve ser fornecida');
          }
          
          const aiService = new AIService(validatedAiConfig);
          
          // Criar instância do MessageProcessor
          const messageProcessor = new MessageProcessor(
            aiService,
            {
              checkInterval: processingConfig.checkInterval ? processingConfig.checkInterval / 60000 : 0.5, // Converter ms para minutos
              maxMessagesPerBatch: processingConfig.maxMessagesPerBatch || 5,
              minResponseDelay: processingConfig.delayBetweenReplies?.min || 2000,
              maxResponseDelay: processingConfig.delayBetweenReplies?.max || 5000,
              timeWindowHours: 24,
              enableHumanization: processingConfig.enableHumanization || true
            }
          );

          // Inicializar o banco de dados para o usuário
          await this.initializeDatabaseForUser(username);

          // Iniciar o processamento
          messageProcessor.startAutoProcessing();

          // Armazenar a instância ativa
          this.activeMessageProcessors.set(username, messageProcessor);

          console.log(`🤖 MessageProcessor iniciado para ${username}`);
          return { 
            success: true, 
            message: 'MessageProcessor iniciado com sucesso',
            config: { aiConfig: { ...aiConfig, openaiApiKey: '***', googleApiKey: '***' }, processingConfig }
          };
        } catch (error: any) {
          console.error(`❌ Erro ao iniciar MessageProcessor para ${username}:`, error.message);
          throw new Error(`Falha ao iniciar MessageProcessor: ${error.message}`);
        }

      case 'stopMessageProcessor':
        // Verificar se existe um MessageProcessor ativo para este usuário
        const activeProcessor = this.activeMessageProcessors.get(username);
        if (!activeProcessor) {
          console.log(`⚠️ Nenhum MessageProcessor ativo encontrado para ${username}`);
          return { success: false, message: 'Nenhum MessageProcessor ativo encontrado para este usuário' };
        }

        try {
          // Parar o processamento
          activeProcessor.stopAutoProcessing();

          // Remover da lista de instâncias ativas
          this.activeMessageProcessors.delete(username);

          console.log(`🛑 MessageProcessor parado para ${username}`);
          return { 
            success: true, 
            message: 'MessageProcessor parado com sucesso',
            statistics: activeProcessor.getStats()
          };
        } catch (error: any) {
          console.error(`❌ Erro ao parar MessageProcessor para ${username}:`, error.message);
          throw new Error(`Falha ao parar MessageProcessor: ${error.message}`);
        }
      
        case 'uploadPhoto':
          if (!action.params.imagePath) {
            throw new Error('Parâmetro imagePath é obrigatório para uploadPhoto');
          }
          await instance.postPhoto(action.params.imagePath, action.params.caption);
          return { success: true, message: 'Foto enviada com sucesso' };

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
  async executeWorkflow(workflow: Workflow, instanceName: string): Promise<WorkflowResult> {
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

    // Armazenar resultado imediatamente para permitir interrupção
    this.results.set(workflow.id, result);

    try {
      this.sendLog(instanceName, 'info', `🚀 Iniciando execução do workflow: ${workflow.name}`);
      console.log(`🚀 Iniciando execução do workflow: ${workflow.name} (${workflow.id})`);

      // Garantir que a instância do Instagram existe
      const instance = await this.ensureInstagramInstance(instanceName);

      // Verificar se a página está ativa
      if (!await instance.isPageActive()) {
        throw new Error(`Página do usuário ${instanceName} não está ativa`);
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
        // Verificar se o workflow foi interrompido
        const currentResult = this.results.get(workflow.id);
        if (currentResult && currentResult.error === 'Workflow interrompido pelo usuário') {
          console.log(`🛑 Workflow ${workflow.id} foi interrompido durante a execução`);
          break;
        }

        try {
          const stepResult = await this.executeStep(step, instance, instanceName, result.results);

          result.results[step.id] = stepResult;

          if (stepResult.success) {
            result.executedSteps.push(step.id);
            this.sendLog(instanceName, 'success', `✅ Step ${step.name} executado com sucesso`);
            console.log(`✅ Step ${step.id} executado com sucesso`);
          } else if (!stepResult.skipped) {
            result.failedSteps.push(step.id);
            this.sendLog(instanceName, 'error', `❌ Step ${step.name} falhou`);
            console.error(`❌ Step ${step.id} falhou`);

            // Parar execução se configurado para parar em erro
            if (workflow.config?.stopOnError !== false) {
              this.sendLog(instanceName, 'warning', `🛑 Parando execução devido a erro no step ${step.name}`);
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

          this.sendLog(instanceName, 'error', `❌ Erro crítico no step ${step.name}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
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
      this.sendLog(instanceName, 'error', `❌ Erro na execução do workflow: ${result.error}`);
      console.error(`❌ Erro na execução do workflow ${workflow.id}:`, error);
    }

    result.endTime = new Date();
    result.executionTime = result.endTime.getTime() - result.startTime.getTime();

    // Armazenar resultado
    this.results.set(workflow.id, result);

    if (result.success) {
      this.sendLog(instanceName, 'success', `🏁 Workflow ${workflow.name} finalizado com sucesso`);
    } else {
      this.sendLog(instanceName, 'warning', `🏁 Workflow ${workflow.name} finalizado com falhas`);
    }
    
    this.sendLog(instanceName, 'info', `⏱️ Tempo de execução: ${result.executionTime}ms`);
    this.sendLog(instanceName, 'info', `📊 Steps executados: ${result.executedSteps.length}, Steps falharam: ${result.failedSteps.length}`);

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
    // Primeiro verificar se existe um resultado já armazenado
    let result = this.results.get(workflowId);
    
    // Se não existe resultado, criar um temporário para workflows em execução
    if (!result) {
      // Criar um resultado temporário para workflows que estão executando
      result = {
        workflowId: workflowId,
        success: false,
        executedSteps: [],
        failedSteps: [],
        results: {},
        error: 'Workflow interrompido pelo usuário',
        executionTime: 0,
        startTime: new Date(),
        endTime: new Date()
      };
      
      // Armazenar o resultado temporário
      this.results.set(workflowId, result);
    } else {
      // Marcar como parado se já existia
      result.error = 'Workflow interrompido pelo usuário';
      result.endTime = new Date();
      result.executionTime = result.endTime.getTime() - result.startTime.getTime();
    }

    // Parar qualquer MessageProcessor ativo relacionado a este workflow
    if (this.activeMessageProcessors.has(workflowId)) {
      const messageProcessor = this.activeMessageProcessors.get(workflowId)!;
      await messageProcessor.stopAutoProcessing();
      this.activeMessageProcessors.delete(workflowId);
      console.log(`🛑 MessageProcessor para workflow ${workflowId} foi parado`);
    }

    console.log(`🛑 Workflow ${workflowId} foi interrompido`);
    return true;
  }

  /**
   * Sincroniza posts salvos no SQLite com o Supabase via frontend
   */
  private async syncPostsToSupabase(posts: PostData[], username: string): Promise<void> {
    try {
      console.log(`🔄 Sincronizando ${posts.length} posts com Supabase para ${username}...`);

      const payload = {
        user_id: "dc780220-2c99-4bfb-9302-c1e983c40152",
        username: username,
        posts: posts.map(post => {
          return {
            url: post.url,
            post_id: post.post_id || post.url.match(/\/(p|reel)\/([^/]+)\//)?.[2] || post.url,
            username: post.username,
            likes: post.likes || 0,
            comments: post.comments || 0,
            post_date: post.postDate || post.post_date,
            liked_by_users: post.likedByUsers || [], // Esta linha está funcionalmente correta
            followed_likers: post.followedLikers || false
          };
        })
      };
      // console.log(`📝 Payload para sincronização (completo):`, JSON.stringify(payload, null, 2));
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
export function validateWorkflow(workflow: Workflow, instanceName: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!workflow.id || !workflow.name || !instanceName|| !workflow.steps) {
    errors.push('Workflow inválido: campos obrigatórios (id, name, instanceName, steps) estão faltando');
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

      const validTypes = ['sendDirectMessage', 'likePost', 'followUser', 'unfollowUser', 'monitorMessages', 'monitorPosts', 'comment', 'delay', 'startMessageProcessor', 'stopMessageProcessor', 'uploadPhoto'];
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