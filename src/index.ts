/**
 * Instagram Automator Library
 * 
 * A powerful TypeScript library for Instagram automation using Puppeteer
 * with advanced stealth features and anti-detection mechanisms.
 * 
 * Features:
 * - Intelligent login with cookie management
 * - Captcha/Challenge detection and handling
 * - Stealth browsing with puppeteer-extra-plugin-stealth
 * - Human-like interactions with random delays
 * - Multiple account support
 * - Rate limiting and safety features
 * - Screenshot debugging capabilities
 * - Real-time message monitoring (Inbox + Requests)
 * 
 * @author Instagram Automator
 * @version 1.0.4
 */

export { Instagram } from './Instagram';
export type { InstagramConfig, InstagramCredentials, PostData } from './Instagram';

// Re-exporta tipos do Puppeteer que podem ser úteis
export type { Browser, Page, Protocol } from 'puppeteer';

/**
 * Versão da biblioteca
 */
export const VERSION = '1.0.4';

/**
 * Configurações padrão recomendadas
 */
export const DEFAULT_CONFIG = {
  headless: false,
  viewport: { width: 1366, height: 768 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * Utilitários auxiliares
 */
export class InstagramUtils {
  /**
   * Gera um delay aleatório entre min e max milissegundos
   */
  static randomDelay(min: number = 1000, max: number = 3000): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Gera um número aleatório entre min e max
   */
  static randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Valida se um ID de post do Instagram é válido
   */
  static isValidPostId(postId: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(postId) && postId.length >= 8;
  }

  /**
   * Valida se um username do Instagram é válido
   */
  static isValidUsername(username: string): boolean {
    return /^[a-zA-Z0-9._]+$/.test(username) && username.length >= 1 && username.length <= 30;
  }

  /**
   * Extrai o ID do post de uma URL do Instagram
   */
  static extractPostIdFromUrl(url: string): string | null {
    const match = url.match(/\/p\/([A-Za-z0-9_-]+)\//);;
    return match ? match[1] : null;
  }

  /**
   * Extrai o username de uma URL de perfil do Instagram
   */
  static extractUsernameFromUrl(url: string): string | null {
    const match = url.match(/instagram\.com\/([a-zA-Z0-9._]+)\/?/);
    return match ? match[1] : null;
  }
}

/**
 * Exemplo de uso básico da biblioteca
 */
export const USAGE_EXAMPLE = `
// Basic usage example
import { Instagram } from 'instagram-automator';

const bot = new Instagram({
  headless: false, // Set to true for production
  userDataDir: './puppeteer-cache/user-data'
});

// Login and perform actions
async function main() {
  try {
    await bot.initialize();
    await bot.login({ username: 'your_username', password: 'your_password' });
    
    // Note: The bot has advanced captcha mitigation and automatic handling of:
    // - Captchas/reCAPTCHA
    // - Code verification pages (SMS/Email/App)
    // - Automatic configuration for Brazil (pt-BR, timezone, geolocation)
    // Automation will pause automatically for manual resolution when needed.
    
    // Like a post
    await bot.likePost('https://www.instagram.com/p/POST_ID/');
    
    // Follow a user
    await bot.followUser('target_username');
    
    // Send a message
    await bot.sendMessage('friend_username', 'Hello from bot!');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await bot.close();
  }
}

main();
`;

/**
 * Constantes úteis
 */
export const INSTAGRAM_URLS = {
  BASE: 'https://www.instagram.com',
  LOGIN: 'https://www.instagram.com/accounts/login/',
  DIRECT: 'https://www.instagram.com/direct/inbox/',
  EXPLORE: 'https://www.instagram.com/explore/',
} as const;

/**
 * Tipos de erro personalizados
 */
export class InstagramError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'InstagramError';
  }
}

export class InstagramLoginError extends InstagramError {
  constructor(message: string = 'Erro de login no Instagram') {
    super(message, 'LOGIN_ERROR');
    this.name = 'InstagramLoginError';
  }
}

export class InstagramActionError extends InstagramError {
  constructor(action: string, message?: string) {
    super(message || `Erro ao executar ação: ${action}`, 'ACTION_ERROR');
    this.name = 'InstagramActionError';
  }
}

/**
 * Configurações de rate limiting recomendadas
 */
export const RATE_LIMITS = {
  LIKES_PER_HOUR: 60,
  COMMENTS_PER_HOUR: 30,
  FOLLOWS_PER_HOUR: 20,
  MESSAGES_PER_HOUR: 10,
  POSTS_PER_DAY: 5
} as const;

/**
 * Mensagens de comentário sugeridas (para evitar spam)
 */
export const SUGGESTED_COMMENTS = [
  'Incrível! 👏',
  'Que foto linda! 📸',
  'Adorei! ❤️',
  'Muito bom! 👍',
  'Perfeito! ✨',
  'Show! 🔥',
  'Que máximo! 😍',
  'Top demais! 🚀'
] as const;

// Exportação padrão
import { Instagram } from './Instagram';
export default Instagram;