/// <reference types="vite/client" />

// ============   ============

// PowerShell 
export interface PowerShellResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  error?: string;
  duration?: number;
}

export interface PowerShellOutput {
  type: 'stdout' | 'stderr' | 'error' | 'exit';
  data: string;
  timestamp: number;
}

export interface PowerShellExitEvent {
  code: number | null;
  sessionId: string;
}

export interface PowerShellErrorEvent {
  error: string;
  sessionId: string;
}

export interface SessionInfo {
  id: string;
  state: 'idle' | 'running' | 'busy' | 'error' | 'terminated';
  startTime: number;
  currentDirectory: string;
  lastActivity: number;
}

//   
export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  electronVersion: string;
  appVersion: string;
  appPath: string;
  userDataPath: string;
  tempPath: string;
}

//  
export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface DialogResult {
  success: boolean;
  canceled: boolean;
  filePath?: string;
  filePaths?: string[];
  error?: string;
}

export interface MessageDialogOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  title?: string;
  message: string;
  detail?: string;
  buttons?: string[];
}

//   
export interface LogFile {
  name: string;
  path: string;
  size: number;
  date: string;
}

//  
export type Theme = 'dark' | 'light';

// ============ Electron API  ============

export interface ElectronAPI {
  //  
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
    onFocusChange: (callback: (isFocused: boolean) => void) => () => void;
    reload: () => Promise<{ success: boolean }>;
    getWindowType: () => Promise<'chat' | 'task'>;
  };

  // Task  
  taskWindow: {
    toggle: () => Promise<{ success: boolean; visible?: boolean }>;
    show: () => Promise<{ success: boolean }>;
    hide: () => Promise<{ success: boolean }>;
    isVisible: () => Promise<boolean>;
    setAlwaysOnTop: (value: boolean) => Promise<{ success: boolean; alwaysOnTop?: boolean }>;
    isAlwaysOnTop: () => Promise<boolean>;
  };

  // 
  theme: {
    getSystem: () => Promise<Theme>;
    onChange: (callback: (theme: Theme) => void) => () => void;
    onAppearanceChange?: (callback: (data: { key: string; value: unknown }) => void) => () => void;
  };

  // 
  dialog: {
    openFile: (options?: {
      title?: string;
      defaultPath?: string;
      filters?: FileFilter[];
      multiSelections?: boolean;
    }) => Promise<DialogResult>;

    saveFile: (options?: {
      title?: string;
      defaultPath?: string;
      filters?: FileFilter[];
    }) => Promise<DialogResult>;

    openFolder: (options?: {
      title?: string;
      defaultPath?: string;
      multiSelections?: boolean;
    }) => Promise<DialogResult>;

    showMessage: (options: MessageDialogOptions) => Promise<{
      success: boolean;
      response?: number;
      error?: string;
    }>;
  };

  //  
  fs: {
    readFile: (filePath: string) => Promise<{
      success: boolean;
      content?: string;
      error?: string;
    }>;

    writeFile: (filePath: string, content: string) => Promise<{
      success: boolean;
      error?: string;
    }>;

    exists: (filePath: string) => Promise<boolean>;

    readDir: (dirPath: string) => Promise<{
      success: boolean;
      files?: string[];
      error?: string;
    }>;
  };

  // Shell
  shell: {
    showItemInFolder: (filePath: string) => Promise<{ success: boolean }>;
    openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    openExternal: (url: string) => Promise<{ success: boolean }>;
  };

  // VSCode
  vscode: {
    isAvailable: () => Promise<{ available: boolean; autoDetected: boolean }>;
    openFile: (filePath: string) => Promise<{ success: boolean; error?: string; fallback?: boolean }>;
    openDiff: (originalPath: string, modifiedPath: string, title?: string) => Promise<{ success: boolean; error?: string; fallback?: boolean }>;
    openDiffWithContent: (data: {
      filePath: string;
      originalContent: string;
      newContent: string;
    }) => Promise<{ success: boolean; error?: string; fallback?: boolean }>;
    setPath: (vscodePath: string | null) => Promise<{ success: boolean; error?: string }>;
    getPath: () => Promise<{ path: string | null }>;
  };

  // PowerShell
  powershell: {
    startSession: () => Promise<{
      success: boolean;
      session?: SessionInfo;
      error?: string;
    }>;

    execute: (command: string) => Promise<PowerShellResult>;

    executeOnce: (command: string, cwd?: string) => Promise<PowerShellResult>;

    sendInput: (input: string) => Promise<{ success: boolean }>;

    interrupt: () => Promise<{ success: boolean }>;

    terminate: () => Promise<{ success: boolean }>;

    restart: () => Promise<{
      success: boolean;
      session?: SessionInfo;
      error?: string;
    }>;

    getSessionInfo: () => Promise<SessionInfo>;

    isRunning: () => Promise<boolean>;

    changeDirectory: (newPath: string) => Promise<{ success: boolean }>;

    getCurrentDirectory: () => Promise<{
      success: boolean;
      directory?: string;
    }>;

    onOutput: (callback: (output: PowerShellOutput) => void) => () => void;

    onExit: (callback: (event: PowerShellExitEvent) => void) => () => void;

    onError: (callback: (event: PowerShellErrorEvent) => void) => () => void;
  };

  // 
  log: {
    getFiles: () => Promise<LogFile[]>;

    readFile: (filePath: string) => Promise<{
      success: boolean;
      content?: string;
      error?: string;
    }>;

    openInExplorer: (filePath?: string) => Promise<{ success: boolean }>;

    openDirectory: () => Promise<{ success: boolean }>;

    setLevel: (level: number) => Promise<{ success: boolean }>;

    getLevel: () => Promise<number>;

    getCurrentPath: () => Promise<string>;
  };

  // 
  system: {
    info: () => Promise<SystemInfo>;
  };

  //  
  app: {
    restart: () => Promise<void>;
    quit: () => Promise<void>;
  };

  //  
  devTools: {
    toggle: () => Promise<{ success: boolean }>;
  };

  // Image (Vision )
  image: {
    saveFromClipboard: (base64: string, mimeType: string) => Promise<{
      success: boolean;
      filePath?: string;
      error?: string;
    }>;
    selectFile: () => Promise<{
      success: boolean;
      filePath?: string;
      error?: string;
    }>;
  };
}

// ============    ============

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Vite   
interface ImportMetaEnv {
  readonly VITE_DEV_SERVER_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
