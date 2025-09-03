import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface AIConfig {
  openaiApiKey?: string;
  googleApiKey?: string;
  defaultProvider?: 'openai' | 'google';
  temperature?: number;
  maxTokens?: number;
}

export interface MessageContext {
  username: string;
  messageContent: string;
  conversationHistory?: string[];
  userProfile?: {
    name?: string;
    bio?: string;
    followersCount?: number;
  };
}

export interface AIResponse {
  content: string;
  provider: 'openai' | 'google';
  tokensUsed?: number;
  processingTime: number;
}

export class AIService {
  private openai?: OpenAI;
  private googleAI?: GoogleGenerativeAI;
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = {
      defaultProvider: 'openai',
      temperature: 0.7,
      maxTokens: 150,
      ...config
    };

    // Inicializar OpenAI se a chave foi fornecida
    if (config.openaiApiKey) {
      this.openai = new OpenAI({
        apiKey: config.openaiApiKey
      });
    }

    // Inicializar Google AI se a chave foi fornecida
    if (config.googleApiKey) {
      this.googleAI = new GoogleGenerativeAI(config.googleApiKey);
    }

    if (!config.openaiApiKey && !config.googleApiKey) {
      throw new Error('Pelo menos uma chave de API (OpenAI ou Google) deve ser fornecida');
    }
  }

  /**
   * Gera uma resposta humanizada usando IA
   */
  async generateResponse(
    context: MessageContext,
    provider?: 'openai' | 'google'
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const selectedProvider = provider || this.config.defaultProvider || 'openai';

    try {
      let response: string;

      if (selectedProvider === 'openai' && this.openai) {
        response = await this.generateOpenAIResponse(context);
      } else if (selectedProvider === 'google' && this.googleAI) {
        response = await this.generateGoogleResponse(context);
      } else {
        // Fallback para o provedor disponível
        if (this.openai) {
          response = await this.generateOpenAIResponse(context);
        } else if (this.googleAI) {
          response = await this.generateGoogleResponse(context);
        } else {
          throw new Error('Nenhum provedor de IA disponível');
        }
      }

      const processingTime = Date.now() - startTime;

      return {
        content: response,
        provider: selectedProvider,
        processingTime
      };
    } catch (error) {
      console.error(`Erro ao gerar resposta com ${selectedProvider}:`, error);
      throw error;
    }
  }

  /**
   * Gera resposta usando OpenAI GPT
   */
  private async generateOpenAIResponse(context: MessageContext): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI não está configurado');
    }

    const systemPrompt = this.buildSystemPrompt(context);
    const userMessage = this.buildUserMessage(context);

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: this.config.temperature || 0.7,
      max_tokens: this.config.maxTokens || 150,
      presence_penalty: 0.6, // Evita repetições
      frequency_penalty: 0.3  // Varia o vocabulário
    });

    return completion.choices[0]?.message?.content?.trim() || 'Desculpe, não consegui gerar uma resposta.';
  }

  /**
   * Gera resposta usando Google Gemini
   */
  private async generateGoogleResponse(context: MessageContext): Promise<string> {
    if (!this.googleAI) {
      throw new Error('Google AI não está configurado');
    }

    const model = this.googleAI.getGenerativeModel({ model: 'gemini-pro' });
    const prompt = this.buildGooglePrompt(context);

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    return response.text().trim() || 'Desculpe, não consegui gerar uma resposta.';
  }

  /**
   * Constrói o prompt do sistema para OpenAI
   */
  private buildSystemPrompt(context: MessageContext): string {
    return `Você é um assistente de Instagram que responde mensagens de forma natural e humanizada.

Diretrizes importantes:
- Responda de forma casual e amigável, como uma pessoa real
- Use emojis ocasionalmente, mas não exagere
- Mantenha as respostas curtas e diretas (máximo 2-3 frases)
- Adapte o tom baseado no contexto da conversa
- Evite soar robótico ou muito formal
- Use linguagem brasileira natural
- Se não souber algo específico, seja honesto mas útil

Perfil do usuário que está respondendo:
${context.userProfile ? `Nome: ${context.userProfile.name || 'Não informado'}
Bio: ${context.userProfile.bio || 'Não informada'}
Seguidores: ${context.userProfile.followersCount || 'Não informado'}` : 'Perfil não disponível'}

Histórico da conversa:
${context.conversationHistory?.join('\n') || 'Primeira mensagem da conversa'}`;
  }

  /**
   * Constrói a mensagem do usuário para OpenAI
   */
  private buildUserMessage(context: MessageContext): string {
    return `O usuário @${context.username} enviou: "${context.messageContent}"

Responda de forma natural e humanizada.`;
  }

  /**
   * Constrói o prompt completo para Google Gemini
   */
  private buildGooglePrompt(context: MessageContext): string {
    return `Você é um assistente de Instagram que responde mensagens de forma natural e humanizada.

Diretrizes importantes:
- Responda de forma casual e amigável, como uma pessoa real
- Use emojis ocasionalmente, mas não exagere
- Mantenha as respostas curtas e diretas (máximo 2-3 frases)
- Adapte o tom baseado no contexto da conversa
- Evite soar robótico ou muito formal
- Use linguagem brasileira natural
- Se não souber algo específico, seja honesto mas útil

Perfil do usuário que está respondendo:
${context.userProfile ? `Nome: ${context.userProfile.name || 'Não informado'}
Bio: ${context.userProfile.bio || 'Não informada'}
Seguidores: ${context.userProfile.followersCount || 'Não informado'}` : 'Perfil não disponível'}

Histórico da conversa:
${context.conversationHistory?.join('\n') || 'Primeira mensagem da conversa'}

O usuário @${context.username} enviou: "${context.messageContent}"

Responda de forma natural e humanizada:`;
  }

  /**
   * Gera múltiplas variações de resposta para escolher a melhor
   */
  async generateMultipleResponses(
    context: MessageContext,
    count: number = 3
  ): Promise<AIResponse[]> {
    const promises = Array.from({ length: count }, () => 
      this.generateResponse(context)
    );

    try {
      return await Promise.all(promises);
    } catch (error) {
      console.error('Erro ao gerar múltiplas respostas:', error);
      throw error;
    }
  }

  /**
   * Seleciona a melhor resposta baseada em critérios de qualidade
   */
  selectBestResponse(responses: AIResponse[]): AIResponse {
    if (responses.length === 0) {
      throw new Error('Nenhuma resposta fornecida');
    }

    if (responses.length === 1) {
      return responses[0];
    }

    // Critérios de seleção:
    // 1. Evitar respostas muito curtas (< 10 caracteres)
    // 2. Evitar respostas muito longas (> 200 caracteres)
    // 3. Preferir respostas com emojis (mas não muitos)
    // 4. Evitar respostas genéricas

    const scoredResponses = responses.map(response => {
      let score = 0;
      const content = response.content;
      const length = content.length;

      // Penalizar respostas muito curtas ou muito longas
      if (length < 10) score -= 3;
      else if (length > 200) score -= 2;
      else if (length >= 20 && length <= 100) score += 2;

      // Bonificar presença moderada de emojis
      const emojiCount = (content.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) || []).length;
      if (emojiCount === 1 || emojiCount === 2) score += 1;
      else if (emojiCount > 3) score -= 1;

      // Penalizar respostas genéricas
      const genericPhrases = ['obrigado', 'de nada', 'ok', 'tudo bem', 'legal'];
      if (genericPhrases.some(phrase => content.toLowerCase().includes(phrase))) {
        score -= 1;
      }

      // Bonificar tempo de processamento mais rápido
      if (response.processingTime < 2000) score += 1;

      return { ...response, score };
    });

    // Retornar a resposta com maior pontuação
    return scoredResponses.reduce((best, current) => 
      current.score > best.score ? current : best
    );
  }

  /**
   * Verifica se o serviço está configurado corretamente
   */
  isConfigured(): boolean {
    return !!(this.openai || this.googleAI);
  }

  /**
   * Retorna informações sobre os provedores disponíveis
   */
  getAvailableProviders(): string[] {
    const providers: string[] = [];
    if (this.openai) providers.push('openai');
    if (this.googleAI) providers.push('google');
    return providers;
  }
}