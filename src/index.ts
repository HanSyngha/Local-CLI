/**
 * LOCAL-CLI Main Export
 *
 *      .
 * CLI  src/cli.ts .
 */

import { createRequire } from 'module';

// Read version from package.json (single source of truth)
const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string; name: string };

export const version = packageJson.version;
export const name = packageJson.name;

/**
 *  API    export.
 */

// Placeholder for future exports
export {};
