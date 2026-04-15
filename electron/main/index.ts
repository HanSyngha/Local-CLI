/**
 * Electron Main Process
 * -   
 * -   won
 * - /  won
 * -  best practices
 * -   
 */

import { app, BrowserWindow, shell, nativeTheme, crashReporter, screen } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { logger, LogLevel } from './utils/logger';
import { setupIpcHandlers, setChatWindow, setTaskWindow, setJarvisWindow as setIpcJarvisWindow, setJarvisLifecycleCallbacks, cleanupIpcHandlers, updateAutoStartSettings } from './ipc-handlers';
import { powerShellManager } from './powershell-manager';
import { configManager } from './core/config';
import { sessionManager } from './core/session';
import { toolManager } from './tool-manager';
import { reportError } from './core/telemetry/error-reporter';
import { startCliServer, stopCliServer, setCliServerWindows } from './cli-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GPU   ( )
// : disable-gpu    CPU   
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist'); //   GPU 

// Electron-vite   
const RENDERER_DIST = path.join(__dirname, '../renderer');
const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];
const isDev = !!VITE_DEV_SERVER_URL;

//   (Chat: , Task: , Jarvis: )
let chatWindow: BrowserWindow | null = null;
let taskWindow: BrowserWindow | null = null;
let jarvisWindow: BrowserWindow | null = null;

// Jarvis  
import { DEFAULT_JARVIS_CONFIG, jarvisService } from './jarvis';
import { JarvisTray } from './jarvis/jarvis-tray';
let jarvisTray: JarvisTray | null = null;
const isJarvisOnlyMode = process.argv.includes('--jarvis-only');
let isAppQuitting = false; // app.quit()   true → chatWindow close  hide  close 


// ============ task   (Portable   temp  ) ============

const cwd = process.cwd();
const tempDir = os.tmpdir().toLowerCase();
if (cwd.toLowerCase().startsWith(tempDir) || cwd.toLowerCase().includes('\\temp\\')) {
  const home = os.homedir();
  try {
    process.chdir(home);
    logger.info('Working directory corrected from temp to home', { from: cwd, to: home });
  } catch {
    // fallback: keep current directory
  }
}

// ============    ============

crashReporter.start({
  productName: 'Local CLI (For Windows)',
  submitURL: '', //    URL ()
  uploadToServer: false, //  
  compress: true,
});

// ============    ============

process.on('uncaughtException', (error) => {
  logger.fatal('Uncaught Exception', {
    message: error.message,
    stack: error.stack,
  });
  reportError(error, { type: 'uncaughtException' }).catch(() => {});

  //    
  if (isDev) {
    console.error('Uncaught Exception:', error);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal('Unhandled Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: String(promise),
  });
  reportError(reason, { type: 'unhandledRejection' }).catch(() => {});

  if (isDev) {
    console.error('Unhandled Rejection:', reason);
  }
});

// ============   ============

// : app.disableHardwareAcceleration()     
// GPU    , ,   

//     ()
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

// Windows dedicated 
if (process.platform === 'win32') {
  app.setAppUserModelId('com.local-bot.windows');
}

// ============  webPreferences ============

const commonWebPreferences = {
  preload: path.join(__dirname, '../preload/index.mjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  devTools: true,
};

const appIcon = app.isPackaged
  ? path.join(process.resourcesPath, process.platform === 'win32' ? 'icon.ico' : 'icon.png')
  : path.join(__dirname, '../../build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

//  URL  
function loadWindowURL(win: BrowserWindow, windowType: string): void {
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}?window=${windowType}`);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), {
      query: { window: windowType },
    });
  }
}

//  bounds /won
function saveWindowBounds(key: string, win: BrowserWindow): void {
  try {
    const bounds = win.getBounds();
    (configManager as { set(key: string, value: unknown): void }).set(`windowBounds.${key}`, bounds);
  } catch {
    // ignore
  }
}

function getWindowBounds(key: string): Electron.Rectangle | null {
  try {
    const bounds = (configManager as { get(key: string): unknown }).get(`windowBounds.${key}`) as Electron.Rectangle | undefined;
    return bounds || null;
  } catch {
    return null;
  }
}

// ============ Chat   () ============

async function createChatWindow(): Promise<void> {
  const savedBounds = getWindowBounds('chat');
  const defaultWidth = 820;
  const defaultHeight = 620;
  const taskWindowWidth = 400;

  //  bounds  Chat + Task    
  let chatX: number | undefined = savedBounds?.x;
  let chatY: number | undefined = savedBounds?.y;
  let shouldCenter = false;
  if (!savedBounds) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;
    const totalWidth = defaultWidth + 10 + taskWindowWidth; // Chat + gap + Task

    if (totalWidth <= workArea.width) {
      //     → Chat  
      chatX = workArea.x + Math.floor((workArea.width - totalWidth) / 2);
      chatY = workArea.y + Math.floor((workArea.height - defaultHeight) / 2);
    } else {
      //   → Chat  
      shouldCenter = true;
    }
  }

  chatWindow = new BrowserWindow({
    width: savedBounds?.width || defaultWidth,
    height: savedBounds?.height || defaultHeight,
    x: chatX,
    y: chatY,
    minWidth: 480,
    minHeight: 400,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    transparent: false,
    icon: appIcon,
    webPreferences: commonWebPreferences,
    show: true,
    center: shouldCenter,
  });

  setChatWindow(chatWindow);

  if (isDev) {
    chatWindow.webContents.once('did-finish-load', () => {
      chatWindow?.webContents.openDevTools({ mode: 'detach' });
    });
  }

  chatWindow.on('maximize', () => {
    chatWindow?.webContents.send('window:maximizeChange', true);
  });

  chatWindow.on('unmaximize', () => {
    chatWindow?.webContents.send('window:maximizeChange', false);
  });

  chatWindow.on('focus', () => {
    logger.windowFocus({ windowId: chatWindow?.id });
    chatWindow?.webContents.send('window:focus', true);
    chatWindow?.flashFrame(false);
  });

  chatWindow.on('blur', () => {
    logger.windowBlur({ windowId: chatWindow?.id });
    chatWindow?.webContents.send('window:focus', false);
  });

  chatWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  chatWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(VITE_DEV_SERVER_URL || '') && !url.startsWith('file://')) {
      event.preventDefault();
      logger.warn('Navigation blocked', { url });
    }
  });

  loadWindowURL(chatWindow, 'chat');

  // Chat  : Jarvis   hide,   
  // app.quit()  isAppQuitting=true → hide   close 
  chatWindow.on('close', (e) => {
    saveWindowBounds('chat', chatWindow!);

    // app.quit()    close  (hide )
    if (isAppQuitting) return;

    const jarvisConfig = configManager.get('jarvis') || DEFAULT_JARVIS_CONFIG;
    if (jarvisConfig.enabled && jarvisTray?.isCreated()) {
      // Jarvis  → hide (  )
      e.preventDefault();
      chatWindow!.hide();
      if (taskWindow && !taskWindow.isDestroyed()) {
        taskWindow.hide();
      }
      logger.info('[Jarvis] Chat window hidden, running in tray');
      return;
    }
  });

  chatWindow.on('closed', () => {
    logger.windowClose({ windowId: 'chat' });
    chatWindow = null;
    // Task    
    if (taskWindow && !taskWindow.isDestroyed()) {
      taskWindow.destroy();
      taskWindow = null;
    }
    // Jarvis 
    destroyJarvis();
    app.quit();
  });

  logger.windowCreate({
    id: chatWindow.id,
    width: savedBounds?.width || defaultWidth,
    height: savedBounds?.height || defaultHeight,
    isDev,
    frame: false,
    titleBarStyle: 'hidden',
  });
}

// ============ Task   () ============

async function createTaskWindow(): Promise<void> {
  const savedBounds = getWindowBounds('task');

  //  bounds  Chat    (   )
  const taskWidth = savedBounds?.width || 400;
  const taskHeight = savedBounds?.height || 600;
  let x: number | undefined = savedBounds?.x;
  let y: number | undefined = savedBounds?.y;
  if (!savedBounds && chatWindow) {
    const chatBounds = chatWindow.getBounds();
    const display = screen.getDisplayMatching(chatBounds);
    const workArea = display.workArea;

    // Chat   
    const idealX = chatBounds.x + chatBounds.width + 10;
    if (idealX + taskWidth <= workArea.x + workArea.width) {
      x = idealX;
      y = chatBounds.y;
    } else {
      //    Chat  
      const leftX = chatBounds.x - taskWidth - 10;
      if (leftX >= workArea.x) {
        x = leftX;
        y = chatBounds.y;
      } else {
        //       
        x = workArea.x + workArea.width - taskWidth;
        y = chatBounds.y;
      }
    }
  }

  taskWindow = new BrowserWindow({
    width: savedBounds?.width || 400,
    height: savedBounds?.height || 600,
    x,
    y,
    minWidth: 300,
    minHeight: 400,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    transparent: false,
    icon: appIcon,
    webPreferences: commonWebPreferences,
    show: true, //    Task   
  });

  setTaskWindow(taskWindow);

  taskWindow.on('maximize', () => {
    taskWindow?.webContents.send('window:maximizeChange', true);
  });

  taskWindow.on('unmaximize', () => {
    taskWindow?.webContents.send('window:maximizeChange', false);
  });

  taskWindow.on('focus', () => {
    taskWindow?.webContents.send('window:focus', true);
    taskWindow?.flashFrame(false);
  });

  taskWindow.on('blur', () => {
    taskWindow?.webContents.send('window:focus', false);
  });

  taskWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  loadWindowURL(taskWindow, 'task');

  // Task  = hide (destroy ,  )
  taskWindow.on('close', (e) => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      e.preventDefault();
      saveWindowBounds('task', taskWindow!);
      taskWindow!.hide();
    }
    // Chat     destroy
  });

  logger.windowCreate({
    id: taskWindow.id,
    width: savedBounds?.width || 400,
    height: savedBounds?.height || 600,
    isDev,
    frame: false,
    titleBarStyle: 'hidden',
  });
}

// ============ Jarvis   () ============

async function createJarvisWindow(): Promise<void> {
  const savedBounds = getWindowBounds('jarvis');

  // :    
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const jarvisWidth = savedBounds?.width || 400;
  const jarvisHeight = savedBounds?.height || 600;
  const defaultX = workArea.x + workArea.width - jarvisWidth - 20;
  const defaultY = workArea.y + workArea.height - jarvisHeight - 40;

  jarvisWindow = new BrowserWindow({
    width: jarvisWidth,
    height: jarvisHeight,
    x: savedBounds?.x ?? defaultX,
    y: savedBounds?.y ?? defaultY,
    minWidth: 360,
    minHeight: 480,
    maxWidth: 500,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0F172A' : '#F0F4F8',
    transparent: false,
    icon: appIcon,
    webPreferences: commonWebPreferences,
    show: false, //  hidden, /IPC show
    skipTaskbar: false,
    resizable: true,
  });

  jarvisWindow.on('focus', () => {
    jarvisWindow?.webContents.send('window:focus', true);
    jarvisWindow?.flashFrame(false);
  });

  jarvisWindow.on('blur', () => {
    jarvisWindow?.webContents.send('window:focus', false);
  });

  jarvisWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  setIpcJarvisWindow(jarvisWindow);
  loadWindowURL(jarvisWindow, 'jarvis');

  // Jarvis  = hide (destroy ). , app.quit()  .
  let jarvisQuitting = false;
  app.on('before-quit', () => { jarvisQuitting = true; });
  jarvisWindow.on('close', (e) => {
    if (jarvisQuitting) return; // app.quit()    
    e.preventDefault();
    saveWindowBounds('jarvis', jarvisWindow!);
    jarvisWindow!.hide();
  });

  logger.info('[Jarvis] Window created', {
    width: jarvisWidth,
    height: jarvisHeight,
  });
}

// ============ Jarvis  +  ============

function initializeJarvis(): void {
  const jarvisConfig = configManager.get('jarvis') || DEFAULT_JARVIS_CONFIG;
  if (!jarvisConfig.enabled) return;
  startJarvisRuntime();
}

/**
 * Jarvis   ( +  + )
 * initializeJarvis() , Settings    
 */
function startJarvisRuntime(): void {
  //    
  if (jarvisTray?.isCreated()) return;

  //  
  jarvisTray = new JarvisTray({
    onShowJarvisWindow: () => {
      if (jarvisWindow && !jarvisWindow.isDestroyed()) {
        jarvisWindow.show();
        jarvisWindow.focus();
      }
    },
    onShowChatWindow: () => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.show();
        chatWindow.focus();
      } else {
        // --jarvis-only       
        createChatWindow().then(() => {
          createTaskWindow();
        });
      }
    },
    onPollNow: () => {
      jarvisService.pollNow().catch(err =>
        logger.errorSilent('[Jarvis] Poll failed', { error: String(err) })
      );
    },
    onDisableJarvis: async () => {
      //   (config  +  )
      const current = configManager.get('jarvis') || DEFAULT_JARVIS_CONFIG;
      await configManager.set('jarvis', { ...current, enabled: false });
      updateAutoStartSettings();
      destroyJarvis();
      logger.info('[Jarvis] Disabled via tray menu');
      //    ,   
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.show();
        chatWindow.focus();
      } else {
        app.quit();
      }
    },
    onQuit: () => {
      destroyJarvis();
      app.quit();
    },
  });
  jarvisTray.create();

  // Jarvis   (hidden)
  createJarvisWindow();

  // JarvisService   + 
  jarvisService.setWindow(jarvisWindow);
  jarvisService.start().catch(err =>
    logger.errorSilent('[Jarvis] Service start failed', { error: String(err) })
  );

  //     
  if (jarvisWindow && !jarvisWindow.isDestroyed()) {
    jarvisWindow.show();
    jarvisWindow.focus();
  }

  const currentJarvisConfig = configManager.get('jarvis') || DEFAULT_JARVIS_CONFIG;
  logger.info('[Jarvis] Initialized', {
    pollInterval: currentJarvisConfig.pollIntervalMinutes,
    autoStartOnBoot: currentJarvisConfig.autoStartOnBoot,
  });
}

function destroyJarvis(): void {
  jarvisService.stop();
  jarvisTray?.destroy();
  jarvisTray = null;
  if (jarvisWindow && !jarvisWindow.isDestroyed()) {
    jarvisWindow.destroy();
    jarvisWindow = null;
  }
}

// ============    ============

nativeTheme.on('updated', () => {
  const isDark = nativeTheme.shouldUseDarkColors;
  const themeValue = isDark ? 'dark' : 'light';
  const bgColor = isDark ? '#1e1e1e' : '#ffffff';

  //     
  chatWindow?.webContents.send('theme:change', themeValue);
  taskWindow?.webContents.send('theme:change', themeValue);
  jarvisWindow?.webContents.send('theme:change', themeValue);

  if (chatWindow) chatWindow.setBackgroundColor(bgColor);
  if (taskWindow) taskWindow.setBackgroundColor(bgColor);
  const jarvisBg = isDark ? '#0F172A' : '#F0F4F8';
  if (jarvisWindow) jarvisWindow.setBackgroundColor(jarvisBg);

  logger.systemThemeChange({ theme: themeValue, isDark });
});

// ============ Auto Updater  ============

function setupAutoUpdater(): void {
  //   
  if (isDev) {
    logger.info('Auto-updater disabled in development mode');
    return;
  }

  // Check if app-update.yml exists (only created by electron-builder with publish config)
  const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
  if (!fs.existsSync(updateConfigPath)) {
    logger.info('Auto-updater disabled: app-update.yml not found (standalone deployment)');
    return;
  }

  //   chatWindow + jarvisWindow  
  const sendUpdateEvent = (channel: string, ...args: unknown[]) => {
    chatWindow?.webContents.send(channel, ...args);
    jarvisWindow?.webContents.send(channel, ...args);
  };

  //  
  autoUpdater.logger = {
    info: (message: string) => logger.info(`[AutoUpdater] ${message}`),
    warn: (message: string) => logger.warn(`[AutoUpdater] ${message}`),
    error: (message: string) => logger.error(`[AutoUpdater] ${message}`),
    debug: (message: string) => logger.debug(`[AutoUpdater] ${message}`),
  };

  //  :   +    
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  //   
  autoUpdater.on('checking-for-update', () => {
    logger.updateCheckStart();
    sendUpdateEvent('update:checking');
  });

  //   - renderer  ( UI )
  autoUpdater.on('update-available', (info) => {
    logger.updateAvailable({ version: info.version, releaseDate: info.releaseDate });
    sendUpdateEvent('update:available', info);
  });

  //  
  autoUpdater.on('update-not-available', () => {
    logger.info('No updates available');
    sendUpdateEvent('update:not-available');
  });

  //  
  autoUpdater.on('download-progress', (progress) => {
    logger.updateDownloadProgress({ percent: progress.percent, bytesPerSecond: progress.bytesPerSecond, transferred: progress.transferred, total: progress.total });
    sendUpdateEvent('update:download-progress', progress);
  });

  //   → renderer     silent install
  autoUpdater.on('update-downloaded', (info) => {
    logger.updateDownloadComplete({ version: info.version });
    sendUpdateEvent('update:downloaded', info);
  });

  //  
  autoUpdater.on('error', (error) => {
    logger.updateError({ error: error.message, stack: error.stack });
    sendUpdateEvent('update:error', error.message);
  });

  //      (5 )
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      logger.errorSilent('Failed to check for updates', { error: error.message });
    });
  }, 5000);

  // 30   
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      logger.errorSilent('Failed to check for updates (periodic)', { error: error.message });
    });
  }, 30 * 60 * 1000);
}

// ============   ============

app.whenReady().then(async () => {
  //  
  await logger.initialize({
    logLevel: isDev ? LogLevel.DEBUG : LogLevel.INFO,
    consoleOutput: isDev,
  });

  // Config 
  await configManager.initialize();

  // Session Manager 
  await sessionManager.initialize();

  // Tool Manager  (   )
  await toolManager.initialize();

  // appReady  (  )
  logger.appReady({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isDev,
    configPath: configManager.getConfigPath(),
    sessionsDir: sessionManager.getSessionsDirectory(),
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
  });

  // IPC  
  setupIpcHandlers();

  // Auto-start   ( ON )
  updateAutoStartSettings();

  // Jarvis  /  
  setJarvisLifecycleCallbacks({
    onEnable: () => startJarvisRuntime(),
    onDisable: () => destroyJarvis(),
  });

  //   —  Chat/Task  (    )
  // --jarvis-only  
  if (!isJarvisOnlyMode) {
    await createChatWindow();
    await createTaskWindow();
  }

  // Jarvis  (chatWindow   — Jarvis    )
  try {
    initializeJarvis();
  } catch (err) {
    logger.errorSilent('[Jarvis] Initialization failed, continuing without Jarvis', { error: String(err) });
  }

  // --jarvis-only : chatWindow  jarvisWindow
  if (isJarvisOnlyMode) {
    const jarvisConfig = configManager.get('jarvis') || DEFAULT_JARVIS_CONFIG;
    if (jarvisConfig.enabled && jarvisWindow && !jarvisWindow.isDestroyed()) {
      jarvisWindow.show();
    } else {
      // Jarvis   →  Chat/Task 
      logger.info('[Jarvis] --jarvis-only but Jarvis disabled, creating Chat/Task');
      await createChatWindow();
      await createTaskWindow();
    }
  }

  // CLI Server  (CLI → Electron )
  setCliServerWindows(chatWindow, taskWindow, jarvisWindow);
  startCliServer();

  // Auto Updater 
  setupAutoUpdater();

  // macOS:      
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createChatWindow();
      await createTaskWindow();
    }
  });
});

// ============    ============

//      (macOS )
// Jarvis     
app.on('window-all-closed', () => {
  // Jarvis      (  )
  const jarvisConfig = configManager.get('jarvis') || DEFAULT_JARVIS_CONFIG;
  if (jarvisConfig.enabled && jarvisTray?.isCreated()) return;
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

//    
// Electron does NOT await async before-quit handlers, so we use
// preventDefault + async cleanup + re-quit pattern to ensure
// sessions are fully saved before the process exits.
let cleanupDone = false;
app.on('before-quit', (event) => {
  isAppQuitting = true; //    — chatWindow close  hide  close 

  if (cleanupDone) return; // Already cleaned up — let quit proceed

  // Prevent quit until async cleanup finishes
  event.preventDefault();

  logger.appBeforeQuit({ reason: 'user_initiated' });

  (async () => {
    // Worker threads  ( )
    try {
      const { workerManager } = await import('./workers/worker-manager');
      await workerManager.terminateAll();
    } catch (err) {
      logger.errorSilent('Failed to terminate workers', err);
    }

    // CLI Server 
    stopCliServer();

    // Jarvis 
    destroyJarvis();

    // PowerShell  
    await powerShellManager.terminate();

    // IPC   ( sessionManager.cleanup()  —   )
    await cleanupIpcHandlers();

    //    
    try {
      const tempImageDir = path.join(os.tmpdir(), 'local-cli-images');
      if (fs.existsSync(tempImageDir)) {
        fs.rmSync(tempImageDir, { recursive: true, force: true });
      }
    } catch (err) {
      logger.errorSilent('Failed to clean up temp image directory', err);
    }

    //  
    await logger.shutdown();

    // Now allow quit to proceed
    cleanupDone = true;
    app.quit();
  })().catch((err) => {
    logger.errorSilent('Cleanup failed during before-quit', err);
    cleanupDone = true;
    app.quit();
  });
});

//    
app.on('render-process-gone', (_event, _webContents, details) => {
  logger.fatal('Renderer process crashed', {
    reason: details.reason,
    exitCode: details.exitCode,
  });

  //    
  if (isDev && chatWindow) {
    chatWindow.reload();
  }
});

// GPU   
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU') {
    logger.error('GPU process crashed', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  }
});

// ============    ============

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    //      Chat  
    // Jarvis   hide    show()  
    if (chatWindow) {
      if (!chatWindow.isVisible()) {
        chatWindow.show();
      }
      if (chatWindow.isMinimized()) {
        chatWindow.restore();
      }
      chatWindow.focus();
      // Task   
      if (taskWindow && !taskWindow.isDestroyed() && !taskWindow.isVisible()) {
        taskWindow.show();
      }
    }
  });
}
