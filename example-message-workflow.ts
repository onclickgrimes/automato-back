import { Workflow, WorkflowProcessor } from './WorkflowProcessor';
import { Instagram } from './src';

/**
 * Exemplo de workflow para iniciar e parar o processamento automatizado de mensagens
 * Este exemplo demonstra como usar os novos tipos de workflow:
 * - startMessageProcessor: Inicia o sistema de resposta automatizada
 * - stopMessageProcessor: Para o sistema de resposta automatizada
 */

// Exemplo de workflow completo
const messageWorkflowExample: Workflow = {
  id: 'message-automation-workflow',
  name: 'Automação de Resposta de Mensagens',
  description: 'Workflow para gerenciar resposta automatizada de mensagens do Instagram',
  username: 'seu_username_aqui', // Substitua pelo username real
  steps: [
    {
      id: 'start-message-processing',
      name: 'Iniciar Processamento de Mensagens',
      actions: [
        {
          type: 'startMessageProcessor',
          params: {
            aiConfig: {
              openaiApiKey: process.env.OPENAI_API_KEY, // Será carregada do .env
              googleApiKey: process.env.GOOGLE_AI_API_KEY, // Será carregada do .env
              temperature: 0.7,
              maxTokens: 150
            },
            processingConfig: {
              checkInterval: 30000, // Verificar mensagens a cada 30 segundos (será convertido para minutos)
              maxMessagesPerBatch: 5, // Processar até 5 mensagens por vez
              delayBetweenReplies: { min: 2000, max: 5000 }, // Delay entre respostas (2-5 segundos)
              enableHumanization: true // Ativar humanização das respostas
            }
          },
          description: 'Inicia o sistema de resposta automatizada de mensagens'
        }
      ]
    },
    {
      id: 'delay-processing',
      name: 'Aguardar Processamento',
      actions: [
        {
          type: 'delay',
          params: {
            duration: 60000 // Aguardar 1 minuto (60 segundos)
          },
          description: 'Aguarda o processamento de mensagens por 1 minuto'
        }
      ],
      condition: {
        type: 'success',
        previousStep: 'start-message-processing'
      }
    },
    {
      id: 'stop-message-processing',
      name: 'Parar Processamento de Mensagens',
      actions: [
        {
          type: 'stopMessageProcessor',
          params: {},
          description: 'Para o sistema de resposta automatizada de mensagens'
        }
      ],
      condition: {
        type: 'success',
        previousStep: 'delay-processing'
      }
    }
  ],
  config: {
    stopOnError: true,
    logLevel: 'info',
    timeout: 300000 // Timeout de 5 minutos
  }
};

// Exemplo de workflow apenas para iniciar
const startOnlyWorkflow: Workflow = {
  id: 'start-message-processor-only',
  name: 'Apenas Iniciar Processamento',
  description: 'Workflow para apenas iniciar o processamento de mensagens',
  username: 'seu_username_aqui',
  steps: [
    {
      id: 'start-only',
      name: 'Iniciar Processamento',
      actions: [
        {
          type: 'startMessageProcessor',
          params: {
            aiConfig: {
              temperature: 0.8,
              maxTokens: 200
            },
            processingConfig: {
              checkInterval: 15000, // Verificar a cada 15 segundos
              maxMessagesPerBatch: 3,
              delayBetweenReplies: { min: 1000, max: 3000 },
              enableHumanization: true
            }
          }
        }
      ]
    }
  ]
};

// Exemplo de workflow apenas para parar
const stopOnlyWorkflow: Workflow = {
  id: 'stop-message-processor-only',
  name: 'Apenas Parar Processamento',
  description: 'Workflow para apenas parar o processamento de mensagens',
  username: 'seu_username_aqui',
  steps: [
    {
      id: 'stop-only',
      name: 'Parar Processamento',
      actions: [
        {
          type: 'stopMessageProcessor',
          params: {}
        }
      ]
    }
  ]
};

/**
 * Função de exemplo para executar os workflows
 */
export async function runMessageWorkflowExample() {
  // Configurar instâncias ativas (normalmente isso seria feito no main.ts)
  const activeInstances = new Map<string, Instagram>();
  
  // Funções de callback (normalmente definidas no main.ts)
  const initializeDatabaseForUser = async (username: string) => {
    console.log(`Inicializando database para ${username}`);
  };
  
  const saveMessageToDatabase = async (username: string, messageData: any) => {
    console.log(`Salvando mensagem para ${username}:`, messageData);
  };
  
  // Criar o processador de workflow
  const workflowProcessor = new WorkflowProcessor(
    activeInstances,
    initializeDatabaseForUser,
    saveMessageToDatabase
  );
  
  try {
    console.log('🚀 Executando workflow de exemplo...');
    
    // Executar o workflow completo
    const result = await workflowProcessor.executeWorkflow(messageWorkflowExample);
    
    console.log('✅ Workflow executado com sucesso!');
    console.log('Resultado:', {
      success: result.success,
      executedSteps: result.executedSteps,
      executionTime: result.executionTime,
      error: result.error
    });
    
  } catch (error) {
    console.error('❌ Erro ao executar workflow:', error);
  }
}

// Exportar os workflows de exemplo
export {
  messageWorkflowExample,
  startOnlyWorkflow,
  stopOnlyWorkflow
};

/**
 * INSTRUÇÕES DE USO:
 * 
 * 1. Certifique-se de que o arquivo .env está configurado com as chaves de API:
 *    - OPENAI_API_KEY=sua_chave_openai
 *    - GOOGLE_AI_API_KEY=sua_chave_google
 * 
 * 2. Substitua 'seu_username_aqui' pelo username real da instância do Instagram
 * 
 * 3. Para executar o exemplo:
 *    import { runMessageWorkflowExample } from './example-message-workflow';
 *    runMessageWorkflowExample();
 * 
 * 4. Para usar workflows individuais:
 *    import { messageWorkflowExample, startOnlyWorkflow, stopOnlyWorkflow } from './example-message-workflow';
 *    
 *    // Executar workflow completo
 *    await workflowProcessor.executeWorkflow(messageWorkflowExample);
 *    
 *    // Ou apenas iniciar
 *    await workflowProcessor.executeWorkflow(startOnlyWorkflow);
 *    
 *    // Ou apenas parar
 *    await workflowProcessor.executeWorkflow(stopOnlyWorkflow);
 */