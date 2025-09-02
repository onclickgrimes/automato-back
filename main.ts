import express from 'express';
import cors from 'cors';
import { Instagram, InstagramConfig } from './src';
import * as fs from 'fs';
import * as path from 'path';
import knex from 'knex';
const knexConfig = require('./knexfile');
import { WorkflowProcessor, Workflow, WorkflowResult, validateWorkflow } from './WorkflowProcessor';

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

// Interfaces
type InstagramAuthType = 'credentials' | 'cookie';

interface InstagramAccount {
  id: string;
  username: string;
  auth_type: InstagramAuthType;
  password?: string | null;
  cookie?: string | null;
}

interface InitializeRequest {
  accountId: string;
  username: string;
  auth_type: InstagramAuthType;
  password?: string;
  cookies?: string;
}

// Mapa para armazenar instâncias ativas do Instagram
const activeInstances = new Map<string, Instagram>();

// Funções auxiliares do banco de dados
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

// Criar aplicação Express
const app = express();
const PORT = 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Função para garantir que o diretório existe
function ensureDirectoryExists(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Função para salvar cookies
function saveCookies(username: string, cookies: string | object) {
  const userDir = path.join(__dirname, 'puppeteer-cache', username);
  ensureDirectoryExists(userDir);

  const cookiesPath = path.join(userDir, `${username}.json`);
  const cookiesString = typeof cookies === 'string' ? cookies : JSON.stringify(cookies, null, 2);
  fs.writeFileSync(cookiesPath, cookiesString, 'utf8');

  return cookiesPath;
}

// Função para carregar cookies
function loadCookies(username: string): string | null {
  const cookiesPath = path.join(__dirname, 'puppeteer-cache', username, `${username}.json`);

  if (fs.existsSync(cookiesPath)) {
    return fs.readFileSync(cookiesPath, 'utf8');
  }

  return null;
}

// Instância do WorkflowProcessor
const workflowProcessor = new WorkflowProcessor(
  activeInstances,
  initializeDatabaseForUser,
  saveMessageToDatabase
);

// Mapa para armazenar workflows em execução
const runningWorkflows = new Map<string, Promise<WorkflowResult>>();

/**
 * @route POST /api/instagram/iniciar
 * @description Inicializa uma nova instância do Instagram com autenticação por credenciais ou cookies
 */
app.post('/api/instagram/iniciar', async (req, res) => {
  try {
    const { accountId, username, auth_type, password, cookies, cookie }: InitializeRequest & { cookie?: string | object } = req.body;

    // Usar 'cookies' ou 'cookie' (compatibilidade)
    const cookieData = cookies || cookie;

    // Validações básicas
    if (!accountId || !username || !auth_type) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: accountId, username, auth_type'
      });
    }

    if (auth_type === 'credentials' && !password) {
      return res.status(400).json({
        success: false,
        error: 'Password é obrigatório quando auth_type é credentials'
      });
    }

    if (auth_type === 'cookie' && !cookieData) {
      return res.status(400).json({
        success: false,
        error: 'Cookies são obrigatórios quando auth_type é cookies'
      });
    }

    // Verificar se já existe uma instância ativa para este username
    if (activeInstances.has(username)) {
      return res.status(200).json({
        success: true,
        message: 'Perfil já está ativo',
        accountId,
        username
      });
    }

    // Configurar Instagram baseado no tipo de autenticação
    let config: InstagramConfig;

    if (auth_type === 'credentials') {
      config = {
        username,
        password: password!,
        headless: false,
        userDataDir: `./puppeteer-cache/${username}/user-data`,
        cookiesPath: `./puppeteer-cache/${username}/${username}.json`
      };
    } else {
      // Salvar cookies no arquivo
      const cookiesPath = saveCookies(username, cookieData!);

      config = {
        username,
        password: '', // Não usado quando usando cookies
        headless: false,
        userDataDir: `./puppeteer-cache/${username}/user-data`,
        cookiesPath
      };
    }

    // Criar instância do Instagram
    const ig = new Instagram(config);

    // Inicializar
    await ig.init();

    // Verificar se o login foi bem-sucedido
    if (!ig.loggedIn) {
      return res.status(401).json({
        success: false,
        error: 'Falha na autenticação. Verifique as credenciais ou cookies.'
      });
    }
    
    console.log("LOGGED: ", ig.loggedIn);
    
    // Inicializar banco de dados para o usuário
    await initializeDatabaseForUser(username);

    // Armazenar a instância ativa usando username como chave
    activeInstances.set(username, ig);

    return res.status(200).json({
      success: true,
      message: 'Perfil inicializado com sucesso',
      accountId,
      username,
      auth_type
    });

  } catch (error) {
    console.error('Erro ao inicializar perfil:', error);

    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

/**
 * @route GET /api/instagram/status/:username
 * @description Verifica o status detalhado de uma instância específica
 */
app.get('/api/instagram/status/:username', async (req, res) => {
  const { username } = req.params;

  const instance = activeInstances.get(username);
  if (!instance) {
    return res.json({
      success: false,
      username,
      isActive: false,
      status: 'not_found',
      error: 'Perfil não encontrado ou não está ativo'
    });
  }

  try {
    // Verificar se a instância está realmente conectada e ativa
    const isLoggedIn = instance.loggedIn;
    const browserConnected = await instance.isBrowserConnected();
    const pageActive = await instance.isPageActive();

    if (!isLoggedIn || !browserConnected || !pageActive) {
      // Remover instância inativa do mapa
      activeInstances.delete(username);

      return res.json({
        success: false,
        username,
        isActive: false,
        status: 'disconnected',
        details: {
          loggedIn: isLoggedIn,
          browserConnected: browserConnected,
          pageActive: pageActive
        },
        error: 'Instância foi desconectada ou fechada'
      });
    }

    return res.json({
      success: true,
      username,
      isActive: true,
      status: 'active',
      details: {
        loggedIn: isLoggedIn,
        browserConnected: browserConnected,
        pageActive: pageActive
      }
    });
  } catch (error) {
    // Em caso de erro, remover a instância e retornar como desconectada
    activeInstances.delete(username);

    return res.json({
      success: false,
      username,
      isActive: false,
      status: 'error',
      error: 'Erro ao verificar status da instância'
    });
  }
});

/**
 * @route POST /api/instagram/parar/:username
 * @description Para uma instância específica do Instagram
 */
app.post('/api/instagram/parar/:username', async (req, res) => {
  const { username } = req.params;

  const instance = activeInstances.get(username);
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: `Instância '${username}' não está rodando`
    });
  }

  try {
    await instance.close();
    activeInstances.delete(username);

    return res.json({
      success: true,
      message: `Instância '${username}' parada com sucesso`,
      username
    });
  } catch (error) {
    console.error(`Erro ao parar instância '${username}':`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao parar instância'
    });
  }
});

/**
 * @route POST /api/workflow/execute
 * @description Executa um workflow
 */
app.post('/api/workflow/execute', async (req, res) => {
  try {
    const { workflow, instagramConfig } = req.body;

    if (!workflow) {
      return res.status(400).json({
        success: false,
        error: 'Campo workflow é obrigatório'
      });
    }

    // Validar estrutura do workflow
    const validation = validateWorkflow(workflow);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Workflow inválido',
        details: validation.errors
      });
    }

    // Verificar se já existe um workflow rodando com o mesmo ID
    if (runningWorkflows.has(workflow.id)) {
      return res.status(409).json({
        success: false,
        error: `Workflow '${workflow.id}' já está em execução`
      });
    }

    if (!activeInstances.has(workflow.username)) {
      return res.status(400).json({
        success: false,
        error: `Instância para ${workflow.username} não está ativa`
      });
    }

    // Executar workflow de forma assíncrona
    const workflowPromise = workflowProcessor.executeWorkflow(workflow, instagramConfig);
    runningWorkflows.set(workflow.id, workflowPromise);

    // Remover da lista quando terminar
    workflowPromise.finally(() => {
      runningWorkflows.delete(workflow.id);
    });

    return res.json({
      success: true,
      message: `Workflow '${workflow.id}' iniciado com sucesso`,
      workflowId: workflow.id,
      status: 'running'
    });

  } catch (error) {
    console.error('Erro ao executar workflow:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

/**
 * @route GET /api/workflow/status/:workflowId
 * @description Verifica o status de um workflow
 */
app.get('/api/workflow/status/:workflowId', async (req, res) => {
  const { workflowId } = req.params;

  try {
    // Verificar se está rodando
    const isRunning = runningWorkflows.has(workflowId);
    
    // Obter resultado se existir
    const result = workflowProcessor.getWorkflowResult(workflowId);

    if (isRunning) {
      return res.json({
        success: true,
        workflowId,
        status: 'running',
        message: 'Workflow está em execução'
      });
    }

    if (result) {
      return res.json({
        success: true,
        workflowId,
        status: result.success ? 'completed' : 'failed',
        result: result
      });
    }

    return res.status(404).json({
      success: false,
      workflowId,
      status: 'not_found',
      error: 'Workflow não encontrado'
    });

  } catch (error) {
    console.error('Erro ao verificar status do workflow:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

/**
 * @route POST /api/workflow/stop/:workflowId
 * @description Para a execução de um workflow
 */
app.post('/api/workflow/stop/:workflowId', async (req, res) => {
  const { workflowId } = req.params;

  try {
    const isRunning = runningWorkflows.has(workflowId);
    
    if (!isRunning) {
      return res.status(404).json({
        success: false,
        error: `Workflow '${workflowId}' não está em execução`
      });
    }

    // Tentar parar o workflow
    const stopped = await workflowProcessor.stopWorkflow(workflowId);
    
    if (stopped) {
      // Remover da lista de execução
      runningWorkflows.delete(workflowId);
      
      return res.json({
        success: true,
        message: `Workflow '${workflowId}' foi interrompido`,
        workflowId
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Não foi possível parar o workflow'
    });

  } catch (error) {
    console.error('Erro ao parar workflow:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

/**
 * @route GET /api/workflow/list
 * @description Lista todos os workflows executados
 */
app.get('/api/workflow/list', (req, res) => {
  try {
    const results = workflowProcessor.getAllResults();
    const runningIds = Array.from(runningWorkflows.keys());

    return res.json({
      success: true,
      workflows: results.map(result => ({
        workflowId: result.workflowId,
        status: runningIds.includes(result.workflowId) ? 'running' : 
                result.success ? 'completed' : 'failed',
        executionTime: result.executionTime,
        startTime: result.startTime,
        endTime: result.endTime,
        executedSteps: result.executedSteps.length,
        failedSteps: result.failedSteps.length
      })),
      running: runningIds,
      total: results.length
    });
  } catch (error) {
    console.error('Erro ao listar workflows:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📋 Rotas disponíveis:`);
  console.log(`   POST /api/instagram/iniciar - Inicializar instância do Instagram`);
  console.log(`   GET  /api/instagram/status/:username - Verificar status da instância`);
  console.log(`   POST /api/instagram/parar/:username - Parar instância`);
  console.log(`   POST /api/workflow/execute - Executar workflow`);
  console.log(`   GET  /api/workflow/status/:workflowId - Status do workflow`);
  console.log(`   POST /api/workflow/stop/:workflowId - Parar workflow`);
  console.log(`   GET  /api/workflow/list - Listar workflows`);
});

// Tratamento de erros e cleanup
process.stdin.resume();

server.on('error', (error) => {
  console.error('❌ Erro no servidor:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Exceção não capturada:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando servidor...');
  
  // Fechar todas as instâncias ativas
  for (const [username, instance] of activeInstances) {
    try {
      console.log(`📱 Fechando instância: ${username}`);
      await instance.close();
    } catch (error) {
      console.error(`❌ Erro ao fechar instância ${username}:`, error);
    }
  }
  
  server.close(() => {
    console.log('✅ Servidor encerrado');
    process.exit(0);
  });
});

export type { InstagramAccount, InstagramAuthType };
export { workflowProcessor, activeInstances };