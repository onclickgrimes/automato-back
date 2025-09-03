import knex from 'knex';
const knexConfig = require('../knexfile');

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

export {
  getDatabaseConnection,
  createUser,
  createChat,
  createMessage,
  initializeDatabaseForUser,
  getChatState,
  updateChatState,
  createMessageSnapshot,
  detectNewMessages,
  saveMessageToDatabase
};