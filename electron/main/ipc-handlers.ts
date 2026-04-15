/**
 * IPC Handlers for Electron Main Process
 * -  / 
 * -   
 * - CLI  
 * -  task  
 * -   
 */

import { ipcMain, dialog, shell, app, BrowserWindow, nativeTheme } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { logger, LogLevel } from './utils/logger';
import { powerShellManager, PowerShellOutput, SessionInfo } from './powershell-manager';
import { configManager, AppConfig, EndpointConfig } from './core/config';
import { sessionManager, Session, SessionSummary, ChatMessage } from './core/session';
import { llmClient, Message } from './core/llm';
import { compactConversation, canCompact, CompactContext, contextTracker } from './core/compact';
import { usageTracker } from './core/usage-tracker';
import { toolManager } from './tool-manager';
import {
  runAgent,
  abortAgent,
  isAgentRunning,
  getCurrentTodos,
  setCurrentTodos,
  setAgentMainWindow,
  setAgentTaskWindow,
  simpleChat,
  handleToolApprovalResponse,
  clearAlwaysApprovedTools,
  AgentConfig,
  AgentCallbacks,
  TodoItem,
  AskUserRequest,
  AskUserResponse,
} from './orchestration';
import { workerManager } from './workers/worker-manager';
import { toolRegistry } from './tools/registry';
import { emitToCLI } from './cli-server-bridge';

//   
interface FileFilter {
  name: string;
  extensions: string[];
}

//   
interface DialogResult {
  success: boolean;
  canceled: boolean;
  filePath?: string;
  filePaths?: string[];
  error?: string;
}

//    
interface FileContentResult {
  success: boolean;
  content?: string;
  error?: string;
}

//   (index.ts )
let chatWindow: BrowserWindow | null = null;
let taskWindow: BrowserWindow | null = null;
let jarvisWindow: BrowserWindow | null = null;

// Jarvis  /  (index.ts )
let onJarvisEnable: (() => void) | null = null;
let onJarvisDisable: (() => void) | null = null;

export function setJarvisLifecycleCallbacks(callbacks: {
  onEnable: () => void;
  onDisable: () => void;
}): void {
  onJarvisEnable = callbacks.onEnable;
  onJarvisDisable = callbacks.onDisable;
}

/**
 * Chat   ()
 */
export function setChatWindow(win: BrowserWindow): void {
  chatWindow = win;
}

/**
 * Task   ()
 */
export function setTaskWindow(win: BrowserWindow | null): void {
  taskWindow = win;
}

/**
 * Jarvis   ()
 */
export function setJarvisWindow(win: BrowserWindow | null): void {
  jarvisWindow = win;
}

/**
 * Auto-start   (Chat + Jarvis    →   )
 */
export function updateAutoStartSettings(): void {
  const autoStartChat = configManager.get('autoStartChat') ?? true;
  const jarvisConfig = configManager.get('jarvis') || { enabled: false, pollIntervalMinutes: 30, autoStartOnBoot: true };
  const jarvisAutoStart = jarvisConfig.enabled && jarvisConfig.autoStartOnBoot;

  const openAtLogin = autoStartChat || jarvisAutoStart;
  // Chat OFF + Jarvis ON → jarvis-only ,     (Chat  )
  const args = (!autoStartChat && jarvisAutoStart) ? ['--jarvis-only'] : [];

  app.setLoginItemSettings({ openAtLogin, args });
  logger.info('[AutoStart] Updated login item settings', { autoStartChat, jarvisAutoStart, openAtLogin, args });
}

/**
 *   IPC  
 */
function broadcastToAll(channel: string, ...args: unknown[]): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send(channel, ...args);
  }
  if (taskWindow && !taskWindow.isDestroyed()) {
    taskWindow.webContents.send(channel, ...args);
  }
  // CLI Server  
  emitToCLI('agent:event', channel, ...args);
}

/**
 *     (for Diff View)
 */
export function sendFileEditEvent(data: {
  path: string;
  originalContent: string;
  newContent: string;
  language: string;
}): void {
  chatWindow?.webContents.send('agent:fileEdit', data);
}

/**
 *    
 */
export function sendFileCreateEvent(data: {
  path: string;
  content: string;
  language: string;
}): void {
  chatWindow?.webContents.send('agent:fileCreate', data);
}

/**
 * IPC  
 */
export function setupIpcHandlers(): void {
  // ============   (event.sender ) ============

  //  
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  //  /won
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.restore();
    } else {
      win?.maximize();
    }
  });

  //  
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  //    
  ipcMain.handle('window:isMaximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  //      
  ipcMain.handle('window:onMaximizeChange', () => {
    return true;
  });

  // ============    ============

  ipcMain.handle('window:getType', (event) => {
    // BrowserWindow.fromWebContents   
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin && taskWindow && !taskWindow.isDestroyed() && senderWin.id === taskWindow.id) {
      return 'task';
    }
    if (senderWin && jarvisWindow && !jarvisWindow.isDestroyed() && senderWin.id === jarvisWindow.id) {
      return 'jarvis';
    }
    return 'chat';
  });

  // ============ Task   ============

  ipcMain.handle('task-window:toggle', () => {
    if (taskWindow && !taskWindow.isDestroyed()) {
      if (taskWindow.isVisible()) {
        taskWindow.hide();
      } else {
        taskWindow.show();
      }
      const visible = taskWindow.isVisible();
      return { success: true, visible };
    }
    return { success: false, visible: false };
  });

  ipcMain.handle('task-window:show', () => {
    if (taskWindow && !taskWindow.isDestroyed()) {
      taskWindow.show();
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('task-window:hide', () => {
    if (taskWindow && !taskWindow.isDestroyed()) {
      taskWindow.hide();
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('task-window:isVisible', () => {
    return taskWindow && !taskWindow.isDestroyed() ? taskWindow.isVisible() : false;
  });

  // Task      (pin)
  ipcMain.handle('task-window:setAlwaysOnTop', (_event, value: boolean) => {
    if (taskWindow && !taskWindow.isDestroyed()) {
      taskWindow.setAlwaysOnTop(value, 'floating');
      return { success: true, alwaysOnTop: value };
    }
    return { success: false };
  });

  ipcMain.handle('task-window:isAlwaysOnTop', () => {
    return taskWindow && !taskWindow.isDestroyed() ? taskWindow.isAlwaysOnTop() : false;
  });

  // ============  ============

  //   
  ipcMain.handle('theme:getSystem', () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });

  //    
  ipcMain.handle('theme:onChange', () => {
    //     
    return true;
  });

  // ============ Config ============

  // Config  
  ipcMain.handle('config:getAll', () => {
    return configManager.getAll();
  });

  // Config   
  ipcMain.handle('config:get', (_event, key: keyof AppConfig) => {
    return configManager.get(key);
  });

  // Config   
  ipcMain.handle('config:set', async (_event, key: keyof AppConfig, value: unknown) => {
    await configManager.set(key, value as AppConfig[typeof key]);

    //        
    const appearanceKeys = ['fontSize', 'fontFamily', 'colorPalette', 'theme', 'uiScale'];
    if (appearanceKeys.includes(key)) {
      broadcastToAll('appearance:change', { key, value });
    }

    return true;
  });

  // Config   
  ipcMain.handle('config:update', async (_event, updates: Partial<AppConfig>) => {
    await configManager.update(updates);
    return true;
  });

  //    (lastOpenedDirectory + recentDirectories  )
  ipcMain.handle('config:addRecentDirectory', async (_event, directory: string) => {
    try {
      await configManager.addRecentDirectory(directory);
      return { success: true };
    } catch (error) {
      logger.error('Failed to add recent directory', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  //  
  ipcMain.handle('config:setTheme', async (_event, theme: 'light' | 'dark' | 'system') => {
    await configManager.setTheme(theme);
    return true;
  });

  //  
  ipcMain.handle('config:getTheme', () => {
    return configManager.getTheme();
  });

  // Config  
  ipcMain.handle('config:getPath', () => {
    return {
      configPath: configManager.getConfigPath(),
      configDir: configManager.getConfigDirectory(),
    };
  });

  // ============ Session ============

  //   
  ipcMain.handle('session:create', async (_event, name?: string, workingDirectory?: string): Promise<{ success: boolean; session?: Session; error?: string }> => {
    logger.ipcHandle('session:create', { name, workingDirectory });
    try {
      const session = await sessionManager.createSession(name, workingDirectory);
      logger.sessionStart({ sessionId: session.id, name: session.name, workingDirectory });

      // NOTE: Do NOT reset global contextTracker, alwaysApprovedTools, or broadcast
      // agent:contextUpdate here. In multi-tab mode, each Worker has its own isolated state.
      // Resetting global state would corrupt other running sessions' context.
      // Each Worker's contextTracker is reset when the worker is created.

      return { success: true, session };
    } catch (error) {
      logger.error('Failed to create session', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  
  ipcMain.handle('session:load', async (_event, sessionId: string): Promise<{ success: boolean; session?: Session; error?: string }> => {
    logger.ipcHandle('session:load', { sessionId });
    try {
      const session = await sessionManager.loadSession(sessionId);
      if (session) {
        logger.flow('Session loaded', { sessionId, messageCount: session.messages?.length || 0 });
        return { success: true, session };
      }
      logger.warn('Session not found', { sessionId });
      return { success: false, error: 'Session not found' };
    } catch (error) {
      logger.error('Failed to load session', { sessionId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  
  ipcMain.handle('session:save', async (_event, session: Session): Promise<{ success: boolean; error?: string }> => {
    logger.ipcHandle('session:save', { sessionId: session.id, messageCount: session.messages?.length || 0 });
    try {
      const success = await sessionManager.saveSession(session);
      logger.flow('Session saved', { sessionId: session.id, success });
      return { success };
    } catch (error) {
      logger.ipcError('session:save', { sessionId: session.id, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('session:saveCurrent', async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const success = await sessionManager.saveCurrentSession();
      return { success };
    } catch (error) {
      logger.error('Failed to save current session', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  
  ipcMain.handle('session:delete', async (_event, sessionId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const success = await sessionManager.deleteSession(sessionId);
      return { success };
    } catch (error) {
      logger.error('Failed to delete session', { sessionId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('session:list', async (): Promise<{ success: boolean; sessions?: SessionSummary[]; error?: string }> => {
    try {
      const sessions = await sessionManager.listSessions();
      return { success: true, sessions };
    } catch (error) {
      logger.error('Failed to list sessions', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('session:getCurrent', (): Session | null => {
    return sessionManager.getCurrentSession();
  });

  //   
  ipcMain.handle('session:setCurrent', (_event, session: Session | null) => {
    sessionManager.setCurrentSession(session);
    return { success: true };
  });

  //  
  ipcMain.handle('session:addMessage', async (_event, message: ChatMessage): Promise<{ success: boolean; error?: string }> => {
    try {
      const success = await sessionManager.addMessage(message);
      return { success };
    } catch (error) {
      logger.error('Failed to add message', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('session:rename', async (_event, sessionId: string, newName: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const success = await sessionManager.renameSession(sessionId, newName);
      return { success };
    } catch (error) {
      logger.error('Failed to rename session', { sessionId, newName, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  
  ipcMain.handle('session:duplicate', async (_event, sessionId: string): Promise<{ success: boolean; session?: Session; error?: string }> => {
    try {
      const session = await sessionManager.duplicateSession(sessionId);
      if (session) {
        return { success: true, session };
      }
      return { success: false, error: 'Failed to duplicate session' };
    } catch (error) {
      logger.error('Failed to duplicate session', { sessionId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  
  ipcMain.handle('session:export', async (_event, sessionId: string): Promise<{ success: boolean; data?: string; error?: string }> => {
    try {
      const data = await sessionManager.exportSession(sessionId);
      if (data) {
        return { success: true, data };
      }
      return { success: false, error: 'Session not found' };
    } catch (error) {
      logger.error('Failed to export session', { sessionId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  
  ipcMain.handle('session:import', async (_event, jsonData: string): Promise<{ success: boolean; session?: Session; error?: string }> => {
    try {
      const session = await sessionManager.importSession(jsonData);
      if (session) {
        return { success: true, session };
      }
      return { success: false, error: 'Invalid session data' };
    } catch (error) {
      logger.error('Failed to import session', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  
  ipcMain.handle('session:search', async (_event, query: string): Promise<{ success: boolean; sessions?: SessionSummary[]; error?: string }> => {
    try {
      const sessions = await sessionManager.searchSessions(query);
      return { success: true, sessions };
    } catch (error) {
      logger.error('Failed to search sessions', { query, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('session:getPath', () => {
    return {
      sessionsDir: sessionManager.getSessionsDirectory(),
    };
  });

  // UI   (   —    won)
  ipcMain.handle('session:saveUIState', async (_event, state: { tabs: string[]; activeTabId: string | null }) => {
    try {
      await sessionManager.saveUIState(state);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // UI   (     won)
  ipcMain.handle('session:loadUIState', async () => {
    try {
      return await sessionManager.loadUIState();
    } catch {
      return null;
    }
  });

  // ============   ============

  //   
  ipcMain.handle(
    'dialog:openFile',
    async (
      _event,
      options?: {
        title?: string;
        defaultPath?: string;
        filters?: FileFilter[];
        multiSelections?: boolean;
      }
    ): Promise<DialogResult> => {
      logger.ipcHandle('dialog:openFile', { title: options?.title, defaultPath: options?.defaultPath });
      try {
        const result = await dialog.showOpenDialog(chatWindow!, {
          title: options?.title || ' ',
          defaultPath: options?.defaultPath,
          filters: options?.filters || [{ name: ' ', extensions: ['*'] }],
          properties: options?.multiSelections
            ? ['openFile', 'multiSelections']
            : ['openFile'],
        });

        return {
          success: !result.canceled,
          canceled: result.canceled,
          filePaths: result.filePaths,
          filePath: result.filePaths[0],
        };
      } catch (error) {
        logger.error('Failed to open file dialog', error);
        return {
          success: false,
          canceled: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  //   
  ipcMain.handle(
    'dialog:saveFile',
    async (
      _event,
      options?: {
        title?: string;
        defaultPath?: string;
        filters?: FileFilter[];
      }
    ): Promise<DialogResult> => {
      try {
        const result = await dialog.showSaveDialog(chatWindow!, {
          title: options?.title || ' ',
          defaultPath: options?.defaultPath,
          filters: options?.filters || [{ name: ' ', extensions: ['*'] }],
        });

        return {
          success: !result.canceled && !!result.filePath,
          canceled: result.canceled,
          filePath: result.filePath,
        };
      } catch (error) {
        logger.error('Failed to save file dialog', error);
        return {
          success: false,
          canceled: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  //   
  ipcMain.handle(
    'dialog:openFolder',
    async (
      _event,
      options?: {
        title?: string;
        defaultPath?: string;
        multiSelections?: boolean;
      }
    ): Promise<DialogResult> => {
      try {
        const result = await dialog.showOpenDialog(chatWindow!, {
          title: options?.title || ' ',
          defaultPath: options?.defaultPath,
          properties: options?.multiSelections
            ? ['openDirectory', 'multiSelections']
            : ['openDirectory'],
        });

        return {
          success: !result.canceled,
          canceled: result.canceled,
          filePaths: result.filePaths,
          filePath: result.filePaths[0],
        };
      } catch (error) {
        logger.error('Failed to open folder dialog', error);
        return {
          success: false,
          canceled: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  //   
  ipcMain.handle(
    'dialog:showMessage',
    async (
      _event,
      options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning';
        title?: string;
        message: string;
        detail?: string;
        buttons?: string[];
      }
    ) => {
      try {
        const result = await dialog.showMessageBox(chatWindow!, {
          type: options.type || 'info',
          title: options.title || 'Local CLI',
          message: options.message,
          detail: options.detail,
          buttons: options.buttons || [''],
        });

        return {
          success: true,
          response: result.response,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // ============   ============

  //  
  ipcMain.handle(
    'fs:readFile',
    async (_event, filePath: string): Promise<FileContentResult> => {
      logger.ipcHandle('fs:readFile', { filePath });
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        logger.flow('File read successfully', { filePath, contentLength: content.length });
        return { success: true, content };
      } catch (error) {
        logger.ipcError('fs:readFile', { filePath, error });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  //  
  ipcMain.handle(
    'fs:writeFile',
    async (_event, filePath: string, content: string): Promise<{ success: boolean; error?: string }> => {
      try {
        await fs.promises.writeFile(filePath, content, 'utf-8');
        return { success: true };
      } catch (error) {
        logger.error('Failed to write file', { filePath, error });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  //   
  ipcMain.handle('fs:exists', async (_event, filePath: string): Promise<boolean> => {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  //   
  ipcMain.handle(
    'fs:readDir',
    async (_event, dirPath: string): Promise<{ success: boolean; files?: string[]; error?: string }> => {
      try {
        const files = await fs.promises.readdir(dirPath);
        return { success: true, files };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  //  
  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
    return { success: true };
  });

  //   
  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    const result = await shell.openPath(filePath);
    return { success: !result, error: result || undefined };
  });

  //  URL 
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
    return { success: true };
  });

  // ============ Image Attachment ============

  ipcMain.handle('image:saveFromClipboard', async (_event, base64Data: string, mimeType: string) => {
    try {
      const ext = mimeType === 'image/jpeg' ? '.jpg' :
                  mimeType === 'image/gif' ? '.gif' :
                  mimeType === 'image/webp' ? '.webp' : '.png';

      const tempDir = path.join(os.tmpdir(), 'local-cli-images');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileName = `clipboard-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const filePath = path.join(tempDir, fileName);
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);

      return { success: true, filePath, size: buffer.length };
    } catch (error) {
      logger.errorSilent('Failed to save clipboard image', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('image:selectFile', async () => {
    if (!chatWindow) return { success: false };
    const result = await dialog.showOpenDialog(chatWindow, {
      title: 'Select Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return { success: true, filePath: result.filePaths[0] };
  });

  // ============ VSCode Integration ============

  // Helper: Get VSCode command (custom path or 'code')
  const getVSCodeCommand = (): string => {
    const customPath = configManager.get('vscodePath');
    if (customPath && typeof customPath === 'string') {
      // Windows paths with spaces need quotes
      return `"${customPath}"`;
    }
    return 'code';
  };

  // Check if VSCode is available (auto-detect from PATH)
  ipcMain.handle('vscode:isAvailable', async () => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // Try to get VSCode version using 'code' command in PATH
      await execAsync('code --version');
      return { available: true, autoDetected: true };
    } catch {
      return { available: false, autoDetected: false };
    }
  });

  // Open file in VSCode
  ipcMain.handle('vscode:openFile', async (_event, filePath: string) => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const vscodeCmd = getVSCodeCommand();

    try {
      await execAsync(`${vscodeCmd} "${filePath}"`);
      return { success: true };
    } catch (error) {
      // Fallback to shell.openPath
      const result = await shell.openPath(filePath);
      return { success: !result, error: result || undefined, fallback: true };
    }
  });

  // Open diff in VSCode
  ipcMain.handle('vscode:openDiff', async (_event, originalPath: string, modifiedPath: string, title?: string) => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const vscodeCmd = getVSCodeCommand();

    try {
      // VSCode diff command: code --diff file1 file2
      const titleArg = title ? ` --title "${title}"` : '';
      await execAsync(`${vscodeCmd} --diff "${originalPath}" "${modifiedPath}"${titleArg}`);
      return { success: true };
    } catch (error) {
      // Fallback to opening the modified file
      const result = await shell.openPath(modifiedPath);
      return { success: !result, error: result || undefined, fallback: true };
    }
  });

  // Open diff with temp files (for showing edit diff)
  ipcMain.handle('vscode:openDiffWithContent', async (_event, data: {
    filePath: string;
    originalContent: string;
    newContent: string;
  }) => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const os = await import('os');
    const fsPromises = await import('fs/promises');
    const pathModule = await import('path');
    const vscodeCmd = getVSCodeCommand();

    const { filePath, originalContent, newContent } = data;
    const ext = pathModule.extname(filePath);
    const baseName = pathModule.basename(filePath, ext);

    // Create temp files for diff
    const tempDir = os.tmpdir();
    const originalTempPath = pathModule.join(tempDir, `${baseName}.original${ext}`);
    const modifiedTempPath = pathModule.join(tempDir, `${baseName}.modified${ext}`);

    try {
      // Write temp files
      await fsPromises.writeFile(originalTempPath, originalContent, 'utf-8');
      await fsPromises.writeFile(modifiedTempPath, newContent, 'utf-8');

      // Open diff in VSCode
      await execAsync(`${vscodeCmd} --diff "${originalTempPath}" "${modifiedTempPath}"`);

      // Clean up temp files after a delay (give VSCode time to read them)
      setTimeout(async () => {
        try {
          await fsPromises.unlink(originalTempPath);
          await fsPromises.unlink(modifiedTempPath);
        } catch {
          // Ignore cleanup errors
        }
      }, 5000);

      return { success: true };
    } catch (error) {
      // Fallback to opening the actual file
      const result = await shell.openPath(filePath);
      return { success: !result, error: result || undefined, fallback: true };
    }
  });

  // Set custom VSCode path
  ipcMain.handle('vscode:setPath', async (_event, vscodePath: string | null) => {
    try {
      if (vscodePath) {
        configManager.set('vscodePath', vscodePath);
      } else {
        // Clear custom path
        configManager.set('vscodePath', undefined);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Get custom VSCode path
  ipcMain.handle('vscode:getPath', async () => {
    const customPath = configManager.get('vscodePath');
    return { path: customPath || null };
  });

  // ============ PowerShell ============

  // PowerShell  
  ipcMain.handle('powershell:startSession', async (): Promise<{ success: boolean; session?: SessionInfo; error?: string }> => {
    try {
      const session = await powerShellManager.startSession();
      return { success: true, session };
    } catch (error) {
      logger.error('Failed to start PowerShell session', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // PowerShell   ( )
  ipcMain.handle(
    'powershell:execute',
    async (_event, command: string) => {
      logger.ipcHandle('powershell:execute', { commandLength: command.length });
      try {
        const result = await powerShellManager.execute(command);
        logger.flow('PowerShell command executed', { exitCode: result.exitCode, outputLength: (result as any).output?.length || 0 });
        return { ...result, success: true };
      } catch (error) {
        logger.ipcError('powershell:execute', { command, error });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // PowerShell    ( )
  ipcMain.handle(
    'powershell:executeOnce',
    async (_event, command: string, cwd?: string) => {
      try {
        const result = await powerShellManager.executeOnce(command, cwd);
        return { ...result };
      } catch (error) {
        logger.error('PowerShell executeOnce error', { command, error });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // PowerShell  
  ipcMain.handle('powershell:sendInput', async (_event, input: string) => {
    const success = powerShellManager.sendInput(input);
    return { success };
  });

  // PowerShell 
  ipcMain.handle('powershell:interrupt', async () => {
    powerShellManager.sendInterrupt();
    return { success: true };
  });

  // PowerShell  
  ipcMain.handle('powershell:terminate', async () => {
    await powerShellManager.terminate();
    return { success: true };
  });

  // PowerShell  
  ipcMain.handle('powershell:restart', async () => {
    try {
      const session = await powerShellManager.restart();
      return { success: true, session };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // PowerShell  
  ipcMain.handle('powershell:getSessionInfo', () => {
    return powerShellManager.getSessionInfo();
  });

  // PowerShell  
  ipcMain.handle('powershell:isRunning', () => {
    return powerShellManager.isRunning();
  });

  // PowerShell task  
  ipcMain.handle('powershell:changeDirectory', async (_event, newPath: string) => {
    const success = await powerShellManager.changeDirectory(newPath);
    return { success };
  });

  // PowerShell   
  ipcMain.handle('powershell:getCurrentDirectory', async () => {
    const directory = await powerShellManager.getCurrentDirectory();
    return { success: true, directory };
  });

  // PowerShell    
  powerShellManager.on('output', (output: PowerShellOutput) => {
    chatWindow?.webContents.send('powershell:output', output);
  });

  powerShellManager.on('exit', (data: { code: number | null; sessionId: string }) => {
    chatWindow?.webContents.send('powershell:exit', data);
  });

  powerShellManager.on('error', (data: { error: Error; sessionId: string }) => {
    chatWindow?.webContents.send('powershell:error', {
      error: data.error.message,
      sessionId: data.sessionId,
    });
  });

  // ============  ============

  // Renderer    (Log Viewer )
  ipcMain.on('log:write', (_event, level: string, message: string, data?: unknown) => {
    switch (level) {
      case 'error':
        logger.error(`[Renderer] ${message}`, data);
        break;
      case 'warn':
        logger.warn(`[Renderer] ${message}`, data);
        break;
      case 'info':
        logger.info(`[Renderer] ${message}`, data);
        break;
      case 'debug':
        logger.debug(`[Renderer] ${message}`, data);
        break;
      default:
        logger.info(`[Renderer] ${message}`, data);
    }
  });

  //   
  ipcMain.handle('log:getFiles', async () => {
    return await logger.getLogFiles();
  });

  //    
  ipcMain.handle('log:readFile', async (_event, filePath: string) => {
    try {
      const content = await logger.readLogFile(filePath);
      return { success: true, content };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //    ()
  ipcMain.handle('log:readEntries', async (_event, filePath: string) => {
    try {
      const entries = await logger.readLogEntries(filePath);
      return { success: true, entries };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //    
  ipcMain.handle('log:openInExplorer', async (_event, filePath?: string) => {
    await logger.openLogFileInExplorer(filePath);
    return { success: true };
  });

  //   
  ipcMain.handle('log:openDirectory', async () => {
    await logger.openLogDirectory();
    return { success: true };
  });

  //   
  ipcMain.handle('log:setLevel', (_event, level: LogLevel) => {
    logger.setLogLevel(level);
    return { success: true };
  });

  //   
  ipcMain.handle('log:getLevel', () => {
    return logger.getLogLevel();
  });

  //    
  ipcMain.handle('log:getCurrentPath', () => {
    return logger.getLogFilePath();
  });

  //   
  ipcMain.handle('log:getDirectory', () => {
    return logger.getLogDirectory();
  });

  //   
  ipcMain.handle('log:deleteFile', async (_event, filePath: string) => {
    try {
      await logger.deleteLogFile(filePath);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('log:clearAll', async () => {
    try {
      const deletedCount = await logger.clearAllLogs();
      return { success: true, deletedCount };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  let logStreamUnsubscribe: (() => void) | null = null;

  ipcMain.handle('log:startStreaming', () => {
    if (logStreamUnsubscribe) {
      return { success: true }; //   
    }

    logStreamUnsubscribe = logger.onLogEntry((entry) => {
      chatWindow?.webContents.send('log:entry', entry);
    });

    return { success: true };
  });

  ipcMain.handle('log:stopStreaming', () => {
    if (logStreamUnsubscribe) {
      logStreamUnsubscribe();
      logStreamUnsubscribe = null;
    }
    return { success: true };
  });

  // Session log handlers
  ipcMain.handle('log:setSession', (_event, sessionId: string | null) => {
    logger.setSessionId(sessionId);
    return { success: true };
  });

  ipcMain.handle('log:getSessionFiles', async () => {
    try {
      const files = await logger.getSessionLogFiles();
      return { success: true, files };
    } catch (error) {
      return { success: false, error: (error as Error).message, files: [] };
    }
  });

  ipcMain.handle('log:readSessionLog', async (_event, sessionId: string) => {
    try {
      const entries = await logger.readSessionLog(sessionId);
      return { success: true, entries };
    } catch (error) {
      return { success: false, error: (error as Error).message, entries: [] };
    }
  });

  ipcMain.handle('log:deleteSessionLog', async (_event, sessionId: string) => {
    try {
      await logger.deleteSessionLog(sessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('log:getCurrentSessionId', () => {
    return { success: true, sessionId: logger.getCurrentSessionId() };
  });

  // Current Run log handlers (  )
  ipcMain.handle('log:getRunFiles', async () => {
    try {
      const files = await logger.getRunLogFiles();
      return { success: true, files };
    } catch (error) {
      return { success: false, error: (error as Error).message, files: [] };
    }
  });

  ipcMain.handle('log:getCurrentRunId', () => {
    return { success: true, runId: logger.getCurrentRunId() };
  });

  ipcMain.handle('log:readCurrentRunLog', async () => {
    try {
      const entries = await logger.readCurrentRunLog();
      return { success: true, entries };
    } catch (error) {
      return { success: false, error: (error as Error).message, entries: [] };
    }
  });

  ipcMain.handle('log:readRunLog', async (_event, runId: string) => {
    try {
      const entries = await logger.readRunLog(runId);
      return { success: true, entries };
    } catch (error) {
      return { success: false, error: (error as Error).message, entries: [] };
    }
  });

  ipcMain.handle('log:deleteRunLog', async (_event, runId: string) => {
    try {
      await logger.deleteRunLog(runId);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ============  ============

  //  
  ipcMain.handle('system:info', () => {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      appVersion: app.getVersion(),
      appPath: app.getAppPath(),
      userDataPath: app.getPath('userData'),
      tempPath: app.getPath('temp'),
    };
  });

  //  
  ipcMain.handle('app:restart', () => {
    app.relaunch();
    app.exit(0);
  });

  //  
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  // ============   ============

  //   
  ipcMain.handle('update:getVersion', () => {
    return app.getVersion();
  });

  //  
  ipcMain.handle('update:startDownload', async () => {
    try {
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  //  (silent NSIS install +  )
  ipcMain.handle('update:install', async () => {
    try {
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.quitAndInstall(true, true);
    } catch (error) {
      logger.error('Failed to install update', { error });
    }
  });

  //   
  ipcMain.handle('devTools:toggle', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools();
    return { success: true };
  });

  //  
  ipcMain.handle('window:reload', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.reload();
    return { success: true };
  });

  // ============ LLM ============

  // LLM endpoints 
  ipcMain.handle('llm:getEndpoints', () => {
    try {
      const result = configManager.getEndpoints();
      return { success: true, ...result };
    } catch (error) {
      logger.error('Failed to get LLM endpoints', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // LLM endpoint 
  ipcMain.handle('llm:addEndpoint', async (_event, endpointData: Omit<EndpointConfig, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const endpoint = await configManager.addEndpoint(endpointData);
      // Broadcast to workers so they can use the new endpoint immediately
      const { endpoints, currentEndpointId, currentModelId } = configManager.getEndpoints();
      workerManager.broadcastConfigChange({
        endpoints,
        currentEndpoint: currentEndpointId,
        currentModel: currentModelId,
      });
      return { success: true, endpoint };
    } catch (error) {
      logger.error('Failed to add LLM endpoint', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // LLM endpoint 
  ipcMain.handle('llm:updateEndpoint', async (_event, endpointId: string, updates: Partial<EndpointConfig>) => {
    try {
      const success = await configManager.updateEndpoint(endpointId, updates);
      // Broadcast updated config to workers
      const { endpoints, currentEndpointId, currentModelId } = configManager.getEndpoints();
      workerManager.broadcastConfigChange({
        endpoints,
        currentEndpoint: currentEndpointId,
        currentModel: currentModelId,
      });
      return { success };
    } catch (error) {
      logger.error('Failed to update LLM endpoint', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // LLM endpoint 
  ipcMain.handle('llm:removeEndpoint', async (_event, endpointId: string) => {
    try {
      const success = await configManager.removeEndpoint(endpointId);
      // Broadcast updated config to workers
      const { endpoints, currentEndpointId, currentModelId } = configManager.getEndpoints();
      workerManager.broadcastConfigChange({
        endpoints,
        currentEndpoint: currentEndpointId,
        currentModel: currentModelId,
      });
      return { success };
    } catch (error) {
      logger.error('Failed to remove LLM endpoint', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //    (endpoint   )
  ipcMain.handle('llm:setCurrentModel', async (_event, modelId: string) => {
    try {
      const success = await configManager.setCurrentModel(modelId);
      if (success) {
        // Notify all workers of the model change
        workerManager.broadcastConfigChange({ currentModel: modelId });
      }
      return { success };
    } catch (error) {
      logger.error('Failed to set current LLM model', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  endpoint 
  ipcMain.handle('llm:setCurrentEndpoint', async (_event, endpointId: string) => {
    try {
      const success = await configManager.setCurrentEndpoint(endpointId);
      if (success) {
        // Notify all workers of the endpoint change
        workerManager.broadcastConfigChange({ currentEndpoint: endpointId });
      }
      return { success };
    } catch (error) {
      logger.error('Failed to set current LLM endpoint', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  
  ipcMain.handle('llm:testConnection', async (_event, baseUrl: string, apiKey: string | undefined, modelId: string) => {
    try {
      const result = await configManager.testConnection(baseUrl, apiKey, modelId);
      return result;
    } catch (error) {
      logger.error('Failed to test LLM connection', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  health check
  ipcMain.handle('llm:healthCheckAll', async () => {
    try {
      await configManager.healthCheckAll();
      return { success: true };
    } catch (error) {
      logger.error('Failed to health check LLM endpoints', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('llm:getStatus', () => {
    try {
      const status = configManager.getStatus();
      return { success: true, status };
    } catch (error) {
      logger.error('Failed to get LLM status', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ============ Chat (LLM) ============

  //    (non-streaming)
  ipcMain.handle('chat:send', async (_event, messages: Message[]) => {
    logger.ipcHandle('chat:send', { messageCount: messages.length });
    try {
      const result = await llmClient.chat(messages, false);
      logger.flow('Chat send completed', { success: true });
      return { success: true, ...result };
    } catch (error) {
      logger.error('Chat send failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //    (streaming)
  ipcMain.handle('chat:sendStream', async (_event, messages: Message[]) => {
    logger.ipcHandle('chat:sendStream', { messageCount: messages.length });
    logger.httpStreamStart('POST', 'llm/chat');
    try {
      // Streaming IPC event  
      const result = await llmClient.chat(messages, true, (chunk, done) => {
        chatWindow?.webContents.send('chat:chunk', { chunk, done });
      });
      logger.httpStreamEnd(0, 0);
      return { success: true, ...result };
    } catch (error) {
      logger.error('Chat stream failed', error);
      //   done  
      chatWindow?.webContents.send('chat:chunk', { chunk: '', done: true, error: true });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('chat:sendMessage', async (_event, userMessage: string, systemPrompt?: string, stream?: boolean) => {
    try {
      if (stream) {
        const content = await llmClient.sendMessage(userMessage, systemPrompt, true, (chunk, done) => {
          chatWindow?.webContents.send('chat:chunk', { chunk, done });
        });
        return { success: true, content };
      } else {
        const content = await llmClient.sendMessage(userMessage, systemPrompt, false);
        return { success: true, content };
      }
    } catch (error) {
      logger.error('Send message failed', error);
      if (stream) {
        chatWindow?.webContents.send('chat:chunk', { chunk: '', done: true, error: true });
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //  
  ipcMain.handle('chat:abort', () => {
    try {
      llmClient.abort();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //    
  ipcMain.handle('chat:isActive', () => {
    return llmClient.isRequestActive();
  });

  // ============ Compact ============

  //    (per-session via worker if available)
  ipcMain.handle('compact:execute', async (_event, messagesOrSessionId: Message[] | string, contextOrMessages?: CompactContext | Message[], maybeContext?: CompactContext) => {
    // Support both old signature (messages, context) and new signature (sessionId, messages, context)
    let sessionId: string | undefined;
    let messages: Message[];
    let context: CompactContext;

    if (typeof messagesOrSessionId === 'string') {
      sessionId = messagesOrSessionId;
      messages = (contextOrMessages as Message[]) || [];
      context = maybeContext || {};
    } else {
      messages = messagesOrSessionId;
      context = (contextOrMessages as CompactContext) || {};
    }

    // Route to worker if session has one (uses worker's own llmClient)
    if (sessionId && workerManager.hasWorker(sessionId)) {
      const result = await workerManager.compactInWorker(sessionId, messages, context);
      return result;
    }

    // Fallback: main process compact (legacy non-worker mode)
    try {
      const result = await compactConversation(messages, context);
      return result;
    } catch (error) {
      logger.error('Compact execution failed', error);
      return {
        success: false,
        originalMessageCount: messages.length,
        newMessageCount: messages.length,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //    
  ipcMain.handle('compact:canCompact', (_event, messages: Message[]) => {
    return canCompact(messages);
  });

  // ============ Usage Tracking ============

  //   
  ipcMain.handle('usage:getSummary', () => {
    try {
      return { success: true, summary: usageTracker.getSummary() };
    } catch (error) {
      logger.error('Failed to get usage summary', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('usage:getDailyStats', (_event, days: number = 30) => {
    try {
      return { success: true, stats: usageTracker.getDailyStats(days) };
    } catch (error) {
      logger.error('Failed to get daily stats', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('usage:resetSession', () => {
    try {
      usageTracker.resetSession();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //    
  ipcMain.handle('usage:clearData', () => {
    try {
      usageTracker.clearData();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ============ Tools ============

  //    
  ipcMain.handle('tools:getGroups', () => {
    try {
      return { success: true, groups: toolManager.getToolGroups() };
    } catch (error) {
      logger.error('Failed to get tool groups', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //     
  ipcMain.handle('tools:getAvailable', () => {
    try {
      return { success: true, groups: toolManager.getAvailableToolGroups() };
    } catch (error) {
      logger.error('Failed to get available tool groups', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //    
  ipcMain.handle('tools:getEnabled', () => {
    try {
      return { success: true, groups: toolManager.getEnabledToolGroups() };
    } catch (error) {
      logger.error('Failed to get enabled tool groups', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('tools:enable', async (_event, groupId: string) => {
    try {
      const result = await toolManager.enableToolGroup(groupId);
      if (result.success) {
        workerManager.broadcastToolGroupChange(groupId, true);
      }
      return result;
    } catch (error) {
      logger.error('Failed to enable tool group', { groupId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('tools:disable', async (_event, groupId: string) => {
    try {
      const result = await toolManager.disableToolGroup(groupId);
      if (result.success) {
        workerManager.broadcastToolGroupChange(groupId, false);
      }
      return result;
    } catch (error) {
      logger.error('Failed to disable tool group', { groupId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('tools:toggle', async (_event, groupId: string) => {
    try {
      const result = await toolManager.toggleToolGroup(groupId);
      if (result.success) {
        workerManager.broadcastToolGroupChange(groupId, result.enabled ?? false);
      }
      return result;
    } catch (error) {
      logger.error('Failed to toggle tool group', { groupId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //   
  ipcMain.handle('tools:getSummary', () => {
    try {
      return { success: true, ...toolManager.getSummary() };
    } catch (error) {
      logger.error('Failed to get tool summary', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //     
  ipcMain.handle('tools:isEnabled', (_event, groupId: string) => {
    return toolManager.isEnabled(groupId);
  });

  // ============ Agent ============

  // Pending ask user resolver
  let pendingAskUserResolve: ((response: AskUserResponse) => void) | null = null;

  // Agent  (sessionId optional - when provided and worker exists, routes to worker)
  ipcMain.handle('agent:run', async (
    _event,
    userMessage: string,
    existingMessages: Message[],
    config: AgentConfig,
    sessionId?: string
  ) => {
    logger.ipcHandle('agent:run', { messageLength: userMessage.length, existingMessagesCount: existingMessages.length, config, sessionId });
    try {
      // Worker-based execution: route to WorkerManager
      if (sessionId && workerManager.hasWorker(sessionId)) {
        workerManager.setChatWindow(chatWindow);
        workerManager.setTaskWindow(taskWindow);
        const result = await workerManager.runAgent(sessionId, userMessage, existingMessages, config);
        return { ...result, success: result.success };
      }

      // Legacy direct execution (no sessionId or no worker)
      setAgentMainWindow(chatWindow);
      setAgentTaskWindow(taskWindow);

      // Set session ID for logging
      const currentSession = sessionManager.getCurrentSession();
      if (currentSession) {
        logger.setSessionId(currentSession.id);
      }

      // Setup callbacks for IPC communication
      const callbacks: AgentCallbacks = {
        onAskUser: async (request: AskUserRequest): Promise<AskUserResponse> => {
          broadcastToAll('agent:askUser', request);

          if (chatWindow && !chatWindow.isDestroyed() && !chatWindow.isFocused()) {
            chatWindow.flashFrame(true);
          }
          if (taskWindow && !taskWindow.isDestroyed() && !taskWindow.isFocused()) {
            taskWindow.flashFrame(true);
          }

          return new Promise((resolve) => {
            pendingAskUserResolve = resolve;
          });
        },
      };

      const result = await runAgent(userMessage, existingMessages, config, callbacks);
      return { ...result, success: result.success };
    } catch (error) {
      logger.error('Agent run failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Agent  — TODO ,  LLM   (sessionId optional)
  ipcMain.handle('agent:pause', (_event, sessionId?: string) => {
    try {
      if (sessionId && workerManager.hasWorker(sessionId)) {
        workerManager.pauseAgent(sessionId);
        return { success: true };
      }
      // Fallback: treat as abort for legacy
      abortAgent();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Agent  — TODO   (sessionId optional)
  ipcMain.handle('agent:abort', (_event, sessionId?: string) => {
    try {
      if (sessionId && workerManager.hasWorker(sessionId)) {
        workerManager.abortAgent(sessionId);
        return { success: true };
      }

      // Legacy direct execution
      if (pendingAskUserResolve) {
        pendingAskUserResolve({ selectedOption: '', isOther: false, customText: 'User aborted' });
        pendingAskUserResolve = null;
      }
      abortAgent();
      broadcastToAll('agent:askUserResolved');
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Agent    (per-session via worker)
  ipcMain.handle('agent:isRunning', (_event, sessionId?: string) => {
    if (sessionId && workerManager.hasWorker(sessionId)) {
      return workerManager.isSessionRunning(sessionId);
    }
    // Fallback: legacy global state
    return isAgentRunning();
  });

  // agent   (Clear Chat  , sessionId optional)
  ipcMain.handle('agent:clearState', (_event, sessionId?: string) => {
    if (sessionId && workerManager.hasWorker(sessionId)) {
      workerManager.clearState(sessionId);
      // Broadcast empty context/askUser resolved to both windows (task window needs these)
      broadcastToAll('agent:contextUpdate', {
        sessionId,
        usagePercentage: 0,
        currentTokens: 0,
        maxTokens: 128000,
      });
      broadcastToAll('agent:askUserResolved', { sessionId });
      logger.info('Agent state cleared via worker', { sessionId });
      return { success: true };
    }

    // Legacy direct execution
    contextTracker.reset();
    setCurrentTodos([]);
    clearAlwaysApprovedTools();

    if (pendingAskUserResolve) {
      pendingAskUserResolve({ selectedOption: '', isOther: false, customText: 'Chat cleared' });
      pendingAskUserResolve = null;
    }

    broadcastToAll('agent:contextUpdate', {
      usagePercentage: 0,
      currentTokens: 0,
      maxTokens: 128000,
    });
    broadcastToAll('agent:todoUpdate', []);
    broadcastToAll('agent:askUserResolved');

    logger.info('Agent state cleared (clear chat)');
    return { success: true };
  });

  //  TODO   (per-session via WorkerManager cache)
  ipcMain.handle('agent:getTodos', (_event, sessionId?: string) => {
    if (sessionId && workerManager.hasWorker(sessionId)) {
      return workerManager.getSessionTodos(sessionId);
    }
    // Fallback: legacy global state (non-worker mode)
    return getCurrentTodos();
  });

  // TODO   (per-session)
  ipcMain.handle('agent:setTodos', (_event, todosOrSessionId: TodoItem[] | string, maybeTodos?: TodoItem[]) => {
    // Support both old signature (todos) and new signature (sessionId, todos)
    if (typeof todosOrSessionId === 'string' && maybeTodos) {
      // New: (sessionId, todos) — no-op for worker sessions (worker manages its own state)
      // but update WorkerManager cache for task window
      return { success: true };
    }
    // Legacy: (todos)
    setCurrentTodos(todosOrSessionId as TodoItem[]);
    return { success: true };
  });

  //   ( )
  ipcMain.handle('agent:simpleChat', async (
    _event,
    userMessage: string,
    existingMessages: Message[],
    systemPrompt?: string,
    stream?: boolean
  ) => {
    try {
      if (stream) {
        const result = await simpleChat(userMessage, existingMessages, systemPrompt, (chunk) => {
          chatWindow?.webContents.send('agent:streamChunk', chunk);
        });
        return { success: true, ...result };
      } else {
        const result = await simpleChat(userMessage, existingMessages, systemPrompt);
        return { success: true, ...result };
      }
    } catch (error) {
      logger.error('Simple chat failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  //    (ask_to_user  , sessionId optional)
  ipcMain.handle('agent:respondToQuestion', (_event, response: unknown, sessionId?: string) => {
    // Normalize response: convert object format to string format
    const rawResponse = response as {
      selectedOption: string | { label?: string; value?: string };
      isOther: boolean;
      customText?: string;
      sessionId?: string;
      reqId?: string;
    };

    const normalizedResponse: AskUserResponse = {
      selectedOption:
        typeof rawResponse.selectedOption === 'string'
          ? rawResponse.selectedOption
          : rawResponse.selectedOption?.value ||
            rawResponse.selectedOption?.label ||
            '',
      isOther: rawResponse.isOther,
      customText: rawResponse.customText,
    };

    const effectiveSessionId = sessionId || rawResponse.sessionId;

    // Worker-based: forward to worker
    if (effectiveSessionId && rawResponse.reqId && workerManager.hasWorker(effectiveSessionId)) {
      workerManager.forwardAskUserResponse(effectiveSessionId, rawResponse.reqId, normalizedResponse);
      return { success: true };
    }

    // Legacy direct execution
    if (pendingAskUserResolve) {
      logger.debug('Ask user response normalized', {
        original: rawResponse.selectedOption,
        normalized: normalizedResponse.selectedOption,
      });

      pendingAskUserResolve(normalizedResponse);
      pendingAskUserResolve = null;
      broadcastToAll('agent:askUserResolved');
    }
    return { success: true };
  });

  // Tool approval  (Supervised Mode, sessionId optional)
  ipcMain.handle('agent:respondToApproval', (_event, response: {
    id: string;
    result: 'approve' | 'always' | { reject: true; comment: string };
    sessionId?: string;
  }) => {
    logger.ipcHandle('agent:respondToApproval', { requestId: response.id, result: response.result, sessionId: response.sessionId });

    // Worker-based: forward to worker
    if (response.sessionId && workerManager.hasWorker(response.sessionId)) {
      workerManager.forwardApprovalResponse(response.sessionId, response.id, response.result);
      return { success: true };
    }

    // Legacy direct execution
    handleToolApprovalResponse(response.id, response.result);
    return { success: true };
  });

  //  ask_to_user    
  ipcMain.on('agent:askUserQuestion', (_event, request: AskUserRequest) => {
    broadcastToAll('agent:askUser', request);
  });

  // ============ Worker Management (Multi-Session) ============

  // Worker  (   )
  ipcMain.handle('worker:create', (_event, sessionId: string) => {
    try {
      workerManager.setChatWindow(chatWindow);
      workerManager.setTaskWindow(taskWindow);
      // Pass currently enabled tool groups so worker initializes its registry
      // toolManager: user-controlled groups (browser, office)
      // toolRegistry: includes autoManaged groups (vision) that toolManager doesn't track
      const managerGroups = toolManager.getEnabledToolGroups().map(g => g.id);
      const registryGroups = toolRegistry.getEnabledToolGroupIds();
      const enabledGroups = [...new Set([...managerGroups, ...registryGroups])];
      workerManager.createWorker(sessionId, enabledGroups);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Worker  (  )
  ipcMain.handle('worker:terminate', async (_event, sessionId: string) => {
    try {
      await workerManager.terminateWorker(sessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Worker  
  ipcMain.handle('worker:exists', (_event, sessionId: string) => {
    return workerManager.hasWorker(sessionId);
  });

  // Worker 
  ipcMain.handle('worker:count', () => {
    return workerManager.getWorkerCount();
  });

  // ============ Task Window Active Session ============

  // Notify task window of active session change (for per-session TODO display)
  ipcMain.handle('taskWindow:setActiveSession', (_event, sessionId: string) => {
    try {
      if (taskWindow && !taskWindow.isDestroyed()) {
        const todos = workerManager.getSessionTodos(sessionId);
        taskWindow.webContents.send('taskWindow:activeSessionChanged', sessionId, todos);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===========================================================================
  // Jarvis Mode
  // ===========================================================================

  ipcMain.handle('jarvis:sendMessage', async (_event, message: string) => {
    logger.info('[IPC] jarvis:sendMessage', { messageLength: message.length });
    const { jarvisService } = await import('./jarvis');
    await jarvisService.handleUserMessage(message);
  });

  ipcMain.handle('jarvis:pollNow', async () => {
    logger.info('[IPC] jarvis:pollNow triggered');
    const { jarvisService } = await import('./jarvis');
    await jarvisService.pollNow();
  });

  ipcMain.handle('jarvis:getConfig', async () => {
    const config = configManager.get('jarvis');
    logger.info('[IPC] jarvis:getConfig', { enabled: config?.enabled });
    return config || { enabled: false, pollIntervalMinutes: 30, autoStartOnBoot: true };
  });

  ipcMain.handle('jarvis:setConfig', async (_event, updates: Partial<{ enabled: boolean; pollIntervalMinutes: number; autoStartOnBoot: boolean; modelId: string; endpointId: string }>) => {
    logger.info('[IPC] jarvis:setConfig', { updates });
    const current = configManager.get('jarvis') || { enabled: false, pollIntervalMinutes: 30, autoStartOnBoot: true };
    const newConfig = { ...current, ...updates };
    await configManager.set('jarvis', newConfig);

    //     (Chat + Jarvis )
    if ('autoStartOnBoot' in updates || 'enabled' in updates) {
      updateAutoStartSettings();
    }

    //  / —  
    if ('enabled' in updates) {
      if (newConfig.enabled) {
        onJarvisEnable?.();
      } else {
        onJarvisDisable?.();
      }
    }
  });

  ipcMain.handle('jarvis:getState', async () => {
    const { jarvisService } = await import('./jarvis');
    const state = jarvisService.getState();
    logger.info('[IPC] jarvis:getState', { status: state.status, isRunning: state.isRunning });
    return state;
  });

  ipcMain.handle('jarvis:getChatHistory', async () => {
    const { jarvisService } = await import('./jarvis');
    const history = jarvisService.getChatHistory();
    logger.info('[IPC] jarvis:getChatHistory', { messageCount: history.length });
    return history;
  });

  ipcMain.handle('jarvis:showWindow', async () => {
    if (jarvisWindow && !jarvisWindow.isDestroyed()) {
      logger.info('[IPC] jarvis:showWindow — showing');
      jarvisWindow.show();
      jarvisWindow.focus();
    } else {
      logger.warn('[IPC] jarvis:showWindow — jarvisWindow is null or destroyed');
    }
  });

  ipcMain.handle('jarvis:respondToApproval', async (_event, requestId: string, approved: boolean) => {
    logger.info('[IPC] jarvis:respondToApproval', { requestId, approved });
    const { jarvisService } = await import('./jarvis');
    jarvisService.respondToApproval(requestId, approved);
  });

  ipcMain.handle('jarvis:respondToQuestion', async (_event, requestId: string, answer: string) => {
    logger.info('[IPC] jarvis:respondToQuestion', { requestId, answerLength: answer.length });
    const { jarvisService } = await import('./jarvis');
    jarvisService.respondToQuestion(requestId, answer);
  });

  // ===========================================================================
  // App Auto-Start (Chat)
  // ===========================================================================

  ipcMain.handle('app:getAutoStartChat', async () => {
    const value = configManager.get('autoStartChat') ?? true;
    logger.info('[IPC] app:getAutoStartChat', { value });
    return value;
  });

  ipcMain.handle('app:setAutoStartChat', async (_event, enabled: boolean) => {
    logger.info('[IPC] app:setAutoStartChat', { enabled });
    await configManager.set('autoStartChat', enabled);
    updateAutoStartSettings();
  });

  logger.info('IPC handlers registered');
}

/**
 * IPC  
 */
export async function cleanupIpcHandlers(): Promise<void> {
  // Agent 
  if (isAgentRunning()) {
    abortAgent();
  }

  // PowerShell  
  powerShellManager.terminate();

  //   
  await sessionManager.cleanup();

  //   
  ipcMain.removeAllListeners();

  logger.info('IPC handlers cleaned up');
}
