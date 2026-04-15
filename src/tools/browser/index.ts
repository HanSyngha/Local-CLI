/**
 * Browser Tools Module
 *
 * Browser automation tools using CDP (Chrome DevTools Protocol)
 * PowerShell   Playwright .
 * server.exe  .
 */

import { browserClient } from './browser-client.js';

export { browserClient } from './browser-client.js';
export type {
  BrowserResponse,
  HealthResponse,
  ScreenshotResponse,
  NavigateResponse,
  PageInfoResponse,
  ConsoleResponse,
  NetworkResponse,
} from './browser-client.js';
export {
  BROWSER_TOOLS,
  browserLaunchTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserFillTool,
  browserGetTextTool,
  browserGetHtmlTool,
  browserGetConsoleTool,
  browserGetNetworkTool,
  browserBringToFrontTool,
  browserFocusTool,
  browserPressKeyTool,
  browserTypeTool,
  browserExecuteScriptTool,
  browserCloseTool,
  browserWaitTool,
  browserConnectTool,
  browserGetHealthTool,
  browserGetPageInfoTool,
  browserSendTool,
} from './browser-tools.js';

/**
 * Start browser server (for compatibility)
 * CDP     
 */
export async function startBrowserServer(): Promise<boolean> {
  // CDP  launch()    
  return true;
}

/**
 * Shutdown browser server
 * Called when browser tool group is disabled
 */
export async function shutdownBrowserServer(): Promise<void> {
  try {
    await browserClient.stopServer();
  } catch {
    // Ignore errors
  }
}

/**
 * Check if browser tools are available
 * CDP     (Chrome/Edge  )
 */
export function isBrowserServerAvailable(): boolean {
  // CDP  server.exe    true
  //    launch  
  return true;
}
