import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { instagramGetUrl, InstagramResponse } from "instagram-url-direct"

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

export interface MediaAnalysisResult {
  mediaAnalysis: string;
  generatedComment: string;
  processingTime: number;
  mediaPath?: string;
  mediaType: 'video' | 'image';
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

  /**
   * Analisa um vídeo do Instagram usando Gemini e gera um comentário
   */
  async analyzeInstagramPost(
    postUrl: string,
    caption?: string,
    username?: string
  ): Promise<MediaAnalysisResult> {
    if (!this.googleAI) {
      throw new Error('Google AI (Gemini) não está configurado. Necessário para análise de vídeo.');
    }

    const startTime = Date.now();
    let videoPath: string | undefined;

    try {
      console.log(`🎥 Iniciando análise de post: ${postUrl}`);

      // 1. Tentar baixar como vídeo primeiro
      try {
        videoPath = await this.downloadVideo(postUrl);
        console.log(`📥 Vídeo baixado: ${videoPath}`);
        return await this.analyzeVideoContent(videoPath, startTime, caption, username);
      } catch (videoError: any) {
        console.log(`ℹ️ Não é um vídeo, tentando como imagem...`);

        // 2. Se falhar, tentar como imagem
        try {
          videoPath = await this.downloadImage(postUrl);
          console.log(`📥 Imagem baixada: ${videoPath}`);
          return await this.analyzeImageContent(videoPath, startTime, caption, username);
        } catch (imageError: any) {
          throw new Error(`Falha ao baixar mídia: Vídeo - ${videoError.message}, Imagem - ${imageError.message}`);
        }
      }

    } catch (error) {
      console.error('❌ Erro na análise do post:', error);

      // Limpar arquivo em caso de erro
      // if (videoPath && fs.existsSync(videoPath)) {
      //   fs.unlinkSync(videoPath);
      // }

      throw error;
    }
  }

  /**
   * Analisa conteúdo de vídeo
   */
  private async analyzeVideoContent(
    videoPath: string,
    startTime: number,
    caption?: string,
    username?: string
  ): Promise<MediaAnalysisResult> {
    const model = this.googleAI!.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    // Ler o arquivo de vídeo
    const videoData = fs.readFileSync(videoPath);
    const mimeType = this.getMimeType(videoPath);

    // Criar prompt para análise
    const analysisPrompt = this.buildVideoAnalysisPrompt(caption, username);

    console.log(`🤖 Enviando vídeo para análise do Gemini...`);

    // Enviar para o Gemini
    const result = await model.generateContent([
      {
        inlineData: {
          data: videoData.toString('base64'),
          mimeType: mimeType
        }
      },
      analysisPrompt
    ]);

    const response = await result.response;
    const mediaAnalysis = response.text();

    console.log(`📊 Análise do vídeo: ${mediaAnalysis}`);
    console.log(`✅ Análise do vídeo concluída`);

    // Gerar comentário baseado na análise
    const generatedComment = await this.generateCommentFromAnalysis(mediaAnalysis, caption, username);

    const processingTime = Date.now() - startTime;

    return {
      mediaAnalysis,
      generatedComment,
      processingTime,
      mediaType: 'video'
    };
  }

  /**
   * Analisa conteúdo de imagem
   */
  private async analyzeImageContent(
    imagePath: string,
    startTime: number,
    caption?: string,
    username?: string
  ): Promise<MediaAnalysisResult> {
    const model = this.googleAI!.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    // Ler o arquivo de imagem
    const imageData = fs.readFileSync(imagePath);
    const mimeType = this.getMimeType(imagePath);

    // Criar prompt para análise de imagem
    const analysisPrompt = this.buildImageAnalysisPrompt(caption, username);

    console.log(`🤖 Enviando imagem para análise do Gemini...`);

    // Enviar para o Gemini
    const result = await model.generateContent([
      {
        inlineData: {
          data: imageData.toString('base64'),
          mimeType: mimeType
        }
      },
      analysisPrompt
    ]);

    const response = await result.response;
    const mediaAnalysis = response.text();

    console.log(`📊 Análise da imagem: ${mediaAnalysis}`);
    console.log(`✅ Análise da imagem concluída`);

    // Gerar comentário baseado na análise
    const generatedComment = await this.generateCommentFromAnalysis(mediaAnalysis, caption, username);

    const processingTime = Date.now() - startTime;

    return {
      mediaAnalysis,
      generatedComment,
      processingTime,
      mediaType: 'image'
    };
  }

  /**
   * Baixa uma imagem do Instagram usando instagram-url-direct
   */
  private async downloadImage(imageUrl: string): Promise<string> {
    const data: InstagramResponse = await instagramGetUrl(imageUrl);
    console.log(data);
    
    const imageDirectUrl = data.media_details[0].url;
    const imageId = this.extractVideoId(imageUrl); // Reutiliza o método para extrair ID
    const tempDir = path.join(process.cwd(), 'temp_videos');
    
    // Criar diretório temporário se não existir
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Determinar extensão da imagem
    const imageExtension = imageDirectUrl.includes('.jpg') ? '.jpg' : '.png';
    const imagePath = path.join(tempDir, `${imageId}${imageExtension}`);
    
    // Baixar a imagem
    const response = await fetch(imageDirectUrl);
    if (!response.ok) {
      throw new Error(`Falha ao baixar imagem: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Salvar a imagem no disco
    fs.writeFileSync(imagePath, buffer);
    
    console.log(`📥 Imagem salva em: ${imagePath}`);
    return imagePath;
  }

  /**
   * Baixa um vídeo do Instagram usando yt-dlp
   */
  private async downloadVideo(videoUrl: string): Promise<string> {
    const videoId = this.extractVideoId(videoUrl);
    const tempDir = path.join(process.cwd(), 'temp_videos');

    // Criar diretório temporário se não existir
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const videoPath = path.join(tempDir, `${videoId}.%(ext)s`);
    const ytDlpPath = path.join(process.cwd(), 'yt-dlp', 'yt-dlp.exe');

    // Verificar se o yt-dlp existe
    if (!fs.existsSync(ytDlpPath)) {
      throw new Error(`yt-dlp não encontrado em: ${ytDlpPath}`);
    }

    return new Promise((resolve, reject) => {
      console.log(`📥 Baixando vídeo: ${videoUrl}`);

      const args = [
        videoUrl,
        '-o', videoPath,
        '--format', 'best[ext=mp4]/best',
        '--no-playlist',
      ];

      const ytDlp = spawn(ytDlpPath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      ytDlp.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(`yt-dlp: ${data.toString().trim()}`);
      });

      ytDlp.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(`yt-dlp error: ${data.toString().trim()}`);
      });

      ytDlp.on('close', (code) => {
        if (code === 0) {
          // Encontrar o arquivo baixado (yt-dlp pode mudar a extensão)
          const files = fs.readdirSync(tempDir).filter(file =>
            file.startsWith(videoId) && (file.endsWith('.mp4') || file.endsWith('.webm') || file.endsWith('.mkv'))
          );

          if (files.length > 0) {
            const downloadedFile = path.join(tempDir, files[0]);
            console.log(`✅ Vídeo baixado com sucesso: ${downloadedFile}`);
            resolve(downloadedFile);
          } else {
            reject(new Error('Arquivo de vídeo não encontrado após download'));
          }
        } else {
          reject(new Error(`yt-dlp falhou com código ${code}. Stderr: ${stderr}`));
        }
      });

      ytDlp.on('error', (error) => {
        reject(new Error(`Erro ao executar yt-dlp: ${error.message}`));
      });
    });
  }

  /**
   * Extrai ID do vídeo da URL do Instagram
   */
  private extractVideoId(url: string): string {
    const match = url.match(/\/(p|reel)\/([^/]+)\//);
    return match ? match[2] : `video_${Date.now()}`;
  }

  /**
   * Determina o MIME type do arquivo de vídeo ou imagem
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.mp4': return 'video/mp4';
      case '.mov': return 'video/quicktime';
      case '.avi': return 'video/x-msvideo';
      case '.webm': return 'video/webm';
      case '.jpg':
      case '.jpeg': return 'image/jpeg';
      case '.png': return 'image/png';
      case '.webp': return 'image/webp';
      case '.gif': return 'image/gif';
      default: return 'video/mp4'; // fallback
    }
  }

  /**
   * Constrói o prompt para análise de vídeo
   */
  private buildVideoAnalysisPrompt(caption?: string, username?: string): string {
    let prompt = `Analise este vídeo do Instagram e forneça uma descrição detalhada.`;

    if (caption) {
      prompt += `\n\nLegenda do post: "${caption}"`;
      prompt += `\nConsidere como o conteúdo se relaciona com a legenda.`;
    }

    if (username) {
      prompt += `\n\nEste vídeo foi postado por @${username}.`;
    }

    prompt += `\n\nSua análise deve ser:
- Detalhada e precisa
- Em português brasileiro`;
    if (caption) {
      prompt += `\n\n- Contextualizada com a legenda`;
    }

    return prompt;
  }

  /**
   * Constrói o prompt para análise de imagem
   */
  private buildImageAnalysisPrompt(caption?: string, username?: string): string {
    let prompt = `Analise esta imagem do Instagram e forneça uma descrição detalhada do conteúdo visual, objetos, pessoas, cenário, cores, composição, estilo e qualquer elemento relevante que você observar.`;

    if (caption) {
      prompt += `\n\nLegenda do post: "${caption}"`;
      prompt += `\nConsidere como o conteúdo se relaciona com a legenda.`;
    }

    if (username) {
      prompt += `\n\nEsta imagem foi postada por @${username}.`;
    }

    prompt += `\n\nSua análise deve ser:
- Detalhada e precisa
- Em português brasileiro
- Focada em elementos visuais relevantes para gerar comentários engajadores`;
    if (caption) {
      prompt += `\n- Contextualizada com a legenda`;
    }

    return prompt;
  }

  /**
   * Gera um comentário baseado na análise do vídeo
   */
  private async generateCommentFromAnalysis(
    videoAnalysis: string,
    caption?: string,
    username?: string
  ): Promise<string> {
    if (!this.googleAI) {
      throw new Error('Google AI não configurado');
    }

    const model = this.googleAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    let prompt = `Você é uma mulher comentando em vídeos aleatórios no Instagram para gerar engajamento. Com base na seguinte análise de vídeo, gere um comentário natural e engajador para o Instagram:\n\n`;
    prompt += `ANÁLISE DO VÍDEO:\n${videoAnalysis}\n\n`;

    if (caption) {
      prompt += `LEGENDA ORIGINAL: "${caption}"\n\n`;
    }

    if (username) {
      prompt += `USUÁRIO: @${username}\n\n`;
    }

    prompt += `INSTRUÇÕES PARA O COMENTÁRIO:`;
    prompt += `- Seja natural e autêntico`;
    prompt += `- Máximo de 2-3 frases`;
    prompt += `- Relacione com o conteúdo visual analisado`;
    prompt += `- Use emojis apropriados (1-2 no máximo)`;
    prompt += `- Evite ser genérico ou robótico`;
    prompt += `- Seja positivo e engajador`;
    prompt += `- Em português brasileiro`;
    prompt += `- Cometa algum erro de digitação proposital para parecer humano`;
    prompt += `- NÃO mencione que você analisou um vídeo\n`;
    prompt += `Gere APENAS o comentário, sem explicações adicionais:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;

    return response.text().trim();
  }
}