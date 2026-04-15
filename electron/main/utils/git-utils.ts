/**
 * Git Utils
 * Git   
 *
 * CLI parity: src/utils/git-utils.ts
 */

import * as fs from 'fs';
import * as path from 'path';

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
    if (parentDir === currentDir) {
      //   
      return false;
    }

    currentDir = parentDir;
  }
}
