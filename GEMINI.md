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

---

*Documentação gerada automaticamente em 2025-01-27*
*Última atualização: 2025-01-27 - Correção do bug do forEach*