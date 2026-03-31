/**
 * LOCAL BOT Constants (Electron)
 *
 * CLI parity: src/constants.ts
 * Windows native paths used for Electron
 */

import * as path from 'path';
import * as os from 'os';

/**
 * LOCAL-CLI 홈 디렉토리
 * Windows: %USERPROFILE%\.local-cli\
 * Linux/WSL: ~/.local-cli/
 */
export const LOCAL_HOME_DIR = path.join(os.homedir(), '.local-cli');

// Backward compatibility alias
export const OPEN_HOME_DIR = LOCAL_HOME_DIR;

/**
 * 설정 파일 경로
 * ~/.local-cli/config.json
 */
export const CONFIG_FILE_PATH = path.join(LOCAL_HOME_DIR, 'config.json');

/**
 * 문서 디렉토리
 * ~/.local-cli/docs/
 */
export const DOCS_DIR = path.join(LOCAL_HOME_DIR, 'docs');

/**
 * 백업 디렉토리
 * ~/.local-cli/backups/
 */
export const BACKUPS_DIR = path.join(LOCAL_HOME_DIR, 'backups');

/**
 * 프로젝트별 로그 디렉토리
 * ~/.local-cli/projects/
 */
export const PROJECTS_DIR = path.join(LOCAL_HOME_DIR, 'projects');


/**
 * Application version (injected from package.json)
 * CLI parity: src/constants.ts
 */
export const APP_VERSION = '5.3.14';

/**
 * CLI Server 포트 (Electron ↔ CLI 통신)
 */
export const CLI_SERVER_PORT = 19524;
