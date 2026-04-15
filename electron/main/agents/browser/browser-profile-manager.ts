/**
 * Browser Profile Manager (Electron)
 *
 * Permanent browser profile management for sub-agents + authentication flow handling.
 * Completely separate from raw browser tool (port 9222, temporary profile).
 *
 * CLI parity: src/agents/browser/browser-profile-manager.ts
 * Note: Electron Windows  WSL/Linux  .
 */

import * as path from 'path';
import * as fs from 'fs';
import { BrowserClient } from '../../tools/browser/browser-client';
import { logger } from '../../utils/logger';

const PROFILE_DIR_NAME = 'browser-profile';
const SUB_AGENT_CDP_PORT = 9223;

export interface LoginIndicators {
  /** If URL contains this string, it's a login page */
  urlPatterns: string[];
  /** If title contains this string, it's a login page */
  titlePatterns: string[];
}

export const ATLASSIAN_LOGIN_INDICATORS: LoginIndicators = {
  urlPatterns: ['/login', '/authenticate', '/sso/', '/saml/'],
  titlePatterns: ['Log in', 'Sign in', 'sign in', 'SSO'],
};

/**
 * Get permanent profile directory path (Windows native)
 */
export function getProfileDir(): string {
  const dir = path.join(process.env.LOCALAPPDATA || '', PROFILE_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * agent dedicated CDP 
 */
export function getSubAgentCdpPort(): number {
  return SUB_AGENT_CDP_PORT;
}

// singleton BrowserClient (agent dedicated)
let subAgentClient: BrowserClient | null = null;

/**
 * agent dedicated BrowserClient return (singleton)
 */
export function getSubAgentBrowserClient(): BrowserClient {
  if (!subAgentClient) {
    subAgentClient = new BrowserClient();
  }
  return subAgentClient;
}

/**
 * agent   (headless,  profile)
 */
export async function launchSubAgentBrowser(headless: boolean = true): Promise<{ success: boolean; error?: string }> {
  const client = getSubAgentBrowserClient();

  if (await client.isRunning()) {
    return { success: true };
  }

  const result = await client.launch({
    headless,
    userDataDir: getProfileDir(),
    cdpPort: SUB_AGENT_CDP_PORT,
  });

  if (!result.success) {
    const errorMsg = result.details || result.error || 'Unknown browser launch error';
    return { success: false, error: errorMsg };
  }

  return { success: true };
}

/**
 * agent  
 */
export async function closeSubAgentBrowser(): Promise<void> {
  const client = getSubAgentBrowserClient();
  if (await client.isRunning()) {
    await client.close();
  }
}

/**
 * authentication status check  sign in 
 *
 * :
 * 1. headless baseUrl 
 * 2. URL/title sign in  
 * 3. sign in  → visible   →   sign in → headless 
 */
export async function ensureAuthenticated(
  baseUrl: string,
  indicators: LoginIndicators
): Promise<{ success: boolean; error?: string }> {
  const client = getSubAgentBrowserClient();

  // 1.    headless 
  if (!(await client.isRunning())) {
    const launched = await launchSubAgentBrowser(true);
    if (!launched.success) {
      return { success: false, error: launched.error || 'Failed to launch browser' };
    }
  }

  // 2. baseUrl 
  const navResult = await client.navigate(baseUrl);
  if (!navResult.success) {
    return { success: false, error: `Navigation failed: ${navResult.error}` };
  }

  //   ( )
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 3. sign in  
  const pageInfo = await client.getPageInfo();
  const currentUrl = (pageInfo as { url?: string }).url || '';
  const currentTitle = (pageInfo as { title?: string }).title || '';

  const isLoginPage = isOnLoginPage(currentUrl, currentTitle, indicators);

  if (!isLoginPage) {
    logger.info('[BrowserProfileManager] Already authenticated');
    return { success: true };
  }

  // 4. sign in  → visible  
  logger.info('[BrowserProfileManager] Login required, switching to visible mode...');
  await client.close();
  await new Promise(resolve => setTimeout(resolve, 1000));

  const visibleLaunched = await client.launch({
    headless: false,
    userDataDir: getProfileDir(),
    cdpPort: SUB_AGENT_CDP_PORT,
  });

  if (!visibleLaunched.success) {
    return { success: false, error: 'Failed to launch visible browser for login' };
  }

  // 5. sign in  
  await client.navigate(baseUrl);

  // 6. sign in   ( 120 )
  logger.info('[BrowserProfileManager] Waiting for user to log in (up to 120s)...');
  const loginTimeout = 120_000;
  const loginStart = Date.now();

  while (Date.now() - loginStart < loginTimeout) {
    await new Promise(resolve => setTimeout(resolve, 3000));

    const info = await client.getPageInfo();
    const url = (info as { url?: string }).url || '';
    const title = (info as { title?: string }).title || '';

    if (!isOnLoginPage(url, title, indicators)) {
      logger.info('[BrowserProfileManager] Login detected, switching back to headless...');

      // 7. visible  headless  ( )
      await client.close();
      await new Promise(resolve => setTimeout(resolve, 1000));

      const headlessLaunched = await launchSubAgentBrowser(true);
      if (!headlessLaunched.success) {
        return { success: false, error: headlessLaunched.error || 'Failed to relaunch headless after login' };
      }

      return { success: true };
    }
  }

  // 
  await client.close();
  return { success: false, error: 'Login timeout (120s). Please try again.' };
}

/**
 *   sign in  
 */
function isOnLoginPage(url: string, title: string, indicators: LoginIndicators): boolean {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();

  for (const pattern of indicators.urlPatterns) {
    if (urlLower.includes(pattern.toLowerCase())) return true;
  }
  for (const pattern of indicators.titlePatterns) {
    if (titleLower.includes(pattern.toLowerCase())) return true;
  }

  return false;
}
