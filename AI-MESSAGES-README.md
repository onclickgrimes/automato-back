# Sistema de Resposta Automatizada com IA

Este sistema permite responder automaticamente mensagens do Instagram usando Inteligência Artificial (OpenAI GPT e Google Gemini) de forma humanizada e com recursos anti-detecção.

## 🚀 Funcionalidades

### AIService
- ✅ Integração com OpenAI GPT-3.5-turbo
- ✅ Integração com Google Gemini Pro
- ✅ Geração de respostas contextuais e humanizadas
- ✅ Múltiplas variações de resposta
- ✅ Seleção automática da melhor resposta
- ✅ Fallback entre provedores

### MessageProcessor
- ✅ Busca automática de mensagens não respondidas
- ✅ Filtro por chats ativos (reply=true)
- ✅ Processamento em lotes configurável
- ✅ Delays humanizados entre respostas (30s-3min)
- ✅ Histórico de conversação para contexto
- ✅ Estatísticas de performance
- ✅ Processamento manual de mensagens específicas

### Recursos Anti-Detecção
- ⏱️ **Delays Aleatórios**: 30 segundos a 3 minutos entre respostas
- 🎭 **Respostas Humanizadas**: Linguagem natural e casual
- 📚 **Contexto Conversacional**: Considera histórico da conversa
- 🎯 **Múltiplas Variações**: Gera várias opções e escolhe a melhor
- 📊 **Controle de Qualidade**: Evita respostas muito curtas ou genéricas

## 📦 Instalação

### Dependências
```bash
npm install openai @google/generative-ai
```

### Variáveis de Ambiente
```bash
# .env
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
```

## 🔧 Configuração

### AIService
```typescript
import { AIService } from './src/AIService';

const aiService = new AIService({
  openaiApiKey: process.env.OPENAI_API_KEY,
  googleApiKey: process.env.GOOGLE_API_KEY,
  defaultProvider: 'openai', // ou 'google'
  temperature: 0.7, // Criatividade (0-1)
  maxTokens: 150 // Tamanho máximo da resposta
});
```

### MessageProcessor
```typescript
import { MessageProcessor } from './src/MessageProcessor';

const messageProcessor = new MessageProcessor(aiService, {
  checkInterval: 5, // Verificar a cada 5 minutos
  maxMessagesPerBatch: 10, // Máx. 10 mensagens por vez
  minResponseDelay: 30000, // Mín. 30 segundos entre respostas
  maxResponseDelay: 180000, // Máx. 3 minutos entre respostas
  timeWindowHours: 24, // Buscar mensagens das últimas 24h
  enableHumanization: true // Ativar delays humanizados
});
```

## 🚀 Uso Básico

### Inicialização Completa
```typescript
import { initializeAIMessageSystem } from './example-ai-messages';

// Inicializar sistema completo
const { aiService, messageProcessor } = await initializeAIMessageSystem();

// Registrar instâncias do Instagram
messageProcessor.registerInstagramInstance('username1', instagramInstance1);
messageProcessor.registerInstagramInstance('username2', instagramInstance2);

// Iniciar processamento automático
messageProcessor.startAutoProcessing();
```

### Teste da IA
```typescript
// Testar resposta da IA
const response = await aiService.generateResponse({
  username: 'joao_teste',
  messageContent: 'Oi! Como você está?',
  conversationHistory: ['joao_teste: Olá!', 'Eu: Oi João!'],
  userProfile: {
    name: 'João Silva',
    bio: 'Desenvolvedor',
    followersCount: 1500
  }
});

console.log(`Resposta: "${response.content}"`);
```

### Processamento Manual
```typescript
// Processar mensagem específica
const success = await messageProcessor.processSpecificMessage('username1', 123);

// Ver estatísticas
const stats = messageProcessor.getStats();
console.log('Estatísticas:', stats);
```

## 📊 Monitoramento

### Logs Automáticos
O sistema gera logs detalhados:
```
🔍 Verificando mensagens pendentes...
📨 Encontradas 3 mensagens pendentes para @username1
💬 Processando mensagem de @joao_teste: "Oi! Como você está?..."
📝 Gerando resposta com OpenAI...
⏱️ Aplicando delay humanizado: 45s
📤 Enviando resposta via Instagram...
✅ Resposta enviada para @joao_teste: "Oi João! Estou bem, obrigado!"
```

### Estatísticas
```typescript
const stats = messageProcessor.getStats();
// {
//   totalProcessed: 25,
//   successfulResponses: 23,
//   failedResponses: 2,
//   averageResponseTime: 1250,
//   lastProcessingTime: Date
// }
```

## 🛡️ Segurança e Boas Práticas

### Configuração de Delays
- **Mínimo**: 30 segundos (evita spam)
- **Máximo**: 3 minutos (mantém naturalidade)
- **Variação**: Aleatória para parecer humano

### Qualidade das Respostas
- Evita respostas muito curtas (< 10 caracteres)
- Evita respostas muito longas (> 200 caracteres)
- Prefere respostas com 1-2 emojis
- Evita frases genéricas

### Limitações de Rate
- Máximo 10 mensagens por lote
- Intervalo mínimo de 5 minutos entre verificações
- Janela de tempo configurável (padrão: 24h)

## 🔧 Estrutura do Banco de Dados

### Tabela `messages`
```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL,
  text TEXT NOT NULL,
  user_id TEXT NOT NULL,
  from_me BOOLEAN NOT NULL,
  answered BOOLEAN DEFAULT FALSE, -- ✅ Campo usado pelo sistema
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela `chats`
```sql
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reply BOOLEAN DEFAULT TRUE -- ✅ Campo usado pelo sistema
);
```

### Consulta de Mensagens Pendentes
```sql
SELECT m.*, u.username 
FROM messages m
JOIN chats c ON m.chat_id = c.id
JOIN users u ON m.user_id = u.id
WHERE m.answered = FALSE 
  AND m.from_me = FALSE 
  AND c.reply = TRUE 
  AND m.timestamp >= datetime('now', '-24 hours')
ORDER BY m.timestamp ASC
LIMIT 10;
```

## 🚨 Troubleshooting

### Erro: "AIService não está configurado"
- Verifique se pelo menos uma chave de API está definida
- Confirme se as variáveis de ambiente estão carregadas

### Erro: "Instância do Instagram não encontrada"
- Registre a instância com `messageProcessor.registerInstagramInstance()`
- Verifique se a instância está inicializada

### Respostas não são enviadas
- Verifique se `chats.reply = true`
- Confirme se `messages.answered = false`
- Verifique logs de erro no console

### Performance lenta
- Reduza `maxMessagesPerBatch`
- Aumente `checkInterval`
- Verifique conexão com APIs de IA

## 📝 Exemplo Completo

Veja o arquivo `example-ai-messages.ts` para um exemplo completo de implementação.

```bash
# Executar exemplo
npx ts-node example-ai-messages.ts
```

## 🔄 Integração com Sistema Existente

Para integrar com seu sistema atual:

1. **Importe as classes**:
   ```typescript
   import { AIService } from './src/AIService';
   import { MessageProcessor } from './src/MessageProcessor';
   ```

2. **Configure as APIs**:
   ```typescript
   const aiService = new AIService({ /* config */ });
   ```

3. **Registre instâncias do Instagram**:
   ```typescript
   messageProcessor.registerInstagramInstance(username, instagramInstance);
   ```

4. **Inicie o processamento**:
   ```typescript
   messageProcessor.startAutoProcessing();
   ```

## 📈 Roadmap

- [ ] Suporte a mais provedores de IA (Claude, etc.)
- [ ] Interface web para monitoramento
- [ ] Configuração de templates de resposta
- [ ] Análise de sentimento das mensagens
- [ ] Integração com webhooks
- [ ] Métricas avançadas de performance

---

**⚠️ Importante**: Use este sistema de forma responsável e em conformidade com os termos de serviço do Instagram. Sempre monitore o comportamento e ajuste os delays conforme necessário para evitar detecção.