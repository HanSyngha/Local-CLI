/**
 * Jarvis Tray -    +  
 *
 *   Jarvis  ,
 *   Jarvis  ,  ,   .
 */

import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';
import { logger } from '../utils/logger';
import type { JarvisStatus } from './jarvis-types';

// =============================================================================
// Tray Manager
// =============================================================================

export class JarvisTray {
  private tray: Tray | null = null;
  private status: JarvisStatus = 'idle';

  // Callbacks set by index.ts
  private onShowJarvisWindow: (() => void) | null = null;
  private onShowChatWindow: (() => void) | null = null;
  private onPollNow: (() => void) | null = null;
  private onDisableJarvis: (() => void) | null = null;
  private onQuit: (() => void) | null = null;

  constructor(callbacks: {
    onShowJarvisWindow: () => void;
    onShowChatWindow: () => void;
    onPollNow: () => void;
    onDisableJarvis: () => void;
    onQuit: () => void;
  }) {
    this.onShowJarvisWindow = callbacks.onShowJarvisWindow;
    this.onShowChatWindow = callbacks.onShowChatWindow;
    this.onPollNow = callbacks.onPollNow;
    this.onDisableJarvis = callbacks.onDisableJarvis;
    this.onQuit = callbacks.onQuit;
  }

  /**
   *   
   */
  create(): void {
    if (this.tray) return;

    // 16x16   (inline nativeImage —    )
    const icon = this.createTrayIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip(' ');

    this.updateContextMenu();

    //  → Jarvis  
    this.tray.on('double-click', () => {
      this.onShowJarvisWindow?.();
    });

    logger.info('[JarvisTray] Tray created');
  }

  /**
   *  
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
      logger.info('[JarvisTray] Tray destroyed');
    }
  }

  /**
   *  
   */
  setStatus(status: JarvisStatus): void {
    if (this.status !== status) {
      logger.info('[JarvisTray] Status changed', { from: this.status, to: status });
    }
    this.status = status;
    if (!this.tray) return;

    const tooltips: Record<JarvisStatus, string> = {
      idle: '  -  ',
      polling: '  -    ...',
      analyzing: '  -  ...',
      executing: '  - task  ...',
      waiting_user: '  -   ',
    };

    this.tray.setToolTip(tooltips[status] || ' ');
    this.updateContextMenu();
  }

  /**
   *    (Windows)
   */
  showBalloon(title: string, content: string): void {
    if (!this.tray) {
      logger.warn('[JarvisTray] showBalloon called but tray is null');
      return;
    }
    logger.info('[JarvisTray] Showing balloon', { title });
    this.tray.displayBalloon({
      title,
      content,
      iconType: 'info',
    });
  }

  /**
   *   
   */
  isCreated(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private updateContextMenu(): void {
    if (!this.tray) return;

    const statusLabels: Record<JarvisStatus, string> = {
      idle: '●  ',
      polling: '◉  ...',
      analyzing: '◉  ...',
      executing: '⚡  ...',
      waiting_user: '⏳  ',
    };

    const menu = Menu.buildFromTemplate([
      {
        label: ` ${statusLabels[this.status]}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: ' ',
        click: () => this.onShowJarvisWindow?.(),
      },
      {
        label: ' ',
        click: () => this.onShowChatWindow?.(),
      },
      { type: 'separator' },
      {
        label: '  ',
        click: () => this.onPollNow?.(),
        enabled: this.status === 'idle',
      },
      { type: 'separator' },
      {
        label: ' ',
        click: () => this.onDisableJarvis?.(),
      },
      {
        label: ' ',
        click: () => this.onQuit?.(),
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  /**
   * 16x16    (amber/gold  won)
   */
  private createTrayIcon(): Electron.NativeImage {
    //     ( Jarvis  Phase 3 )
    const appIcon = app.isPackaged
      ? path.join(process.resourcesPath, process.platform === 'win32' ? 'icon.ico' : 'icon.png')
      : path.join(__dirname, '../../../build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

    try {
      const icon = nativeImage.createFromPath(appIcon).resize({ width: 16, height: 16 });
      logger.info('[JarvisTray] Tray icon loaded', { path: appIcon, isEmpty: icon.isEmpty() });
      return icon;
    } catch (err) {
      logger.warn('[JarvisTray] Failed to load tray icon, using fallback', { path: appIcon, error: String(err) });
      return nativeImage.createEmpty();
    }
  }
}
