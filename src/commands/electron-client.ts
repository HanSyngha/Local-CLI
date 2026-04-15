/**
 * Electron Client
 *
 * CLI   Electron  HTTP  .
 * Health check,  , SSE  .
 */

import http from 'http';
import { spawn, execSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
/** SSE  */
export interface SSEEvent {
  event: string;
  data: unknown;
}

interface HealthResponse {
  status: string;
}

export class ElectronClient {
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  /**
   * Electron CLI Server   
   */
  async isRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.port}/api/health`, { timeout: 2000 }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as HealthResponse;
            resolve(data.status === 'ok');
          } catch {
            resolve(false);
          }
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  /**
   * Electron   
   */
  async startElectron(): Promise<void> {
    const exePath = this.findElectronPath();
    if (!exePath) {
      throw new Error(
        `Electron    .\n` +
        ` LOCAL_CLI_ELECTRON_PATH    .`
      );
    }

    //  
    if (this.isWSL()) {
      // WSL → PowerShell Windows exe 
      const winPath = this.wslToWinPath(exePath);
      spawn('powershell.exe', ['-Command', `Start-Process '${winPath}'`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else {
      spawn(exePath, [], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }

    //    ( 30)
    const maxWait = 30000;
    const interval = 1000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      await this.sleep(interval);
      if (await this.isRunning()) return;
    }

    throw new Error('Electron     (30)');
  }

  /**
   *   (POST + SSE  )
   */
  async execute(
    target: 'chat' | 'jarvis',
    prompt: string,
    onEvent?: (event: SSEEvent) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ prompt });

      const req = http.request({
        hostname: '127.0.0.1',
        port: this.port,
        path: `/api/${target}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 600000, // 10 
      }, (res) => {
        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${body}`)));
          return;
        }

        // SSE 
        let buffer = '';
        let finalResponse = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; //    

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
                const sseEvent: SSEEvent = { event: currentEvent, data: parsed };

                if (onEvent) onEvent(sseEvent);

                if (currentEvent === 'result' && typeof parsed['response'] === 'string') {
                  finalResponse = parsed['response'];
                }
              } catch {
                // JSON   
              }
              currentEvent = '';
            } else if (line === '') {
              currentEvent = '';
            }
          }
        });

        res.on('end', () => {
          resolve(finalResponse);
        });

        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('  '));
      });

      req.write(postData);
      req.end();
    });
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Electron   
   */
  private findElectronPath(): string | null {
    // 1. 
    if (process.env['LOCAL_CLI_ELECTRON_PATH']) {
      const envPath = process.env['LOCAL_CLI_ELECTRON_PATH'];
      if (fs.existsSync(envPath)) return envPath;
    }

    // Electron app display name
    const appDisplayName = 'LOCAL BOT';

    if (this.isWSL()) {
      // WSL: /mnt/c/Users/{USER}/AppData/Local/{}/{}.exe
      const winUser = this.getWindowsUsername();
      if (winUser) {
        const exePath = `/mnt/c/Users/${winUser}/AppData/Local/${appDisplayName}/${appDisplayName}.exe`;
        if (fs.existsSync(exePath)) return exePath;
      }
    } else if (process.platform === 'win32') {
      // Windows: %LOCALAPPDATA%\{}\{}.exe
      const localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
      const exePath = path.join(localAppData, appDisplayName, `${appDisplayName}.exe`);
      if (fs.existsSync(exePath)) return exePath;
    }

    return null;
  }

  private isWSL(): boolean {
    try {
      const release = os.release().toLowerCase();
      return release.includes('wsl') || release.includes('microsoft');
    } catch {
      return false;
    }
  }

  private getWindowsUsername(): string | null {
    try {
      const cmdPath = '/mnt/c/Windows/System32/cmd.exe';
      if (fs.existsSync(cmdPath)) {
        const result = execSync('cmd.exe /c echo %USERNAME%', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (result && !result.includes('%')) return result;
      }
      // Fallback: WSL    
      return process.env['USER'] || null;
    } catch {
      return null;
    }
  }

  private wslToWinPath(wslPath: string): string {
    // /mnt/c/Users/... → C:\Users\...
    const match = wslPath.match(/^\/mnt\/([a-z])\/(.*)$/);
    if (match) {
      return `${match[1]!.toUpperCase()}:\\${match[2]!.replace(/\//g, '\\')}`;
    }
    return wslPath;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
