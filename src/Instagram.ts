import { Browser, Page, ElementHandle } from 'puppeteer';
import type { Protocol } from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
// Adiciona o plugin stealth
puppeteerExtra.use(StealthPlugin());

export interface InstagramConfig {
  username: string;
  password: string;
  headless?: boolean;
  userDataDir?: string;
  cookiesPath?: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
}

export interface InstagramCredentials {
  username: string;
  password: string;
}

export interface PostData {
  url: string;
  username: string;
  likes: number;
  post_id: string;
  post_date: any;
  comments: number;
  caption?: string;
  likedByUsers?: string[];
  followedLikers?: boolean;
}

export class Instagram {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private config: InstagramConfig;
  private cookiesPath: string;
  private isLoggedIn: boolean = false;
  private userDataDir: string;
  private isMonitoringNewMessages: boolean = false;
  private isMonitoringNewPostsFromUsers: boolean = false;

  constructor(config: InstagramConfig) {
    this.config = {
      headless: config.headless ?? false, // Headful por padrão para desenvolvimento
      viewport: config.viewport ?? { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...config
    };

    this.userDataDir = this.config.userDataDir || path.join(process.cwd(), 'puppeteer-cache', this.config.username);
    this.cookiesPath = this.config.cookiesPath || path.join(process.cwd(), 'puppeteer-cache', this.config.username, `cookies-${this.config.username}.json`);

    // Cria diretórios se não existirem
    this.ensureDirectoriesExist();
  }

  /**
   * Garante que os diretórios necessários existam
   */
  private ensureDirectoriesExist(): void {
    const dirs = [
      path.dirname(this.cookiesPath),
      this.userDataDir
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Inicializa o navegador e a página
   */
  async init(): Promise<void> {
    try {
      console.log('🚀 Inicializando Instagram Automator...');

      this.browser = await puppeteerExtra.launch({
        headless: this.config.headless ?? false,
        userDataDir: this.userDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--window-size=1366,768',
          // Configurações para Brasil/Português
          '--lang=pt-BR',
          '--accept-lang=pt-BR,pt;q=0.9,en;q=0.8'
        ],
        defaultViewport: this.config.viewport ?? { width: 1366, height: 768 }
      });

      this.page = await this.browser.newPage();

      // Configura user agent
      await this.page.setUserAgent(this.config.userAgent!);

      // Configura viewport
      await this.page.setViewport(this.config.viewport!);

      // Configurações de localização para Brasil
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
      });

      // Define geolocalização para Brasil
      await this.page.setGeolocation({ latitude: -23.5505, longitude: -46.6333 }); // São Paulo

      // Define timezone para Brasil
      await this.page.emulateTimezone('America/Sao_Paulo');

      // // Intercepta requests para otimização
      // await this.page.setRequestInterception(true);
      // this.page.on('request', (req) => {
      //   const resourceType = req.resourceType();
      //   if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
      //     req.abort();
      //   } else {
      //     req.continue();
      //   }
      // });

      console.log('✅ Navegador inicializado com sucesso');

      // Tenta fazer login
      await this.login();

    } catch (error) {
      console.error('❌ Erro ao inicializar:', error);
      await this.takeScreenshot('init-error');
      throw error;
    }
  }

  /**
   * Realiza login no Instagram
   */
  async login(): Promise<void> {
    if (!this.page) throw new Error('Página não inicializada');

    try {
      console.log('🔐 Iniciando processo de login...');

      // Tenta carregar cookies salvos primeiro
      if (await this.loadCookies()) {
        console.log('🍪 Cookies carregados, verificando sessão...');

        await this.page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await this.randomDelay(2000, 4000);

        // Verifica se está logado
        if (await this.isUserLoggedIn()) {
          console.log('✅ Login realizado com sucesso via cookies');
          this.isLoggedIn = true;
          return;
        }
      }

      console.log('🔑 Realizando login via formulário...');
      await this.loginWithCredentials();

    } catch (error) {
      console.error('❌ Erro no login:', error);
      await this.takeScreenshot('login-error');
      throw error;
    }
  }

  /**
   * Realiza login usando credenciais
   */
  private async loginWithCredentials(): Promise<void> {
    if (!this.page) throw new Error('Página não inicializada');

    await this.page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle2' });
    await this.randomDelay(2000, 4000);

    // Aguarda os campos de login aparecerem
    await this.page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await this.page.waitForSelector('input[name="password"]', { timeout: 10000 });

    // Preenche username com digitação humana
    await this.humanType('input[name="username"]', this.config.username);
    await this.randomDelay(1000, 2000);

    // Preenche password com digitação humana
    await this.humanType('input[name="password"]', this.config.password);
    await this.randomDelay(1000, 2000);

    // Clica no botão de login
    await this.page.click('button[type="submit"]');

    // Aguarda navegação ou erro
    try {
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    } catch (error) {
      // Pode não haver navegação se houver erro
    }

    await this.randomDelay(3000, 5000);

    // Verifica se o login foi bem-sucedido
    if (await this.isUserLoggedIn()) {
      console.log('✅ Login realizado com sucesso via credenciais With Credentials');
      this.isLoggedIn = true;

      // Verifica se há página de desafio/captcha
      if (await this.isChallengePageDetected()) {
        await this.handleChallengePage();
      }

      // Salva cookies para próximas sessões
      await this.saveCookies();

      // Lida com popups pós-login
      await this.handlePostLoginPopups();
    } else {
      throw new Error('Falha no login - verifique suas credenciais');
    }
  }

  /**
   * Verifica se o usuário está logado
   */
  private async isUserLoggedIn(): Promise<boolean> {
    if (!this.page) return false;

    try {
      // Verifica se existe o elemento de perfil ou feed
      const profileSelector = 'a[href*="/" + this.config.username + "/"]';
      const feedSelector = 'article';
      const loginSelector = 'input[name="username"]';

      await this.page.waitForTimeout(2000);

      // Se encontrar campo de login, não está logado
      const loginField = await this.page.$(loginSelector);
      if (loginField) return false;

      // Se encontrar feed ou perfil, está logado
      const feed = await this.page.$(feedSelector);
      if (feed) return true;

      // Verifica URL atual
      const currentUrl = this.page.url();
      return !currentUrl.includes('/accounts/login/');

    } catch (error) {
      return false;
    }
  }

  /**
   * Lida com popups que aparecem após o login
   */
  private async handlePostLoginPopups(): Promise<void> {
    if (!this.page) return;

    try {
      // "Salvar informações de login"
      const saveInfoButton = await this.page.$('button:contains("Agora não")');
      if (saveInfoButton) {
        await saveInfoButton.click();
        await this.randomDelay(1000, 2000);
      }

      // "Ativar notificações"
      const notificationButton = await this.page.$('button:contains("Agora não")');
      if (notificationButton) {
        await notificationButton.click();
        await this.randomDelay(1000, 2000);
      }

    } catch (error) {
      // Ignora erros de popups
    }
  }

  /**
   * Verifica se estamos na página de desafio/captcha do Instagram
   */
  private async isChallengePageDetected(): Promise<boolean> {
    if (!this.page) return false;

    try {
      const currentUrl = this.page.url();

      // Verifica pela URL - incluindo a nova página de código
      if (currentUrl.includes('/challenge') ||
        currentUrl.includes('/auth_platform/codeentry') ||
        currentUrl.includes('/accounts/challenge')) {
        return true;
      }

      // Verifica por elementos da página de desafio
      const challengeElements = [
        'h2', // Título do desafio
        '[data-testid="challenge-form"]', // Formulário de desafio
        '.challenge-form', // Classe de desafio
        'input[name="security_code"]', // Campo de código de segurança
        'input[name="verification_code"]', // Campo de código de verificação
        '.recaptcha-checkbox', // reCAPTCHA
        '#recaptcha', // reCAPTCHA alternativo
        '[data-testid="confirmationCodeInput"]' // Input de código de confirmação
      ];

      for (const selector of challengeElements) {
        const element = await this.page.$(selector);
        if (element) {
          // Para elementos de texto, verifica o conteúdo
          if (selector === 'h2') {
            const titleText = await this.page.evaluate(el => el.textContent, element);
            if (titleText && (titleText.includes('confirm') ||
              titleText.includes('verificar') ||
              titleText.includes('código') ||
              titleText.includes('security') ||
              titleText.includes('challenge'))) {
              return true;
            }
          } else {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Verifica se o captcha/desafio foi completado com sucesso
   */
  private async isChallengeCompleted(): Promise<boolean> {
    if (!this.page) return false;

    try {
      const currentUrl = this.page.url();

      // Se não estamos mais na página de challenge ou codeentry, provavelmente foi completado
      if (!currentUrl.includes('/challenge') &&
        !currentUrl.includes('/auth_platform/codeentry') &&
        !currentUrl.includes('/accounts/challenge')) {
        // Verifica se estamos em uma página válida do Instagram
        if (currentUrl.includes('instagram.com') &&
          (currentUrl.endsWith('/') ||
            currentUrl.includes('/feed') ||
            currentUrl.includes('/accounts') ||
            currentUrl.includes('/direct') ||
            currentUrl.includes('/explore') ||
            (!currentUrl.includes('/challenge') &&
              !currentUrl.includes('/auth_platform/codeentry')))) {
          return true;
        }
      }

      // Verifica por elementos que indicam conclusão do captcha
      const completionIndicators = [
        '.recaptcha-checkbox-checkmark', // reCAPTCHA completado
        '[data-testid="challenge-success"]', // Possível indicador de sucesso
        'button[type="submit"]:not([disabled])', // Botão de submit habilitado
        '.challenge-success', // Classe de sucesso
        '[role="button"]:has-text("Continue")', // Botão continuar
        '[role="button"]:has-text("Submit")', // Botão enviar
        '[role="button"]:has-text("Continuar")', // Botão continuar em português
        '[role="button"]:has-text("Enviar")', // Botão enviar em português
        'button:has-text("Continue")', // Botão continuar
        'button:has-text("Submit")', // Botão enviar
        'button:has-text("Continuar")', // Botão continuar em português
        'button:has-text("Enviar")', // Botão enviar em português
      ];

      for (const selector of completionIndicators) {
        const element = await this.page.$(selector);
        if (element) {
          console.log(`✅ Indicador de conclusão encontrado: ${selector}`);
          return true;
        }
      }

      // Verifica se não há mais elementos de desafio na página
      const challengeElements = await this.page.$$('[class*="challenge"], [class*="captcha"], .recaptcha-checkbox');
      if (challengeElements.length === 0) {
        return true;
      }

      return false;
    } catch (error) {
      console.log('Erro ao verificar conclusão do desafio:', error);
      return false;
    }
  }

  /**
   * Lida com a página de desafio/captcha do Instagram
   * Este método pausará a execução e aguardará intervenção manual
   */
  private async handleChallengePage(): Promise<void> {
    const currentUrl = this.page?.url() || '';

    if (currentUrl.includes('/auth_platform/codeentry')) {
      console.log('📱 Página de verificação de código detectada!');
      console.log('📍 URL atual:', currentUrl);
      console.log('⏳ Por favor, insira o código de verificação que foi enviado para seu dispositivo...');
      console.log('💡 Verifique seu SMS, email ou app autenticador e insira o código na página.');
    } else {
      console.log('🚨 Desafio/Captcha do Instagram detectado!');
      console.log('📍 URL atual:', currentUrl);
      console.log('⏳ Por favor, resolva o desafio manualmente no navegador...');
      console.log('💡 A automação continuará assim que você completar o desafio.');
    }

    // Tira screenshot para debug
    await this.takeScreenshot('challenge-detected');

    // Aguarda o usuário resolver o desafio
    let attempts = 0;
    const maxAttempts = 300; // 25 minutos máximo de espera

    while (attempts < maxAttempts) {
      await this.randomDelay(3000, 5000); // Aguarda 3-5 segundos entre verificações

      // Verifica se o desafio foi completado
      const challengeCompleted = await this.isChallengeCompleted();
      if (challengeCompleted) {
        console.log('✅ Desafio completado com sucesso!');
        await this.takeScreenshot('challenge-completed');

        // Aguarda um pouco mais para garantir que a página carregou completamente
        await this.randomDelay(2000, 4000);

        // Verifica se há botões para clicar após completar o captcha
        await this.handlePostChallengeActions();

        return;
      }

      attempts++;

      if (attempts % 20 === 0) { // A cada minuto aproximadamente
        const minutesElapsed = Math.floor(attempts * 4 / 60);
        console.log(`⏳ Ainda aguardando conclusão do desafio... (${minutesElapsed} minutos decorridos)`);

        if (currentUrl.includes('/auth_platform/codeentry')) {
          console.log('💡 Dica: Verifique seu SMS, email ou app autenticador para o código de verificação.');
        } else {
          console.log('💡 Dica: Certifique-se de completar todos os passos do desafio, incluindo clicar em "Continue" ou "Submit" se necessário.');
        }
      }
    }

    throw new Error('Timeout do desafio: Por favor, resolva o desafio do Instagram manualmente e tente novamente.');
  }

  /**
    * Lida com ações após completar o captcha (clicar em botões de continuação)
    */
  private async handlePostChallengeActions(): Promise<void> {
    if (!this.page) return;

    try {
      const currentUrl = this.page.url();

      // Lista de possíveis botões para clicar após completar o captcha
      const buttonSelectors = [
        'button[type="submit"]',
        'button:has-text("Continue")',
        'button:has-text("Submit")',
        'button:has-text("Continuar")',
        'button:has-text("Enviar")',
        'button:has-text("Confirmar")',
        'button:has-text("Próximo")',
        'button:has-text("Next")',
        '[role="button"]:has-text("Continue")',
        '[role="button"]:has-text("Submit")',
        '[role="button"]:has-text("Continuar")',
        '[role="button"]:has-text("Enviar")',
        '[role="button"]:has-text("Confirmar")',
        'input[type="submit"]',
        '.challenge-submit-button',
        '[data-testid="challenge-submit"]',
        '[data-testid="confirmationCodeSubmit"]',
        'button[data-testid="confirmationCodeSubmit"]'
      ];

      // Se estamos na página de código, procura especificamente por botões de confirmação
      if (currentUrl.includes('/auth_platform/codeentry')) {
        console.log('🔍 Procurando botão de confirmação de código...');

        // Aguarda um pouco para garantir que o código foi inserido
        await this.randomDelay(2000, 3000);

        // Verifica se há um campo de código preenchido
        const codeInput = await this.page.$('input[name="security_code"], input[name="verification_code"], [data-testid="confirmationCodeInput"]');
        if (codeInput) {
          const codeValue = await this.page.evaluate(el => (el as HTMLInputElement).value, codeInput);
          if (codeValue && codeValue.length >= 4) {
            console.log('✅ Código detectado, procurando botão de envio...');
          }
        }
      }

      for (const selector of buttonSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            // Verifica se o botão está visível e habilitado
            const isVisible = await this.page.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              const isHTMLElement = el instanceof HTMLElement;
              const disabled = isHTMLElement ? (el as HTMLInputElement | HTMLButtonElement).disabled : false;
              return rect.width > 0 && rect.height > 0 && !disabled;
            }, button);

            if (isVisible) {
              console.log(`🔘 Clicando no botão: ${selector}`);
              await button.click();
              await this.randomDelay(3000, 5000);

              // Verifica se a página mudou após o clique
              const newUrl = this.page.url();
              if (newUrl !== currentUrl) {
                console.log('✅ Página alterada após clique, continuando...');
                break;
              }
            }
          }
        } catch (error) {
          // Continua tentando outros seletores
        }
      }

      // Aguarda um pouco para a página processar
      await this.randomDelay(3000, 5000);

    } catch (error) {
      console.log('Erro ao lidar com ações pós-desafio:', error);
    }
  }

  /**
   * Carrega cookies salvos
   */
  private async loadCookies(): Promise<boolean> {
    if (!this.page) return false;

    try {
      if (fs.existsSync(this.cookiesPath)) {
        const cookies: Protocol.Network.Cookie[] = JSON.parse(fs.readFileSync(this.cookiesPath, 'utf8'));
        await this.page.setCookie(...cookies);
        return true;
      }
    } catch (error) {
      console.warn('⚠️ Erro ao carregar cookies:', error);
    }

    return false;
  }

  /**
   * Salva cookies da sessão atual
   */
  private async saveCookies(): Promise<void> {
    if (!this.page) return;

    try {
      const cookies = await this.page.cookies();
      fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2));
      console.log('🍪 Cookies salvos com sucesso');
    } catch (error) {
      console.warn('⚠️ Erro ao salvar cookies:', error);
    }
  }

  /**
   * Simula digitação humana
   */
  private async humanType(selector: string, text: string): Promise<void> {
    if (!this.page) return;

    await this.page.focus(selector);
    await this.page.keyboard.type(text, { delay: this.randomBetween(50, 150) });
  }

  /**
   * Gera delay aleatório para simular comportamento humano
   */
  private async randomDelay(min: number = 1000, max: number = 3000): Promise<void> {
    const delay = this.randomBetween(min, max);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Gera número aleatório entre min e max
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Tira screenshot para debug
   */
  private async takeScreenshot(name: string): Promise<void> {
    if (!this.page) return;

    try {
      const screenshotPath = path.join(process.cwd(), 'puppeteer-cache', `screenshot-${name}-${Date.now()}.png`);
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Screenshot salvo: ${screenshotPath}`);
    } catch (error) {
      console.warn('⚠️ Erro ao tirar screenshot:', error);
    }
  }

  /**
   * Curte um post
   */
  async likePost(postId: string): Promise<boolean> {
    if (!this.isLoggedIn || !this.page) {
      throw new Error('Usuário não está logado');
    }

    try {
      const postIdOnly = this.extractPostId(postId);
      console.log(`❤️ Curtindo post: https://www.instagram.com/p/${postIdOnly}/`);

      await this.page.goto(`https://www.instagram.com/p/${postIdOnly}/`, { waitUntil: 'networkidle2' });
      await this.randomDelay(2000, 4000);

      const likeSvgs = await this.page.$$('svg[aria-label="Curtir"][height="24"][width="24"]');

      for (const svg of likeSvgs) {
        // Sobe para o botão real
        const likeButton = await svg.evaluateHandle((el: Element) => el.closest('div[role="button"]'));
        if (likeButton) {
          const visible = await (likeButton as ElementHandle<Element>).evaluate(
            (el: Element) => !!(el as HTMLElement).offsetWidth && !!(el as HTMLElement).offsetHeight
          );
          if (visible) {
            // Clique no contexto do navegador
            await this.page.evaluate((btn: Element | null) => {
              if (btn) {
                (btn as HTMLElement).click();
              }
            }, likeButton);
            await this.randomDelay(1000, 2000);
            console.log('✅ Post curtido com sucesso');
            return true;
          }
        }
      }

      console.log('⚠️ Post já foi curtido ou botão não encontrado');
      return false;

    } catch (error) {
      console.error('❌ Erro ao curtir post:', error);
      await this.takeScreenshot('like-error');
      throw error;
    }
  }

  /**
   * Comenta em um post
   */
  async commentPost(postId: string, comment: string): Promise<boolean> {
    if (!this.isLoggedIn || !this.page) {
      throw new Error('Usuário não está logado');
    }

    try {
      const postIdOnly = this.extractPostId(postId);
      console.log(`💬 Comentando no post: ${postId}`);

      await this.page.goto(`https://www.instagram.com/p/${postIdOnly}/`, { waitUntil: 'networkidle2' });
      await this.randomDelay(2000, 4000);

      // Procura pelo campo de comentário
      const commentField = await this.page.$('textarea[aria-label="Adicione um comentário..."], textarea[aria-label="Add a comment..."]');

      if (commentField) {
        await commentField.click();
        await this.randomDelay(500, 1000);

        await this.humanType('textarea[aria-label="Adicione um comentário..."], textarea[aria-label="Add a comment..."]', comment);
        await this.randomDelay(1000, 2000);

        // Procura pelo botão de publicar (texto "Postar")
        const [publishButton] = await this.page.$x('//div[@role="button" and contains(text(), "Postar")]');

        if (publishButton) {
          await this.page.evaluate((el) => (el as HTMLElement).click(), publishButton);
          await this.randomDelay(2000, 3000);
          console.log('✅ Comentário publicado com sucesso');
          return true;
        } else {
          console.log('⚠️ Botão "Postar" não encontrado');
          return false;
        }
      }

      console.log('⚠️ Não foi possível comentar no post');
      return false;

    } catch (error) {
      console.error('❌ Erro ao comentar post:', error);
      await this.takeScreenshot('comment-error');
      throw error;
    }
  }

  /**
   * Envia mensagem direta
   */
  async sendDirectMessage(userId: string, message: string): Promise<boolean> {
    if (!this.isLoggedIn || !this.page) {
      throw new Error('Usuário não está logado');
    }

    try {
      console.log(`📩 Enviando mensagem para: ${userId}`);

      // Vai para a inbox
      await this.page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'networkidle2' });
      await this.randomDelay(2000, 4000);

      // Clica em "Enviar mensagem"
      const [newMessageButton] = await this.page.$x('//div[@role="button" and contains(text(), "Enviar mensagem")]');
      if (newMessageButton) {
        await (newMessageButton as ElementHandle<Element>).click();
        await this.randomDelay(1000, 2000);
      }

      // Campo de pesquisa
      const searchField = await this.page.$('input[placeholder="Pesquisar..."], input[placeholder="Search..."]');
      if (!searchField) {
        console.log('⚠️ Campo de pesquisa não encontrado');
        return false;
      }
      await this.humanType('input[placeholder="Pesquisar..."], input[placeholder="Search..."]', userId);
      await this.randomDelay(4000, 6000);

      // Busca o resultado exato pelo username dentro da div pai específica
      const userClicked = await this.page.evaluate((userId) => {
        const parentDiv = document.querySelector('.html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x9f619.xjbqb8w.x78zum5.x15mokao.x1ga7v0g.x16uus16.xbiv7yw.x1uhb9sk.x6ikm8r.x1rife3k.x1iyjqo2.x2lwn1j.xeuugli.xdt5ytf.xqjyukv.x1qjc9v5.x1oa3qoh.x1nhvcw1');

        if (parentDiv) {
          const targetElement = Array.from(parentDiv.querySelectorAll('span'))
            .find(el => el.textContent?.trim() === userId);

          if (targetElement) {
            // Clique no elemento correto
            (targetElement as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, userId);

      if (!userClicked) {
        console.log('⚠️ Usuário não encontrado na div pai específica');
        return false;
      }

      await this.randomDelay(1000, 2000);

      // Clica em "Bate-papo"
      const [chatButton] = await this.page.$x('//div[@role="button" and contains(text(), "Bate-papo")]');
      if (chatButton) {
        await this.randomDelay(2000, 3000);
        await (chatButton as ElementHandle<Element>).click();
      }

      // Loop até o campo de mensagem aparecer
      let messageField: ElementHandle<Element> | null = null;
      const maxRetries = 10;
      let retries = 0;

      while (!messageField && retries < maxRetries) {
        messageField = await this.page.$('div[contenteditable="true"][role="textbox"]');
        if (!messageField) {
          await this.randomDelay(500, 1000); // espera antes de tentar de novo
          retries++;
        }
      }

      if (!messageField) {
        console.log('⚠️ Campo de mensagem não encontrado após várias tentativas');
        return false;
      }
      await messageField.click();
      await this.randomDelay(1000, 2000);
      await this.page.keyboard.type(message, { delay: 50 }); // digitação humana

      // Envia a mensagem
      await this.page.keyboard.press('Enter');
      await this.randomDelay(2000, 3000);

      console.log('✅ Mensagem enviada com sucesso');
      return true;

    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error);
      await this.takeScreenshot('message-error');
      throw error;
    }
  }

  /**
   * Envia mensagem diretamente para um chat específico usando o ID do chat
   */
  async replyMessage(chatId: string, message: string): Promise<boolean> {
    if (!this.isLoggedIn || !this.page) {
      throw new Error('Usuário não está logado');
    }

    try {
      console.log(`📩 Enviando mensagem direta para chat: ${chatId}`);

      const targetUrl = `https://www.instagram.com/direct/t/${chatId}/`;
      const currentUrl = this.page.url();

      // Verifica se já está na URL do chat
      if (!currentUrl.includes(`/direct/t/${chatId}/`)) {
        console.log(`🔄 Navegando para o chat: ${targetUrl}`);
        await this.page.goto(targetUrl, { waitUntil: 'networkidle2' });
        await this.randomDelay(2000, 4000);
      } else {
        console.log('✅ Já está na URL do chat');
      }

      // Loop até o campo de mensagem aparecer
      let messageField: ElementHandle<Element> | null = null;
      const maxRetries = 10;
      let retries = 0;

      while (!messageField && retries < maxRetries) {
        messageField = await this.page.$('div[contenteditable="true"][role="textbox"]');
        if (!messageField) {
          if (retries >= 5) {
            await this.page.goto(targetUrl, { waitUntil: 'networkidle2' });
            await this.randomDelay(2000, 3000); // espera antes de tentar de novo
          }
          await this.randomDelay(500, 1000); // espera antes de tentar de novo
          retries++;
        }
      }

      if (!messageField) {
        console.log('⚠️ Campo de mensagem não encontrado após várias tentativas');
        return false;
      }

      await messageField.click();
      await this.randomDelay(1000, 2000);
      await this.page.keyboard.type(message, { delay: 50 }); // digitação humana

      // Envia a mensagem
      await this.page.keyboard.press('Enter');
      await this.randomDelay(2000, 3000);

      console.log('✅ Mensagem enviada com sucesso');
      return true;

    } catch (error) {
      console.error('❌ Erro ao enviar mensagem direta:', error);
      await this.takeScreenshot('direct-message-error');
      throw error;
    }
  }

  /**
   * Posta uma foto
   */
  async postPhoto(imagePath: string, caption?: string): Promise<boolean> {
    if (!this.isLoggedIn || !this.page) {
      throw new Error('Usuário não está logado');
    }

    try {
      console.log(`📸 Postando foto: ${imagePath}`);

      await this.page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
      await this.randomDelay(2000, 4000);

      // Clica no botão de criar post
      const [createButton] = await this.page.$$('svg[aria-label="Novo post"]');
      console.log("createButton", createButton);
      await this.page.evaluate((el) => {
        (el as HTMLElement).style.border = '3px solid red';
      }, createButton);
      if (createButton) {
        await createButton.click();
        //aria-label="Postar"
        const [postButton] = await this.page.$$('svg[aria-label="Postar"]');
        console.log("postButton", postButton);
        if (postButton) {
          await postButton.click();
        }

        // await this.page.evaluate((el) => (el as HTMLElement).click(), createButton);
        await this.randomDelay(2000, 3000);

        // Upload da imagem
        const fileInput = await this.page.$('input[type="file"]');
        if (fileInput) {
          const localPath = await this.downloadFile(imagePath, 'upload.jpg');
          await fileInput.uploadFile(localPath);
          await this.randomDelay(3000, 5000);

          // Clica em "Avançar"
          let [nextButton] = await this.page.$x('//div[@role="button" and contains(text(), "Avançar")]');
          if (nextButton) {
            await this.page.evaluate((el) => (el as HTMLElement).click(), nextButton);
            await this.randomDelay(2000, 3000);

            // Clica em "Avançar" novamente (filtros)
            [nextButton] = await this.page.$x('//div[@role="button" and contains(text(), "Avançar")]');
            if (nextButton) {
              await this.page.evaluate((el) => (el as HTMLElement).click(), nextButton);
              await this.randomDelay(2000, 3000);

              // Adiciona legenda se fornecida
              const captionField = await this.page.$('div[aria-label="Escreva uma legenda..."][role="textbox"]');

              console.log("captionField", captionField);
              if (captionField) {
                await captionField.click({ clickCount: 1 });
                if (caption) {
                  await this.page.keyboard.type(caption, { delay: 50 });
                  await this.randomDelay(1000, 2000);
                }
              }

              // Clica em "Compartilhar"
              const [shareButton] = await this.page.$x('//div[@role="button" and contains(text(), "Compartilhar")]');
              if (shareButton) {
                await this.page.evaluate((el) => (el as HTMLElement).click(), shareButton);
                await this.randomDelay(5000, 8000)
                fs.unlinkSync(localPath);
                console.log('✅ Foto postada com sucesso');
                return true;
              }
            }
          }
        }

      }

      console.log('⚠️ Não foi possível postar a foto');
      return false;

    } catch (error) {
      console.error('❌ Erro ao postar foto:', error);
      await this.takeScreenshot('post-error');
      throw error;
    }
  }

  /**
   * Segue um usuário
   */
  async followUser(userId: string): Promise<boolean> {
    if (!this.isLoggedIn || !this.page) {
      throw new Error('Usuário não está logado');
    }

    try {
      console.log(`👥 Seguindo usuário: ${userId}`);

      await this.page.goto(`https://www.instagram.com/${userId}/`, { waitUntil: 'networkidle2' });
      await this.randomDelay(2000, 4000);

      // Procura pelo botão de seguir
      const [followButton] = await this.page.$x('//button[.//div[contains(text(), "Seguir")]]');


      if (followButton) {
        await this.page.evaluate((el) => (el as HTMLElement).click(), followButton);
        await this.randomDelay(3000, 5000);
        console.log('✅ Usuário seguido com sucesso');
        return true;
      } else {
        console.log('⚠️ Usuário já está sendo seguido ou botão não encontrado');
        return false;
      }

    } catch (error) {
      console.error('❌ Erro ao seguir usuário:', error);
      await this.takeScreenshot('follow-error');
      throw error;
    }
  }

  /**
   * Para de seguir um usuário
   */
  async unfollowUser(userId: string): Promise<boolean> {
    if (!this.isLoggedIn || !this.page) {
      throw new Error('Usuário não está logado');
    }

    try {
      console.log(`👥 Deixando de seguir usuário: ${userId}`);

      await this.page.goto(`https://www.instagram.com/${userId}/`, { waitUntil: 'networkidle2' });
      await this.randomDelay(2000, 4000);

      // Procura pelo botão de seguindo
      const [unfollowButton] = await this.page.$x(`//button[.//div/div[text()="Seguindo"]]`);

      if (unfollowButton) {
        await this.page.evaluate((el) => (el as HTMLElement).click(), unfollowButton);
        await this.randomDelay(1000, 2000);

        // Confirma deixar de seguir
        // Confirma deixar de seguir (XPath aceita OR `|`)
        const [confirmButton] = await this.page.$x('//span[contains(text(), "Deixar de seguir")] | //span[contains(text(), "Unfollow")]');
        if (confirmButton) {
          await this.page.evaluate((el) => (el as HTMLElement).click(), confirmButton);
          await this.randomDelay(2000, 3000);
          console.log('✅ Deixou de seguir usuário com sucesso');
          return true;
        }
      } else {
        console.log('⚠️ Usuário não está sendo seguido ou botão não encontrado');
        return false;
      }

      return false;

    } catch (error) {
      console.error('❌ Erro ao deixar de seguir usuário:', error);
      await this.takeScreenshot('unfollow-error');
      throw error;
    }
  }

  /**
   * Monitora novas mensagens na caixa de entrada e requests
   */
  async monitorNewMessages(options: {
    includeRequests?: boolean;
    onNewMessage?: (data: {
      username: string;
      profileImageUrl: string;
      chatId: string;
      messages: Array<{
        author: string;
        text: string;
        fromMe: boolean;
      }>;
    }) => void;
  } = {}): Promise<void> {
    if (!this.isLoggedIn || !this.page) {
      throw new Error('Usuário não está logado');
    }

    // Desabilita monitoramento de posts quando mensagens for ativado
    this.isMonitoringNewPostsFromUsers = false;

    if (!this.isMonitoringNewMessages) {
      console.log("Monitoramento pausado");
      return;
    }

    const {
      includeRequests = true,
      onNewMessage
    } = options;

    console.log('📬 Iniciando monitoramento de novas mensagens...');
    console.log(`📥 Monitorar requests: ${includeRequests ? 'Sim' : 'Não'}`);
    const url = 'https://www.instagram.com/direct/inbox/';
    await this.page!.goto(url, { waitUntil: 'networkidle2' });
    while (this.isMonitoringNewMessages) {
      // Verifica conectividade antes de cada iteração
      const browserConnected = await this.isBrowserConnected();
      const pageActive = await this.isPageActive();

      if (!browserConnected || !pageActive) {
        console.log('🔍 Página desconectada detectada no monitoramento de mensagens:', !browserConnected ? 'Navegador fechado' : 'Página inativa');
        this.isMonitoringNewMessages = false;
        break;
      }

      if (!this.page!.url().includes("/direct/inbox/")) {
        try {
          await this.page!.goto(url, { waitUntil: 'networkidle2' });
          console.log("Navegou para o inbox");
          await this.randomDelay(2000, 4000);
        } catch (err) {
          console.error("Erro ao navegar:", err);
        }
      }
      try {

        // Localiza conversas com "Unread"
        const unreadSelector = '//div[contains(text(), "Unread")]'; // div que contém "Unread"

        await this.page!.waitForXPath(unreadSelector, { timeout: 0 });
        console.log('Nova conversa não lida detectada!');

        // Seleciona todos os elementos que correspondem ao seletor
        const unreadElements = await this.page!.$x(unreadSelector);
        console.log('Número de conversas não lidas:', unreadElements.length);

        for (const conv of unreadElements) {
          try {
            // Clica na conversa
            await (conv as ElementHandle<Element>).click();
            // await this.page!.waitForNavigation({ waitUntil: 'networkidle2' });
            await this.randomDelay(2000, 2500)
            console.log('📥 Aguardando carregamento da nova página...', conv);
            // Recupera a URL atual
            const currentUrl = this.page!.url();
            if (currentUrl.includes("/direct/t/")) {
              const chatId = currentUrl.split("/direct/t/")[1].replace("/", "");
              console.log(`✅ Abriu conversa. Chat ID: ${chatId}`);

              console.log("🔍 Iniciando extração de dados da conversa...");

              // Primeiro, tenta encontrar a imagem de perfil fora do evaluate
              let profileImageUrl = "";
              try {
                // Tenta diferentes seletores para a imagem de perfil
                const profileSelectors = [
                  'a[aria-label^="Open the profile page of"] img',
                  'img[alt*="profile picture"]',
                  'img[src*="profile"]',
                  'header img',
                  'div[role="banner"] img'
                ];

                for (const selector of profileSelectors) {
                  try {
                    const imgElement = await this.page!.$(selector);
                    if (imgElement) {
                      profileImageUrl = await imgElement.evaluate(img => img.getAttribute('src')) || "";
                      if (profileImageUrl) {
                        console.log(`✅ Imagem encontrada com seletor: ${selector}`);
                        console.log(`🖼️ URL da imagem: ${profileImageUrl}`);
                        break;
                      }
                    }
                  } catch (e) {
                    // Continua tentando outros seletores
                  }
                }

                if (!profileImageUrl) {
                  console.log("⚠️ Não foi possível encontrar a imagem de perfil com os seletores padrão");
                  const allImages = await this.page!.$$('img');
                  console.log(`🔍 Encontradas ${allImages.length} imagens na página`);

                  for (const img of allImages.slice(0, 10)) {
                    const src = await img.evaluate(el => el.getAttribute('src')) || '';
                    const alt = await img.evaluate(el => el.getAttribute('alt')) || '';
                    const srcClean = src.replace(/\s+/g, '').trim();

                    if (srcClean && (
                      srcClean.includes('profile') ||
                      alt.toLowerCase().includes('profile') ||
                      srcClean.includes('avatar') ||
                      alt.toLowerCase().includes('avatar')
                    )) {
                      profileImageUrl = srcClean;
                      console.log(`✅ Imagem de perfil encontrada:`, profileImageUrl);
                      break;
                    }
                  }
                }
              } catch (error) {
                console.log("❌ Erro ao buscar imagem de perfil:", error);
              }

              // Extrai o username e as mensagens
              const conversationData = await this.page!.evaluate(() => {
                // Seleciona o <a> pelo atributo aria-label que contém "Open the profile page of"
                const profileLink = document.querySelector('a[aria-label^="Open the profile page of"]');
                let username = "";
                if (profileLink) {
                  // Pega o texto depois de "Open the profile page of "
                  const label = profileLink.getAttribute("aria-label") || "";
                  username = label.replace("Open the profile page of ", "").trim();
                }

                console.log("Username:", username);
                // Extrai as mensagens
                const results: Array<{
                  author: string;
                  text: string;
                  fromMe: boolean;
                }> = [];

                const rows = document.querySelectorAll('div[role="gridcell"][data-scope="messages_table"]');
                let lastAuthor: string | null = null;

                rows.forEach(row => {
                  const textEl = row.querySelector('div[dir="auto"]');
                  const authorEl = row.querySelector('h6 span, h5 span');

                  const text = textEl?.textContent?.trim() || "";
                  let author = authorEl?.textContent?.trim() || "";

                  let fromMe = false;

                  if (!author) {
                    // Reaproveita o último autor conhecido
                    if (row.classList.contains("xyk4ms5")) {
                      author = "me";
                      fromMe = true;
                    } else if (lastAuthor) {
                      author = lastAuthor;
                      fromMe = author === "me";
                    } else {
                      author = "usuario"; // fallback
                      fromMe = false;
                    }
                  } else {
                    fromMe = author === "Você enviou" || author === "";
                    if (fromMe) author = "me";
                  }

                  // Atualiza o último autor conhecido
                  lastAuthor = author;

                  if (text) {
                    results.push({ author, text, fromMe });
                  }
                });


                return {
                  username,
                  messages: results
                };
              });

              // console.log(`💬 Conversa com ${conversationData.username} (Chat ID: ${chatId}):`, conversationData.messages);
              // console.log(`👤 Username extraído: ${conversationData.username}`);

              // Chama o callback se fornecido
              if (onNewMessage) {
                onNewMessage({
                  username: conversationData.username,
                  profileImageUrl: profileImageUrl,
                  chatId: chatId,
                  messages: conversationData.messages
                });
              }

            }

            // Pequeno delay antes de processar a próxima
            await this.randomDelay(2000, 4000);
          } catch (err) {
            console.error("❌ Erro ao clicar na conversa:", err);
          }
        }
      } catch (error) {
        console.error(`Nenhuma nova mensagem detectada, continuando a observação...`);
      }
      await this.randomDelay(2000, 4000);
    }
  }

  /**
   * Para o monitoramento de mensagens (método auxiliar)
   */
  switchMessagesMonitoring(enabled: boolean): void {
    if (enabled) {
      console.log('▶️ Iniciando monitoramento de mensagens...');
      this.isMonitoringNewMessages = true;
      // Desabilita monitoramento de posts quando mensagens for ativado
      this.isMonitoringNewPostsFromUsers = false;
    } else {
      console.log('🛑 Parando monitoramento de mensagens...');
      this.isMonitoringNewMessages = false;
    }
    // Nota: O monitoramento para automaticamente quando a instância é fechada
  }

  getIsMonitoringNewMessages(): boolean {
    return this.isMonitoringNewMessages;
  }

  /**
   * Interface para dados dos posts (definida acima)
   */

  /**
   * Coleta até 50 usuários que curtiram um post específico
   */
  private async getLikedByUsers(postUrl: string): Promise<string[]> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      // Extrai o ID do post da URL (funciona para /p/ e /reel/)
      const postIdMatch = postUrl.match(/\/(p|reel)\/([^/]+)\//);
      if (!postIdMatch) {
        throw new Error('URL do post inválida');
      }

      const postId = postIdMatch[2];
      const likedByUrl = `https://www.instagram.com/p/${postId}/liked_by/`;

      console.log(`🔍 Navegando para página de curtidas: ${likedByUrl}`);

      // Navega para a página de curtidas
      await this.page.goto(likedByUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      await this.randomDelay(2000, 3000);

      // Aguarda o carregamento da lista de usuários
      try {
        await this.page.waitForSelector('div.x1rg5ohu:not([class*=" "]) span.xjp7ctv a', { timeout: 10000 });
      } catch {
        console.warn('⚠️ Nenhum usuário encontrado na página de curtidas');
        return [];
      }

      // Coleta os usernames usando o seletor fornecido
      const usernamesThatLikes = await this.page.$$eval(
        'div.x1rg5ohu:not([class*=" "]) span.xjp7ctv a',
        (anchors) => anchors.map(a => a.getAttribute('href'))
      );

      // Extrai apenas os usernames das URLs e limita a 50
      const usernames = usernamesThatLikes
        .map(href => {
          if (href && href.startsWith('/')) {
            return href.replace('/', '').replace('/', '');
          }
          return null;
        })
        .filter(username => username !== null && username.length > 0)
        .slice(0, 50) as string[];

      console.log(`✅ Coletados ${usernames.length} usuários que curtiram o post`);
      return usernames;

    } catch (error: any) {
      console.error(`❌ Erro ao coletar curtidores:`, error.message);
      return [];
    }
  }

  /**
   * Monitora novos posts de uma lista de usuários (últimos 10 posts de cada)
   */
  async monitorNewPostsFromUsers(options: {
    usernames: string[];
    checkInterval?: number;
    maxExecutions?: number;
    maxPostsPerUser?: number;
    maxPostAgeUnit?: 'minutes' | 'hours' | 'days';
    maxPostAge?: number;
    onNewPosts?: (posts: PostData[], executionCount: number, totalTime: number) => void;
  }): Promise<PostData[]> {
    if (!this.isLoggedIn || !this.page) {
      throw new Error('Usuário não está logado');
    }

    // Desabilita outros monitoramentos
    this.isMonitoringNewMessages = false;
    this.isMonitoringNewPostsFromUsers = true;

    const { usernames, checkInterval = 60000, maxExecutions, maxPostsPerUser = 6, maxPostAgeUnit = 'hours', maxPostAge = 24, onNewPosts } = options;

    console.log('📸 Iniciando monitoramento de posts de usuários...');
    console.log(`👥 Usuários monitorados: ${usernames.join(', ')}`);
    console.log(`⏱️ Intervalo de verificação: ${checkInterval / 1000}s`);
    if (maxExecutions) {
      console.log(`🔄 Máximo de execuções: ${maxExecutions}`);
    }
    if (maxPostsPerUser) {
      console.log(`🔄 Máximo de posts por usuário: ${maxPostsPerUser}`);
    }
    console.log(`⏰ Filtro de idade: ${maxPostAge} ${maxPostAgeUnit}`);

    // Função auxiliar para verificar se o post está dentro do limite de idade
    const isPostWithinAgeLimit = (postDate: string | null): boolean => {
      if (!postDate) return true; // Se não há data, considera válido
      
      const now = new Date();
      const postDateTime = new Date(postDate);
      const diffMs = now.getTime() - postDateTime.getTime();
      
      let maxAgeMs: number;
      switch (maxPostAgeUnit) {
        case 'minutes':
          maxAgeMs = maxPostAge * 60 * 1000;
          break;
        case 'hours':
          maxAgeMs = maxPostAge * 60 * 60 * 1000;
          break;
        case 'days':
          maxAgeMs = maxPostAge * 24 * 60 * 60 * 1000;
          break;
        default:
          maxAgeMs = maxPostAge * 60 * 60 * 1000; // default para horas
      }
      
      return diffMs <= maxAgeMs;
    };

    const seenPosts = new Set<string>();
    const allCollectedPosts: PostData[] = [];
    let executionCount = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;
    const startTime = Date.now();

    while (this.isMonitoringNewPostsFromUsers && (!maxExecutions || executionCount < maxExecutions)) {
      executionCount++;

      // Verifica se o navegador e a página ainda estão conectados
      const browserConnected = await this.isBrowserConnected();
      const pageActive = await this.isPageActive();

      if (!browserConnected || !pageActive) {
        console.log('🔍 Página desconectada detectada:', !browserConnected ? 'Navegador fechado' : 'Página inativa');
        this.isMonitoringNewPostsFromUsers = false;
        break;
      }

      // Circuit breaker: para se houver muitos erros consecutivos
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.error(`❌ Muitos erros consecutivos (${consecutiveErrors}). Parando monitoramento.`);
        this.isMonitoringNewPostsFromUsers = false;
        break;
      }

      try {
        const allNewPosts: PostData[] = [];

        for (const username of usernames) {
          if (!this.isMonitoringNewPostsFromUsers) break;

          // Verifica conectividade antes de processar cada usuário
          const browserConnected = await this.isBrowserConnected();
          const pageActive = await this.isPageActive();

          if (!browserConnected || !pageActive) {
            console.log('🔍 Página desconectada detectada:', !browserConnected ? 'Navegador fechado' : 'Página inativa');
            this.isMonitoringNewPostsFromUsers = false;
            break;
          }

          // Função auxiliar para extrair 6 links de posts/reels de uma aba com retry
          const extractLinks = async (path: string, user: string, retries: number = 3) => {
            if (!this.page) throw new Error('Page not initialized');

            for (let attempt = 1; attempt <= retries; attempt++) {
              try {
                console.log(`🔄 Tentativa ${attempt}/${retries} para @${user}${path}`);

                await this.page.goto(`https://www.instagram.com/${user}${path}`, {
                  waitUntil: 'domcontentloaded',
                  timeout: 15000,
                });

                // Aguarda um pouco para o conteúdo carregar
                await this.randomDelay(2000, 3000);

                // Tenta aguardar por links, mas não falha se não encontrar
                try {
                  await this.page.waitForSelector('a[href]', { timeout: 5000 });
                } catch {
                  console.warn(`⚠️ Nenhum link encontrado para @${user}${path}`);
                  return [];
                }

                await this.randomDelay(1000, 2000);

                const links = await this.page.evaluate((u, limit) => {
                  const anchors = Array.from(document.querySelectorAll('a[href]'));
                  const links = anchors
                    .map((a) => (a as HTMLAnchorElement).href)
                    .filter((href) => href.includes('/p/') || href.includes('/reel/'))
                    .slice(0, limit);

                  return links.map((url) => {
                    const postId =
                      url.includes('/p/')
                        ? url.split('/p/')[1]?.split('/')[0]
                        : url.split('/reel/')[1]?.split('/')[0];

                    return {
                      url,
                      id: postId || '',
                      timeAgo: 'Desconhecido',
                      likes: 0,
                      comments: 0,
                      username: u,
                      postDate: null,
                    };
                  });
                }, user, maxPostsPerUser);

                console.log(`✅ Encontrados ${links.length} posts/reels para @${user}${path}`);
                return links;

              } catch (error: any) {
                console.warn(`⚠️ Tentativa ${attempt}/${retries} falhou para @${user}${path}:`, error.message);

                if (attempt === retries) {
                  console.error(`❌ Todas as tentativas falharam para @${user}${path}`);
                  return [];
                }

                // Aguarda antes da próxima tentativa
                await this.randomDelay(2000, 4000);
              }
            }

            return [];
          };

          try {
            // Executa sequencialmente para evitar conflitos de navegação na mesma página
            console.log(`🔍 Coletando posts principais de @${username}...`);
            const postsMain = await extractLinks('/', username);

            console.log(`🎬 Coletando reels de @${username}...`);
            const postsReels = await extractLinks('/reels/', username);

            // junta e remove duplicados
            const merged = [...postsMain, ...postsReels].filter(
              (p, idx, arr) => arr.findIndex((pp) => pp.id === p.id) === idx
            );

            for (const post of merged) {
              if (!this.isMonitoringNewPostsFromUsers) break;
              if (!post.id || seenPosts.has(post.id)) continue;

              // Verifica conectividade antes de processar cada post
              const browserConnected = await this.isBrowserConnected();
              const pageActive = await this.isPageActive();

              if (!browserConnected || !pageActive) {
                console.log('🔍 Página desconectada detectada:', !browserConnected ? 'Navegador fechado' : 'Página inativa');
                this.isMonitoringNewPostsFromUsers = false;
                break;
              }

              // Processa post individual com retry
              const processPost = async (postData: any, retries: number = 2) => {
                for (let attempt = 1; attempt <= retries; attempt++) {
                  try {
                    console.log(`🔍 Processando post ${postData.id} (tentativa ${attempt}/${retries})`);

                    await this.page!.goto(postData.url, {
                      waitUntil: 'domcontentloaded',
                      timeout: 12000,
                    });

                    await this.randomDelay(1000, 2000);

                    // Pega stats com timeout usando seletores mais específicos
                    const stats = await Promise.race([
                      this.page!.evaluate(() => {
                        let likes = 0;
                        let comments = 0;

                        // Busca curtidas pelo href específico '/liked_by/'
                        const likeLink = document.querySelector('a[href*="/liked_by/"]');
                        if (likeLink) {
                          const likeText = likeLink.textContent || '';
                          const likeMatch = likeText.match(/([\d,.]+)/);
                          if (likeMatch) {
                            likes = parseInt(likeMatch[1].replace(/[,.]/g, '')) || 0;
                          }
                        }

                        // Fallback: busca por texto genérico se não encontrar o link específico
                        if (likes === 0) {
                          const texts = Array.from(document.querySelectorAll('span, a')).map(
                            (el) => el.textContent || ''
                          );

                          for (const t of texts) {
                            if (/curtida|like/i.test(t)) {
                              const m = t.match(/([\d,.]+)/);
                              if (m) {
                                likes = parseInt(m[1].replace(/[,.]/g, '')) || 0;
                                break;
                              }
                            }
                          }
                        }

                        // Busca comentários
                        const texts = Array.from(document.querySelectorAll('span, a')).map(
                          (el) => el.textContent || ''
                        );

                        for (const t of texts) {
                          if (/comentário|comment/i.test(t)) {
                            const m = t.match(/([\d,.]+)/);
                            if (m) {
                              comments = parseInt(m[1].replace(/[,.]/g, '')) || 0;
                              break;
                            }
                          }
                        }

                        // Busca data da postagem
                        let postDate = null;
                        const timeElement = document.querySelector('time[datetime]');
                        if (timeElement) {
                          const datetime = timeElement.getAttribute('datetime');
                          if (datetime) {
                            postDate = new Date(datetime).toISOString();
                          }
                        }

                        // Busca legenda do post
                        let caption = '';
                        // Primeira tentativa: elemento h1
                        let captionElement = document.querySelector('h1._ap3a._aaco._aacu._aacx._aad7._aade');
                        if (captionElement) {
                          caption = captionElement.textContent || '';
                        } else {
                          // Segunda tentativa: elemento span com style específico
                          captionElement = document.querySelector('span.x193iq5w.x126k92a[style="line-height: 18px;"]');
                          if (captionElement) {
                            caption = captionElement.textContent || '';
                          }
                        }

                        return { likes, comments, postDate, caption };
                      }),
                      new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout ao extrair stats')), 8000)
                      )
                    ]) as { likes: number; comments: number; postDate: string | null; caption: string };

                    postData.likes = stats.likes;
                    postData.comments = stats.comments;
                    postData.postDate = stats.postDate;
                    postData.caption = stats.caption;

                    // Verifica se o post está dentro do limite de idade ANTES de coletar likes
                    if (isPostWithinAgeLimit(postData.postDate)) {
                      // Coleta usuários que curtiram o post apenas se estiver dentro do limite de idade
                      try {
                        const likedByUsers = await this.getLikedByUsers(postData.url);
                        postData.likedByUsers = likedByUsers;
                        postData.followedLikers = false; // Inicialmente não seguiu os curtidores

                        if (likedByUsers.length > 0) {
                          console.log(`👥 Coletados ${likedByUsers.length} usuários que curtiram o post`);
                        }
                      } catch (likeError: any) {
                        console.warn(`⚠️ Erro ao coletar curtidores do post ${postData.url}:`, likeError.message);
                        postData.likedByUsers = [];
                        postData.followedLikers = false;
                      }

                      seenPosts.add(postData.id);
                      allNewPosts.push(postData);
                      allCollectedPosts.push(postData);

                      const dateInfo = postData.postDate ? ` (${new Date(postData.postDate).toLocaleDateString('pt-BR')})` : '';
                      const captionInfo = postData.caption ? ` - Legenda: "${postData.caption.substring(0, 50)}${postData.caption.length > 50 ? '...' : ''}"` : '';
                      console.log(
                        `📊 Post/Reel de @${username}: ${postData.likes} curtidas, ${postData.comments} comentários${dateInfo}${captionInfo}`
                      );
                    } else {
                      // Post fora do limite de idade - não coleta likes para economizar recursos
                      postData.likedByUsers = [];
                      postData.followedLikers = false;
                      
                      const dateInfo = postData.postDate ? ` (${new Date(postData.postDate).toLocaleDateString('pt-BR')})` : '';
                      console.log(
                        `⏰ Post/Reel de @${username} ignorado por idade${dateInfo} - fora do limite de ${maxPostAge} ${maxPostAgeUnit} (likes não coletados)`
                      );
                    }

                    return true; // Sucesso

                  } catch (err: any) {
                    console.warn(`⚠️ Tentativa ${attempt}/${retries} falhou para ${postData.url}:`, err.message);

                    if (attempt === retries) {
                      console.error(`❌ Falha definitiva ao processar ${postData.url}`);
                      return false;
                    }

                    await this.randomDelay(1500, 3000);
                  }
                }
                return false;
              };

              await processPost(post);
            }
          } catch (err: any) {
            console.error(`⚠️ Erro ao coletar posts/reels de @${username}:`, err.message);

            // Se for erro de navegação, tenta reinicializar a página
            if (err.message.includes('ERR_ABORTED') || err.message.includes('Navigation')) {
              console.log(`🔄 Tentando reinicializar página após erro de navegação...`);
              try {
                await this.page!.goto('https://www.instagram.com/', {
                  waitUntil: 'domcontentloaded',
                  timeout: 10000
                });
                await this.randomDelay(2000, 4000);
              } catch (reinitErr: any) {
                console.error(`❌ Falha ao reinicializar página:`, reinitErr.message);
              }
            }
          }
          await this.randomDelay(3000, 5000); // Delay entre usuários
        }

        const currentTime = Date.now();
        const totalTime = currentTime - startTime;

        // Chama callback se houver novos posts
        if (allNewPosts.length > 0 && onNewPosts) {
          onNewPosts(allNewPosts, executionCount, totalTime);
        }

        console.log(`✅ Verificação ${executionCount}${maxExecutions ? `/${maxExecutions}` : ''} completa. ${allNewPosts.length} novos posts encontrados.`);
        console.log(`⏱️ Tempo total decorrido: ${Math.round(totalTime / 1000)}s`);

        // Reset contador de erros em caso de sucesso
        consecutiveErrors = 0;

      } catch (error: any) {
        consecutiveErrors++;
        console.error(`❌ Erro no monitoramento de posts (${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);

        // Em caso de erro crítico, aguarda mais tempo antes da próxima tentativa
        if (consecutiveErrors >= 2) {
          console.log(`⏳ Aguardando tempo extra devido a erros consecutivos...`);
          await this.randomDelay(10000, 15000);
        }
      }

      // Aguarda próxima verificação
      await this.randomDelay(checkInterval, checkInterval + 5000);
    }

    return allCollectedPosts;
  }

  /**
   * Extrai dados de um único post do Instagram e salva no banco de dados
   */
  async extractPostData(postUrl: string): Promise<PostData | null> {
    if (!this.isLoggedIn || !this.page) {
      throw new Error('Usuário não está logado');
    }

    // Valida se é uma URL válida do Instagram
    if (!postUrl.includes('instagram.com') || (!postUrl.includes('/p/') && !postUrl.includes('/reel/'))) {
      throw new Error('URL inválida. Deve ser uma URL de post ou reel do Instagram.');
    }

    console.log(`🔍 Extraindo dados do post: ${postUrl}`);

    try {
      // Extrai o ID do post da URL
      const postIdMatch = postUrl.match(/\/(p|reel)\/([^/]+)\//); 
      const postId = postIdMatch ? postIdMatch[2] : '';
      
      if (!postId) {
        throw new Error('Não foi possível extrair o ID do post da URL');
      }

      // Extrai o username da URL ou tenta detectar na página
      let username = '';
      const usernameMatch = postUrl.match(/instagram\.com\/([^/]+)\//); 
      if (usernameMatch) {
        username = usernameMatch[1];
      }

      // Navega para o post
      await this.page.goto(postUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      await this.randomDelay(2000, 3000);

      // Extrai dados do post
      const postData = await this.page.evaluate(() => {
        let likes = 0;
        let comments = 0;
        let username = '';
        let postDate = null;
        let caption = '';

        // Busca curtidas pelo href específico '/liked_by/'
        const likeLink = document.querySelector('a[href*="/liked_by/"]');
        if (likeLink) {
          const likeText = likeLink.textContent || '';
          const likeMatch = likeText.match(/([\d,.]+)/);
          if (likeMatch) {
            likes = parseInt(likeMatch[1].replace(/[,.]/g, '')) || 0;
          }
        }

        // Fallback: busca por texto genérico se não encontrar o link específico
        if (likes === 0) {
          const texts = Array.from(document.querySelectorAll('span, a')).map(
            (el) => el.textContent || ''
          );

          for (const t of texts) {
            if (/curtida|like/i.test(t)) {
              const m = t.match(/([\d,.]+)/);
              if (m) {
                likes = parseInt(m[1].replace(/[,.]/g, '')) || 0;
                break;
              }
            }
          }
        }

        // Busca comentários
        const texts = Array.from(document.querySelectorAll('span, a')).map(
          (el) => el.textContent || ''
        );

        for (const t of texts) {
          if (/comentário|comment/i.test(t)) {
            const m = t.match(/([\d,.]+)/);
            if (m) {
              comments = parseInt(m[1].replace(/[,.]/g, '')) || 0;
              break;
            }
          }
        }

        // Busca data da postagem
        const timeElement = document.querySelector('time[datetime]');
        if (timeElement) {
          const datetime = timeElement.getAttribute('datetime');
          if (datetime) {
            postDate = new Date(datetime).toISOString();
          }
        }

        // Busca legenda do post
        // Primeira tentativa: elemento h1
        let captionElement = document.querySelector('h1._ap3a._aaco._aacu._aacx._aad7._aade');
        if (captionElement) {
          caption = captionElement.textContent || '';
        } else {
          // Segunda tentativa: elemento span com style específico
          captionElement = document.querySelector('span.x193iq5w.x126k92a[style="line-height: 18px;"]');
          if (captionElement) {
            caption = captionElement.textContent || '';
          }
        }

        // Busca username se não foi extraído da URL
        if (!username) {
          const usernameElement = document.querySelector('a[href*="/"] span');
          if (usernameElement) {
            username = usernameElement.textContent || '';
          }
        }

        return { likes, comments, postDate, caption, username };
      });

      // Se não conseguiu extrair username da página, usa o da URL ou deixa vazio
      if (!postData.username && username) {
        postData.username = username;
      }

      // Coleta usuários que curtiram o post
      let likedByUsers: string[] = [];
      try {
        likedByUsers = await this.getLikedByUsers(postUrl);
        if (likedByUsers.length > 0) {
          console.log(`👥 Coletados ${likedByUsers.length} usuários que curtiram o post`);
        }
      } catch (likeError: any) {
        console.warn(`⚠️ Erro ao coletar curtidores do post ${postUrl}:`, likeError.message);
      }

      // Cria objeto PostData
        const post: PostData = {
          url: postUrl,
          post_id: postId,
          post_date: postData.postDate || undefined,
          likes: postData.likes,
          comments: postData.comments,
          username: postData.username || 'desconhecido',
          caption: postData.caption,
          likedByUsers: likedByUsers,
          followedLikers: false
        };

      return post;

    } catch (error: any) {
      console.error(`❌ Erro ao extrair dados do post ${postUrl}:`, error.message);
      throw error;
    }
  }

  /**
   * Para/inicia o monitoramento de posts de usuários
   */
  switchPostsMonitoring(enabled: boolean): void {
    if (enabled) {
      console.log('▶️ Iniciando monitoramento de posts...');
      this.isMonitoringNewPostsFromUsers = true;
      // Desabilita monitoramento de mensagens
      this.isMonitoringNewMessages = false;
    } else {
      console.log('🛑 Parando monitoramento de posts...');
      this.isMonitoringNewPostsFromUsers = false;
    }
  }

  /**
   * Retorna se está monitorando posts de usuários
   */
  getIsMonitoringNewPostsFromUsers(): boolean {
    return this.isMonitoringNewPostsFromUsers;
  }

  /**
   * Fecha o navegador e limpa recursos
   */
  async close(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      console.log('🔒 Instagram Automator fechado com sucesso');
    } catch (error) {
      console.error('❌ Erro ao fechar navegador:', error);
    }
  }

  /**
   * Verifica se está logado
   */
  get loggedIn(): boolean {
    return this.isLoggedIn;
  }

  /**
   * Obtém a página atual (para uso avançado)
   */
  get currentPage(): Page | null {
    return this.page;
  }

  /**
   * Obtém o navegador atual (para uso avançado)
   */
  get currentBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * Verifica se o navegador ainda está conectado e ativo
   */
  async isBrowserConnected(): Promise<boolean> {
    try {
      if (!this.browser) {
        return false;
      }

      // Tenta obter as páginas do navegador para verificar se ainda está conectado
      const pages = await this.browser.pages();
      return pages.length > 0;
    } catch (error) {
      // Se houver erro, significa que o navegador foi fechado
      console.log('🔍 Navegador desconectado detectado:', (error as Error).message);
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
      return false;
    }
  }

  /**
   * Verifica se a página ainda está ativa
   */
  async isPageActive(): Promise<boolean> {
    try {
      if (!this.page) {
        return false;
      }

      // Tenta verificar se a página ainda está ativa
      await this.page.url();
      return true;
    } catch (error) {
      // Se houver erro, significa que a página foi fechada
      console.log('🔍 Página desconectada detectada:', (error as Error).message);
      this.page = null;
      return false;
    }
  }

  private extractPostId(input: string): string {
    try {
      // Se for uma URL completa (com ou sem protocolo)
      if (input.includes("instagram.com")) {
        // Garante que tenha protocolo
        const url = input.startsWith("http") ? input : `https://${input}`;
        const parsed = new URL(url);

        // URL padrão do Instagram: /p/:id/
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts[0] === "p" && parts[1]) {
          return parts[1];
        }
      }

      // Caso contrário, assumimos que já é só o postId
      return input.trim();
    } catch {
      return input.trim(); // fallback se der erro no parse
    }
  }

/**
 * Faz download de um arquivo remoto e salva no diretório temporário local.
 * Retorna o caminho absoluto do arquivo salvo.
 */
private async downloadFile(url: string, filename: string): Promise<string> {
  // Usa fetch nativa do Node 18+
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Erro ao baixar arquivo: ${res.status} ${res.statusText}`);
  }

  // Converte para Buffer
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Salva no diretório temporário
  const tempPath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(tempPath, buffer);

  return tempPath;
}


}