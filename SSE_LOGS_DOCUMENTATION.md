# Documentação - Server-Sent Events (SSE) para Logs em Tempo Real

## Visão Geral

Este sistema implementa Server-Sent Events (SSE) para transmitir logs em tempo real do backend para o frontend durante operações do Instagram (inicialização, parada de instâncias e execução de workflows).

## Endpoint SSE

### URL
```
GET /api/instagram/logs/:username
```

### Parâmetros
- `username`: Nome de usuário da instância do Instagram

### Headers Necessários
```
Accept: text/event-stream
Cache-Control: no-cache
```

## Formato dos Logs

Cada log enviado via SSE tem o seguinte formato JSON:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "message": "🚀 Iniciando instância do Instagram",
  "username": "exemplo_usuario"
}
```

### Níveis de Log
- `info`: Informações gerais
- `success`: Operações bem-sucedidas
- `warning`: Avisos
- `error`: Erros

## Implementação no Frontend (React)

### 1. Hook Personalizado para SSE

```typescript
// hooks/useSSELogs.ts
import { useState, useEffect, useRef } from 'react';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  username: string;
}

export interface UseSSELogsReturn {
  logs: LogEntry[];
  isConnected: boolean;
  error: string | null;
  clearLogs: () => void;
  connect: () => void;
  disconnect: () => void;
}

export function useSSELogs(username: string, autoConnect = true): UseSSELogsReturn {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const eventSource = new EventSource(`http://localhost:3001/api/instagram/logs/${username}`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
        console.log('SSE conectado para:', username);
      };

      eventSource.onmessage = (event) => {
        try {
          const logEntry: LogEntry = JSON.parse(event.data);
          setLogs(prev => [...prev, logEntry]);
        } catch (err) {
          console.error('Erro ao parsear log SSE:', err);
        }
      };

      eventSource.onerror = (err) => {
        console.error('Erro SSE:', err);
        setIsConnected(false);
        setError('Erro na conexão SSE');
      };

    } catch (err) {
      setError('Erro ao conectar SSE');
      console.error('Erro ao criar EventSource:', err);
    }
  };

  const disconnect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  useEffect(() => {
    if (autoConnect && username) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [username, autoConnect]);

  return {
    logs,
    isConnected,
    error,
    clearLogs,
    connect,
    disconnect
  };
}
```

### 2. Componente de Logs

```typescript
// components/LogViewer.tsx
import React from 'react';
import { useSSELogs, LogEntry } from '../hooks/useSSELogs';

interface LogViewerProps {
  username: string;
  maxLogs?: number;
}

const LogViewer: React.FC<LogViewerProps> = ({ username, maxLogs = 100 }) => {
  const { logs, isConnected, error, clearLogs } = useSSELogs(username);

  const getLogColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'error': return 'text-red-600';
      case 'warning': return 'text-yellow-600';
      case 'success': return 'text-green-600';
      default: return 'text-gray-700';
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Manter apenas os últimos logs
  const displayLogs = logs.slice(-maxLogs);

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Logs - {username}</h3>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`}></div>
          <span className="text-sm text-gray-600">
            {isConnected ? 'Conectado' : 'Desconectado'}
          </span>
          <button
            onClick={clearLogs}
            className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
          >
            Limpar
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="bg-gray-50 rounded p-3 h-64 overflow-y-auto font-mono text-sm">
        {displayLogs.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            Nenhum log disponível
          </div>
        ) : (
          displayLogs.map((log, index) => (
            <div key={index} className="mb-1">
              <span className="text-gray-500">[{formatTime(log.timestamp)}]</span>
              <span className={`ml-2 ${getLogColor(log.level)}`}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LogViewer;
```

### 3. Uso no Componente Principal

```typescript
// pages/InstagramManagement.tsx
import React, { useState } from 'react';
import LogViewer from '../components/LogViewer';

const InstagramManagement: React.FC = () => {
  const [selectedUsername, setSelectedUsername] = useState<string>('');
  const [instances, setInstances] = useState<string[]>([]);

  const startInstance = async (username: string) => {
    try {
      const response = await fetch('http://localhost:3001/api/instagram/iniciar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username })
      });
      
      if (response.ok) {
        setInstances(prev => [...prev, username]);
        setSelectedUsername(username);
      }
    } catch (error) {
      console.error('Erro ao iniciar instância:', error);
    }
  };

  const stopInstance = async (username: string) => {
    try {
      const response = await fetch(`http://localhost:3001/api/instagram/parar/${username}`, {
        method: 'POST'
      });
      
      if (response.ok) {
        setInstances(prev => prev.filter(u => u !== username));
      }
    } catch (error) {
      console.error('Erro ao parar instância:', error);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Gerenciamento Instagram</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Controles */}
        <div className="bg-white rounded-lg shadow-md p-4">
          <h2 className="text-xl font-semibold mb-4">Controles</h2>
          
          {/* Formulário para iniciar instância */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="Nome de usuário"
              className="border rounded px-3 py-2 mr-2"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  startInstance(e.currentTarget.value);
                  e.currentTarget.value = '';
                }
              }}
            />
            <button
              onClick={() => {
                const input = document.querySelector('input') as HTMLInputElement;
                if (input.value) {
                  startInstance(input.value);
                  input.value = '';
                }
              }}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              Iniciar Instância
            </button>
          </div>

          {/* Lista de instâncias ativas */}
          <div>
            <h3 className="font-semibold mb-2">Instâncias Ativas:</h3>
            {instances.map(username => (
              <div key={username} className="flex justify-between items-center p-2 bg-gray-50 rounded mb-2">
                <span>{username}</span>
                <div>
                  <button
                    onClick={() => setSelectedUsername(username)}
                    className="bg-green-500 text-white px-2 py-1 rounded text-sm mr-2 hover:bg-green-600"
                  >
                    Ver Logs
                  </button>
                  <button
                    onClick={() => stopInstance(username)}
                    className="bg-red-500 text-white px-2 py-1 rounded text-sm hover:bg-red-600"
                  >
                    Parar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Visualizador de Logs */}
        <div>
          {selectedUsername ? (
            <LogViewer username={selectedUsername} />
          ) : (
            <div className="bg-white rounded-lg shadow-md p-4 text-center text-gray-500">
              Selecione uma instância para ver os logs
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InstagramManagement;
```

## Eventos de Log Disponíveis

### Inicialização de Instância
- Configuração inicial
- Validação de parâmetros
- Configuração do navegador
- Status de login
- Inicialização do banco de dados
- Erros durante o processo

### Parada de Instância
- Início do processo de parada
- Fechamento do navegador
- Limpeza de recursos
- Confirmação de parada
- Erros durante o processo

### Execução de Workflows
- Início do workflow
- Execução de cada step
- Sucesso/falha de steps
- Tempo de execução
- Estatísticas finais
- Erros durante execução

## Configuração do CORS

Certifique-se de que o backend está configurado para aceitar conexões SSE do frontend:

```typescript
// No main.ts, o CORS já está configurado para aceitar todas as origens
app.use(cors());
```

## Tratamento de Erros

### Reconexão Automática
Para implementar reconexão automática em caso de falha:

```typescript
const useSSELogsWithReconnect = (username: string) => {
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const maxReconnectAttempts = 5;
  
  const connectWithRetry = () => {
    if (reconnectAttempts < maxReconnectAttempts) {
      setTimeout(() => {
        connect();
        setReconnectAttempts(prev => prev + 1);
      }, 1000 * Math.pow(2, reconnectAttempts)); // Backoff exponencial
    }
  };
  
  // Usar connectWithRetry no lugar de connect
};
```

## Considerações de Performance

1. **Limite de Logs**: Mantenha apenas os últimos N logs na memória
2. **Throttling**: Considere implementar throttling para logs muito frequentes
3. **Cleanup**: Sempre feche conexões SSE quando o componente for desmontado
4. **Batching**: Para muitos logs simultâneos, considere fazer batching no backend

## Exemplo de Uso Completo

```typescript
// App.tsx
import React from 'react';
import InstagramManagement from './pages/InstagramManagement';

function App() {
  return (
    <div className="App">
      <InstagramManagement />
    </div>
  );
}

export default App;
```

## Troubleshooting

### Problemas Comuns

1. **Conexão não estabelecida**
   - Verifique se o backend está rodando na porta correta
   - Confirme que o CORS está configurado
   - Verifique se a URL do SSE está correta

2. **Logs não aparecem**
   - Verifique se o username está correto
   - Confirme que a instância está ativa
   - Verifique o console do navegador para erros

3. **Desconexões frequentes**
   - Implemente reconexão automática
   - Verifique a estabilidade da rede
   - Considere aumentar timeouts no servidor

### Debug

Para debug, adicione logs no console:

```typescript
// No hook useSSELogs
eventSource.onmessage = (event) => {
  console.log('Log recebido:', event.data);
  // ... resto do código
};
```

Esta documentação fornece tudo o que é necessário para implementar e usar o sistema de logs SSE no frontend.