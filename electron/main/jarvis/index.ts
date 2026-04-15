/**
 * Jarvis Module - barrel export
 *
 * NOTE: JarvisTray Electron main process dedicated (Tray, Menu, nativeImage ).
 * worker   electron-shim   barrel .
 * index.ts  import: import { JarvisTray } from './jarvis/jarvis-tray';
 */

export * from './jarvis-types';
export { JarvisService, jarvisService } from './jarvis-service';
export { JARVIS_SYSTEM_PROMPT, JARVIS_MANAGER_TOOLS, buildManagerUserPrompt } from './jarvis-prompts';
