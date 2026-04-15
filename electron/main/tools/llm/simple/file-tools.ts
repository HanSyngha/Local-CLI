/**
 * File System Tools (LLM Simple)
 *
 * LLM      
 * CLI parity: src/tools/llm/simple/file-tools.ts
 *
 * Category: LLM Simple Tools - LLM tool_call , Sub-LLM 
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ToolDefinition } from '../../../core';
import type { LLMSimpleTool, ToolResult, ToolCategory } from '../../types';
import { sendFileEditEvent, sendFileCreateEvent } from '../../../ipc-handlers';
import { logger } from '../../../utils/logger';
import { reportError } from '../../../core/telemetry/error-reporter';

/**
 * Delay execution for specified milliseconds
 * @param ms - Milliseconds to wait
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Standard delay for file open operations (3 seconds)
 * This gives VSCode time to fully open the file before LLM proceeds
 */
const FILE_OPEN_DELAY_MS = 3000;

/**
 * Smart unescape for file content from LLM tool calls.
 *
 * Problem: Some LLMs double-escape content, sending \\n instead of \n in JSON.
 * After JSON.parse, this becomes literal \n (two chars) instead of actual newlines.
 *
 * The old unescapeContent() blindly converted ALL \n → newline, which broke
 * source code containing string literals like "\n", f"\n", '\t' etc.
 *
 * Strategy:
 * - If content already has actual newlines → JSON parsing worked → don't touch
 * - If NO actual newlines exist → double-escaped → unescape, but PROTECT
 *   double-backslash sequences (\\n, \\t) that represent source code literals
 */
function smartUnescapeContent(content: string): string {
  if (!content) return content;

  // If content already has actual newlines, JSON parsing worked correctly
  if (content.includes('\n')) return content;

  // No actual newlines. Check for literal escape sequences.
  if (!content.includes('\\n') && !content.includes('\\t') && !content.includes('\\r')) {
    return content;
  }

  // Step 1: Protect double-backslash sequences (\\n → source code "\n")
  let result = content;
  result = result.replace(/\\\\n/g, '\x00ESC_N\x00');
  result = result.replace(/\\\\t/g, '\x00ESC_T\x00');
  result = result.replace(/\\\\r/g, '\x00ESC_R\x00');

  // Step 2: Convert single-backslash escape sequences to actual characters
  result = result.replace(/\\n/g, '\n');
  result = result.replace(/\\t/g, '\t');
  result = result.replace(/\\r/g, '\r');

  // Step 3: Restore protected sequences as literal escape chars
  result = result.replace(/\x00ESC_N\x00/g, '\\n');
  result = result.replace(/\x00ESC_T\x00/g, '\\t');
  result = result.replace(/\x00ESC_R\x00/g, '\\r');

  return result;
}

// =============================================================================
// Constants
// =============================================================================

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'coverage',
  '.cache',
  'build',
  '__pycache__',
]);
const MAX_DEPTH = 5;
const MAX_FILES = 100;
const DEFAULT_LINE_LIMIT = 2000;
const MAX_LINE_LIMIT = 10000;

// Core tool categories
const CORE_CATEGORIES: ToolCategory[] = ['llm-simple'];

// =============================================================================
// Working Directory Management
// =============================================================================

// Portable/      :   fallback
function getSafeInitialCwd(): string {
  const cwd = process.cwd();
  const lower = cwd.toLowerCase();
  const tempDir = (process.env.TEMP || process.env.TMP || os.tmpdir()).toLowerCase();
  if (
    (tempDir && lower.startsWith(tempDir)) ||
    lower.includes('\\appdata\\local\\temp\\') ||
    lower.includes('\\program files\\') ||
    lower.includes('\\program files (x86)\\') ||
    lower.includes('\\windows\\') ||
    lower.includes('\\system32\\')
  ) {
    return os.homedir();
  }
  return cwd;
}
let currentWorkingDirectory: string = getSafeInitialCwd();

export function setWorkingDirectory(dir: string): void {
  currentWorkingDirectory = dir;
}

export function getWorkingDirectory(): string {
  return currentWorkingDirectory;
}

function resolvePath(filePath: string): string {
  const cleanPath = filePath.startsWith('@') ? filePath.slice(1) : filePath;
  if (path.isAbsolute(cleanPath)) {
    return cleanPath;
  }
  return path.resolve(currentWorkingDirectory, cleanPath);
}

// =============================================================================
// Utility Functions
// =============================================================================

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.ps1': 'powershell',
    '.json': 'json',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.xml': 'xml',
    '.sh': 'bash',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
  };
  return langMap[ext] || 'plaintext';
}

function formatWithLineNumbers(content: string, startLine: number = 1): string {
  const lines = content.split('\n');
  const totalDigits = String(startLine + lines.length - 1).length;
  return lines
    .map((line, idx) => {
      const lineNum = startLine + idx;
      return `${String(lineNum).padStart(totalDigits)}→${line}`;
    })
    .join('\n');
}

// =============================================================================
// read_file Tool
// =============================================================================

const READ_FILE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: `Read the contents of a file. Only text files are supported.
By default, reads up to ${DEFAULT_LINE_LIMIT} lines. Use offset/limit for large files.`,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: `A natural, conversational explanation for the user about what you're doing.
Write as if you're talking to the user directly. Use the same language as the user.
Examples:
- "Checking how the current authentication logic is implemented"
- "Opening the file where the error occurred to find the problem"
- "Checking package.json to understand the project setup"
- "Looking at the existing code before making changes"`,
        },
        file_path: {
          type: 'string',
          description: 'Absolute or relative path of the file to read',
        },
        offset: {
          type: 'number',
          description: 'Starting line number (1-based, default: 1)',
        },
        limit: {
          type: 'number',
          description: `Number of lines to read (default: ${DEFAULT_LINE_LIMIT}, max: ${MAX_LINE_LIMIT})`,
        },
      },
      required: ['reason', 'file_path'],
    },
  },
};

async function executeReadFile(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args['file_path'] as string;
  const offset = Math.max(1, (args['offset'] as number) || 1);
  const limit = Math.min(MAX_LINE_LIMIT, Math.max(1, (args['limit'] as number) || DEFAULT_LINE_LIMIT));

  logger.toolStart('read_file', args);

  try {
    const resolvedPath = resolvePath(filePath);
    const content = await fs.readFile(resolvedPath, 'utf-8');

    const allLines = content.split('\n');
    const totalLines = allLines.length;
    const startIdx = offset - 1;
    const endIdx = Math.min(startIdx + limit, totalLines);
    const selectedLines = allLines.slice(startIdx, endIdx);

    const formattedContent = formatWithLineNumbers(selectedLines.join('\n'), offset);

    let result = formattedContent;

    if (totalLines > limit || offset > 1) {
      const header = `[File: ${filePath} | Lines ${offset}-${endIdx} of ${totalLines}]`;
      const hasMore = endIdx < totalLines;
      const footer = hasMore
        ? `\n[... ${totalLines - endIdx} more lines. Use offset=${endIdx + 1} to continue reading]`
        : '';
      result = `${header}\n${result}${footer}`;
    }

    logger.toolSuccess('read_file', args, { linesRead: selectedLines.length, totalLines }, 0);
    return { success: true, result };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger.toolError('read_file', args, err, 0);
    reportError(error, { type: 'toolExecution', tool: 'read_file' }).catch(() => {});
    if (err.code === 'ENOENT') {
      return { success: false, error: `File not found: ${filePath}` };
    } else if (err.code === 'EACCES') {
      return { success: false, error: `Permission denied reading file: ${filePath}` };
    }
    return { success: false, error: `Failed to read file: ${err.message}` };
  }
}

export const readFileTool: LLMSimpleTool = {
  definition: READ_FILE_DEFINITION,
  execute: executeReadFile,
  categories: CORE_CATEGORIES,
  description: 'Read file contents',
};

// =============================================================================
// create_file Tool
// =============================================================================

const CREATE_FILE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_file',
    description: `Create a NEW file with the given content.
IMPORTANT: Only use this for files that do NOT exist yet.
For modifying existing files, use edit_file instead.
If the file already exists, this tool will fail.`,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: `A natural, conversational explanation for the user about what you're doing.
Write as if you're talking to the user directly. Use the same language as the user.
Examples:
- "Creating the main entry file for the application"
- "Creating a configuration file for the build process"
- "Creating a test file for the new feature"`,
        },
        file_path: {
          type: 'string',
          description: 'Absolute or relative path of the new file to create',
        },
        content: {
          type: 'string',
          description: 'Content to write to the new file',
        },
      },
      required: ['reason', 'file_path', 'content'],
    },
  },
};

async function executeCreateFile(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args['file_path'] as string;
  // Smart unescape: fixes double-escaped \n from LLM while preserving source code literals
  const content = smartUnescapeContent(args['content'] as string);

  logger.toolStart('create_file', { file_path: filePath, contentLength: content?.length || 0 });

  try {
    const resolvedPath = resolvePath(filePath);

    try {
      await fs.access(resolvedPath);
      logger.warn('create_file failed - file already exists', { filePath });
      return {
        success: false,
        error: `File already exists: ${filePath}. Use edit_file to modify existing files.`,
      };
    } catch {
      // File doesn't exist - good
    }

    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(resolvedPath, content, 'utf-8');

    const lines = content.split('\n').length;
    const language = detectLanguage(filePath);

    // Emit file create event for diff view
    try {
      sendFileCreateEvent({
        path: resolvedPath,
        content,
        language,
      });
      // Wait for VSCode to fully open the file before LLM proceeds
      await delay(FILE_OPEN_DELAY_MS);
    } catch {
      // Silently ignore event emission errors
    }

    logger.toolSuccess('create_file', args, { file: filePath, lines }, 0);
    return {
      success: true,
      result: JSON.stringify({
        action: 'created',
        file: filePath,
        lines,
        message: `Created ${filePath} (${lines} lines)`,
      }),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger.toolError('create_file', args, err, 0);
    reportError(error, { type: 'toolExecution', tool: 'create_file' }).catch(() => {});
    return { success: false, error: `Failed to create file (${filePath}): ${err.message}` };
  }
}

export const createFileTool: LLMSimpleTool = {
  definition: CREATE_FILE_DEFINITION,
  execute: executeCreateFile,
  categories: CORE_CATEGORIES,
  description: 'Create a new file',
};

// =============================================================================
// edit_file Tool
// =============================================================================

const EDIT_FILE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'edit_file',
    description: `Edit an EXISTING file by replacing a specific text block.
IMPORTANT: Only use this for files that already exist. For new files, use create_file.

HOW TO USE:
1. First use read_file to see the current content
2. Copy the EXACT text block you want to change (can be multiple lines)
3. Provide old_string (text to find) and new_string (replacement)

RULES:
- old_string must match EXACTLY (including whitespace and indentation)
- old_string must be UNIQUE in the file (if it appears multiple times, use replace_all: true)
- Both old_string and new_string can be multi-line
- To delete text, use empty string "" for new_string

EXAMPLES:
1. Change a single line:
   old_string: "const x = 1;"
   new_string: "const x = 2;"

2. Change multiple lines at once:
   old_string: "function foo() {\\n  return 1;\\n}"
   new_string: "function foo() {\\n  return 2;\\n}"

3. Delete a line:
   old_string: "// delete this line\\n"
   new_string: ""

4. Replace all occurrences:
   old_string: "oldName"
   new_string: "newName"
   replace_all: true`,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: `A natural, conversational explanation for the user about what you're doing.
Write as if you're talking to the user directly. Use the same language as the user.
Examples:
- "Updating the function to handle the new edge case"
- "Adding error handling to the API call"
- "Fixing the typo in the configuration"`,
        },
        file_path: {
          type: 'string',
          description: 'Absolute or relative path of the existing file to edit',
        },
        old_string: {
          type: 'string',
          description: 'The exact text to find and replace',
        },
        new_string: {
          type: 'string',
          description: 'The new text to replace with',
        },
        replace_all: {
          type: 'boolean',
          description: 'If true, replace ALL occurrences of old_string',
        },
      },
      required: ['reason', 'file_path', 'old_string', 'new_string'],
    },
  },
};

async function executeEditFile(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args['file_path'] as string;
  // Smart unescape: fixes double-escaped \n from LLM while preserving source code literals
  const oldString = smartUnescapeContent(args['old_string'] as string);
  const newString = smartUnescapeContent(args['new_string'] as string);
  const replaceAll = args['replace_all'] as boolean | undefined;

  const oldStringLength = oldString?.length || 0;
  const newStringLength = newString?.length || 0;
  logger.toolStart('edit_file', { file_path: filePath, oldStringLength, newStringLength, replaceAll });

  try {
    const resolvedPath = resolvePath(filePath);

    if (!oldString) {
      logger.warn('edit_file failed - old_string empty', { filePath });
      return { success: false, error: 'old_string cannot be empty.' };
    }

    try {
      await fs.access(resolvedPath);
    } catch {
      logger.warn('edit_file failed - file does not exist', { filePath });
      return {
        success: false,
        error: `File does not exist: ${filePath}. Use create_file to create new files.`,
      };
    }

    const originalContent = await fs.readFile(resolvedPath, 'utf-8');

    // Normalize line endings: match old_string/new_string to the file's style
    const hasCRLF = originalContent.includes('\r\n');
    let normalizedOldString = oldString;
    let normalizedNewString = newString;
    if (hasCRLF && !oldString.includes('\r\n')) {
      normalizedOldString = oldString.replace(/\n/g, '\r\n');
      normalizedNewString = newString.replace(/\n/g, '\r\n');
    } else if (!hasCRLF && oldString.includes('\r\n')) {
      normalizedOldString = oldString.replace(/\r\n/g, '\n');
      normalizedNewString = newString.replace(/\r\n/g, '\n');
    }

    if (!originalContent.includes(normalizedOldString)) {
      const lines = originalContent.split('\n');
      const preview = lines.slice(0, 20).map((l, i) => `${i + 1}: ${l}`).join('\n');
      logger.warn('edit_file failed - old_string not found', { filePath });
      return {
        success: false,
        error: `old_string not found in file.\n\nSearched for:\n"${oldString.slice(0, 200)}${oldString.length > 200 ? '...' : ''}"\n\nFile preview (first 20 lines):\n${preview}\n\nUse read_file to check the exact content and try again.`,
      };
    }

    const occurrences = originalContent.split(normalizedOldString).length - 1;

    if (!replaceAll && occurrences > 1) {
      // Find line numbers for each occurrence
      const fileLines = originalContent.split('\n');
      const occurrenceLineNums: number[] = [];
      let searchFrom = 0;
      for (let i = 0; i < occurrences; i++) {
        const idx = originalContent.indexOf(normalizedOldString, searchFrom);
        if (idx === -1) break;
        const lineNum = originalContent.substring(0, idx).split('\n').length;
        occurrenceLineNums.push(lineNum);
        searchFrom = idx + 1;
      }

      // Build context preview (max 5 to keep message concise)
      const maxPreview = 5;
      const occurrenceDetails = occurrenceLineNums
        .slice(0, maxPreview)
        .map((lineNum, i) => {
          const ctxStart = Math.max(0, lineNum - 2);
          const ctxEnd = Math.min(fileLines.length, lineNum + 1);
          const ctxLines = fileLines
            .slice(ctxStart, ctxEnd)
            .map((l, j) => {
              const num = ctxStart + j + 1;
              const marker = num === lineNum ? '>>' : '  ';
              const trimmed = l.trimEnd();
              const display = trimmed.length > 120 ? trimmed.substring(0, 120) + '...' : trimmed;
              return `    ${marker} ${num}: ${display}`;
            })
            .join('\n');
          return `  #${i + 1} (line ${lineNum}):\n${ctxLines}`;
        })
        .join('\n\n');

      const linesList = occurrenceLineNums.join(', ');
      const truncNote =
        occurrences > maxPreview ? `\n\n  ... and ${occurrences - maxPreview} more occurrences.` : '';

      logger.warn('edit_file failed - multiple occurrences', {
        filePath,
        occurrences,
        lines: occurrenceLineNums,
      });
      return {
        success: false,
        error: `old_string appears ${occurrences} times in the file (at lines ${linesList}). Make old_string more specific by including surrounding lines for unique context, or use replace_all: true.\n\nOccurrences:\n${occurrenceDetails}${truncNote}`,
      };
    }

    // Perform replacement (using normalized strings to preserve file's line ending style)
    let newContent: string;
    if (replaceAll) {
      newContent = originalContent.split(normalizedOldString).join(normalizedNewString);
    } else {
      newContent = originalContent.replace(normalizedOldString, normalizedNewString);
    }

    await fs.writeFile(resolvedPath, newContent, 'utf-8');

    const oldLinesArr = oldString.split('\n');
    const newLinesArr = newString.split('\n');
    const replacements = replaceAll ? occurrences : 1;
    const language = detectLanguage(filePath);

    // Emit file edit event for diff view
    try {
      sendFileEditEvent({
        path: resolvedPath,
        originalContent,
        newContent,
        language,
      });
      // Wait for VSCode to fully open the file before LLM proceeds
      await delay(FILE_OPEN_DELAY_MS);
    } catch {
      // Silently ignore event emission errors
    }

    const diffPreview: string[] = [];
    const oldPreview = oldLinesArr.slice(0, 5);
    const newPreview = newLinesArr.slice(0, 5);

    oldPreview.forEach((line) => diffPreview.push(`- ${line}`));
    if (oldLinesArr.length > 5) diffPreview.push('- ...');
    newPreview.forEach((line) => diffPreview.push(`+ ${line}`));
    if (newLinesArr.length > 5) diffPreview.push('+ ...');

    logger.toolSuccess('edit_file', args, { file: filePath, replacements, oldLines: oldLinesArr.length, newLines: newLinesArr.length }, 0);
    return {
      success: true,
      result: JSON.stringify({
        action: 'edited',
        file: filePath,
        replacements,
        oldLines: oldLinesArr.length,
        newLines: newLinesArr.length,
        message: replaceAll
          ? `Replaced ${replacements} occurrence(s) in ${filePath}`
          : `Updated ${filePath}`,
        diff: diffPreview,
      }),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger.toolError('edit_file', args, err, 0);
    reportError(error, { type: 'toolExecution', tool: 'edit_file' }).catch(() => {});
    return { success: false, error: `File edit failed (${filePath}): ${err.message}` };
  }
}

export const editFileTool: LLMSimpleTool = {
  definition: EDIT_FILE_DEFINITION,
  execute: executeEditFile,
  categories: CORE_CATEGORIES,
  description: 'Edit an existing file',
};

// =============================================================================
// list_files Tool
// =============================================================================

const LIST_FILES_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_files',
    description: 'List files and folders in a directory.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: `A natural, conversational explanation for the user about what you're doing.
Write as if you're talking to the user directly. Use the same language as the user.
Examples:
- "Checking what files are in the project root"
- "Looking at the structure of the src folder"
- "Finding all configuration files"`,
        },
        directory_path: {
          type: 'string',
          description: 'Directory path to list (default: current directory)',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list subdirectories recursively (default: false)',
        },
      },
      required: ['reason'],
    },
  },
};

async function getFilesRecursively(
  dirPath: string,
  baseDir: string = dirPath,
  depth: number = 0,
  fileCount: { count: number } = { count: 0 }
): Promise<Array<{ name: string; type: string; path: string }>> {
  if (depth > MAX_DEPTH || fileCount.count >= MAX_FILES) {
    return [];
  }

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: Array<{ name: string; type: string; path: string }> = [];

  for (const entry of entries) {
    if (fileCount.count >= MAX_FILES) break;

    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;

      files.push({ name: entry.name, type: 'directory', path: relativePath });
      fileCount.count++;

      const subFiles = await getFilesRecursively(fullPath, baseDir, depth + 1, fileCount);
      files.push(...subFiles);
    } else {
      files.push({ name: entry.name, type: 'file', path: relativePath });
      fileCount.count++;
    }
  }

  return files;
}

async function executeListFiles(args: Record<string, unknown>): Promise<ToolResult> {
  const directoryPath = (args['directory_path'] as string) || '.';
  const recursive = (args['recursive'] as boolean) || false;

  logger.toolStart('list_files', { directory_path: directoryPath, recursive });

  try {
    const resolvedPath = resolvePath(directoryPath);

    if (recursive) {
      const files = await getFilesRecursively(resolvedPath);
      logger.toolSuccess('list_files', args, { fileCount: files.length }, 0);
      return { success: true, result: JSON.stringify(files, null, 2) };
    } else {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const files = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        path: path.join(directoryPath, entry.name),
      }));
      logger.toolSuccess('list_files', args, { fileCount: files.length }, 0);
      return { success: true, result: JSON.stringify(files, null, 2) };
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger.toolError('list_files', args, err, 0);
    reportError(error, { type: 'toolExecution', tool: 'list_files' }).catch(() => {});
    if (err.code === 'ENOENT') {
      return { success: false, error: `Directory not found: ${directoryPath}` };
    }
    return { success: false, error: `Failed to read directory: ${err.message}` };
  }
}

export const listFilesTool: LLMSimpleTool = {
  definition: LIST_FILES_DEFINITION,
  execute: executeListFiles,
  categories: CORE_CATEGORIES,
  description: 'List directory contents',
};

// =============================================================================
// find_files Tool
// =============================================================================

const FIND_FILES_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'find_files',
    description: 'Search for files by filename pattern.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: `A natural, conversational explanation for the user about what you're doing.
Write as if you're talking to the user directly. Use the same language as the user.
Examples:
- "Finding all TypeScript files in the project"
- "Looking for configuration files"
- "Searching for test files"`,
        },
        pattern: {
          type: 'string',
          description: 'Filename pattern to search for (e.g., *.ts, package.json)',
        },
        directory_path: {
          type: 'string',
          description: 'Directory path to start search from (default: current directory)',
        },
      },
      required: ['reason', 'pattern'],
    },
  },
};

async function findFilesRecursively(
  dirPath: string,
  regex: RegExp,
  baseDir: string,
  depth: number = 0,
  fileCount: { count: number } = { count: 0 }
): Promise<Array<{ name: string; path: string }>> {
  if (depth > MAX_DEPTH || fileCount.count >= MAX_FILES) {
    return [];
  }

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const matchedFiles: Array<{ name: string; path: string }> = [];

  for (const entry of entries) {
    if (fileCount.count >= MAX_FILES) break;

    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;

      const subFiles = await findFilesRecursively(fullPath, regex, baseDir, depth + 1, fileCount);
      matchedFiles.push(...subFiles);
    } else if (regex.test(entry.name)) {
      const relativePath = path.relative(baseDir, fullPath);
      matchedFiles.push({ name: entry.name, path: relativePath });
      fileCount.count++;
    }
  }

  return matchedFiles;
}

async function executeFindFiles(args: Record<string, unknown>): Promise<ToolResult> {
  const pattern = args['pattern'] as string;
  const directoryPath = (args['directory_path'] as string) || '.';

  logger.toolStart('find_files', { pattern, directory_path: directoryPath });

  try {
    const resolvedPath = resolvePath(directoryPath);

    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`, 'i');

    const matchedFiles = await findFilesRecursively(resolvedPath, regex, resolvedPath);

    logger.toolSuccess('find_files', args, { matchedCount: matchedFiles.length }, 0);

    if (matchedFiles.length === 0) {
      return { success: true, result: `No files found matching pattern "${pattern}".` };
    }

    return { success: true, result: JSON.stringify(matchedFiles, null, 2) };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger.toolError('find_files', args, err, 0);
    reportError(error, { type: 'toolExecution', tool: 'find_files' }).catch(() => {});
    return { success: false, error: `File search failed: ${err.message}` };
  }
}

export const findFilesTool: LLMSimpleTool = {
  definition: FIND_FILES_DEFINITION,
  execute: executeFindFiles,
  categories: CORE_CATEGORIES,
  description: 'Search files by pattern',
};

// =============================================================================
// search_content Tool
// =============================================================================

const SEARCH_CONTENT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_content',
    description: 'Search for text pattern inside files.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: `A natural, conversational explanation for the user about what you're doing.
Write as if you're talking to the user directly. Use the same language as the user.
Examples:
- "Searching for usages of the function"
- "Finding where the error message is defined"
- "Looking for references to the API endpoint"`,
        },
        pattern: {
          type: 'string',
          description: 'Text or regex pattern to search for',
        },
        directory_path: {
          type: 'string',
          description: 'Directory path to search in (default: current directory)',
        },
        file_pattern: {
          type: 'string',
          description: 'File pattern to filter (e.g., *.ts)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
        },
      },
      required: ['reason', 'pattern'],
    },
  },
};

const TEXT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.scss',
  '.html', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.ps1', '.py', '.rb', '.go', '.rs', '.java', '.c',
  '.cpp', '.h', '.hpp', '.cs', '.php', '.vue', '.svelte',
];

async function searchContentRecursively(
  dirPath: string,
  searchRegex: RegExp,
  baseDir: string,
  fileRegex: RegExp | null,
  resultCount: { count: number },
  maxResults: number,
  depth: number = 0
): Promise<Array<{ file: string; line: number; content: string }>> {
  if (depth > MAX_DEPTH || resultCount.count >= maxResults) {
    return [];
  }

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: Array<{ file: string; line: number; content: string }> = [];

  for (const entry of entries) {
    if (resultCount.count >= maxResults) break;

    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;

      const subResults = await searchContentRecursively(
        fullPath, searchRegex, baseDir, fileRegex, resultCount, maxResults, depth + 1
      );
      results.push(...subResults);
    } else {
      if (fileRegex && !fileRegex.test(entry.name)) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.includes(ext)) continue;

      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        const relativePath = path.relative(baseDir, fullPath);

        for (let i = 0; i < lines.length && resultCount.count < maxResults; i++) {
          if (searchRegex.test(lines[i])) {
            results.push({
              file: relativePath,
              line: i + 1,
              content: lines[i].trim().substring(0, 200),
            });
            resultCount.count++;
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }
  }

  return results;
}

async function executeSearchContent(args: Record<string, unknown>): Promise<ToolResult> {
  const pattern = args['pattern'] as string;
  const directoryPath = (args['directory_path'] as string) || '.';
  const filePattern = args['file_pattern'] as string | undefined;
  const maxResults = (args['max_results'] as number) || 50;

  logger.toolStart('search_content', { pattern, directory_path: directoryPath, file_pattern: filePattern, maxResults });

  try {
    const resolvedPath = resolvePath(directoryPath);
    const searchRegex = new RegExp(pattern, 'gi');

    let fileRegex: RegExp | null = null;
    if (filePattern) {
      const regexPattern = filePattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      fileRegex = new RegExp(`^${regexPattern}$`, 'i');
    }

    const results = await searchContentRecursively(
      resolvedPath, searchRegex, resolvedPath, fileRegex, { count: 0 }, maxResults
    );

    logger.toolSuccess('search_content', args, { matchedCount: results.length }, 0);

    if (results.length === 0) {
      return { success: true, result: `No matches found for pattern "${pattern}".` };
    }

    return { success: true, result: JSON.stringify(results, null, 2) };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger.toolError('search_content', args, err, 0);
    reportError(error, { type: 'toolExecution', tool: 'search_content' }).catch(() => {});
    return { success: false, error: `Content search failed: ${err.message}` };
  }
}

export const searchContentTool: LLMSimpleTool = {
  definition: SEARCH_CONTENT_DEFINITION,
  execute: executeSearchContent,
  categories: CORE_CATEGORIES,
  description: 'Search content in files',
};

// =============================================================================
// Export All File Tools
// =============================================================================

export const FILE_TOOLS: LLMSimpleTool[] = [
  readFileTool,
  createFileTool,
  editFileTool,
  listFilesTool,
  findFilesTool,
  searchContentTool,
];

/**
 * System tools (used by file operations)
 * CLI parity: SYSTEM_TOOLS is also exported for compatibility
 */
export const SYSTEM_TOOLS: LLMSimpleTool[] = [];
