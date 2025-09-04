// Configurar dotenv primeiro para carregar variáveis de ambiente
import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { Instagram, InstagramConfig } from './src';
import * as fs from 'fs';
import * as path from 'path';
import { WorkflowProcessor, Workflow, WorkflowResult, validateWorkflow } from './WorkflowProcessor';
import { initializeDatabaseForUser, saveMessageToDatabase } from './src/MessagesDatabase';

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

// Mapa para armazenar conexões SSE ativas por username
const sseConnections = new Map<string, express.Response[]>();

// Função para enviar log para todas as conexões SSE de uma instância
function sendLogToFrontend(username: string, logEntry: {
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp?: string;
}) {
  const connections = sseConnections.get(username) || [];
  const logData = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: logEntry.timestamp || new Date().toLocaleTimeString(),
    level: logEntry.level,
    message: logEntry.message
  };
  
  connections.forEach(res => {
    try {
      res.write(`data: ${JSON.stringify(logData)}\n\n`);
    } catch (error) {
      console.error('Erro ao enviar log via SSE:', error);
    }
  });
}

// Criar aplicação Express
const app = express();
const PORT = 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Endpoint SSE para logs da instância em tempo real
app.get('/api/instagram/logs/:username', (req, res) => {
  const { username } = req.params;
  
  // Configurar headers SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  
  // Adicionar conexão ao mapa
  if (!sseConnections.has(username)) {
    sseConnections.set(username, []);
  }
  sseConnections.get(username)!.push(res);
  
  console.log(`📡 Nova conexão SSE para logs de @${username}`);
  
  // Enviar log inicial de conexão
  sendLogToFrontend(username, {
    level: 'info',
    message: `📡 Conectado aos logs da instância @${username}`
  });
  
  // Cleanup quando conexão for fechada
  req.on('close', () => {
    const connections = sseConnections.get(username) || [];
    const index = connections.indexOf(res);
    if (index !== -1) {
      connections.splice(index, 1);
      console.log(`📡 Conexão SSE removida para @${username}`);
    }
    
    if (connections.length === 0) {
      sseConnections.delete(username);
    }
  });
});

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
  saveMessageToDatabase,
  'http://localhost:3000', // Frontend endpoint
  '/api/instagram-accounts/posts', // Supabase route
  sendLogToFrontend // Callback para logs SSE
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

    // Enviar log inicial
    sendLogToFrontend(username, {
      level: 'info',
      message: `🚀 Iniciando instância para @${username}...`
    });

    // Validações básicas
    if (!accountId || !username || !auth_type) {
      sendLogToFrontend(username, {
        level: 'error',
        message: '❌ Parâmetros obrigatórios não fornecidos (accountId, username, auth_type)'
      });
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: accountId, username, auth_type'
      });
    }

    if (auth_type === 'credentials' && !password) {
      sendLogToFrontend(username, {
        level: 'error',
        message: '❌ Password é obrigatório para autenticação por credenciais'
      });
      return res.status(400).json({
        success: false,
        error: 'Password é obrigatório quando auth_type é credentials'
      });
    }

    if (auth_type === 'cookie' && !cookieData) {
      sendLogToFrontend(username, {
        level: 'error',
        message: '❌ Cookies são obrigatórios para autenticação por cookie'
      });
      return res.status(400).json({
        success: false,
        error: 'Cookies são obrigatórios quando auth_type é cookies'
      });
    }

    // Log do tipo de autenticação
    if (auth_type === 'credentials') {
      sendLogToFrontend(username, {
        level: 'info',
        message: '🔐 Usando autenticação por credenciais'
      });
    } else {
      sendLogToFrontend(username, {
        level: 'info',
        message: '🍪 Usando autenticação por cookies'
      });
    }

    // Verificar se já existe uma instância ativa para este username
    if (activeInstances.has(username)) {
      sendLogToFrontend(username, {
        level: 'warning',
        message: `⚠️ Instância @${username} já está ativa`
      });
      return res.status(200).json({
        success: true,
        message: 'Perfil já está ativo',
        accountId,
        username
      });
    }

    // Configurar Instagram baseado no tipo de autenticação
    let config: InstagramConfig;

    sendLogToFrontend(username, {
      level: 'info',
      message: '⚙️ Configurando navegador...'
    });

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

    sendLogToFrontend(username, {
      level: 'info',
      message: '🔑 Realizando login...'
    });

    // Inicializar
    await ig.init();

    // Verificar se o login foi bem-sucedido
    if (!ig.loggedIn) {
      sendLogToFrontend(username, {
        level: 'error',
        message: `❌ Falha na autenticação para @${username}`
      });
      return res.status(401).json({
        success: false,
        error: 'Falha na autenticação. Verifique as credenciais ou cookies.'
      });
    }
    
    console.log("LOGGED: ", ig.loggedIn);
    
    sendLogToFrontend(username, {
      level: 'info',
      message: '💾 Inicializando banco de dados...'
    });
    
    // Inicializar banco de dados para o usuário
    try {
      await initializeDatabaseForUser(username);
      sendLogToFrontend(username, {
        level: 'success',
        message: '💾 Banco de dados inicializado com sucesso'
      });
    } catch (dbError) {
      console.error(`Erro ao inicializar banco para ${username}:`, dbError);
      sendLogToFrontend(username, {
        level: 'warning',
        message: '⚠️ Erro ao inicializar banco de dados, mas instância continuará funcionando'
      });
    }

    // Armazenar a instância ativa usando username como chave
    activeInstances.set(username, ig);

    sendLogToFrontend(username, {
      level: 'success',
      message: `✅ Instância @${username} iniciada com sucesso!`
    });

    return res.status(200).json({
      success: true,
      message: 'Perfil inicializado com sucesso',
      accountId,
      username,
      auth_type
    });

  } catch (error) {
    const username = req.body.username || 'unknown';
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    
    console.error('Erro ao inicializar perfil:', error);

    sendLogToFrontend(username, {
      level: 'error',
      message: `❌ Erro ao iniciar instância: ${errorMsg}`
    });

    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: errorMsg
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

  sendLogToFrontend(username, {
    level: 'info',
    message: `🛑 Encerrando instância @${username}...`
  });

  const instance = activeInstances.get(username);
  if (!instance) {
    sendLogToFrontend(username, {
      level: 'warning',
      message: `⚠️ Instância @${username} não encontrada ou já foi encerrada`
    });
    return res.status(404).json({
      success: false,
      error: `Instância '${username}' não está rodando`
    });
  }

  try {
    sendLogToFrontend(username, {
      level: 'info',
      message: '🔄 Fechando navegador...'
    });

    await instance.close();
    activeInstances.delete(username);

    sendLogToFrontend(username, {
      level: 'success',
      message: `✅ Instância @${username} encerrada com sucesso`
    });

    return res.json({
      success: true,
      message: `Instância '${username}' parada com sucesso`,
      username
    });
  } catch (error) {
    console.error(`Erro ao parar instância '${username}':`, error);
    
    sendLogToFrontend(username, {
      level: 'error',
      message: `❌ Erro ao encerrar instância: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
    });
    
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao parar instância'
    });
  }
});

/**
 * @route POST /api/instagram/workflow/execute
 * @description Executa um workflow
 */
app.post('/api/instagram/workflow/execute', async (req, res) => {
  try {
    const { workflow, instanceName } = req.body;
    // console.log("INSTANCE NAME: ", instanceName);
    // console.log("RAW BODY: ", JSON.stringify(req.body, null, 2));

    // Extrair o workflow correto da estrutura aninhada se necessário
    const actualWorkflow = workflow?.workflow || workflow;
    const actualInstanceName = instanceName || workflow?.instanceName;
    
    // console.log("PROCESSED WORKFLOW: ", JSON.stringify(actualWorkflow));
    // console.log("PROCESSED INSTANCE NAME: ", actualInstanceName);

    if (!actualWorkflow) {
      return res.status(400).json({
        success: false,
        error: 'Campo workflow é obrigatório'
      });
    }

    if (!actualInstanceName) {
      return res.status(400).json({
        success: false,
        error: 'Campo instanceName é obrigatório'
      });
    }

    // Validar estrutura do workflow
    const validation = validateWorkflow(actualWorkflow, actualInstanceName);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Workflow inválido',
        details: validation.errors
      });
    }

    // Verificar se já existe um workflow rodando com o mesmo ID
    if (runningWorkflows.has(actualWorkflow.id)) {
      return res.status(409).json({
        success: false,
        error: `Workflow '${actualWorkflow.id}' já está em execução`
      });
    }

    if (!activeInstances.has(actualInstanceName)) {
      console.log("INSTANCES: ", Array.from(activeInstances.keys()));
      return res.status(400).json({
        success: false,
        error: `Instância para ${actualInstanceName} não está ativa`
      });
    }

    // Executar workflow de forma assíncrona
    const workflowPromise = workflowProcessor.executeWorkflow(actualWorkflow, actualInstanceName);
    runningWorkflows.set(actualWorkflow.id, workflowPromise);

    // Remover da lista quando terminar
    workflowPromise.finally(() => {
      runningWorkflows.delete(actualWorkflow.id);
    });

    return res.json({
      success: true,
      message: `Workflow '${actualWorkflow.id}' iniciado com sucesso`,
      workflowId: actualWorkflow.id,
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
 * @route GET /api/instagram/workflow/status/:workflowId
 * @description Verifica o status de um workflow
 */
app.get('/api/instagram/workflow/status/:workflowId', async (req, res) => {
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
 * @route POST /api/instagram/workflow/stop/:workflowId
 * @description Para a execução de um workflow
 */
app.post('/api/instagram/workflow/stop/:workflowId', async (req, res) => {
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
 * @route GET /api/instagram/workflow/list
 * @description Lista todos os workflows executados
 */
app.get('/api/instagram/workflow/list', (req, res) => {
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
  console.log(`   POST /api/instagram/workflow/execute - Executar workflow`);
  console.log(`   GET  /api/instagram/workflow/status/:workflowId - Status do workflow`);
  console.log(`   POST /api/instagram/workflow/stop/:workflowId - Parar workflow`);
  console.log(`   GET  /api/instagram/workflow/list - Listar workflows`);
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