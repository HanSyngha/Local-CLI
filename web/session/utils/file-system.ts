/**
 * File System Utilities
 *
 *     
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);
const stat = promisify(fs.stat);

/**
 *   
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 *   
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 *   ()
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  const exists = await directoryExists(dirPath);
  if (!exists) {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * JSON  
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const exists = await fileExists(filePath);
    if (!exists) {
      return null;
    }

    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to read JSON file ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * JSON  
 */
export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  try {
    const dirPath = path.dirname(filePath);
    await ensureDirectory(dirPath);

    const content = JSON.stringify(data, null, 2);
    await writeFile(filePath, content, 'utf-8');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to write JSON file ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 *   
 */
export async function readTextFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to read text file ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 *   
 */
export async function writeTextFile(filePath: string, content: string): Promise<void> {
  try {
    const dirPath = path.dirname(filePath);
    await ensureDirectory(dirPath);

    await writeFile(filePath, content, 'utf-8');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to write text file ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 *    (bytes)
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await stat(filePath);
    return stats.size;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to get file size ${filePath}: ${error.message}`);
    }
    throw error;
  }
}
