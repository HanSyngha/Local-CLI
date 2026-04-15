/**
 * LOCAL BOT Constants (Electron)
 *
 * CLI parity: src/constants.ts
 * Windows native paths used for Electron
 */

import * as path from 'path';
import * as os from 'os';

/**
 * LOCAL-CLI  
 * Windows: %USERPROFILE%\.local-cli\
 * Linux/WSL: ~/.local-cli/
 */
export const LOCAL_HOME_DIR = path.join(os.homedir(), '.local-cli');

// Backward compatibility alias
export const OPEN_HOME_DIR = LOCAL_HOME_DIR;

/**
 *   
 * ~/.local-cli/config.json
 */
export const CONFIG_FILE_PATH = path.join(LOCAL_HOME_DIR, 'config.json');

/**
 *  
 * ~/.local-cli/docs/
 */
export const DOCS_DIR = path.join(LOCAL_HOME_DIR, 'docs');

/**
 *  
 * ~/.local-cli/backups/
 */
export const BACKUPS_DIR = path.join(LOCAL_HOME_DIR, 'backups');

/**
 *   
 * ~/.local-cli/projects/
 */
export const PROJECTS_DIR = path.join(LOCAL_HOME_DIR, 'projects');


/**
 * Application version (injected from package.json)
 * CLI parity: src/constants.ts
 */
export const APP_VERSION = '5.3.20';

/**
 * CLI Server  (Electron ↔ CLI )
 */
export const CLI_SERVER_PORT = 19524;
