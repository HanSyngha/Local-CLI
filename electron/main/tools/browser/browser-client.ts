/**
 * Browser Client for Electron (Windows Native)
 *
 * Simple CDP (Chrome DevTools Protocol) based browser automation.
 * Uses Chrome or Edge directly via CDP - no Playwright/Puppeteer dependency.
 *
 * This is much simpler than the CLI version since we're running natively on Windows.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import WebSocket from 'ws';
import { logger } from '../../utils/logger';
import { reportError } from '../../core/telemetry/error-reporter';
import { getWorkingDirectory } from '../llm/simple/file-tools';

// =============================================================================
// Types
// =============================================================================

export interface BrowserResponse {
  success: boolean;
  message?: string;
  error?: string;
  details?: string;
  [key: string]: unknown;
}

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

// =============================================================================
// CDP Connection
// =============================================================================

class CDPConnection {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pendingMessages = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private eventHandlers = new Map<string, ((params: unknown) => void)[]>();

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

// =============================================================================
// Browser Client
// =============================================================================

interface ConsoleLogEntry {
  level: string;
  message: string;
  timestamp: number;
}

interface NetworkLogEntry {
  type: 'request' | 'response';
  url: string;
  method?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  timestamp: number;
}

class BrowserClient {
  private cdp: CDPConnection | null = null;
  private cdpPort = 9222;
  private browserType: 'chrome' | 'edge' = 'chrome';
  // screenshotDir removed — screenshots saved to getWorkingDirectory() directly

  // Console/Network log collection
  private consoleLogs: ConsoleLogEntry[] = [];
  private networkLogs: NetworkLogEntry[] = [];

  constructor() {
    // No initialization needed — screenshots saved to getWorkingDirectory() at capture time
  }

  /**
   * Setup console and network logging
   */
  private setupLogging(): void {
    if (!this.cdp) return;

    // Console.messageAdded
    this.cdp.on('Console.messageAdded', (params: unknown) => {
      const p = params as { message: { level: string; text: string } };
      this.consoleLogs.push({
        level: p.message.level.toUpperCase(),
        message: p.message.text,
        timestamp: Date.now(),
      });
    });

    // Runtime.consoleAPICalled (captures console.log, etc.)
    this.cdp.on('Runtime.consoleAPICalled', (params: unknown) => {
      const p = params as { type: string; args: { value?: string; description?: string }[] };
      const message = p.args.map(a => a.value || a.description || '').join(' ');
      this.consoleLogs.push({
        level: p.type.toUpperCase(),
        message,
        timestamp: Date.now(),
      });
    });

    // Network.requestWillBeSent
    this.cdp.on('Network.requestWillBeSent', (params: unknown) => {
      const p = params as { request: { url: string; method: string } };
      this.networkLogs.push({
        type: 'request',
        url: p.request.url,
        method: p.request.method,
        timestamp: Date.now(),
      });
    });

    // Network.responseReceived
    this.cdp.on('Network.responseReceived', (params: unknown) => {
      const p = params as { response: { url: string; status: number; statusText: string; mimeType: string } };
      this.networkLogs.push({
        type: 'response',
        url: p.response.url,
        status: p.response.status,
        statusText: p.response.statusText,
        mimeType: p.response.mimeType,
        timestamp: Date.now(),
      });
    });
  }

  // ===========================================================================
  // Browser Path Detection (Windows Native)
  // ===========================================================================

  private findChromePath(): string | null {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const paths = [
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ...(localAppData ? [path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')] : []),
    ];
    for (const p of paths) {
      logger.debug(`[BrowserClient] Checking Chrome path: ${p}`);
      if (fs.existsSync(p)) {
        logger.info(`[BrowserClient] Chrome found at: ${p}`);
        return p;
      }
    }
    logger.warn('[BrowserClient] Chrome not found in any path');
    return null;
  }

  private findEdgePath(): string | null {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const paths = [
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    for (const p of paths) {
      logger.debug(`[BrowserClient] Checking Edge path: ${p}`);
      if (fs.existsSync(p)) {
        logger.info(`[BrowserClient] Edge found at: ${p}`);
        return p;
      }
    }
    logger.warn('[BrowserClient] Edge not found in any path');
    return null;
  }

  private killExistingBrowser(): void {
    try {
      // Kill any process using the CDP port
      execSync(
        `powershell.exe -Command "Get-NetTCPConnection -LocalPort ${this.cdpPort} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore', timeout: 5000 }
      );
      // Also kill any Chrome/Edge with our user-data-dir profile (might be running without CDP)
      execSync(
        `powershell.exe -Command "Get-Process chrome, msedge -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*local-bot*' } | Stop-Process -Force -ErrorAction SilentlyContinue"`,
        { stdio: 'ignore', timeout: 5000 }
      );
    } catch {
      // Ignore
    }
  }

  private async isCDPAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${this.cdpPort}/json/version`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async getTargets(): Promise<CDPTarget[]> {
    const response = await fetch(`http://localhost:${this.cdpPort}/json`);
    return await response.json() as CDPTarget[];
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  async isRunning(): Promise<boolean> {
    return this.cdp !== null && this.cdp.isConnected();
  }

  /**
   * Launch browser
   */
  async launch(options?: {
    headless?: boolean;
    browser?: 'chrome' | 'edge';
    userDataDir?: string;
    cdpPort?: number;
  }): Promise<BrowserResponse> {
    const headless = options?.headless ?? false;
    const preferredBrowser = options?.browser ?? 'chrome';

    // Override CDP port if specified (for sub-agent isolation)
    if (options?.cdpPort) {
      this.cdpPort = options.cdpPort;
    }

    logger.info('[BrowserClient] Launching browser', { preferredBrowser, headless, cdpPort: this.cdpPort });

    try {
      // Clean up existing connection
      if (this.cdp) {
        this.cdp.close();
        this.cdp = null;
      }

      this.killExistingBrowser();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find browser path
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

      // Browser arguments — use persistent profile if provided, else temp
      const userDataDir = options?.userDataDir || path.join(process.env.LOCALAPPDATA || '', 'local-bot', `browser-profile-${Date.now()}`);
      const args = [
        `--remote-debugging-port=${this.cdpPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-popup-blocking',
        '--start-maximized',
      ];

      if (headless) {
        args.push('--headless=new');
      }

      // Start with Google instead of default new tab (avoids showing internal pages)
      args.push('https://www.google.com');

      // Launch browser - use execSync to run PowerShell Start-Process for reliable Windows GUI launch
      logger.debug('[BrowserClient] Launching with args', { browserPath, args });

      // Build PowerShell command for reliable GUI app launch
      const argsString = args.map(a => `'${a}'`).join(',');
      const psCommand = `Start-Process -FilePath '${browserPath}' -ArgumentList ${argsString}`;

      try {
        execSync(`powershell.exe -Command "${psCommand}"`, {
          stdio: 'ignore',
          timeout: 10000,
          windowsHide: true,
        });
        logger.debug('[BrowserClient] PowerShell Start-Process completed');
      } catch (spawnError) {
        logger.errorSilent('[BrowserClient] Failed to spawn browser', { error: spawnError });
        reportError(spawnError, { type: 'browserClient', method: 'launch.spawn' }).catch(() => {});
        return {
          success: false,
          error: 'Failed to start browser process',
          details: spawnError instanceof Error ? spawnError.message : String(spawnError),
        };
      }

      // Wait for CDP
      const maxWait = 15000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        if (await this.isCDPAvailable()) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (!(await this.isCDPAvailable())) {
        return {
          success: false,
          error: 'CDP endpoint not available',
          details: `Timeout waiting for browser on port ${this.cdpPort}`,
        };
      }

      // Get page target
      const targets = await this.getTargets();
      const pageTarget = targets.find(t => t.type === 'page');

      if (!pageTarget) {
        return {
          success: false,
          error: 'No page target found',
        };
      }

      // Connect via WebSocket
      this.cdp = new CDPConnection();
      await this.cdp.connect(pageTarget.webSocketDebuggerUrl);
      await this.cdp.send('Page.enable');

      // Bring browser window to front so actions are visible
      try {
        await this.cdp.send('Page.bringToFront');
      } catch {
        logger.debug('[BrowserClient] Page.bringToFront failed (non-critical)');
      }

      // Setup logging
      this.consoleLogs = [];
      this.networkLogs = [];
      this.setupLogging();
      await this.cdp.send('Console.enable');
      await this.cdp.send('Runtime.enable');
      await this.cdp.send('Network.enable');

      return {
        success: true,
        message: `${this.browserType} launched successfully`,
        browser: this.browserType,
        headless,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.errorSilent('[BrowserClient] Launch failed', { error: errorMsg });
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
      if (this.cdp) {
        this.cdp.close();
        this.cdp = null;
      }

      // Kill browser processes with our profile
      try {
        const processName = this.browserType === 'chrome' ? 'chrome.exe' : 'msedge.exe';
        execSync(
          `powershell.exe -Command "Get-Process -Name '${processName.replace('.exe', '')}' -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*local-bot*' } | Stop-Process -Force -ErrorAction SilentlyContinue"`,
          { stdio: 'ignore', timeout: 10000 }
        );
      } catch {
        // Process might already be closed
      }

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
  async navigate(url: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      // Ensure browser window is visible before navigation
      try { await this.cdp.send('Page.bringToFront'); } catch { /* ignore */ }

      await this.cdp.send('Page.navigate', { url });

      // Wait for load
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.cdp?.off('Page.loadEventFired');
          reject(new Error('Navigation timeout'));
        }, 30000);

        this.cdp?.on('Page.loadEventFired', () => {
          clearTimeout(timeoutId);
          this.cdp?.off('Page.loadEventFired');
          resolve();
        });
      });

      // Get page info
      const evalResult = await this.cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify({ url: window.location.href, title: document.title })',
        returnByValue: true,
      }) as { result: { value: string } };

      const pageInfo = JSON.parse(evalResult.result.value);

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
   * Click element
   */
  async click(selector: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

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
        return { success: false, error: result.result.value.error || 'Click failed' };
      }

      return { success: true, message: 'Element clicked', selector };
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
   * Type text character by character (triggers key events)
   * Unlike fill() which sets value directly, this simulates actual typing.
   * Useful for inputs that have keystroke handlers or autocomplete.
   */
  async type(text: string, selector?: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      // Focus element if selector provided
      if (selector) {
        const focusResult = await this.cdp.send('Runtime.evaluate', {
          expression: `
            (function() {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return { success: false, error: 'Element not found: ${selector}' };
              el.focus();
              return { success: true };
            })()
          `,
          returnByValue: true,
        }) as { result: { value: { success: boolean; error?: string } } };

        if (!focusResult.result.value.success) {
          return { success: false, error: focusResult.result.value.error || 'Failed to focus element' };
        }
      }

      // Type character by character
      for (const char of text) {
        await this.cdp.send('Input.dispatchKeyEvent', {
          type: 'char',
          text: char,
        });
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      return { success: true, message: `Typed ${text.length} characters`, selector, length: text.length };
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
   * Take screenshot
   */
  async screenshot(fullPage = false): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      // JPEG quality 60 for smaller context footprint (CLI parity)
      const params: Record<string, unknown> = { format: 'jpeg', quality: 60 };

      if (fullPage) {
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

      // Save to working directory for easy LLM access
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `browser_screenshot_${timestamp}.jpg`;
      const filepath = path.join(getWorkingDirectory(), filename);
      fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));

      // Get page info for context (matches CLI behavior)
      let url = '';
      let title = '';
      try {
        const evalResult = await this.cdp.send('Runtime.evaluate', {
          expression: 'JSON.stringify({ url: window.location.href, title: document.title })',
          returnByValue: true,
        }) as { result: { value: string } };
        const pageInfo = JSON.parse(evalResult.result.value);
        url = pageInfo.url;
        title = pageInfo.title;
      } catch { /* non-critical */ }

      return {
        success: true,
        message: 'Screenshot captured',
        image: result.data,
        filepath,
        format: 'jpeg',
        encoding: 'base64',
        url,
        title,
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
   * Get page HTML
   */
  async getHtml(selector?: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      const expression = selector
        ? `document.querySelector(${JSON.stringify(selector)})?.outerHTML || ''`
        : 'document.documentElement.outerHTML';

      const result = await this.cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify({ html: ${expression}, url: window.location.href, title: document.title })`,
        returnByValue: true,
      }) as { result: { value: string } };

      const pageInfo = JSON.parse(result.result.value);

      return {
        success: true,
        message: 'HTML retrieved',
        html: pageInfo.html,
        url: pageInfo.url,
        title: pageInfo.title,
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
   * Wait for element
   */
  async waitFor(selector?: string, timeout = 10): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      if (!selector) {
        // Just wait for specified time
        await new Promise(resolve => setTimeout(resolve, timeout * 1000));
        return { success: true, message: `Waited ${timeout} seconds` };
      }

      const startTime = Date.now();
      const timeoutMs = timeout * 1000;

      while (Date.now() - startTime < timeoutMs) {
        const result = await this.cdp.send('Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(selector)}) !== null`,
          returnByValue: true,
        }) as { result: { value: boolean } };

        if (result.result.value) {
          return { success: true, message: 'Element found', selector };
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return { success: false, error: 'Timeout waiting for element', selector };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'waitFor' }).catch(() => {});
      return {
        success: false,
        error: 'Wait failed',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Connect to existing browser
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
      await this.cdp.send('Console.enable');
      await this.cdp.send('Runtime.enable');
      await this.cdp.send('Network.enable');

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
   * Execute JavaScript
   * Wraps script in async IIFE to support return statements and await
   */
  async executeScript(script: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      // Wrap script in async IIFE to support return statements and await
      // This allows LLM to use "return value;" syntax
      const wrappedScript = `(async function() { ${script} })()`;

      const result = await this.cdp.send('Runtime.evaluate', {
        expression: wrappedScript,
        returnByValue: true,
        awaitPromise: true,
      }) as { result: { value: unknown }; exceptionDetails?: { text: string } };

      if (result.exceptionDetails) {
        return { success: false, error: result.exceptionDetails.text };
      }

      return { success: true, message: 'Script executed', result: result.result.value };
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
   * Fill form field - clears existing content and sets value directly
   */
  async fill(selector: string, value: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      // JavaScript    (CLI )
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
        return { success: false, error: result.result.value.error || 'Fill failed' };
      }

      return { success: true, message: 'Field filled', selector, length: value.length };
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
   * Focus element
   */
  async focus(selector: string): Promise<BrowserResponse> {
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
      reportError(error, { type: 'browserClient', method: 'focus' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to focus element',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get console logs
   */
  async getConsole(): Promise<BrowserResponse> {
    if (!this.cdp || !this.cdp.isConnected()) {
      return { success: false, error: 'Browser not running. Use launch first.' };
    }

    // Return only the most recent 50 entries to prevent context bloat (CLI parity)
    const recentLogs = this.consoleLogs.slice(-50);
    return {
      success: true,
      message: `Console logs retrieved (${recentLogs.length} of ${this.consoleLogs.length} total)`,
      logs: recentLogs,
      count: this.consoleLogs.length,
    };
  }

  /**
   * Get browser health
   */
  async getHealth(): Promise<BrowserResponse> {
    try {
      const cdpAvailable = await this.isCDPAvailable();
      const connected = this.cdp?.isConnected() ?? false;

      return {
        success: true,
        cdp_available: cdpAvailable,
        connected,
        port: this.cdpPort,
        browser_type: this.browserType,
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'getHealth' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to get health',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get network request logs
   */
  async getNetwork(): Promise<BrowserResponse> {
    if (!this.cdp || !this.cdp.isConnected()) {
      return { success: false, error: 'Browser not running. Use launch first.' };
    }

    return {
      success: true,
      message: 'Network logs retrieved',
      logs: [...this.networkLogs],
      count: this.networkLogs.length,
    };
  }

  /**
   * Get page info
   */
  async getPageInfo(): Promise<BrowserResponse> {
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
   * Get text content from element or page
   */
  async getText(selector?: string): Promise<BrowserResponse> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return { success: false, error: 'Browser not running. Use launch first.' };
      }

      const expression = selector
        ? `document.querySelector(${JSON.stringify(selector)})?.textContent || ''`
        : 'document.body?.innerText || ""';

      const result = await this.cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify({ text: ${expression}, url: window.location.href })`,
        returnByValue: true,
      }) as { result: { value: string } };

      const pageInfo = JSON.parse(result.result.value);

      return {
        success: true,
        message: 'Text content retrieved',
        text: pageInfo.text,
        url: pageInfo.url,
        selector: selector || 'body',
      };
    } catch (error) {
      reportError(error, { type: 'browserClient', method: 'getText' }).catch(() => {});
      return {
        success: false,
        error: 'Failed to get text content',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if browser is active
   */
  async isBrowserActive(): Promise<boolean> {
    try {
      if (!this.cdp || !this.cdp.isConnected()) {
        return false;
      }

      await this.cdp.send('Runtime.evaluate', {
        expression: 'true',
        returnByValue: true,
      });

      return true;
    } catch {
      return false;
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

      //    (CLI )
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

      // Focus element if selector provided
      if (selector) {
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
   * Send CDP command (low-level)
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
}

// Export singleton
export const browserClient = new BrowserClient();
export { BrowserClient };
export default browserClient;
