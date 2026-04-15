/**
 * Context File Loader
 *
 * Reads `context.md` from the current working directory once per session.
 * The result is cached after the first read — subsequent calls return the
 * cached value without hitting the filesystem again.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';

// Cache: undefined = not yet loaded, null = loaded but absent/empty, string = content
let cachedContext: string | null | undefined = undefined;

/**
 * Load `context.md` from the current working directory.
 * Only reads the file once per session; subsequent calls return the cached value.
 *
 * @returns File contents if the file exists and is non-empty, otherwise null.
 */
export async function loadContextFile(): Promise<string | null> {
  if (cachedContext !== undefined) {
    return cachedContext;
  }

  const contextPath = path.join(process.cwd(), 'context.md');

  try {
    const content = await fs.readFile(contextPath, 'utf-8');
    const trimmed = content.trim();
    cachedContext = trimmed.length > 0 ? trimmed : null;

    if (cachedContext) {
      logger.info(`Loaded context file: ${contextPath} (${cachedContext.length} chars)`);
    }
  } catch {
    // File does not exist or is unreadable — treat as absent
    cachedContext = null;
  }

  return cachedContext;
}

/**
 * Reset the context cache (for testing or session resets).
 */
export function resetContextCache(): void {
  cachedContext = undefined;
}
