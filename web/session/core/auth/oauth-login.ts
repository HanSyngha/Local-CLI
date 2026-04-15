/**
 * OAuth Login for CLI
 *
 * Dashboard(main) OAuth  CLI  
 *
 * :
 * 1. CLI  HTTP   ( )
 * 2.  : http://<dashboard>/api/auth/cli-login?port=<port>&state=<state>
 * 3.  OAuth sign in 
 * 4. Dashboard http://localhost:<port>/callback?token=<jwt>&state=<state> 
 * 5. CLI   → ~/.hanseol/credentials.json 
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { CREDENTIALS_FILE_PATH, LOCAL_HOME_DIR } from '../../constants.js';
import { reportError } from '../telemetry/error-reporter.js';

export interface DashboardCredentials {
  dashboardUrl: string;
  token: string;
  email: string | null;
  displayName: string | null;
  provider: string | null;
  issuedAt: string;
  expiresAt: string;
  plan?: {
    name: string;
    displayName: string;
    tier: string;
  } | null;
}

/**
 * Dashboard   
 */
export async function loadCredentials(): Promise<DashboardCredentials | null> {
  try {
    const data = await fs.readFile(CREDENTIALS_FILE_PATH, 'utf-8');
    const creds = JSON.parse(data) as DashboardCredentials;

    //  
    if (creds.expiresAt && new Date(creds.expiresAt) < new Date()) {
      return null;
    }

    return creds;
  } catch (error) {
    reportError(error, { type: 'authError', method: 'loadCredentials' }).catch(() => {});
    return null;
  }
}

/**
 * Dashboard   
 */
export async function saveCredentials(creds: DashboardCredentials): Promise<void> {
  await fs.mkdir(LOCAL_HOME_DIR, { recursive: true });
  await fs.writeFile(CREDENTIALS_FILE_PATH, JSON.stringify(creds, null, 2), 'utf-8');
  //   600 ( /)
  await fs.chmod(CREDENTIALS_FILE_PATH, 0o600);
}

/**
 * Dashboard   
 */
export async function clearCredentials(): Promise<void> {
  try {
    await fs.unlink(CREDENTIALS_FILE_PATH);
  } catch (error) {
    reportError(error, { type: 'authError', method: 'clearCredentials' }).catch(() => {});
    //   
  }
}

/**
 *   
 *
 * POST ${dashboardUrl}/api/auth/refresh 
 *    JWT  → credentials.json  →  creds return
 *   null return
 */
export async function refreshTokenFromServer(
  _creds: DashboardCredentials,
): Promise<DashboardCredentials | null> {
  // No-op: local-web has no Dashboard to refresh tokens from
  return null;
}

/**
 * JWT   (  )
 */
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1]!, 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch (error) {
    reportError(error, { type: 'authError', method: 'parseJwtPayload' }).catch(() => {});
    return null;
  }
}

/**
 *    
 */
function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to find available port')));
      }
    });
    server.on('error', reject);
  });
}

/**
 *   ( )
 */
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      await execAsync(`open "${url}"`);
    } else if (platform === 'win32') {
      await execAsync(`start "" "${url}"`);
    } else {
      // Linux (including WSL)
      // WSL : /proc/version microsoft  
      const { readFileSync } = await import('fs');
      let isWSL = false;
      try {
        const procVersion = readFileSync('/proc/version', 'utf-8');
        isWSL = /microsoft/i.test(procVersion);
      } catch {
        // /proc/version   →  Linux
      }

      if (isWSL) {
        // WSL: Windows  
        try {
          await execAsync(`cmd.exe /c start "" "${url.replace(/&/g, '^&')}"`);
        } catch {
          try {
            await execAsync(`wslview "${url}"`);
          } catch {
            await execAsync(`explorer.exe "${url}"`);
          }
        }
      } else {
        //  Linux
        try {
          await execAsync(`xdg-open "${url}"`);
        } catch {
          await execAsync(`sensible-browser "${url}"`);
        }
      }
    }
  } catch (error) {
    reportError(error, { type: 'authError', method: 'openBrowser' }).catch(() => {});
    //     URL 
    // ( )
    throw new Error('BROWSER_OPEN_FAILED');
  }
}

/**
 * OAuth sign in 
 *
 * @param dashboardUrl Dashboard URL (: http://ec2-ip:4090)
 * @param timeoutMs  ( 5)
 * @returns DashboardCredentials  null (/)
 */
export async function performOAuthLogin(
  dashboardUrl: string,
  timeoutMs: number = 300000,
): Promise<DashboardCredentials | null> {
  // 1.   (CSRF )
  const state = crypto.randomUUID();

  // 2.     
  const port = await findAvailablePort();

  // 3. Promise   
  return new Promise<DashboardCredentials | null>((resolve) => {
    let resolved = false;
    let server: http.Server;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        try {
          server?.close();
        } catch {
          // ignore
        }
      }
    };

    // 
    const timeout = setTimeout(() => {
      if (!resolved) {
        cleanup();
        resolve(null);
      }
    }, timeoutMs);

    //   
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      if (url.pathname === '/callback') {
        const token = url.searchParams.get('token');
        const receivedState = url.searchParams.get('state');

        // State 
        if (receivedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(createHtmlPage(' ', ' state .  .', false));
          return;
        }

        if (!token) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(createHtmlPage(' ', ' .  .', false));
          return;
        }

        // JWT  (   )
        const payload = parseJwtPayload(token);

        //  
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(createHtmlPage(' !', 'CLI .    .', true));

        //   
        const now = new Date();
        const expiresAt = payload?.['exp']
          ? new Date((payload['exp'] as number) * 1000)
          : new Date(now.getTime() + 24 * 60 * 60 * 1000); //  24

        const creds: DashboardCredentials = {
          dashboardUrl: dashboardUrl.replace(/\/$/, ''),
          token,
          email: (payload?.['email'] as string) || null,
          displayName: (payload?.['displayName'] as string) || null,
          provider: (payload?.['provider'] as string) || null,
          issuedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        };

        //   
        await saveCredentials(creds);

        clearTimeout(timeout);
        cleanup();
        resolve(creds);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(port, '127.0.0.1', async () => {
      // 4.  Dashboard CLI sign in  
      const loginUrl = `${dashboardUrl.replace(/\/$/, '')}/api/auth/cli-login?port=${port}&state=${state}`;

      console.log('\n  Dashboard OAuth sign in .');
      console.log(`      URL  :\n`);
      console.log(`  ${loginUrl}\n`);

      try {
        await openBrowser(loginUrl);
      } catch {
        //    - URL  
      }

      console.log('  sign in   ...\n');
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      console.error('    :', err.message);
      resolve(null);
    });
  });
}

/**
 *  HTML  
 */
function createHtmlPage(title: string, message: string, success: boolean): string {
  const color = success ? '#10b981' : '#ef4444';
  const icon = success ? '&#10004;' : '&#10008;';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title> CLI - ${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 16px; padding: 48px 32px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
    h1 { font-size: 24px; color: #1a1a1a; margin: 0 0 8px; }
    p { color: #666; font-size: 14px; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
  ${success ? '<script>setTimeout(() => window.close(), 3000)</script>' : ''}
</body>
</html>`;
}
