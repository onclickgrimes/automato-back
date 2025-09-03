import { getDatabaseConnection } from './MessagesDatabase';
import { AIService, MessageContext, AIResponse } from './AIService';
import { Instagram } from './Instagram';

export interface MessageProcessorConfig {
  checkInterval: number; // Intervalo em minutos para verificar mensagens
  maxMessagesPerBatch: number; // Máximo de mensagens para processar por vez
  minResponseDelay: number; // Delay mínimo entre respostas (ms)
  maxResponseDelay: number; // Delay máximo entre respostas (ms)
  timeWindowHours: number; // Janela de tempo para buscar mensagens (horas)
  enableHumanization: boolean; // Ativar delays humanizados
}

export interface PendingMessage {
  id: number;
  chat_id: string;
  text: string;
  user_id: string;
  username: string;
  timestamp: Date;
  created_at: Date;
}

export interface ProcessingStats {
  totalProcessed: number;
  successfulResponses: number;
  failedResponses: number;
  averageResponseTime: number;
  lastProcessingTime: Date;
}

export class MessageProcessor {
  private aiService: AIService;
  private config: MessageProcessorConfig;
  private isProcessing: boolean = false;
  private processingInterval?: NodeJS.Timeout;
  private stats: ProcessingStats;
  private instagramInstances: Map<string, Instagram> = new Map();

  constructor(aiService: AIService, config: Partial<MessageProcessorConfig> = {}) {
    this.aiService = aiService;
    this.config = {
      checkInterval: 5, // 5 minutos
      maxMessagesPerBatch: 10,
      minResponseDelay: 30000, // 30 segundos
      maxResponseDelay: 180000, // 3 minutos
      timeWindowHours: 24, // 24 horas
      enableHumanization: true,
      ...config
    };

    this.stats = {
      totalProcessed: 0,
      successfulResponses: 0,
      failedResponses: 0,
      averageResponseTime: 0,
      lastProcessingTime: new Date()
    };
  }

  /**
   * Inicia o processamento automático de mensagens
   */
  startAutoProcessing(): void {
    if (this.processingInterval) {
      console.log('⚠️ Processamento automático já está ativo');
      return;
    }

    console.log(`🤖 Iniciando processamento automático de mensagens`);
    console.log(`📊 Configurações:`);
    console.log(`   - Intervalo: ${this.config.checkInterval} minutos`);
    console.log(`   - Máx. mensagens/lote: ${this.config.maxMessagesPerBatch}`);
    console.log(`   - Delay entre respostas: ${this.config.minResponseDelay/1000}s - ${this.config.maxResponseDelay/1000}s`);
    console.log(`   - Janela de tempo: ${this.config.timeWindowHours} horas`);

    // Processar imediatamente
    this.processAllPendingMessages();

    // Configurar intervalo
    this.processingInterval = setInterval(() => {
      this.processAllPendingMessages();
    }, this.config.checkInterval * 60 * 1000);
  }

  /**
   * Para o processamento automático
   */
  stopAutoProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined as any;
      console.log('🛑 Processamento automático parado');
    }
  }

  /**
   * Processa todas as mensagens pendentes de todos os usuários
   */
  async processAllPendingMessages(): Promise<void> {
    if (this.isProcessing) {
      console.log('⏳ Processamento já em andamento, aguardando...');
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();

    try {
      console.log('🔍 Verificando mensagens pendentes...');
      
      // Aqui você precisaria ter uma lista dos usernames ativos
      // Por enquanto, vamos assumir que você tem uma forma de obter isso
      const activeUsernames = await this.getActiveUsernames();
      
      let totalProcessed = 0;
      
      for (const username of activeUsernames) {
        try {
          const pendingMessages = await this.getPendingMessages(username);
          
          if (pendingMessages.length > 0) {
            console.log(`📨 Encontradas ${pendingMessages.length} mensagens pendentes para @${username}`);
            
            const processed = await this.processMessagesForUser(username, pendingMessages);
            totalProcessed += processed;
          }
        } catch (error) {
          console.error(`❌ Erro ao processar mensagens para @${username}:`, error);
        }
      }

      const processingTime = Date.now() - startTime;
      this.stats.lastProcessingTime = new Date();
      
      if (totalProcessed > 0) {
        console.log(`✅ Processamento concluído: ${totalProcessed} mensagens em ${processingTime}ms`);
      }
      
    } catch (error) {
      console.error('❌ Erro no processamento geral:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Busca mensagens não respondidas em chats ativos
   */
  async getPendingMessages(username: string): Promise<PendingMessage[]> {
    try {
      const db = getDatabaseConnection(username);
      const timeWindow = new Date();
      timeWindow.setHours(timeWindow.getHours() - this.config.timeWindowHours);

      const messages = await db('messages')
        .join('chats', 'messages.chat_id', 'chats.id')
        .join('users', 'messages.user_id', 'users.id')
        .select(
          'messages.id',
          'messages.chat_id',
          'messages.text',
          'messages.user_id',
          'messages.timestamp',
          'messages.created_at',
          'users.username'
        )
        .where('messages.answered', false) // Mensagem não foi respondida
        .where('messages.from_me', false) // Mensagem não é minha
        .where('chats.reply', true) // Chat está configurado para responder
        .where('messages.timestamp', '>=', timeWindow) // Dentro da janela de tempo
        .orderBy('messages.timestamp', 'asc')
        .limit(this.config.maxMessagesPerBatch);

      return messages;
    } catch (error) {
      console.error(`Erro ao buscar mensagens pendentes para @${username}:`, error);
      return [];
    }
  }

  /**
   * Processa mensagens para um usuário específico
   */
  async processMessagesForUser(username: string, messages: PendingMessage[]): Promise<number> {
    let processedCount = 0;
    
    for (const message of messages) {
      try {
        console.log(`💬 Processando mensagem de @${message.username}: "${message.text.substring(0, 50)}..."`);
        
        // Gerar resposta com IA
        const context = await this.buildMessageContext(username, message);
        const aiResponse = await this.aiService.generateResponse(context);
        
        // Aplicar delay humanizado
        if (this.config.enableHumanization) {
          await this.applyHumanizedDelay();
        }
        
        // Enviar resposta via Instagram
        const success = await this.sendInstagramResponse(username, message.chat_id, aiResponse.content);
        
        if (success) {
          // Marcar mensagem como respondida
          await this.markMessageAsAnswered(username, message.id);
          
          this.stats.successfulResponses++;
          processedCount++;
          
          console.log(`✅ Resposta enviada para @${message.username}: "${aiResponse.content}"`);
        } else {
          this.stats.failedResponses++;
          console.log(`❌ Falha ao enviar resposta para @${message.username}`);
        }
        
      } catch (error) {
        console.error(`❌ Erro ao processar mensagem ${message.id}:`, error);
        this.stats.failedResponses++;
      }
    }
    
    this.stats.totalProcessed += processedCount;
    return processedCount;
  }

  /**
   * Constrói o contexto da mensagem para a IA
   */
  async buildMessageContext(username: string, message: PendingMessage): Promise<MessageContext> {
    try {
      const db = getDatabaseConnection(username);
      
      // Buscar histórico da conversa (últimas 5 mensagens)
      const conversationHistory = await db('messages')
        .where('chat_id', message.chat_id)
        .where('timestamp', '<', message.timestamp)
        .orderBy('timestamp', 'desc')
        .limit(5)
        .select('text', 'from_me');
      
      // Buscar informações do usuário
      const userInfo = await db('users')
        .where('id', message.user_id)
        .first();
      
      const history = conversationHistory
        .reverse()
        .map((msg: any) => `${msg.from_me ? 'Eu' : message.username}: ${msg.text}`);
      
      return {
        username: message.username,
        messageContent: message.text,
        conversationHistory: history,
        userProfile: {
          name: userInfo?.name,
          bio: userInfo?.bio
        }
      };
    } catch (error) {
      console.error('Erro ao construir contexto da mensagem:', error);
      
      // Contexto mínimo em caso de erro
      return {
        username: message.username,
        messageContent: message.text
      };
    }
  }

  /**
   * Aplica delay humanizado entre respostas
   */
  async applyHumanizedDelay(): Promise<void> {
    const delay = Math.random() * (this.config.maxResponseDelay - this.config.minResponseDelay) + this.config.minResponseDelay;
    
    console.log(`⏱️ Aplicando delay humanizado: ${Math.round(delay/1000)}s`);
    
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Envia resposta via Instagram
   */
  async sendInstagramResponse(username: string, chatId: string, responseText: string): Promise<boolean> {
    try {
      const instagram = this.instagramInstances.get(username);
      
      if (!instagram) {
        console.error(`❌ Instância do Instagram não encontrada para @${username}`);
        return false;
      }
      
      // Aqui você implementaria o envio da mensagem via Instagram
      // Por enquanto, vamos simular o envio
      console.log(`📤 Simulando envio de mensagem para chat ${chatId}: "${responseText}"`);
      
      // Simular delay de envio
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      return true;
    } catch (error) {
      console.error('Erro ao enviar resposta via Instagram:', error);
      return false;
    }
  }

  /**
   * Marca mensagem como respondida no banco
   */
  async markMessageAsAnswered(username: string, messageId: number): Promise<void> {
    try {
      const db = getDatabaseConnection(username);
      await db('messages')
        .where('id', messageId)
        .update({ answered: true });
    } catch (error) {
      console.error('Erro ao marcar mensagem como respondida:', error);
      throw error;
    }
  }

  /**
   * Registra instância do Instagram para um usuário
   */
  registerInstagramInstance(username: string, instagram: Instagram): void {
    this.instagramInstances.set(username, instagram);
    console.log(`📱 Instância do Instagram registrada para @${username}`);
  }

  /**
   * Remove instância do Instagram
   */
  unregisterInstagramInstance(username: string): void {
    this.instagramInstances.delete(username);
    console.log(`📱 Instância do Instagram removida para @${username}`);
  }

  /**
   * Obtém lista de usernames ativos (implementação placeholder)
   */
  private async getActiveUsernames(): Promise<string[]> {
    // Por enquanto, retorna os usernames que têm instâncias do Instagram registradas
    return Array.from(this.instagramInstances.keys());
  }

  /**
   * Retorna estatísticas do processamento
   */
  getStats(): ProcessingStats {
    return { ...this.stats };
  }

  /**
   * Reseta estatísticas
   */
  resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      successfulResponses: 0,
      failedResponses: 0,
      averageResponseTime: 0,
      lastProcessingTime: new Date()
    };
  }

  /**
   * Verifica se o processamento está ativo
   */
  isActive(): boolean {
    return !!this.processingInterval;
  }

  /**
   * Processa uma mensagem específica manualmente
   */
  async processSpecificMessage(username: string, messageId: number): Promise<boolean> {
    try {
      const db = getDatabaseConnection(username);
      
      const message = await db('messages')
        .join('users', 'messages.user_id', 'users.id')
        .select(
          'messages.id',
          'messages.chat_id',
          'messages.text',
          'messages.user_id',
          'messages.timestamp',
          'messages.created_at',
          'users.username'
        )
        .where('messages.id', messageId)
        .first();
      
      if (!message) {
        console.error(`❌ Mensagem ${messageId} não encontrada`);
        return false;
      }
      
      if (message.answered) {
        console.log(`⚠️ Mensagem ${messageId} já foi respondida`);
        return false;
      }
      
      const processed = await this.processMessagesForUser(username, [message]);
      return processed > 0;
      
    } catch (error) {
      console.error(`❌ Erro ao processar mensagem específica ${messageId}:`, error);
      return false;
    }
  }
}