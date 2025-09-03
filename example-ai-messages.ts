import { AIService, AIConfig } from './src/AIService';
import { MessageProcessor, MessageProcessorConfig } from './src/MessageProcessor';
import { Instagram } from './src/Instagram';

/**
 * Exemplo de uso das classes AIService e MessageProcessor
 * para resposta automatizada de mensagens do Instagram
 */

// Configuração da IA
const aiConfig: AIConfig = {
  // Adicione suas chaves de API aqui
  openaiApiKey: process.env.OPENAI_API_KEY, // 'sk-...'
  googleApiKey: process.env.GOOGLE_API_KEY, // 'AIza...'
  defaultProvider: 'openai', // ou 'google'
  temperature: 0.7, // Criatividade da resposta (0-1)
  maxTokens: 150 // Máximo de tokens por resposta
};

// Configuração do processador de mensagens
const processorConfig: MessageProcessorConfig = {
  checkInterval: 5, // Verificar a cada 5 minutos
  maxMessagesPerBatch: 10, // Processar até 10 mensagens por vez
  minResponseDelay: 30000, // Mínimo 30 segundos entre respostas
  maxResponseDelay: 180000, // Máximo 3 minutos entre respostas
  timeWindowHours: 24, // Buscar mensagens das últimas 24 horas
  enableHumanization: true // Ativar delays humanizados
};

async function initializeAIMessageSystem() {
  try {
    console.log('🤖 Inicializando sistema de resposta automatizada...');
    
    // 1. Inicializar serviço de IA
    const aiService = new AIService(aiConfig);
    
    // Verificar se está configurado corretamente
    if (!aiService.isConfigured()) {
      throw new Error('❌ AIService não está configurado. Verifique as chaves de API.');
    }
    
    console.log(`✅ AIService configurado com provedores: ${aiService.getAvailableProviders().join(', ')}`);
    
    // 2. Inicializar processador de mensagens
    const messageProcessor = new MessageProcessor(aiService, processorConfig);
    
    // 3. Exemplo de como registrar instâncias do Instagram
    // (você precisaria ter suas instâncias do Instagram já inicializadas)
    /*
    const instagramUser1 = new Instagram();
    await instagramUser1.initialize('username1', 'password1');
    messageProcessor.registerInstagramInstance('username1', instagramUser1);
    
    const instagramUser2 = new Instagram();
    await instagramUser2.initialize('username2', 'password2');
    messageProcessor.registerInstagramInstance('username2', instagramUser2);
    */
    
    // 4. Iniciar processamento automático
    messageProcessor.startAutoProcessing();
    
    console.log('🚀 Sistema de resposta automatizada iniciado!');
    console.log('📊 Para ver estatísticas, use: messageProcessor.getStats()');
    
    // 5. Exemplo de processamento manual de uma mensagem específica
    // await messageProcessor.processSpecificMessage('username1', 123);
    
    // 6. Exemplo de teste da IA
    await testAIService(aiService);
    
    return { aiService, messageProcessor };
    
  } catch (error) {
    console.error('❌ Erro ao inicializar sistema:', error);
    throw error;
  }
}

/**
 * Função para testar o serviço de IA
 */
async function testAIService(aiService: AIService) {
  try {
    console.log('\n🧪 Testando AIService...');
    
    const testContext = {
      username: 'joao_teste',
      messageContent: 'Oi! Como você está?',
      conversationHistory: [
        'joao_teste: Olá!',
        'Eu: Oi João! Tudo bem?'
      ],
      userProfile: {
        name: 'João Silva',
        bio: 'Desenvolvedor apaixonado por tecnologia',
        followersCount: 1500
      }
    };
    
    // Testar resposta única
    console.log('📝 Gerando resposta única...');
    const response = await aiService.generateResponse(testContext);
    console.log(`✅ Resposta (${response.provider}): "${response.content}"`);
    console.log(`⏱️ Tempo de processamento: ${response.processingTime}ms`);
    
    // Testar múltiplas respostas
    console.log('\n📝 Gerando múltiplas respostas...');
    const multipleResponses = await aiService.generateMultipleResponses(testContext, 3);
    
    multipleResponses.forEach((resp, index) => {
      console.log(`${index + 1}. (${resp.provider}): "${resp.content}"`);
    });
    
    // Selecionar melhor resposta
    const bestResponse = aiService.selectBestResponse(multipleResponses);
    console.log(`🏆 Melhor resposta: "${bestResponse.content}"`);
    
  } catch (error) {
    console.error('❌ Erro no teste da IA:', error);
  }
}

/**
 * Função para monitorar estatísticas do sistema
 */
function startStatsMonitoring(messageProcessor: MessageProcessor) {
  setInterval(() => {
    const stats = messageProcessor.getStats();
    
    if (stats.totalProcessed > 0) {
      console.log('\n📊 Estatísticas do Sistema:');
      console.log(`   Total processadas: ${stats.totalProcessed}`);
      console.log(`   Respostas enviadas: ${stats.successfulResponses}`);
      console.log(`   Falhas: ${stats.failedResponses}`);
      console.log(`   Taxa de sucesso: ${((stats.successfulResponses / stats.totalProcessed) * 100).toFixed(1)}%`);
      console.log(`   Última execução: ${stats.lastProcessingTime.toLocaleString()}`);
    }
  }, 10 * 60 * 1000); // A cada 10 minutos
}

/**
 * Função para parar o sistema graciosamente
 */
function stopSystem(messageProcessor: MessageProcessor) {
  console.log('🛑 Parando sistema de resposta automatizada...');
  messageProcessor.stopAutoProcessing();
  
  // Mostrar estatísticas finais
  const finalStats = messageProcessor.getStats();
  console.log('📊 Estatísticas finais:', finalStats);
  
  console.log('✅ Sistema parado com sucesso!');
}

// Exemplo de uso
if (require.main === module) {
  initializeAIMessageSystem()
    .then(({ aiService, messageProcessor }) => {
      // Iniciar monitoramento de estatísticas
      startStatsMonitoring(messageProcessor);
      
      // Configurar parada graceful
      process.on('SIGINT', () => {
        stopSystem(messageProcessor);
        process.exit(0);
      });
      
      process.on('SIGTERM', () => {
        stopSystem(messageProcessor);
        process.exit(0);
      });
      
      console.log('\n💡 Dicas de uso:');
      console.log('   - Configure as variáveis de ambiente OPENAI_API_KEY e/ou GOOGLE_API_KEY');
      console.log('   - Registre suas instâncias do Instagram com messageProcessor.registerInstagramInstance()');
      console.log('   - Use Ctrl+C para parar o sistema graciosamente');
      console.log('   - Monitore os logs para acompanhar o processamento');
      
    })
    .catch(error => {
      console.error('❌ Falha ao inicializar sistema:', error);
      process.exit(1);
    });
}

export {
  initializeAIMessageSystem,
  testAIService,
  startStatsMonitoring,
  stopSystem
};

/**
 * INSTRUÇÕES DE USO:
 * 
 * 1. Configure as variáveis de ambiente:
 *    - OPENAI_API_KEY=sk-...
 *    - GOOGLE_API_KEY=AIza...
 * 
 * 2. Execute o exemplo:
 *    npx ts-node example-ai-messages.ts
 * 
 * 3. O sistema irá:
 *    - Verificar mensagens não respondidas a cada 5 minutos
 *    - Gerar respostas humanizadas usando IA
 *    - Aplicar delays aleatórios entre respostas (30s-3min)
 *    - Enviar respostas via Instagram
 *    - Marcar mensagens como respondidas no banco
 * 
 * 4. Funcionalidades anti-detecção:
 *    - Delays humanizados entre respostas
 *    - Variação no tempo de resposta
 *    - Respostas contextuais baseadas no histórico
 *    - Múltiplas variações de resposta para escolher a melhor
 * 
 * 5. Monitoramento:
 *    - Logs detalhados de todas as operações
 *    - Estatísticas de performance
 *    - Controle de erros e fallbacks
 */