/**
 * Browser Automation Client ( CDP )
 *
 * PowerShell  Chrome CDP   ,
 * WebSocket CDP (Chrome DevTools Protocol)    .
 *
 *    (playwright ) .
 */

import { spawn, ChildProcess, execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import WebSocket from 'ws';
import { logger } from '../../utils/logger.js';
import { reportError } from '../../core/telemetry/error-reporter.js';

import {
  getPlatform,
  getPowerShellPath,
  Platform,
} from '../../utils/platform-utils.js';
import { isMirroredNetworking } from '../../utils/wsl-utils.js';

// ===========================================================================
// Types
// ===========================================================================

interface BrowserResponse {
  success: boolean;
  message?: string;
  error?: string;
  details?: string;
  [key: string]: unknown;
}

interface HealthResponse extends BrowserResponse {
  status: string;
  version: string;
  browser: {
    active: boolean;
    type: string | null;
    chrome_available: boolean;
    edge_available: boolean;
  };
}

interface ScreenshotResponse extends BrowserResponse {
  image?: string;
  format?: string;
  encoding?: string;
  url?: string;
  title?: string;
}

interface NavigateResponse extends BrowserResponse {
  url?: string;
  title?: string;
}

interface PageInfoResponse extends BrowserResponse {
  url?: string;
  title?: string;
  html?: string;
  domain?: string;
  protocol?: string;
  pathname?: string;
  readyState?: string;
  bodyLength?: number;
  linkCount?: number;
  imageCount?: number;
  formCount?: number;
  inputCount?: number;
}

interface ConsoleLogEntry {
  level: string;
  message: string;
  timestamp: number;
}

interface ConsoleResponse extends BrowserResponse {
  logs?: ConsoleLogEntry[];
  count?: number;
}

interface NetworkLogEntry {
  type: 'request' | 'response';
  url: string;
  method?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  timestamp: number;
  requestId: string;
}

interface NetworkResponse extends BrowserResponse {
  logs?: NetworkLogEntry[];
  count?: number;
}

// CDP Protocol types
interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface CDPMessage {
  id: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

// ===========================================================================
// CDP Client (WebSocket )
// ===========================================================================

class CDPConnection {
  private ws: WebSocket | null = null;
  private messageId: number = 0;
  private pendingMessages: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private eventHandlers: Map<string, ((params: unknown) => void)[]> = new Map();

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        logger.debug('[CDP] WebSocket connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message: CDPMessage = JSON.parse(data.toString());

          if (message.id !== undefined) {
            // Response to a command
            const pending = this.pendingMessages.get(message.id);
            if (pending) {
              this.pendingMessages.delete(message.id);
              if (message.error) {
                pending.reject(new Error(message.error.message));
              } else {
                pending.resolve(message.result);
              }
            }
          } else if (message.method) {
            // Event from browser
            const handlers = this.eventHandlers.get(message.method) || [];
            for (const handler of handlers) {
              handler(message.params);
            }
          }
        } catch (e) {
          logger.debug('[CDP] Failed to parse message: ' + e);
        }
      });

      this.ws.on('error', (error) => {
        logger.debug('[CDP] WebSocket error: ' + error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        logger.debug('[CDP] WebSocket closed');
        // Reject all pending messages
        for (const [, pending] of this.pendingMessages) {
          pending.reject(new Error('WebSocket closed'));
        }
        this.pendingMessages.clear();
      });
    });
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const id = ++this.messageId;
    const message: CDPMessage = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(message));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`CDP command timeout: ${method}`));
        }
      }, 30000);
    });
  }

  on(event: string, handler: (params: unknown) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  off(event: string): void {
    this.eventHandlers.delete(event);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingMessages.clear();
    this.eventHandlers.clear();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// ===========================================================================
// Browser Client
// ===========================================================================

class BrowserClient {
  private cdp: CDPConnection | null = null;
  private browserProcess: ChildProcess | null = null;
  private platform: Platform;
  private cdpPort: number = 9222;
  private browserType: 'chrome' | 'edge' = 'chrome';
  // Console/Network  
  private consoleLogs: ConsoleLogEntry[] = [];
  private networkLogs: NetworkLogEntry[] = [];

  constructor() {
    this.platform = getPlatform();
    logger.debug('[BrowserClient] constructor: platform = ' + this.platform);
    logger.debug('[BrowserClient] constructor: CDP URL = ' + this.getCDPUrl());
  }

  /**
   * Get CDP endpoint URL
   */
  private getCDPUrl(): string {
    return `http://localhost:${this.cdpPort}`;
  }


  /**
   * Find browser executable path based on platform
   */
  private findBrowserPath(windowsPaths: string[], linuxPaths?: string[]): string | null {
    // Native Windows - direct file system check
    if (this.platform === 'native-windows') {
      for (const p of windowsPaths) {
        if (fs.existsSync(p)) return p;
      }
      return null;
    }

    // WSL - check via /mnt/c/ paths first (fast, no PowerShell), then fallback to PowerShell
    if (this.platform === 'wsl') {
      // Fast path: convert Windows paths to WSL /mnt/ paths and check directly
      for (const winPath of windowsPaths) {
        const wslPath = winPath
          .replace(/^([A-Z]):\\/i, (_, drive: string) => `/mnt/${drive.toLowerCase()}/`)
          .replace(/\\/g, '/');
        if (fs.existsSync(wslPath)) {
          logger.debug(`[BrowserClient] findBrowserPath: found via WSL mount: ${wslPath} → ${winPath}`);
          return winPath;
        }
      }

      // Slow fallback: PowerShell Test-Path (for non-standard paths)
      try {
        const powerShellPath = getPowerShellPath();
        const conditions = windowsPaths
          .map((p, index) => {
            const keyword = index === 0 ? 'if' : 'elseif';
            return `${keyword} (Test-Path '${p}') { Write-Output '${p}' }`;
          })
          .join(' ');
        const result = execSync(
          `${powerShellPath} -Command "${conditions}"`,
          { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        if (result) return result;
      } catch (error) {
        logger.debug(
          `[BrowserClient] findBrowserPath: PowerShell check failed (${error instanceof Error ? error.message : String(error)})`
        );
      }
      return null;
    }

    // Native Linux - check Linux paths
    if (linuxPaths) {
      for (const p of linuxPaths) {
        if (fs.existsSync(p)) return p;
      }
    }
    return null;
  }

  private findChromePath(): string | null {
    return this.findBrowserPath(
      // Windows paths
      [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ],
      // Linux paths
      [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ]
    );
  }

  private findEdgePath(): string | null {
    return this.findBrowserPath(
      // Windows paths
      [
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ],
      // Linux paths (Edge for Linux)
      [
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
      ]
    );
  }

  /**
   * Kill existing browser processes with CDP port
   */
  private killExistingBrowser(): void {
    logger.debug('[BrowserClient] killExistingBrowser: killing processes on port ' + this.cdpPort);
    try {
      if (this.platform === 'native-windows') {
        // Native Windows - PowerShell to kill processes
        const powerShellPath = getPowerShellPath();
        execSync(
          `${powerShellPath} -Command "Get-NetTCPConnection -LocalPort ${this.cdpPort} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
          { stdio: 'ignore', timeout: 5000 }
        );
      } else if (this.platform === 'wsl') {
        // WSL - kill only processes on CDP port (not ALL Chrome/Edge instances)
        // Use PowerShell for precise port-based kill (same as native-windows)
        try {
          const powerShellPath = getPowerShellPath();
          execSync(
            `${powerShellPath} -Command "Get-NetTCPConnection -LocalPort ${this.cdpPort} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
            { stdio: 'ignore', timeout: 5000 }
          );
        } catch { /* ignore - PowerShell may timeout in enterprise env */ }
      } else {
        // Native Linux - use fuser or lsof
        try {
          execSync(`fuser -k ${this.cdpPort}/tcp 2>/dev/null || true`, { stdio: 'ignore', timeout: 5000 });
        } catch {
          // Try lsof as fallback
          try {
            execSync(`lsof -ti:${this.cdpPort} | xargs -r kill -9 2>/dev/null || true`, { stdio: 'ignore', timeout: 5000 });
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * WSL2: Ensure mirrored networking is configured.
   * If not, auto-create .wslconfig and return a user-facing error message.
   */
  private ensureWslMirroredNetworking(): string {
    if (isMirroredNetworking()) {
      // Already configured but still failing — generic timeout message
      return `Timeout waiting for browser to start on port ${this.cdpPort}. Mirrored networking is enabled but CDP is unreachable. Try restarting WSL: wsl --shutdown`;
    }

    // Auto-create .wslconfig with mirrored networking
    try {
      const winUser = execSync('whoami.exe 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }).trim().split('\\').pop();
      const wslConfigPath = `/mnt/c/Users/${winUser}/.wslconfig`;

      if (fs.existsSync(wslConfigPath)) {
        // Append mirrored networking if not already present
        const content = fs.readFileSync(wslConfigPath, 'utf-8');
        if (!content.toLowerCase().includes('networkingmode=mirrored')) {
          const updated = content.includes('[wsl2]')
            ? content.replace('[wsl2]', '[wsl2]\nnetworkingMode=mirrored')
            : content + '\n[wsl2]\nnetworkingMode=mirrored\n';
          fs.writeFileSync(wslConfigPath, updated, 'utf-8');
          logger.info('[BrowserClient] Added networkingMode=mirrored to existing .wslconfig');
        }
      } else {
        fs.writeFileSync(wslConfigPath, '[wsl2]\nnetworkingMode=mirrored\n', 'utf-8');
        logger.info('[BrowserClient] Created .wslconfig with networkingMode=mirrored');
      }

      return `WSL2 mirrored networking    CDP   .\n` +
        `.wslconfig networkingMode=mirrored  .\n` +
        `WSL  :\n` +
        `  1. Windows PowerShell/CMD: wsl --shutdown\n` +
        `  2. WSL   \n` +
        `  3.  `;
    } catch (error) {
      logger.warn('[BrowserClient] Failed to auto-configure .wslconfig', {
        error: error instanceof Error ? error.message : String(error),
      });
      return `WSL2  CDP   .\n` +
        `C:\\Users\\{}\\.wslconfig   :\n` +
        `[wsl2]\nnetworkingMode=mirrored\n\n` +
        `  WSL : wsl --shutdown`;
    }
  }

  /**
   * Check if CDP endpoint is available
   */
  private async isCDPAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getCDPUrl()}/json/version`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get list of available targets (tabs)
   */
  private async getTargets(): Promise<CDPTarget[]> {
    const response = await fetch(`${this.getCDPUrl()}/json`);
    return await response.json() as CDPTarget[];
  }

  /**
   * Check if browser is running
   */
  async isRunning(): Promise<boolean> {
    return this.cdp !== null && this.cdp.isConnected();
  }

  /**
   * Get server health status
   */
  async getHealth(): Promise<HealthResponse | null> {
    const chromePath = this.findChromePath();
    const edgePath = this.findEdgePath();

    return {
      success: true,
      status: 'running',
      version: '2.0.0-pure-cdp',
      browser: {
        active: this.cdp !== null && this.cdp.isConnected(),
        type: this.browserType,
        chrome_available: chromePath !== null,
        edge_available: edgePath !== null,
      },
    };
  }

  /**
   * Start the browser server (for compatibility)
   */
  async startServer(): Promise<boolean> {
    return true;
  }

  /**
   * Stop the browser server (for compatibility)
   */
  async stopServer(): Promise<boolean> {
    return this.close().then(() => true).catch((err) => {
      logger.debug('Browser stopServer failed: ' + (err instanceof Error ? err.message : String(err)));
      return true;
    });
  }

  /**
   * Setup console and network logging via CDP
   */
  private setupLogging(): void {
    if (!this.cdp) return;

    // Enable Console domain
    this.cdp.send('Console.enable').catch(err => logger.debug('[CDP] Failed to enable Console domain: ' + err));
    this.cdp.on('Console.messageAdded', (params: unknown) => {
      const p = params as { message: { level: string; text: string } };
      this.consoleLogs.push({
        level: p.message.level.toUpperCase(),
        message: p.message.text,
        timestamp: Date.now(),
      });
    });

    // Enable Runtime for console.log
    this.cdp.send('Runtime.enable').catch(err => logger.debug('[CDP] Failed to enable Runtime domain: ' + err));
    this.cdp.on('Runtime.consoleAPICalled', (params: unknown) => {
      const p = params as { type: string; args: { value?: string; description?: string }[] };
      const message = p.args.map(a => a.value || a.description || '').join(' ');
      this.consoleLogs.push({
        level: p.type.toUpperCase(),
        message,
        timestamp: Date.now(),
      });
    });

    // Enable Network domain
    this.cdp.send('Network.enable').catch(err => logger.debug('[CDP] Failed to enable Network domain: ' + err));
    this.cdp.on('Network.requestWillBeSent', (params: unknown) => {
      const p = params as { requestId: string; request: { url: string; method: string } };
      this.networkLogs.push({
        type: 'request',
        url: p.request.url,
        method: p.request.method,
        timestamp: Date.now(),
        requestId: p.requestId,
      });
    });

    this.cdp.on('Network.responseReceived', (params: unknown) => {
      const p = params as { requestId: string; response: { url: string; status: number; statusText: string; mimeType: string } };
      this.networkLogs.push({
        type: 'response',
        url: p.response.url,
        status: p.response.status,
        statusText: p.response.statusText,
        mimeType: p.response.mimeType,
        timestamp: Date.now(),
        requestId: p.requestId,
      });
    });
  }

  /**
   * Get current page info (URL and title) - helper to reduce code duplication
   */
  private async getCurrentPageInfo(): Promise<{ url: string; title: string }> {
    if (!this.cdp || !this.cdp.isConnected()) {
      return { url: '', title: '' };
    }

    const evalResult = await this.cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({ url: window.location.href, title: document.title })',
      returnByValue: true,
    }) as { result: { value: string } };

    return JSON.parse(evalResult.result.value);
  }

  // ===========================================================================
  // Browser Operations
  // ===========================================================================

  /**
   * Launch browser with CDP
   */
  async launch(options?: {
    headless?: boolean;
    browser?: 'chrome' | 'edge';
    userDataDir?: string;
    cdpPort?: number;
  }): Promise<BrowserResponse> {
    const headless = options?.headless ?? false;
    const preferredBrowser = options?.browser ?? 'chrome';

    // /profile  (agent)
    if (options?.cdpPort) this.cdpPort = options.cdpPort;

    logger.debug(`[BrowserClient] launch: starting browser (preferred=${preferredBrowser}, headless=${headless})`);

    try {
      //   
      if (this.cdp) {
        this.cdp.close();
        this.cdp = null;
      }

      //  CDP  
      this.killExistingBrowser();
      await new Promise(resolve => setTimeout(resolve, 500));

      //   
      let browserPath: string | null = null;
      if (preferredBrowser === 'chrome') {
        browserPath = this.findChromePath();
        if (!browserPath) {
          browserPath = this.findEdgePath();
          this.browserType = 'edge';
        } else {
          this.browserType = 'chrome';
        }
      } else {
        browserPath = this.findEdgePath();
        if (!browserPath) {
          browserPath = this.findChromePath();
          this.browserType = 'chrome';
        } else {
          this.browserType = 'edge';
        }
      }

      if (!browserPath) {
        return {
          success: false,
          error: 'No browser found',
          details: 'Neither Chrome nor Edge is installed',
        };
      }

      logger.debug(`[BrowserClient] launch: using ${this.browserType} at ${browserPath}`);

      // Common browser arguments (without user-data-dir)
      const baseArgs = [
        `--remote-debugging-port=${this.cdpPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-popup-blocking',
        '--start-maximized',
      ];

      if (headless) {
        baseArgs.push('--headless=new');
      }

      // Start with Google instead of default new tab (avoids showing internal pages)
      baseArgs.push('https://www.google.com');

      // Launch browser based on platform
      if (this.platform === 'native-windows') {
        // Native Windows - spawn directly with user data dir
        const userDataDir = options?.userDataDir
          || `${process.env['LOCALAPPDATA']}\\local-cli-browser-profile-${Date.now()}`;
        const args = [...baseArgs, `--user-data-dir=${userDataDir}`];

        logger.debug(`[BrowserClient] launch: spawning browser directly on Windows`);
        this.browserProcess = spawn(browserPath, args, {
          detached: true,
          stdio: 'ignore',
        });
      } else if (this.platform === 'wsl') {
        // WSL - use PowerShell to launch Windows browser
        let psCommand: string;
        if (options?.userDataDir) {
          // Persistent profile path: use Windows path directly (protected with single quotes)
          const winPath = options.userDataDir.startsWith('/mnt/')
            ? options.userDataDir.replace(/^\/mnt\/([a-z])\//, (_, d: string) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\')
            : options.userDataDir;
          // single quotes → PowerShell won't interpret the path
          const argsForPowerShell = [`'--user-data-dir=${winPath}'`, ...baseArgs.map(a => `"${a}"`)];
          const argsString = argsForPowerShell.join(',');
          psCommand = `Start-Process -FilePath '${browserPath}' -ArgumentList ${argsString}`;
        } else {
          const argsForPowerShell = ['--user-data-dir=$dir', ...baseArgs];
          const argsString = argsForPowerShell.map(arg => `"${arg}"`).join(',');
          psCommand = `$dir = "$env:LOCALAPPDATA\\local-cli-browser-profile-${Date.now()}"; Start-Process -FilePath '${browserPath}' -ArgumentList ${argsString}`;
        }

        logger.debug(`[BrowserClient] launch: executing PowerShell command from WSL (port=${this.cdpPort})`);

        const powershellPath = getPowerShellPath();
        this.browserProcess = spawn(powershellPath, ['-Command', psCommand], {
          detached: true,
          stdio: 'ignore',
        });
      } else {
        // Native Linux - spawn directly
        const userDataDir = options?.userDataDir
          || `${process.env['HOME']}/.local-cli-browser-profile-${Date.now()}`;
        const args = [...baseArgs, `--user-data-dir=${userDataDir}`];

        logger.debug(`[BrowserClient] launch: spawning browser directly on Linux`);
        this.browserProcess = spawn(browserPath, args, {
          detached: true,
          stdio: 'ignore',
        });
      }

      this.browserProcess.unref();

      // CDP  
      logger.debug('[BrowserClient] launch: waiting for CDP endpoint...');
      const maxWait = 15000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        if (await this.isCDPAvailable()) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (!(await this.isCDPAvailable())) {
        // WSL2: CDP not reachable — likely missing mirrored networking
        if (this.platform === 'wsl') {
          return {
            success: false,
            error: 'CDP endpoint not available',
            details: this.ensureWslMirroredNetworking(),
          };
        }
        return {
          success: false,
          error: 'CDP endpoint not available',
          details: `Timeout waiting for browser to start on port ${this.cdpPort}`,
        };
      }

      //  () 
      const targets = await this.getTargets();
      const pageTarget = targets.find(t => t.type === 'page');

      if (!pageTarget) {
        return {
          success: false,
          error: 'No page target found',
          details: 'Browser started but no page available',
        };
      }

      // WebSocket CDP 
      logger.debug('[BrowserClient] launch: connecting to page via WebSocket...');
      this.cdp = new CDPConnection();
      await this.cdp.connect(pageTarget.webSocketDebuggerUrl);
      // Target connected

      //  
      this.consoleLogs = [];
      this.networkLogs = [];
      this.setupLogging();

      // Page  
      await this.cdp.send('Page.enable');

      // Bring browser window to front so actions are visible
      try {
        await this.cdp.send('Page.bringToFront');
      } catch {
        logger.debug('[BrowserClient] launch: Page.bringToFront failed (non-critical)');
      }

      logger.debug('[BrowserClient] launch: browser connected successfully');

      return {
        success: true,
        message: `${this.browserType} launched successfully`,
        browser: this.browserType,
        headless,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.debug('[BrowserClient] launch: error - ' + errorMsg);
      reportError(error, { type: 'browserClient', method: 'launch' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to launch browser',
        details: errorMsg,
      };
    }
  }

  /**
   * Close browser
   */
  async close(): Promise<BrowserResponse> {
    try {
      // 1. CDP  
      if (this.cdp) {
        this.cdp.close();
      }
      this.cdp = null;
      // Target disconnected
      this.consoleLogs = [];
      this.networkLogs = [];

      // 2.    (platform-specific)
      try {
        if (this.platform === 'native-windows' || this.platform === 'wsl') {
          const processName = this.browserType === 'chrome' ? 'chrome.exe' : 'msedge.exe';
          execSync(
            `powershell.exe -Command "Get-WmiObject Win32_Process -Filter \\"name='${processName}'\\" | Where-Object { \\$_.CommandLine -like '*local-cli*' } | ForEach-Object { Stop-Process -Id \\$_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
            { stdio: 'ignore', timeout: 10000 }
          );
        } else {
          // Native Linux - kill browser processes with our profile
          const processName = this.browserType === 'chrome' ? 'chrome' : 'msedge';
          execSync(
            `pkill -f "${processName}.*local-cli-browser-profile" 2>/dev/null || true`,
            { stdio: 'ignore', timeout: 10000 }
          );
        }
      } catch {
        //     
      }

      // 3. CDP     ()
      this.killExistingBrowser();

      return { success: true, message: 'Browser closed' };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'close' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to close browser',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Navigate to URL
   */
  async navigate(url: string): Promise<NavigateResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      // Ensure browser window is visible before navigation
      try { await this.cdp.send('Page.bringToFront'); } catch { /* ignore */ }

      await this.cdp.send('Page.navigate', { url });

      // Page.loadEventFired       
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.cdp?.off('Page.loadEventFired');
          reject(new Error(`Navigation to ${url} timed out after 30 seconds`));
        }, 30000);

        const handler = () => {
          clearTimeout(timeoutId);
          this.cdp?.off('Page.loadEventFired');
          resolve();
        };

        this.cdp?.on('Page.loadEventFired', handler);
      });

      //  URL  
      const pageInfo = await this.getCurrentPageInfo();

      return {
        success: true,
        message: 'Navigated successfully',
        url: pageInfo.url,
        title: pageInfo.title,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'navigate' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to navigate',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Take screenshot
   */
  async screenshot(fullPage: boolean = false): Promise<ScreenshotResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      //   — JPEG quality 60 for smaller context footprint
      const params: Record<string, unknown> = { format: 'jpeg', quality: 60 };

      if (fullPage) {
        //    
        const layoutMetrics = await this.cdp.send('Page.getLayoutMetrics') as {
          contentSize: { width: number; height: number };
        };

        params['clip'] = {
          x: 0,
          y: 0,
          width: layoutMetrics.contentSize.width,
          height: layoutMetrics.contentSize.height,
          scale: 0.8,
        };
        params['captureBeyondViewport'] = true;
      }

      const result = await this.cdp.send('Page.captureScreenshot', params) as { data: string };

      //   
      const pageInfo = await this.getCurrentPageInfo();

      return {
        success: true,
        message: 'Screenshot captured',
        image: result.data,
        format: 'jpeg',
        encoding: 'base64',
        url: pageInfo.url,
        title: pageInfo.title,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'screenshot' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to take screenshot',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Click element by selector
   */
  async click(selector: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      // JavaScript  
      const result = await this.cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { success: false, error: 'Element not found' };
            el.click();
            return { success: true };
          })()
        `,
        returnByValue: true,
      }) as { result: { value: { success: boolean; error?: string } } };

      if (!result.result.value.success) {
        return {
          success: false,
          error: result.result.value.error || 'Click failed',
        };
      }

      //  URL 
      const urlResult = await this.cdp.send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      }) as { result: { value: string } };

      return {
        success: true,
        message: 'Element clicked',
        selector,
        current_url: urlResult.result.value,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'click' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to click element',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Fill input field
   */
  async fill(selector: string, value: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      // JavaScript   
      const result = await this.cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { success: false, error: 'Element not found' };
            el.focus();
            el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true };
          })()
        `,
        returnByValue: true,
      }) as { result: { value: { success: boolean; error?: string } } };

      if (!result.result.value.success) {
        return {
          success: false,
          error: result.result.value.error || 'Fill failed',
        };
      }

      return {
        success: true,
        message: 'Field filled',
        selector,
        length: value.length,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'fill' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to fill field',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get element text
   */
  async getText(selector?: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      const expression = selector
        ? `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { success: false, error: 'Element not found: ${selector}' };
            return { success: true, text: el.textContent || '' };
          })()
        `
        : `({ success: true, text: document.body.innerText || '' })`;

      const result = await this.cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
      }) as { result: { value: { success: boolean; text?: string; error?: string } } };

      if (!result.result.value.success) {
        return {
          success: false,
          error: result.result.value.error || 'Get text failed',
        };
      }

      return {
        success: true,
        message: 'Text retrieved',
        selector,
        text: result.result.value.text || '',
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'getText' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to get text',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get page info
   */
  async getPageInfo(): Promise<PageInfoResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      const result = await this.cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          url: window.location.href,
          title: document.title,
          domain: window.location.hostname,
          protocol: window.location.protocol,
          pathname: window.location.pathname,
          readyState: document.readyState,
          bodyLength: document.body?.innerHTML.length || 0,
          linkCount: document.querySelectorAll('a').length,
          imageCount: document.querySelectorAll('img').length,
          formCount: document.querySelectorAll('form').length,
          inputCount: document.querySelectorAll('input').length,
        })`,
        returnByValue: true,
      }) as { result: { value: string } };

      const pageInfo = JSON.parse(result.result.value);

      return {
        success: true,
        message: 'Page info retrieved',
        ...pageInfo,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'getPageInfo' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to get page info',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get page HTML
   */
  async getHtml(): Promise<PageInfoResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      const result = await this.cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify({ url: window.location.href, title: document.title, html: document.documentElement.outerHTML })',
        returnByValue: true,
      }) as { result: { value: string } };

      const pageInfo = JSON.parse(result.result.value);

      return {
        success: true,
        message: 'HTML retrieved',
        url: pageInfo.url,
        title: pageInfo.title,
        html: pageInfo.html,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'getHtml' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to get HTML',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute JavaScript
   * Wraps script in async IIFE to support return statements and await
   */
  async executeScript(script: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      // Wrap script in async IIFE to support return statements and await
      const wrappedScript = `(async function() { ${script} })()`;

      const result = await this.cdp.send('Runtime.evaluate', {
        expression: wrappedScript,
        returnByValue: true,
        awaitPromise: true,
      }) as { result: { value: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };

      if (result.exceptionDetails) {
        return {
          success: false,
          error: 'Script execution error',
          details: result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Unknown error',
        };
      }

      return {
        success: true,
        message: 'Script executed',
        result: result.result.value,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'executeScript' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to execute script',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get console logs
   */
  async getConsole(): Promise<ConsoleResponse> {
    if (!this.cdp || !this.cdp.isConnected()) {
      return { success: false, error: 'Browser not running. Use launch first.', logs: [], count: 0 };
    }
    // Return only the most recent 50 entries to prevent context bloat
    const recentLogs = this.consoleLogs.slice(-50);
    return {
      success: true,
      message: `Console logs retrieved (${recentLogs.length} of ${this.consoleLogs.length} total)`,
      logs: recentLogs,
      count: this.consoleLogs.length,
    };
  }

  /**
   * Wait for element
   */
  async waitFor(selector: string, timeout: number = 10): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      const startTime = Date.now();
      const timeoutMs = timeout * 1000;

      while (Date.now() - startTime < timeoutMs) {
        const result = await this.cdp.send('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(selector)}) !== null`,
          returnByValue: true,
        }) as { result: { value: boolean } };

        if (result.result.value) {
          return {
            success: true,
            message: 'Element found',
            selector,
          };
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return {
        success: false,
        error: 'Timeout waiting for element',
        selector,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'waitFor' }).catch(() => {});
      return {
        success: false,
        error: 'Timeout waiting for element',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get network logs
   */
  async getNetwork(): Promise<NetworkResponse> {
    if (!this.cdp || !this.cdp.isConnected()) {
      return { success: false, error: 'Browser not running. Use launch first.', logs: [], count: 0 };
    }
    return {
      success: true,
      message: 'Network logs retrieved',
      logs: [...this.networkLogs],
      count: this.networkLogs.length,
    };
  }

  /**
   * Focus browser window
   */
  async focus(): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      await this.cdp.send('Page.bringToFront');

      return {
        success: true,
        message: 'Browser window focused',
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'focus' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to focus browser',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Press a keyboard key
   * Supports: Enter, Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
   *           Backspace, Delete, Home, End, PageUp, PageDown, F1-F12,
   *           Control, Alt, Shift, Meta, and combinations like Control+A
   */
  async pressKey(key: string, selector?: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      //    ( )
      const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
        //  
        'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
        'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
        'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
        'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
        'Delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
        'Space': { key: ' ', code: 'Space', keyCode: 32 },
        //  
        'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
        'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
        'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
        //  
        'Home': { key: 'Home', code: 'Home', keyCode: 36 },
        'End': { key: 'End', code: 'End', keyCode: 35 },
        'PageUp': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
        'PageDown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },
        'Insert': { key: 'Insert', code: 'Insert', keyCode: 45 },
        //  
        'Control': { key: 'Control', code: 'ControlLeft', keyCode: 17 },
        'Alt': { key: 'Alt', code: 'AltLeft', keyCode: 18 },
        'Shift': { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
        'Meta': { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
        // Function 
        'F1': { key: 'F1', code: 'F1', keyCode: 112 },
        'F2': { key: 'F2', code: 'F2', keyCode: 113 },
        'F3': { key: 'F3', code: 'F3', keyCode: 114 },
        'F4': { key: 'F4', code: 'F4', keyCode: 115 },
        'F5': { key: 'F5', code: 'F5', keyCode: 116 },
        'F6': { key: 'F6', code: 'F6', keyCode: 117 },
        'F7': { key: 'F7', code: 'F7', keyCode: 118 },
        'F8': { key: 'F8', code: 'F8', keyCode: 119 },
        'F9': { key: 'F9', code: 'F9', keyCode: 120 },
        'F10': { key: 'F10', code: 'F10', keyCode: 121 },
        'F11': { key: 'F11', code: 'F11', keyCode: 122 },
        'F12': { key: 'F12', code: 'F12', keyCode: 123 },
      };

      if (selector) {
        //   
        await this.cdp.send('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
        });
      }

      //    (: Control+A, Shift+Tab)
      const parts = key.split('+');
      const modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {};
      let mainKey = key;

      if (parts.length > 1) {
        for (let i = 0; i < parts.length - 1; i++) {
          const mod = parts[i]?.toLowerCase();
          if (mod === 'control' || mod === 'ctrl') modifiers.ctrl = true;
          else if (mod === 'alt') modifiers.alt = true;
          else if (mod === 'shift') modifiers.shift = true;
          else if (mod === 'meta' || mod === 'cmd') modifiers.meta = true;
        }
        mainKey = parts[parts.length - 1] || key;
      }

      //    / 
      let keyInfo = keyMap[mainKey];
      if (!keyInfo) {
        if (mainKey.length === 1) {
          const charCode = mainKey.charCodeAt(0);
          const isUpper = mainKey >= 'A' && mainKey <= 'Z';
          keyInfo = {
            key: mainKey,
            code: `Key${mainKey.toUpperCase()}`,
            keyCode: isUpper ? charCode : charCode - 32,
          };
        } else {
          keyInfo = { key: mainKey, code: mainKey, keyCode: 0 };
        }
      }

      //    (CDP)
      let modifierFlags = 0;
      if (modifiers.alt) modifierFlags |= 1;
      if (modifiers.ctrl) modifierFlags |= 2;
      if (modifiers.meta) modifierFlags |= 4;
      if (modifiers.shift) modifierFlags |= 8;

      // keyDown
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: keyInfo.key,
        code: keyInfo.code,
        windowsVirtualKeyCode: keyInfo.keyCode,
        nativeVirtualKeyCode: keyInfo.keyCode,
        modifiers: modifierFlags,
      });

      // keyUp
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: keyInfo.key,
        code: keyInfo.code,
        windowsVirtualKeyCode: keyInfo.keyCode,
        nativeVirtualKeyCode: keyInfo.keyCode,
        modifiers: modifierFlags,
      });

      return {
        success: true,
        message: `Key "${key}" pressed successfully`,
        key,
        selector: selector || '(focused element)',
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'pressKey' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to press key',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Type text character by character
   */
  async type(text: string, selector?: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      if (selector) {
        //   
        await this.cdp.send('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
        });
      }

      //   
      for (const char of text) {
        await this.cdp.send('Input.dispatchKeyEvent', {
          type: 'char',
          text: char,
        });
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      return {
        success: true,
        message: `Typed ${text.length} characters`,
        length: text.length,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'type' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to type text',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if browser is currently active
   */
  async isBrowserActive(): Promise<boolean> {
    return this.cdp !== null && this.cdp.isConnected();
  }

  /**
   * Save screenshot to file and return path
   */
  saveScreenshot(base64Image: string, prefix: string = 'browser'): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${prefix}_screenshot_${timestamp}.jpg`;
    const filepath = path.join(process.cwd(), filename);

    const imageBuffer = Buffer.from(base64Image, 'base64');
    fs.writeFileSync(filepath, imageBuffer);

    logger.debug('[BrowserClient] saveScreenshot: saved to ' + filepath);
    return filepath;
  }

  /**
   * For compatibility: getServerExePath
   */
  getServerExePath(): string | null {
    return null;
  }

  /**
   * For compatibility: getServerUrl
   */
  getServerUrl(): string {
    return this.getCDPUrl();
  }

  /**
   * Connect to an existing browser with CDP port
   */
  async connect(port?: number): Promise<BrowserResponse> {
    try {
      if (port) this.cdpPort = port;

      if (!(await this.isCDPAvailable())) {
        return { success: false, error: `No browser found on port ${this.cdpPort}` };
      }

      const targets = await this.getTargets();
      const pageTarget = targets.find(t => t.type === 'page');

      if (!pageTarget) {
        return { success: false, error: 'No page target found' };
      }

      if (this.cdp) {
        this.cdp.close();
      }

      this.cdp = new CDPConnection();
      await this.cdp.connect(pageTarget.webSocketDebuggerUrl);
      await this.cdp.send('Page.enable');

      // Setup logging
      this.consoleLogs = [];
      this.networkLogs = [];
      this.setupLogging();

      return {
        success: true,
        message: 'Connected to existing browser',
        url: pageTarget.url,
        title: pageTarget.title,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'connect' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to connect to browser',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send raw CDP command
   */
  async send(method: string, params?: Record<string, unknown>): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      const result = await this.cdp.send(method, params);
      return { success: true, message: 'Command sent', result };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'send' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to send CDP command',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Focus element by selector (DOM element focus)
   */
  async focusElement(selector: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      const result = await this.cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { success: false, error: 'Element not found' };
            el.focus();
            return { success: true };
          })()
        `,
        returnByValue: true,
      }) as { result: { value: { success: boolean; error?: string } } };

      if (!result.result.value.success) {
        return { success: false, error: result.result.value.error || 'Focus failed' };
      }

      return { success: true, message: 'Element focused', selector };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'focusElement' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to focus element',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Export singleton instance (raw browser tools)
export const browserClient = new BrowserClient();
// Export class for sub-agent instances ( /profile )
export { BrowserClient };
export type { BrowserResponse, HealthResponse, ScreenshotResponse, NavigateResponse, PageInfoResponse, ConsoleResponse, NetworkResponse };
