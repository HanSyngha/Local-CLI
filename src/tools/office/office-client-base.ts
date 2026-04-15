/**
 * Office Client Base Class
 *
 * Common functionality for all Office automation clients.
 * Provides PowerShell execution and WSL path conversion.
 *
 * Office tools require Windows access (Native Windows or WSL)
 */

import { execSync, spawn } from 'node:child_process';
import { logger } from '../../utils/logger.js';
import {
  getPlatform,
  hasWindowsAccess,
  getPowerShellPath,
  Platform,
} from '../../utils/platform-utils.js';

export interface OfficeResponse {
  success: boolean;
  message?: string;
  error?: string;
  details?: string;
  [key: string]: unknown;
}

export interface ScreenshotResponse extends OfficeResponse {
  image?: string;
  format?: string;
  encoding?: string;
}

export class OfficeClientBase {
  protected platform: Platform;
  protected powerShellPath: string = '';
  protected commandTimeout: number = 30000; // 30 seconds
  /** COM ProgID for DisplayAlerts auto-suppression (set by subclass) */
  protected comProgId: string = '';
  /** Expression to suppress DisplayAlerts (overridden by subclass, e.g. PowerPoint needs enum) */
  protected displayAlertsSuppressExpr: string = '$false';

  constructor() {
    this.platform = getPlatform();

    // Office tools require Windows access
    if (!hasWindowsAccess()) {
      logger.warn('[OfficeClientBase] Office tools require Windows (Native or WSL)');
      this.powerShellPath = '';
    } else {
      this.powerShellPath = getPowerShellPath();
    }

    logger.debug('[OfficeClientBase] constructor: platform = ' + this.platform);
    logger.debug('[OfficeClientBase] constructor: PowerShell path = ' + this.powerShellPath);
  }

  /**
   * Encode text to Base64 for safe PowerShell transfer (handles Korean characters)
   */
  protected encodeTextForPowerShell(text: string): string {
    return Buffer.from(text, 'utf8').toString('base64');
  }

  /**
   * Generate PowerShell code to decode Base64 text
   */
  protected getPowerShellDecodeExpr(base64Text: string): string {
    return `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Text}'))`;
  }

  /**
   * Resolve relative path to absolute path
   */
  protected resolvePath(inputPath: string): string {
    // If already absolute, return as-is
    if (inputPath.startsWith('/') || /^[A-Za-z]:/.test(inputPath)) {
      return inputPath;
    }
    // Resolve relative path from current working directory
    const cwd = process.cwd();
    return `${cwd}/${inputPath}`;
  }

  /**
   * Convert path to Windows path (handles both Native Windows and WSL)
   */
  protected toWindowsPath(inputPath: string): string {
    // First resolve relative paths
    const resolvedPath = this.resolvePath(inputPath);

    // Native Windows - no conversion needed
    if (this.platform === 'native-windows') {
      return resolvedPath;
    }

    // WSL - convert Linux path to Windows path
    if (this.platform === 'wsl') {
      // Already a Windows path?
      if (/^[A-Za-z]:/.test(resolvedPath)) {
        return resolvedPath;
      }

      // /mnt/c/... -> C:\...
      const match = resolvedPath.match(/^\/mnt\/([a-z])\/(.*)$/i);
      if (match && match[1] && match[2]) {
        const drive = match[1].toUpperCase();
        const rest = match[2].replace(/\//g, '\\');
        return `${drive}:\\${rest}`;
      }

      // WSL internal paths (/home/..., /usr/..., etc) -> \\wsl$\<distro>\...
      try {
        const windowsPath = execSync(`wslpath -w "${resolvedPath}"`, { encoding: 'utf-8' }).trim();
        return windowsPath;
      } catch {
        return resolvedPath;
      }
    }

    // Native Linux - Office tools not supported
    throw new Error('Office tools require Windows (Native or WSL)');
  }

  /**
   * Execute PowerShell script and return JSON result (async, non-blocking)
   */
  protected async executePowerShell(script: string): Promise<OfficeResponse> {
    return new Promise((resolve) => {
      // Auto-suppress DisplayAlerts if comProgId is set (prevents blocking dialogs)
      // Uses try/finally so DisplayAlerts is restored even when script errors
      let actualScript = script;
      if (this.comProgId) {
        actualScript = `$__comApp = $null
try { $__comApp = [Runtime.InteropServices.Marshal]::GetActiveObject("${this.comProgId}"); $__savedDA = $__comApp.DisplayAlerts; $__comApp.DisplayAlerts = ${this.displayAlertsSuppressExpr} } catch {}
try {
${script}
} finally {
  if ($__comApp) { try { $__comApp.DisplayAlerts = $__savedDA } catch {} }
}`;
      }

      // Wrap script with JSON error handling and comprehensive UTF-8 encoding
      // This ensures Korean/CJK text is handled correctly
      const wrappedScript = `
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"
try {
${actualScript}
} catch {
  @{
    success = $false
    error = $_.Exception.Message
    details = $_.Exception.ToString()
  } | ConvertTo-Json -Compress
}
`;

      logger.debug('[OfficeClientBase] executePowerShell: executing script');

      // Use -EncodedCommand for Unicode support
      const encodedCommand = Buffer.from(wrappedScript, 'utf16le').toString('base64');

      // Use spawn instead of execSync for non-blocking execution
      const child = spawn(this.powerShellPath, [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodedCommand,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString('utf-8');
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      // Timeout handling
      const timeoutId = setTimeout(() => {
        child.kill();
        resolve({ success: false, error: 'PowerShell execution timed out' });
      }, this.commandTimeout);

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        if (code !== 0 && !stdout.trim()) {
          logger.debug('[OfficeClientBase] executePowerShell: error - ' + stderr);
          resolve({ success: false, error: stderr || `PowerShell exited with code ${code}` });
          return;
        }

        // Parse JSON output
        const trimmed = stdout.trim();
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed);
            resolve(parsed);
          } catch {
            // If not JSON, treat as success message
            resolve({ success: true, message: trimmed });
          }
        } else {
          resolve({ success: true });
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        logger.debug('[OfficeClientBase] executePowerShell: error - ' + error.message);
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * Check if Office COM is available (requires Windows access)
   */
  async isAvailable(): Promise<boolean> {
    // Office requires Windows access
    if (!hasWindowsAccess()) {
      return false;
    }

    try {
      const result = await this.executePowerShell(`
@{
  success = $true
  message = "PowerShell COM available"
} | ConvertTo-Json -Compress
`);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Convert hex color to RGB
   */
  protected hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result || !result[1] || !result[2] || !result[3]) return null;
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    };
  }
}
