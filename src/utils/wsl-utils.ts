/**
 * WSL Utilities
 *
 * Utilities specific to WSL (Windows Subsystem for Linux) environment.
 * These are specialized functions for WSL networking and Windows interop.
 *
 * NOTE: For platform detection, use `platform-utils.ts` instead.
 * This file only contains WSL-specific networking utilities.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

/**
 * Check if WSL2 mirrored networking is enabled
 * With mirrored networking, localhost works directly
 */
export function isMirroredNetworking(): boolean {
  try {
    const winUser = execSync('whoami.exe 2>/dev/null', { encoding: 'utf-8' }).trim().split('\\').pop();
    const wslConfigPath = '/mnt/c/Users/' + winUser + '/.wslconfig';

    if (fs.existsSync(wslConfigPath)) {
      const content = fs.readFileSync(wslConfigPath, 'utf-8').toLowerCase();
      if (content.includes('networkingmode=mirrored')) {
        return true;
      }
    }
  } catch {
    // Ignore errors
  }
  return false;
}

/**
 * Get Windows host IP from WSL
 * Priority: WSL_HOST_IP env > mirrored networking > ip route > resolv.conf (172.x only)
 */
export function getWindowsHostIP(): string {
  try {
    // 1. Environment variable has highest priority (user override)
    if (process.env['WSL_HOST_IP']) {
      return process.env['WSL_HOST_IP'];
    }

    // 2. Mirrored networking uses localhost
    if (isMirroredNetworking()) {
      return '127.0.0.1';
    }

    // 3. Try ip route (more reliable than resolv.conf in corporate networks)
    try {
      const routeOutput = execSync('ip route show default 2>/dev/null', { encoding: 'utf-8' });
      const routeMatch = routeOutput.match(/via\s+(\d+\.\d+\.\d+\.\d+)/);
      if (routeMatch && routeMatch[1]) {
        const ip = routeMatch[1];
        // Only use if it looks like WSL2 NAT gateway (172.x.x.x or 192.168.x.x)
        if (ip.startsWith('172.') || ip.startsWith('192.168.')) {
          return ip;
        }
      }
    } catch {
      // Ignore ip route errors
    }

    // 4. Fall back to resolv.conf, but only if it's a WSL2 NAT IP (172.x.x.x)
    // Corporate networks often have custom DNS servers that are NOT the Windows host
    if (fs.existsSync('/etc/resolv.conf')) {
      const content = fs.readFileSync('/etc/resolv.conf', 'utf-8');
      const match = content.match(/nameserver\s+(\d+\.\d+\.\d+\.\d+)/);
      if (match && match[1] && match[1].startsWith('172.')) {
        return match[1];
      }
    }
  } catch {
    // Ignore errors
  }

  // 5. Default to localhost (works with mirrored networking or local server)
  return '127.0.0.1';
}

/**
 * @deprecated Use `getPowerShellPath()` from `platform-utils.ts` instead.
 *
 * Find powershell.exe path for WSL
 * Tries multiple locations since PATH may not include Windows System32
 */
export function findPowerShellPath(): string {
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
