# Documentação de Migração e Estrutura do Banco - Instagram Workflow

## Problema Identificado no Workflow

### Data: 2025-01-27
### Tipo: Correção de Referência de Dados

**Problema:** O workflow estava falhando ao tentar acessar `{{steps.step-1757192103276.result.newPosts}}` que não existe no resultado do `monitorPosts`.

**Causa:** Referência incorreta à propriedade do resultado. O `monitorPosts` retorna `posts`, não `newPosts`.

**Solução:** Corrigir as referências no workflow para usar as propriedades corretas.

## Estrutura de Dados do MonitorPosts

### Resultado Retornado pelo monitorPosts:
```json
{
  "success": boolean,
  "postsCollected": number,
  "posts": PostData[],
  "monitoredUsers": string[],
  "hasNewPosts": boolean,
  "allLikers": string[],
  "allCommenters": string[],
  "postsByUser": { [username: string]: PostData[] }
}
```

### Estrutura PostData:
```json
{
  "url": string,
  "id": string,
  "timeAgo": string,
  "likes": number,
  "comments": number,
  "username": string,
  "postDate": string (ISO),
  "likedByUsers": string[],
  "followedLikers": boolean
}
```

## Tabelas do Banco de Dados

### Tabela: instagram_posts
```sql
-- Estrutura atual da tabela instagram_posts
CREATE TABLE instagram_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  post_id TEXT NOT NULL,
  username TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  post_date TEXT,
  liked_by_users TEXT, -- JSON array
  followed_likers BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Sincronização com Supabase

Os dados são sincronizados com o Supabase através do endpoint `/api/posts/sync` com a seguinte estrutura:

```json
{
  "user_id": "dc780220-2c99-4bfb-9302-c1e983c40152",
  "username": string,
  "posts": [
    {
      "url": string,
      "post_id": string,
      "username": string,
      "likes": number,
      "comments": number,
      "post_date": string,
      "liked_by_users": string[],
      "followed_likers": boolean
    }
  ]
}
```

## Correções Implementadas

### 1. Referências Corretas para Workflows

**Antes (Incorreto):**
```json
{
  "variable": "{{steps.step-1757192103276.result.newPosts}}",
  "list": "{{steps.step-1757192103276.result.newPosts}}"
}
```

**Depois (Correto):**
```json
{
  "variable": "{{steps.step-monitor.result.posts}}",
  "list": "{{steps.step-monitor.result.posts}}"
}
```

### 2. Opções de Verificação de Condições

```json
// Opção 1: Verificar se há posts
"variable": "{{steps.step-monitor.result.hasNewPosts}}"

// Opção 2: Verificar se array de posts não está vazio
{
  "variable": "{{steps.step-monitor.result.posts}}",
  "operator": "isNotEmpty"
}
```

### 3. Acesso aos Dados do Post no forEach

```json
{
  "type": "forEach",
  "params": {
    "list": "{{steps.step-monitor.result.posts}}",
    "actions": [
      {
        "type": "comment",
        "params": {
          "postId": "{{item.id}}",        // ID do post
          "postUrl": "{{item.url}}",      // URL do post
          "username": "{{item.username}}", // Username do autor
          "comment": "Comentário automático!"
        }
      }
    ]
  }
}
```

## Propriedades Disponíveis

### No Contexto do Step:
- `{{steps.STEP_ID.result.success}}` - Boolean
- `{{steps.STEP_ID.result.postsCollected}}` - Number
- `{{steps.STEP_ID.result.posts}}` - Array de posts
- `{{steps.STEP_ID.result.hasNewPosts}}` - Boolean
- `{{steps.STEP_ID.result.allLikers}}` - Array de usernames
- `{{steps.STEP_ID.result.allCommenters}}` - Array de usernames
- `{{steps.STEP_ID.result.postsByUser}}` - Object

### No Contexto do forEach (item):
- `{{item.id}}` - ID do post
- `{{item.url}}` - URL do post
- `{{item.username}}` - Username do autor
- `{{item.likes}}` - Número de likes
- `{{item.comments}}` - Número de comentários
- `{{item.postDate}}` - Data do post (ISO string)
- `{{item.likedByUsers}}` - Array de usernames que curtiram
- `{{item.followedLikers}}` - Boolean

## Arquivos Criados para Correção

1. `WORKFLOW_FIX.md` - Documentação detalhada do problema e soluções
2. `workflow-corrigido.json` - Exemplo de workflow com referências corretas
3. `test-workflow-fix.js` - Script de teste para validar as correções

## Correção Adicional - Bug no forEach

### Data: 2025-01-27 (Atualização)
### Tipo: Correção de Bug no WorkflowProcessor

**Problema Adicional Identificado:** Mesmo com as referências corretas no workflow, o `{{item.id}}` ainda não funcionava no forEach.

**Causa:** Na linha 484 do `WorkflowProcessor.ts`, o contexto estava sendo passado vazio `{ steps: {} }` em vez do contexto completo.

**Código Problemático:**
```typescript
// ANTES (linha 484)
const resolvedParams = this.resolveActionParams(subAction.params, { steps: {} }, item);
```

**Correção Aplicada:**
```typescript
// DEPOIS (linha 484)
const resolvedParams = this.resolveActionParams(subAction.params, context, item);
```

### Impacto da Correção

**Antes da correção:**
- `{{item.id}}` → `null` (referência não encontrada)
- `{{steps.step-monitor.result.hasNewPosts}}` → `null` (contexto vazio)
- Erro: "Parâmetros postId e comment são obrigatórios"

**Depois da correção:**
- `{{item.id}}` → `"DMiD2_1ux65"` (ID correto do post)
- `{{item.url}}` → URL completa do post
- `{{steps.step-monitor.result.hasNewPosts}}` → `true` (contexto disponível)
- Ação comment funciona corretamente

### Arquivo Modificado

- <mcfile name="WorkflowProcessor.ts" path="L:\Projetos-NestJS\Insta-lib - Copia\WorkflowProcessor.ts"></mcfile> (linha 484)

### Teste de Validação

- <mcfile name="test-foreach-fix.js" path="L:\Projetos-NestJS\Insta-lib - Copia\test-foreach-fix.js"></mcfile> - Script que demonstra a correção

## Status

✅ **Problema inicial identificado e documentado**
✅ **Bug adicional no forEach identificado e corrigido**
✅ **Soluções implementadas e testadas**
✅ **Documentação atualizada**
✅ **Scripts de teste validados**
✅ **WorkflowProcessor.ts corrigido**

## Migrações do Supabase

### 1. Adicionar coluna caption à tabela instagram_posts

**Arquivo:** `add_caption_to_supabase.sql`

**Descrição:** Adiciona a coluna `caption` à tabela `instagram_posts` no Supabase para armazenar as legendas dos posts do Instagram.

**SQL:**
```sql
ALTER TABLE instagram_posts 
ADD COLUMN caption TEXT;
```

**Como aplicar:**
1. Acesse o painel do Supabase
2. Vá para SQL Editor
3. Execute o comando SQL acima
4. Verifique se a coluna foi criada com sucesso

**Status:** Pendente

**Impacto:** Permite salvar legendas dos posts do Instagram no Supabase, resolvendo o problema onde `caption: null` aparecia nas respostas da API.

### 2. Criar tabela para análises de vídeo

**Arquivo:** `add_video_analysis_table.sql`

**Descrição:** Cria a tabela `video_analyses` para armazenar análises de vídeos do Instagram geradas pelo Gemini AI.

**SQL:**
```sql
CREATE TABLE IF NOT EXISTS video_analyses (
    id BIGSERIAL PRIMARY KEY,
    post_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    caption TEXT,
    video_analysis TEXT NOT NULL,
    generated_comment TEXT NOT NULL,
    processing_time INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_video_analyses_post_id ON video_analyses(post_id);
CREATE INDEX IF NOT EXISTS idx_video_analyses_username ON video_analyses(username);
CREATE INDEX IF NOT EXISTS idx_video_analyses_created_at ON video_analyses(created_at);
```

**Como aplicar:**
1. Acesse o painel do Supabase
2. Vá para SQL Editor
3. Execute o SQL completo do arquivo `add_video_analysis_table.sql`
4. Verifique se a tabela e índices foram criados

**Status:** Pendente

**Impacto:** Permite armazenar análises de vídeos do Instagram processadas pelo Gemini, incluindo descrições detalhadas e comentários gerados automaticamente.

## Funcionalidade de Análise de Vídeo com Gemini

### Visão Geral

A funcionalidade de análise de vídeo permite processar vídeos do Instagram usando o modelo Gemini 2.0 Flash da Google AI. O sistema:

1. **Baixa o vídeo** do Instagram (simulado na versão atual)
2. **Envia para o Gemini** para análise visual detalhada
3. **Combina a análise** com a legenda original do post
4. **Gera um comentário** natural e engajador
5. **Armazena os resultados** no banco de dados

### Arquivos Principais

#### `src/AIService.ts`
- **Método principal:** `analyzeInstagramVideo(videoUrl, caption?, username?)`
- **Funcionalidades:**
  - Download de vídeo (simulado)
  - Upload para Gemini via base64
  - Análise visual detalhada
  - Geração de comentários contextualizados
  - Limpeza automática de arquivos temporários

#### `src/VideoAnalysisIntegration.ts`
- **Classe:** `VideoAnalysisIntegration`
- **Funcionalidades:**
  - Integração com workflow do Instagram
  - Processamento em lote de vídeos
  - Cache de análises existentes
  - Estatísticas de processamento

#### `test-video-analysis.js`
- Script de teste para validar a funcionalidade
- Testes com múltiplos cenários
- Verificação de configuração do Gemini

### Configuração Necessária

```javascript
// Variáveis de ambiente
GOOGLE_API_KEY=sua_chave_do_google_ai

// Inicialização
const aiService = new AIService({
  googleApiKey: process.env.GOOGLE_API_KEY
});
```

### Exemplo de Uso

```javascript
// Análise simples (método direto)
const result = await aiService.analyzeInstagramVideo(
  'https://www.instagram.com/reel/ABC123/',
  'Momento incrível na praia! 🌊',
  'usuario_exemplo'
);

console.log('Análise:', result.videoAnalysis);
console.log('Comentário:', result.generatedComment);

// Integração completa com opções de comentário
const integration = new VideoAnalysisIntegration(aiService, postsDatabase);

// OPÇÃO 1: IA completa (análise + comentário gerado)
const result1 = await integration.processInstagramVideo(videoData, {
  useAI: true,
  generateAnalysis: true
});

// OPÇÃO 2: Comentário fixo + análise do vídeo
const result2 = await integration.processInstagramVideo(videoData, {
  useAI: false,
  fixedComment: 'Conteúdo incrível! Parabéns! 🔥',
  generateAnalysis: true
});

// OPÇÃO 3: Comentário fixo sem análise (mais rápido)
const result3 = await integration.processInstagramVideo(videoData, {
  useAI: false,
  fixedComment: 'Ótimo post! 👏',
  generateAnalysis: false
});

// OPÇÃO 4: IA apenas para comentário (sem análise detalhada)
const result4 = await integration.processInstagramVideo(videoData, {
  useAI: true,
  generateAnalysis: false
});
```

### Estrutura da Resposta

```typescript
// Resultado da análise direta (AIService)
interface VideoAnalysisResult {
  videoAnalysis: string;      // Descrição detalhada do vídeo
  generatedComment: string;   // Comentário gerado
  processingTime: number;     // Tempo de processamento em ms
  videoPath?: string;         // Path do arquivo (removido após uso)
}

// Resultado da integração completa
interface VideoAnalysisIntegrationResult {
  postId: string;            // ID do post processado
  videoAnalysis: string;     // Análise do vídeo (ou mensagem se não gerada)
  generatedComment: string;  // Comentário (gerado por IA ou fixo)
  processingTime: number;    // Tempo total de processamento
  saved: boolean;           // Se foi salvo no banco com sucesso
  error?: string;           // Mensagem de erro (se houver)
}

// Opções de comentário
interface CommentOptions {
  useAI?: boolean;           // Se true, gera comentário via IA (padrão: true)
  fixedComment?: string;     // Comentário fixo (usado quando useAI = false)
  generateAnalysis?: boolean; // Se deve gerar análise do vídeo (padrão: true)
}
```

### Modelos Gemini Utilizados

- **Análise de vídeo:** `gemini-2.0-flash-exp`
- **Geração de comentários:** `gemini-pro`

### Limitações Atuais

1. **Download simulado:** A versão atual simula o download de vídeos
2. **Dependência do Gemini:** Requer API key válida do Google AI
3. **Formatos suportados:** MP4, MOV, AVI, WebM
4. **Tamanho máximo:** Limitado pelas especificações do Gemini

### Próximos Passos

1. Implementar download real de vídeos do Instagram
2. Adicionar suporte a mais formatos de vídeo
3. Implementar cache inteligente de análises
4. Adicionar métricas de qualidade dos comentários
5. Integrar com sistema de moderação de conteúdo

---

*Documentação gerada automaticamente em 2025-01-27*
*Última atualização: 2025-01-27 - Correção do bug do forEach*