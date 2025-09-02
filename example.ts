import express from 'express';
import cors from 'cors';
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

async function getUserById(username: string, userId: string) {
  try {
    const db = getDatabaseConnection(username);
    return await db('users').where('id', userId).first();
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    throw error;
  }
}

async function getChatById(username: string, chatId: string) {
  try {
    const db = getDatabaseConnection(username);
    return await db('chats').where('id', chatId).first();
  } catch (error) {
    console.error('Erro ao buscar chat:', error);
    throw error;
  }
}

async function getMessagesByChatId(username: string, chatId: string) {
  try {
    const db = getDatabaseConnection(username);
    return await db('messages').where('chat_id', chatId).orderBy('timestamp', 'asc');
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
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

// Função para salvar mensagem no banco de dados
// ... existing code ...

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
      console.log(`   - Última contagem: ${state.last_message_count}`);
      console.log(`   - Tem snapshot: ${!!state.last_message_snapshot}`);
      console.log(`   - Última verificação: ${state.last_check}`);
    }
    
    return state || { chat_id: chatId, last_message_count: 0, last_message_snapshot: null };
  } catch (error) {
    console.error('Erro ao obter estado do chat:', error);
    return { chat_id: chatId, last_message_count: 0, last_message_snapshot: null };
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
  // Aqui você pode salvar mais mensagens se quiser mais precisão
  const lastMessages = messages.slice(-20).map((msg) => ({
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

  const lastMessages = JSON.parse(lastSnapshot) as any[];

  // Vamos alinhar as mensagens: comparar do fim para o começo
  let newMessages: any[] = [];

  for (let i = currentMessages.length - 1; i >= 0; i--) {
    const curr = currentMessages[i];
    const last = lastMessages.find(
      (msg) => msg.author === curr.author && msg.text === curr.text && msg.fromMe === curr.fromMe
    );

    if (!last) {
      // Não existia no snapshot anterior → é nova
      newMessages.unshift(curr);
    } else {
      // Encontramos uma mensagem igual → todas antes já estavam salvas
      break;
    }
  }

  console.log(`   🆕 Detectadas ${newMessages.length} mensagens novas`);
  return {
    newMessages,
    snapshot: createMessageSnapshot(currentMessages),
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
    const newSnapshot = createMessageSnapshot(messageData.messages || []);
    await updateChatState(
      username,
      messageData.chatId,
      newSnapshot
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

/**
 * @route POST /api/instagram/iniciar
 * @description Inicializa uma nova instância do Instagram com autenticação por credenciais ou cookies
 * @param {Object} req.body - Dados da requisição
 * @param {string} req.body.accountId - ID único da conta
 * @param {string} req.body.username - Nome de usuário do Instagram
 * @param {string} req.body.auth_type - Tipo de autenticação: "credentials" ou "cookie"
 * @param {string} [req.body.password] - Senha (obrigatório se auth_type = "credentials")
 * @param {string} [req.body.cookies] - String de cookies (obrigatório se auth_type = "cookie")
 * @returns {Object} 200 - Sucesso na inicialização
 * @returns {Object} 400 - Erro de validação
 * @returns {Object} 409 - Instância já existe
 * @returns {Object} 500 - Erro interno do servidor
 */
app.post('/api/instagram/iniciar', async (req, res) => {
  // console.log('Recebido request:', req.body);
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

    // Verificar se já existe uma instância ativa para este accountId
    if (activeInstances.has(accountId)) {
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

app.post('/api/instagram/likePost', async (req, res) => {
  const { username, postId } = req.body;
  const instance = activeInstances.get(username);
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: 'Perfil não encontrado ou não está ativo'
    });
  }

  const success = await instance.likePost(postId);
  if (success) {
    console.log(`✅ Post curtido ${postId} (${instance})`);
  }
  return success;


})

/**
 * @route GET /api/instagram/status/:username
 * @description Verifica o status detalhado de uma instância específica
 * @param {string} req.params.username - Nome de usuário da instância
 * @returns {Object} 200 - Status da instância (ativa ou inativa)
 * @returns {Object} 500 - Erro interno do servidor
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

// Endpoint para listar perfis ativos
app.get('/api/instagram/ativos', (req, res) => {
  const activeProfiles = Array.from(activeInstances.keys());

  return res.json({
    success: true,
    activeProfiles: activeProfiles.map(username => ({ username })),
    count: activeProfiles.length
  });
});

// Endpoint para verificar se uma instância específica está rodando
app.get('/api/instagram/verificar/:username', async (req, res) => {
  const { username } = req.params;
  const instance = activeInstances.get(username);

  if (!instance) {
    return res.json({
      success: true,
      username,
      isActive: false,
      status: 'stopped'
    });
  }

  try {
    // Verificar se a instância está realmente conectada e ativa
    const isLoggedIn = instance.loggedIn;
    const browserConnected = await instance.isBrowserConnected();
    const pageActive = await instance.isPageActive();
    const isReallyActive = isLoggedIn && browserConnected && pageActive;

    if (!isReallyActive) {
      // Remover instância inativa do mapa
      activeInstances.delete(username);
    }

    return res.json({
      success: true,
      username,
      isActive: isReallyActive,
      status: isReallyActive ? 'running' : 'stopped',
      details: {
        loggedIn: isLoggedIn,
        browserConnected: browserConnected,
        pageActive: pageActive
      }
    });
  } catch (error) {
    // Em caso de erro, remover a instância e retornar como parada
    activeInstances.delete(username);

    return res.json({
      success: true,
      username,
      isActive: false,
      status: 'error',
      error: 'Erro ao verificar conexão da instância'
    });
  }
});

// Endpoint para parar uma instância específica
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
 * @route POST /api/instagram/sendDirectMessage/:username
 * @description Envia uma mensagem direta para um usuário específico
 * @param {string} req.params.username - Nome de usuário da instância remetente
 * @param {Object} req.body - Dados da mensagem
 * @param {string} req.body.user - Nome de usuário do destinatário
 * @param {string} req.body.message - Texto da mensagem
 * @returns {Object} 200 - Mensagem enviada com sucesso
 * @returns {Object} 400 - Erro de validação
 * @returns {Object} 404 - Instância não encontrada
 * @returns {Object} 500 - Erro interno do servidor
 */
app.post('/api/instagram/sendDirectMessage/:username', async (req, res) => {
  const { username } = req.params;
  const { user, message } = req.body;

  // Validar campos obrigatórios
  if (!message) {
    return res.status(400).json({
      success: false,
      error: 'Campo message é obrigatório'
    });
  }

  const instance = activeInstances.get(username);
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: `Instância '${username}' não está rodando`
    });
  }

    try {
    const success = await instance.sendDirectMessage(user, message);

    if (success) {
      return res.json({
        success: true,
        message: 'Mensagem enviada com sucesso',
        username,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Falha ao enviar mensagem'
      });
    }
  } catch (error) {
    console.error(`Erro ao enviar mensagem para '${user}':`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao enviar mensagem'
    });
  }
});

// Endpoint para responder mensagem usando ID do chat
app.post('/api/instagram/responder/:username', async (req, res) => {
  const { username } = req.params;
  const { chatId, message } = req.body;

  // Validar campos obrigatórios
  if (!chatId || !message) {
    return res.status(400).json({
      success: false,
      error: 'Campos obrigatórios: chatId, message'
    });
  }

  const instance = activeInstances.get(username);
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: `Instância '${username}' não está rodando`
    });
  }

  try {
    const success = await instance.replyMessage(chatId, message);

    if (success) {
      return res.json({
        success: true,
        message: 'Mensagem respondida com sucesso',
        username,
        chatId
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Falha ao responder mensagem'
      });
    }
  } catch (error) {
    console.error(`Erro ao responder mensagem para '${username}':`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao responder mensagem'
    });
  }
});

// Endpoint para monitorar posts de usuários
app.post('/api/instagram/monitorar-posts/:username', async (req, res) => {
  const { username } = req.params;
  const { usernames, checkInterval, maxExecutions } = req.body;

  // Validar campos obrigatórios
  if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Campo usernames é obrigatório e deve ser um array não vazio'
    });
  }

  const instance = activeInstances.get(username);
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: `Instância '${username}' não está rodando`
    });
  }

  try {
    // Inicia o monitoramento de posts
    instance.monitorNewPostsFromUsers({
      usernames,
      checkInterval: checkInterval || 60000,
      maxExecutions,
      onNewPosts: (posts, executionCount, totalTime) => {
        console.log(`📸 Novos posts detectados para ${username} (execução ${executionCount}, tempo: ${Math.round(totalTime / 1000)}s):`, posts);
        // Aqui você pode implementar lógica adicional como webhook, notificação, etc.
      }
    });

    return res.json({
      success: true,
      message: 'Monitoramento de posts iniciado com sucesso',
      username,
      monitoredUsers: usernames,
      checkInterval: checkInterval || 60000,
      maxExecutions: maxExecutions || 'ilimitado'
    });
  } catch (error) {
    console.error(`Erro ao iniciar monitoramento de posts para '${username}':`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao iniciar monitoramento de posts'
    });
  }
});

// Endpoint para parar monitoramento de posts
app.post('/api/instagram/parar-monitoramento-posts/:username', async (req, res) => {
  const { username } = req.params;

  const instance = activeInstances.get(username);
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: `Instância '${username}' não está rodando`
    });
  }

  try {
    instance.switchPostsMonitoring(false);

    return res.json({
      success: true,
      message: 'Monitoramento de posts parado com sucesso',
      username
    });
  } catch (error) {
    console.error(`Erro ao parar monitoramento de posts para '${username}':`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao parar monitoramento de posts'
    });
  }
});

/**
 * @route POST /api/instagram/monitorar-mensagens/:username
 * @description Inicia o monitoramento de novas mensagens diretas
 * @param {string} req.params.username - Nome de usuário da instância
 * @param {Object} req.body - Configurações do monitoramento
 * @param {boolean} [req.body.includeRequests=false] - Incluir solicitações de mensagem
 * @returns {Object} 200 - Monitoramento iniciado com sucesso
 * @returns {Object} 404 - Instância não encontrada
 * @returns {Object} 500 - Erro interno do servidor
 */
app.post('/api/instagram/monitorar-mensagens/:username', async (req, res) => {
  const { username } = req.params;
  const { checkInterval, includeRequests } = req.body;

  const instance = activeInstances.get(username);
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: `Instância '${username}' não está rodando`
    });
  }
  instance.switchMessagesMonitoring(true);
  try {
    // Inicia o monitoramento de mensagens
    instance.monitorNewMessages({
      includeRequests: includeRequests || false,
      onNewMessage: async (data) => {
        // console.log(`💬 Nova mensagem detectada para ${username}:`, data);
        
        // Salvar mensagem no banco de dados
        await saveMessageToDatabase(username, data);
        
        // Aqui você pode implementar lógica adicional como webhook, notificação, etc.
      }
    });

    return res.json({
      success: true,
      message: 'Monitoramento de mensagens iniciado com sucesso',
      username,
      includeRequests: includeRequests || false
    });
  } catch (error) {
    console.error(`Erro ao iniciar monitoramento de mensagens para '${username}':`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao iniciar monitoramento de mensagens'
    });
  }
});

// Endpoint para parar monitoramento de mensagens
app.post('/api/instagram/parar-monitoramento-mensagens/:username', async (req, res) => {
  const { username } = req.params;

  const instance = activeInstances.get(username);
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: `Instância '${username}' não está rodando`
    });
  }

  try {
    instance.switchMessagesMonitoring(false);

    return res.json({
      success: true,
      message: 'Monitoramento de mensagens parado com sucesso',
      username
    });
  } catch (error) {
    console.error(`Erro ao parar monitoramento de mensagens para '${username}':`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao parar monitoramento de mensagens'
    });
  }
});



// Inicializar servidor

const server = app.listen(PORT, () => {
  console.log(`🚀 API Instagram rodando na porta ${PORT}`);
  console.log(`📚 Documentação completa: API_DOCUMENTATION.md`);
  console.log(`\n📡 Endpoints disponíveis:`);
  
  console.log(`\n🔐 AUTENTICAÇÃO:`);
  console.log(`   POST /api/instagram/iniciar - Body: {accountId: string, username: string, auth_type: "credentials"|"cookie", password?: string, cookies?: string}`);
  
  console.log(`\n📊 STATUS & CONTROLE:`);
  console.log(`   GET  /api/instagram/status/:username  - Status detalhado da instância`);
  console.log(`   GET  /api/instagram/verificar/:username  - Verificação simples se está ativo`);
  console.log(`   POST /api/instagram/parar/:username  - Para uma instância específica`);
  console.log(`   GET  /api/instagram/ativos  - Lista todas as instâncias ativas`);
  
  console.log(`\n💬 MENSAGENS:`);
  console.log(`   POST /api/instagram/mensagem-direta/:username - Body: {user: string, message: string}`);
  console.log(`   POST /api/instagram/responder/:username - Body: {chatId: string, message: string}`);
  
  console.log(`\n🔍 MONITORAMENTO:`);
  console.log(`   POST /api/instagram/monitorar-mensagens/:username - Body: {includeRequests?: boolean}`);
  console.log(`   POST /api/instagram/parar-monitoramento-mensagens/:username`);
  console.log(`   POST /api/instagram/monitorar-posts/:username - Body: {usernames: string[], checkInterval?: number, maxExecutions?: number}`);
  console.log(`   POST /api/instagram/parar-monitoramento-posts/:username`);
  
  console.log(`\n❤️ INTERAÇÕES:`);
  console.log(`   POST /api/instagram/like-post/:username - Body: {postId: string}`);
  console.log(`   POST /api/instagram/comment-post/:username - Body: {postId: string, comment: string}`);
  console.log(`   POST /api/instagram/follow-user/:username - Body: {username: string}`);
  console.log(`   POST /api/instagram/unfollow-user/:username - Body: {username: string}`);
  
  console.log(`\n💡 Servidor mantido ativo. Use Ctrl+C para encerrar.`);
  console.log(`📖 Para documentação detalhada, consulte: API_DOCUMENTATION.md`);
});
// Manter o processo ativo
process.stdin.resume();

// Tratar erros do servidor
server.on('error', (error) => {
  console.error('❌ Erro no servidor:', error);
});

// Evitar que o processo termine inesperadamente
process.on('uncaughtException', (error) => {
  console.error('❌ Exceção não capturada:', error);
  console.log('🔄 Servidor continuará rodando...');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
  console.log('🔄 Servidor continuará rodando...');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Finalizando todas as instâncias ativas...');

  const promises = Array.from(activeInstances.values()).map(ig => ig.close());
  await Promise.all(promises);

  console.log('✅ Todas as instâncias finalizadas. Servidor encerrado.');
  process.exit(0);
});

export type { InstagramAccount, InstagramAuthType };