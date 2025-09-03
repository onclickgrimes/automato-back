import knex from 'knex';
import { PostData } from './Instagram';

const knexConfig = require('../knexfile.js');

// Cache de conexões por username
const dbConnections: Map<string, knex.Knex> = new Map();

// Função para obter conexão específica por username
function getDbConnection(username?: string): knex.Knex {
  if (!username) {
    // Fallback para o banco padrão
    if (!dbConnections.has('default')) {
      dbConnections.set('default', knex(knexConfig.development));
    }
    return dbConnections.get('default')!;
  }
  
  if (!dbConnections.has(username)) {
    const userConfig = {
      ...knexConfig.development,
      connection: {
        filename: `./database_${username}.sqlite`
      }
    };
    dbConnections.set(username, knex(userConfig));
  }
  
  return dbConnections.get(username)!;
}

export interface InstagramPostRecord {
  id?: number;
  url: string;
  post_id: string;
  username: string;
  likes: number;
  comments: number;
  post_date?: string;
  created_at?: string;
  updated_at?: string;
}

export class PostsDatabase {
  /**
   * Salva posts no banco de dados, evitando duplicatas baseadas no post_id
   */
  static async savePosts(posts: PostData[], username?: string): Promise<{ saved: number; duplicates: number }> {
    const db = getDbConnection(username);
    let saved = 0;
    let duplicates = 0;

    for (const post of posts) {
      try {
        // Extrai post_id da URL (formato: /p/POST_ID/)
        const postIdMatch = post.url.match(/\/p\/([^/]+)\//); 
        const postId = postIdMatch ? postIdMatch[1] : post.url;

        // Verifica se o post já existe
        const existingPost = await db('instagram_posts')
          .where('post_id', postId)
          .first();

        if (existingPost) {
          // Atualiza dados se já existe
          await db('instagram_posts')
            .where('post_id', postId)
            .update({
              likes: post.likes,
              comments: post.comments,
              post_date: post.postDate,
              updated_at: new Date().toISOString()
            });
          duplicates++;
          console.log(`🔄 Post atualizado: ${postId} (@${post.username})`);
        } else {
          // Insere novo post
          await db('instagram_posts').insert({
            url: post.url,
            post_id: postId,
            username: post.username,
            likes: post.likes,
            comments: post.comments,
            post_date: post.postDate,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
          saved++;
          console.log(`💾 Novo post salvo: ${postId} (@${post.username})`);
        }
      } catch (error: any) {
        console.error(`❌ Erro ao salvar post ${post.url}:`, error.message);
      }
    }

    return { saved, duplicates };
  }

  /**
   * Busca posts por username
   */
  static async getPostsByUsername(username: string, dbUsername?: string): Promise<InstagramPostRecord[]> {
    const db = getDbConnection(dbUsername);
    return await db('instagram_posts')
      .where('username', username)
      .orderBy('created_at', 'desc');
  }

  /**
   * Busca posts por período
   */
  static async getPostsByDateRange(startDate: string, endDate: string, username?: string): Promise<InstagramPostRecord[]> {
    const db = getDbConnection(username);
    return await db('instagram_posts')
      .whereBetween('post_date', [startDate, endDate])
      .orderBy('post_date', 'desc');
  }

  /**
   * Estatísticas gerais
   */
  static async getStats(username?: string): Promise<{
    totalPosts: number;
    totalUsers: number;
    avgLikes: number;
    avgComments: number;
  }> {
    const db = getDbConnection(username);
    const stats = await db('instagram_posts')
      .select(
        db.raw('COUNT(*) as totalPosts'),
        db.raw('COUNT(DISTINCT username) as totalUsers'),
        db.raw('AVG(likes) as avgLikes'),
        db.raw('AVG(comments) as avgComments')
      )
      .first();

    return {
      totalPosts: parseInt(stats.totalPosts) || 0,
      totalUsers: parseInt(stats.totalUsers) || 0,
      avgLikes: Math.round(parseFloat(stats.avgLikes) || 0),
      avgComments: Math.round(parseFloat(stats.avgComments) || 0)
    };
  }
}