/**
 * Platform Utilities
 *
 * Centralized platform detection for Hanseol
 * Supports: Native Windows, WSL, Native Linux
 */

import * as os from 'os';
import { execSync } from 'child_process';
import * as fs from 'fs';

// ===========================================================================
// Platform Types
// ===========================================================================

export type Platform = 'native-windows' | 'wsl' | 'native-linux';

// ===========================================================================
// Platform Detection (cached)
// ===========================================================================

let cachedPlatform: Platform | null = null;

/**
 * Detect the current platform
 * Results are cached for performance
 */
export function getPlatform(): Platform {
  if (cachedPlatform !== null) {
    return cachedPlatform;
  }

  // Native Windows: process.platform === 'win32'
  if (process.platform === 'win32') {
    cachedPlatform = 'native-windows';
    return cachedPlatform;
  }

  // WSL: os.release() contains 'microsoft' or 'wsl'
  try {
    const release = os.release().toLowerCase();
    if (release.includes('microsoft') || release.includes('wsl')) {
      cachedPlatform = 'wsl';
      return cachedPlatform;
    }
  } catch {
    // Ignore errors
  }

  // Native Linux (default for non-windows, non-wsl)
  cachedPlatform = 'native-linux';
  return cachedPlatform;
}

/**
 * Check if running on Native Windows
 */
export function isNativeWindows(): boolean {
  return getPlatform() === 'native-windows';
}

/**
 * Check if running on WSL
 */
export function isWSL(): boolean {
  return getPlatform() === 'wsl';
}

/**
 * Check if running on Native Linux
 */
export function isNativeLinux(): boolean {
  return getPlatform() === 'native-linux';
}

/**
 * Check if Windows access is available (Native Windows or WSL)
 * Used to determine Office/Browser tool availability
 */
export function hasWindowsAccess(): boolean {
  const platform = getPlatform();
  return platform === 'native-windows' || platform === 'wsl';
}

// ===========================================================================
// Shell Configuration
// ===========================================================================

export interface ShellConfig {
  shell: string;
  args: (command: string) => string[];
}

/**
 * Get the appropriate shell configuration for the current platform
 * Note: This is used internally, not for LLM tools
 */
export function getShellConfig(): ShellConfig {
  if (isNativeWindows()) {
    return {
      shell: 'powershell.exe',
      args: (command: string) => ['-NoProfile', '-Command', command],
    };
  }

  // WSL and Native Linux use bash
  return {
    shell: '/bin/bash',
    args: (command: string) => ['-c', command],
  };
}

// ===========================================================================
// Dangerous Command Patterns
// ===========================================================================

/**
 * Bash dangerous command patterns (WSL/Linux)
 */
export const BASH_DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\/(?:\s|$|\*)/i,   // rm -rf / or rm -rf /* (root only, allows /tmp/path)
  /\brm\s+-rf\s+~(?:\/(?:\s|$|\*)|(?:\s|$))/i, // rm -rf ~ or ~/ or ~/* (home only, allows ~/specific-dir)
  /\brm\s+-rf\s+\*/i,              // rm -rf *
  /\bdd\s+if=/i,                   // dd if=
  /\bmkfs\b/i,                     // mkfs
  /\b:(){ :|:& };:/,               // fork bomb
  /\bchmod\s+-R\s+777\s+\//i,      // chmod -R 777 /
  /\bsudo\s+rm/i,                  // sudo rm
  />\s*\/dev\/sd[a-z]/i,           // write to disk device
  /\bshutdown\b/i,                 // shutdown
  /\breboot\b/i,                   // reboot
  /\bhalt\b/i,                     // halt
  /\bpoweroff\b/i,                 // poweroff
];

/**
 * PowerShell dangerous command patterns (Native Windows)
 */
export const POWERSHELL_DANGEROUS_PATTERNS: RegExp[] = [
  // File system destruction
  /Remove-Item\s+.*-Recurse\s+.*-Force\s+[A-Z]:\\/i,
  /ri\s+.*-r\s+.*-fo\s+[A-Z]:\\/i,
  /Remove-Item\s+-Path\s+[A-Z]:\\\s+-Recurse/i,

  // Disk operations
  /\bFormat-Volume\b/i,
  /\bClear-Disk\b/i,
  /\bInitialize-Disk\b/i,
  /\bRemove-Partition\b/i,

  // System operations
  /\bStop-Computer\b/i,
  /\bRestart-Computer\b/i,
  /\bSet-ExecutionPolicy\s+Unrestricted/i,

  // Registry destruction
  /Remove-Item\s+.*HK[LCU]M:/i,
  /Remove-ItemProperty\s+.*HK[LCU]M:/i,

  // Critical process termination
  /Stop-Process\s+.*-Name\s+(svchost|csrss|wininit|lsass|services)/i,

  // Fork bomb equivalent
  /while\s*\(\$true\)\s*\{.*Start-Process/i,
  /for\s*\(\s*;\s*;\s*\)\s*\{.*Start-Process/i,
];

/**
 * Check if a bash command is dangerous
 */
export function isDangerousBashCommand(command: string): boolean {
  return BASH_DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

/**
 * Check if a PowerShell command is dangerous
 */
export function isDangerousPowerShellCommand(command: string): boolean {
  return POWERSHELL_DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

// ===========================================================================
// PowerShell Path Finding (for Native Windows)
// ===========================================================================

let cachedPowerShellPath: string | null = null;

/**
 * Find PowerShell executable path on Native Windows
 * Prefers pwsh.exe (PowerShell 7+) over powershell.exe (5.1)
 */
export function findNativePowerShellPath(): string {
  if (cachedPowerShellPath !== null) {
    return cachedPowerShellPath;
  }

  // Try pwsh.exe first (PowerShell 7+)
  try {
    execSync('pwsh -v', { stdio: 'ignore', timeout: 5000 });
    cachedPowerShellPath = 'pwsh';
    return cachedPowerShellPath;
  } catch {
    // pwsh not available
  }

  // Fallback to powershell.exe (5.1)
  cachedPowerShellPath = 'powershell.exe';
  return cachedPowerShellPath;
}

/**
 * Find PowerShell path for WSL (Windows PowerShell from Linux)
 * This is re-exported from wsl-utils for convenience
 */
export function findWSLPowerShellPath(): string {
  const possiblePaths = [
    'powershell.exe', // Try PATH first
    '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    '/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe',
    '/mnt/c/windows/system32/WindowsPowerShell/v1.0/powershell.exe',
  ];

  for (const psPath of possiblePaths) {
    try {
      if (psPath === 'powershell.exe') {
        // Check if powershell.exe is accessible by running a simple command
        execSync('powershell.exe -Command "1" 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
        return psPath;
      } else if (fs.existsSync(psPath)) {
        return psPath;
      }
    } catch {
      // Continue to next path
    }
  }

  // Fallback to powershell.exe and let the spawn error provide details
  return 'powershell.exe';
}

/**
 * Get PowerShell path based on platform
 */
export function getPowerShellPath(): string {
  const platform = getPlatform();

  if (platform === 'native-windows') {
    return findNativePowerShellPath();
  }

  if (platform === 'wsl') {
    return findWSLPowerShellPath();
  }

  // Native Linux - no PowerShell
  throw new Error('PowerShell is not available on Native Linux');
}

// ===========================================================================
// Windows User Desktop Path (for Office tool save paths)
// ===========================================================================

let cachedWindowsDesktopPath: string | null = null;

/**
 * Get the current Windows user's Desktop path.
 * Returns Windows-style path (e.g., "C:\Users\john\Desktop").
 * Returns null on native Linux where Windows is not available.
 */
export function getWindowsUserDesktopPath(): string | null {
  if (cachedWindowsDesktopPath !== null) return cachedWindowsDesktopPath;

  const platform = getPlatform();

  if (platform === 'native-windows') {
    // Native Windows: use USERPROFILE env
    const userProfile = process.env['USERPROFILE'];
    if (userProfile) {
      cachedWindowsDesktopPath = `${userProfile}\\Desktop`;
      return cachedWindowsDesktopPath;
    }
    return null;
  }

  if (platform === 'wsl') {
    // WSL: get Windows username via cmd.exe
    try {
      const result = execSync('cmd.exe /c echo %USERNAME% 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (result && !result.includes('%')) {
        cachedWindowsDesktopPath = `C:\\Users\\${result}\\Desktop`;
        return cachedWindowsDesktopPath;
      }
    } catch {
      // Fallback: try whoami.exe
      try {
        const whoami = execSync('whoami.exe 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }).trim();
        const username = whoami.split('\\').pop();
        if (username) {
          cachedWindowsDesktopPath = `C:\\Users\\${username}\\Desktop`;
          return cachedWindowsDesktopPath;
        }
      } catch {
        // No Windows access
      }
    }
  }

  return null;
}
