/**
 * Git Utils
 * Git   
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 *       .git   
 * @param startDir    (: process.cwd())
 * @returns Git    
 */
export function detectGitRepo(startDir: string = process.cwd()): boolean {
  let currentDir = startDir;

  while (true) {
    if (fs.existsSync(path.join(currentDir, '.git'))) {
      return true;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) { // eslint-disable-line no-constant-condition
      //   
      return false;
    }

    currentDir = parentDir;
  }
}
