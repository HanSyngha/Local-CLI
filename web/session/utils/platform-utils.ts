/**
 * Platform Utilities (Web Session — Linux only)
 *
 * Docker    native-linux
 */

// ===========================================================================
// Platform Types
// ===========================================================================

export type Platform = 'native-windows' | 'wsl' | 'native-linux';

// ===========================================================================
// Platform Detection (always Linux in Docker)
// ===========================================================================

/**
 * Always returns 'native-linux' in web session container
 */
export function getPlatform(): Platform {
  return 'native-linux';
}

/**
 * Always false in web session container
 */
export function isNativeWindows(): boolean {
  return false;
}

/**
 * Always false in web session container
 */
export function isWSL(): boolean {
  return false;
}

/**
 * Always true in web session container
 */
export function isNativeLinux(): boolean {
  return true;
}

/**
 * Always false in web session container (no Windows access)
 */
export function hasWindowsAccess(): boolean {
  return false;
}

// ===========================================================================
// Shell Configuration
// ===========================================================================

export interface ShellConfig {
  shell: string;
  args: (command: string) => string[];
}

/**
 * Always returns bash configuration in web session container
 */
export function getShellConfig(): ShellConfig {
  return {
    shell: '/bin/bash',
    args: (command: string) => ['-c', command],
  };
}

// ===========================================================================
// Dangerous Command Patterns
// ===========================================================================

/**
 * Bash dangerous command patterns
 */
export const BASH_DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\/(?:\s|$|\*)/i,
  /\brm\s+-rf\s+~(?:\/(?:\s|$|\*)|(?:\s|$))/i,
  /\brm\s+-rf\s+\*/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\b:(){ :|:& };:/,
  /\bchmod\s+-R\s+777\s+\//i,
  /\bsudo\s+rm/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bpoweroff\b/i,
];

/**
 * Check if a bash command is dangerous
 */
export function isDangerousBashCommand(command: string): boolean {
  return BASH_DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}
