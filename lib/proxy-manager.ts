export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: 'http' | 'https' | 'socks5';
}

export class ProxyManager {
  private proxies: ProxyConfig[] = [];
  private currentIndex = 0;
  private failedProxies = new Set<string>();
  private useProxies: boolean;

  constructor(useProxies = false) {
    this.useProxies = useProxies;
    
    // Add some basic proxy configurations (you would replace with real proxies)
    if (useProxies) {
      this.proxies = [
        // Add your proxy configurations here
        // Example:
        // { host: 'proxy1.example.com', port: 8080, protocol: 'http' },
        // { host: 'proxy2.example.com', port: 8080, protocol: 'http' },
      ];
    }
  }

  getNextProxy(): ProxyConfig | null {
    if (!this.useProxies || this.proxies.length === 0) {
      return null;
    }

    // Find next working proxy
    let attempts = 0;
    while (attempts < this.proxies.length) {
      const proxy = this.proxies[this.currentIndex];
      const proxyKey = `${proxy.host}:${proxy.port}`;
      
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      
      if (!this.failedProxies.has(proxyKey)) {
        return proxy;
      }
      
      attempts++;
    }
    
    // If all proxies failed, reset and try again
    this.failedProxies.clear();
    return this.proxies[0] || null;
  }

  markProxyFailed(proxy: ProxyConfig): void {
    const proxyKey = `${proxy.host}:${proxy.port}`;
    this.failedProxies.add(proxyKey);
    console.log(`Marked proxy ${proxyKey} as failed`);
  }

  getProxyArgs(proxy: ProxyConfig | null): string[] {
    if (!proxy) {
      return [];
    }

    const args = [
      `--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`
    ];

    if (proxy.username && proxy.password) {
      // For authenticated proxies, you might need to handle this differently
      // depending on the proxy type and Puppeteer version
      args.push(`--proxy-auth=${proxy.username}:${proxy.password}`);
    }

    return args;
  }

  generateRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  static getRandomDelay(min = 2000, max = 5000): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

// Enhanced browser initialization with proxy support
export function getBrowserArgs(proxy: ProxyConfig | null, userAgent?: string): {
  args: string[];
  userAgent: string;
} {
  const baseArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=VizDisplayCompositor',
    '--window-size=1920,1080'
  ];

  const proxyManager = new ProxyManager();
  const finalUserAgent = userAgent || proxyManager.generateRandomUserAgent();
  
  let args = [...baseArgs, `--user-agent=${finalUserAgent}`];
  
  if (proxy) {
    args = args.concat(proxyManager.getProxyArgs(proxy));
  }

  return {
    args,
    userAgent: finalUserAgent
  };
}