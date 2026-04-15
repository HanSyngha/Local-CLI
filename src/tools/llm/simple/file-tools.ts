/**
 * File System Tools (LLM Simple)
 *
 * LLM      
 * Category: LLM Simple Tools - LLM tool_call , Sub-LLM 
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ToolDefinition } from '../../../types/index.js';
import { LLMSimpleTool, ToolResult, ToolCategory } from '../../types.js';
import { logger } from '../../../utils/logger.js';
import { reportError } from '../../../core/telemetry/error-reporter.js';

/**
 * Smart unescape for file content from LLM tool calls.
 *
 * Problem: Some LLMs double-escape content, sending \\n instead of \n in JSON.
 * After JSON.parse, this becomes literal \n (two chars) instead of actual newlines.
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

// Safety limits
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

// Read file limits (Claude Code style)
const DEFAULT_LINE_LIMIT = 2000;
const MAX_LINE_LIMIT = 10000;

/**
 * read_file Tool Definition
 */
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

/**
 * Internal: Execute read_file
 * Supports offset/limit for reading portions of large files (Claude Code style)
 */
async function _executeReadFile(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args['file_path'] as string;
  const offset = Math.max(1, (args['offset'] as number) || 1);  // 1-based, default 1
  const limit = Math.min(MAX_LINE_LIMIT, Math.max(1, (args['limit'] as number) || DEFAULT_LINE_LIMIT));

  logger.toolStart('read_file', args);

  try {
    // Remove @ prefix if present
    const cleanPath = filePath.startsWith('@') ? filePath.slice(1) : filePath;
    const resolvedPath = path.resolve(cleanPath);
    const displayPath = filePath.startsWith('@') ? filePath.slice(1) : filePath;
    const content = await fs.readFile(resolvedPath, 'utf-8');

    // Split into lines and apply offset/limit
    const allLines = content.split('\n');
    const totalLines = allLines.length;
    const startIdx = offset - 1;  // Convert to 0-based
    const endIdx = Math.min(startIdx + limit, totalLines);
    const selectedLines = allLines.slice(startIdx, endIdx);

    // Format with line numbers (Claude Code style: "   1→content")
    const formattedLines = selectedLines.map((line, idx) => {
      const lineNum = startIdx + idx + 1;
      const padding = String(totalLines).length;
      return `${String(lineNum).padStart(padding)}→${line}`;
    });

    let result = formattedLines.join('\n');

    // Add info header if file is larger than what we're showing
    if (totalLines > limit || offset > 1) {
      const header = `[File: ${displayPath} | Lines ${offset}-${endIdx} of ${totalLines}]`;
      const hasMore = endIdx < totalLines;
      const footer = hasMore
        ? `\n[... ${totalLines - endIdx} more lines. Use offset=${endIdx + 1} to continue reading]`
        : '';
      result = `${header}\n${result}${footer}`;
    }

    logger.toolSuccess('read_file', args, { linesRead: selectedLines.length, totalLines }, 0);
    return {
      success: true,
      result,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const displayPath = filePath.startsWith('@') ? filePath.slice(1) : filePath;

    if (err.code === 'ENOENT') {
      logger.toolError('read_file', args, err, 0);
      reportError(error, { type: 'toolExecution', tool: 'read_file' }).catch(() => {});
      return {
        success: false,
        error: `File not found: ${displayPath}`,
      };
    } else if (err.code === 'EACCES') {
      logger.toolError('read_file', args, err, 0);
      reportError(error, { type: 'toolExecution', tool: 'read_file' }).catch(() => {});
      return {
        success: false,
        error: `Permission denied reading file: ${displayPath}`,
      };
    } else {
      logger.toolError('read_file', args, err, 0);
      reportError(error, { type: 'toolExecution', tool: 'read_file' }).catch(() => {});
      return {
        success: false,
        error: `Failed to read file: ${err.message}`,
      };
    }
  }
}

/**
 * read_file LLM Simple Tool
 */
export const readFileTool: LLMSimpleTool = {
  definition: READ_FILE_DEFINITION,
  execute: _executeReadFile,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Read file contents',
};

/**
 * create_file Tool Definition
 * Used for creating NEW files only. Use edit_file for existing files.
 */
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
- "Creating a new file for the authentication service"
- "Creating a new test config file since one doesn't exist"
- "Creating a new file to separate the API router"
- "Adding a new component file"`,
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

/**
 * Internal: Execute create_file
 */
async function _executeCreateFile(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args['file_path'] as string;
  const content = smartUnescapeContent(args['content'] as string);

  logger.toolStart('create_file', { file_path: filePath, contentLength: content?.length || 0 });

  try {
    const cleanPath = filePath.startsWith('@') ? filePath.slice(1) : filePath;
    const resolvedPath = path.resolve(cleanPath);
    const displayPath = filePath.startsWith('@') ? filePath.slice(1) : filePath;

    // Check if file already exists
    try {
      await fs.access(resolvedPath);
      logger.toolError('create_file', args, new Error('File already exists'), 0);
      return {
        success: false,
        error: `File already exists: ${displayPath}. Use edit_file to modify existing files.`,
      };
    } catch {
      // File doesn't exist, which is what we want
    }

    // Create directory if it doesn't exist
    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(resolvedPath, content, 'utf-8');

    const lines = content.split('\n').length;
    logger.toolSuccess('create_file', args, { file: displayPath, lines }, 0);
    return {
      success: true,
      result: JSON.stringify({
        action: 'created',
        file: displayPath,
        lines: lines,
        message: `Created ${displayPath} (${lines} lines)`,
      }),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const displayPath = filePath.startsWith('@') ? filePath.slice(1) : filePath;
    logger.toolError('create_file', args, err, 0);
    reportError(error, { type: 'toolExecution', tool: 'create_file' }).catch(() => {});
    return {
      success: false,
      error: `   (${displayPath}): ${err.message}`,
    };
  }
}

/**
 * create_file LLM Simple Tool
 */
export const createFileTool: LLMSimpleTool = {
  definition: CREATE_FILE_DEFINITION,
  execute: _executeCreateFile,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Create a new file',
};

/**
 * edit_file Tool Definition
 * Used for modifying EXISTING files only. Use create_file for new files.
 * Claude Code style: old_string/new_string based replacement
 */
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
- "Fixing the buggy section"
- "Changing the function name as requested"
- "Adding the import statement"
- "Fixing the type error"`,
        },
        file_path: {
          type: 'string',
          description: 'Absolute or relative path of the existing file to edit',
        },
        old_string: {
          type: 'string',
          description: 'The exact text to find and replace (can be multi-line)',
        },
        new_string: {
          type: 'string',
          description: 'The new text to replace with (can be multi-line, use "" to delete)',
        },
        replace_all: {
          type: 'boolean',
          description: 'If true, replace ALL occurrences of old_string. Default is false (requires unique match).',
        },
      },
      required: ['reason', 'file_path', 'old_string', 'new_string'],
    },
  },
};

/**
 * Internal: Execute edit_file (Claude Code style - old_string/new_string)
 */
async function _executeEditFile(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args['file_path'] as string;
  const oldString = smartUnescapeContent(args['old_string'] as string);
  const newString = smartUnescapeContent(args['new_string'] as string);
  const replaceAll = args['replace_all'] as boolean | undefined;

  logger.toolStart('edit_file', { file_path: filePath, oldStringLength: oldString?.length || 0, newStringLength: newString?.length || 0, replaceAll });

  // Compute displayPath once at the top for use in both try and catch
  const cleanPath = filePath.startsWith('@') ? filePath.slice(1) : filePath;
  const displayPath = cleanPath;

  try {
    const resolvedPath = path.resolve(cleanPath);

    // Validate old_string is not empty
    if (!oldString) {
      return {
        success: false,
        error: 'old_string cannot be empty.',
      };
    }

    // Check if file exists
    try {
      await fs.access(resolvedPath);
    } catch {
      return {
        success: false,
        error: `File does not exist: ${displayPath}. Use create_file to create new files.`,
      };
    }

    // Read current content
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

    // Check if old_string exists in the file
    if (!originalContent.includes(normalizedOldString)) {
      // Try to provide helpful context
      const lines = originalContent.split('\n');
      const preview = lines.slice(0, 20).map((l, i) => `${i + 1}: ${l}`).join('\n');
      return {
        success: false,
        error: `old_string not found in file.\n\nSearched for:\n"${oldString.slice(0, 200)}${oldString.length > 200 ? '...' : ''}"\n\nFile preview (first 20 lines):\n${preview}\n\n💡 Use read_file to check the exact content and try again.`,
      };
    }

    // Count occurrences
    const occurrences = originalContent.split(normalizedOldString).length - 1;

    // If not replace_all, old_string must be unique
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

    // Write the modified content
    await fs.writeFile(resolvedPath, newContent, 'utf-8');

    // Calculate diff stats (split once, reuse)
    const oldLinesArr = oldString.split('\n');
    const newLinesArr = newString.split('\n');
    const replacements = replaceAll ? occurrences : 1;

    // Build simple diff preview
    const diffPreview: string[] = [];
    const oldPreview = oldLinesArr.slice(0, 5);
    const newPreview = newLinesArr.slice(0, 5);

    oldPreview.forEach(line => diffPreview.push(`- ${line}`));
    if (oldLinesArr.length > 5) diffPreview.push('- ...');
    newPreview.forEach(line => diffPreview.push(`+ ${line}`));
    if (newLinesArr.length > 5) diffPreview.push('+ ...');

    logger.toolSuccess('edit_file', args, { file: displayPath, replacements, oldLines: oldLinesArr.length, newLines: newLinesArr.length }, 0);
    return {
      success: true,
      result: JSON.stringify({
        action: 'edited',
        file: displayPath,
        replacements: replacements,
        oldLines: oldLinesArr.length,
        newLines: newLinesArr.length,
        message: replaceAll
          ? `Replaced ${replacements} occurrence(s) in ${displayPath}`
          : `Updated ${displayPath}`,
        diff: diffPreview,
      }),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger.toolError('edit_file', args, err, 0);
    reportError(error, { type: 'toolExecution', tool: 'edit_file' }).catch(() => {});
    return {
      success: false,
      error: `File edit failed (${displayPath}): ${err.message}`,
    };
  }
}

/**
 * edit_file LLM Simple Tool
 */
export const editFileTool: LLMSimpleTool = {
  definition: EDIT_FILE_DEFINITION,
  execute: _executeEditFile,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Edit an existing file',
};

/**
 * list_files Tool Definition
 */
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
- "Looking at the folder structure to understand the project"
- "Checking what files are available"
- "Seeing what's inside the src folder"
- "Checking the directory to find related files"`,
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

/**
 * Get files recursively with safety limits
 */
async function getFilesRecursively(
  dirPath: string,
  baseDir: string = dirPath,
  depth: number = 0,
  fileCount: { count: number } = { count: 0 }
): Promise<Array<{ name: string; type: string; path: string }>> {
  // Safety: depth limit
  if (depth > MAX_DEPTH) {
    return [];
  }

  // Safety: file count limit
  if (fileCount.count >= MAX_FILES) {
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
    if (fileCount.count >= MAX_FILES) {
      break;
    }

    // Skip hidden files/directories (starting with .)
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      // Safety: exclude heavy directories
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }

      files.push({
        name: entry.name,
        type: 'directory',
        path: relativePath,
      });
      fileCount.count++;

      // Recursive call with increased depth
      const subFiles = await getFilesRecursively(fullPath, baseDir, depth + 1, fileCount);
      files.push(...subFiles);
    } else {
      files.push({
        name: entry.name,
        type: 'file',
        path: relativePath,
      });
      fileCount.count++;
    }
  }

  return files;
}

/**
 * Internal: Execute list_files
 */
async function _executeListFilesInternal(args: Record<string, unknown>): Promise<ToolResult> {
  const directoryPath = (args['directory_path'] as string) || '.';
  const recursive = (args['recursive'] as boolean) || false;

  logger.toolStart('list_files', { directory_path: directoryPath, recursive });

  try {
    const resolvedPath = path.resolve(directoryPath);

    if (recursive) {
      const files = await getFilesRecursively(resolvedPath);
      logger.toolSuccess('list_files', args, { fileCount: files.length }, 0);
      return {
        success: true,
        result: JSON.stringify(files, null, 2),
      };
    } else {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const files = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        path: path.join(directoryPath, entry.name),
      }));

      logger.toolSuccess('list_files', args, { fileCount: files.length }, 0);
      return {
        success: true,
        result: JSON.stringify(files, null, 2),
      };
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger.toolError('list_files', args, err, 0);
    reportError(error, { type: 'toolExecution', tool: 'list_files' }).catch(() => {});
    if (err.code === 'ENOENT') {
      return {
        success: false,
        error: `Directory not found: ${directoryPath}`,
      };
    } else {
      return {
        success: false,
        error: `Failed to read directory: ${err.message}`,
      };
    }
  }
}

/**
 * list_files LLM Simple Tool
 */
export const listFilesTool: LLMSimpleTool = {
  definition: LIST_FILES_DEFINITION,
  execute: _executeListFilesInternal,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'List directory contents',
};

/**
 * find_files Tool Definition
 */
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
          description: `A natural, conversational explanation for the user about what you're doing (in user's language).
Write as if you're talking to the user directly.
Examples:
- "Looking for where the config files are located"
- "Searching for test files"
- "Checking where TypeScript files are"
- "Finding related component files"`,
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

/**
 * Find files recursively with safety limits
 */
async function findFilesRecursively(
  dirPath: string,
  regex: RegExp,
  baseDir: string,
  depth: number = 0,
  fileCount: { count: number } = { count: 0 }
): Promise<Array<{ name: string; path: string }>> {
  // Safety: depth limit
  if (depth > MAX_DEPTH) {
    return [];
  }

  // Safety: file count limit
  if (fileCount.count >= MAX_FILES) {
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
    if (fileCount.count >= MAX_FILES) {
      break;
    }

    // Skip hidden files/directories (starting with .)
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Safety: exclude heavy directories
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      // Recursive call with increased depth
      const subFiles = await findFilesRecursively(fullPath, regex, baseDir, depth + 1, fileCount);
      matchedFiles.push(...subFiles);
    } else if (regex.test(entry.name)) {
      const relativePath = path.relative(baseDir, fullPath);
      matchedFiles.push({
        name: entry.name,
        path: relativePath,
      });
      fileCount.count++;
    }
  }

  return matchedFiles;
}

/**
 * Internal: Execute find_files
 */
async function _executeFindFilesInternal(args: Record<string, unknown>): Promise<ToolResult> {
  const pattern = args['pattern'] as string;
  const directoryPath = (args['directory_path'] as string) || '.';

  logger.toolStart('find_files', { pattern, directory_path: directoryPath });

  try {
    const resolvedPath = path.resolve(directoryPath);

    // Convert pattern to regex (simple glob support)
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);

    const matchedFiles = await findFilesRecursively(resolvedPath, regex, resolvedPath);

    if (matchedFiles.length === 0) {
      logger.toolSuccess('find_files', args, { matchCount: 0 }, 0);
      return {
        success: true,
        result: `No files found matching pattern "${pattern}".`,
      };
    }

    logger.toolSuccess('find_files', args, { matchCount: matchedFiles.length }, 0);
    return {
      success: true,
      result: JSON.stringify(matchedFiles, null, 2),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger.toolError('find_files', args, err, 0);
    reportError(error, { type: 'toolExecution', tool: 'find_files' }).catch(() => {});
    return {
      success: false,
      error: `File search failed: ${err.message}`,
    };
  }
}

/**
 * find_files LLM Simple Tool
 */
export const findFilesTool: LLMSimpleTool = {
  definition: FIND_FILES_DEFINITION,
  execute: _executeFindFilesInternal,
  categories: ['llm-simple'] as ToolCategory[],
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
          const line = lines[i] ?? '';
          if (searchRegex.test(line)) {
            results.push({
              file: relativePath,
              line: i + 1,
              content: line.trim().substring(0, 200),
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
    const resolvedPath = path.isAbsolute(directoryPath) ? directoryPath : path.resolve(process.cwd(), directoryPath);
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
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Search content in files',
};

/**
 * File operation tools (read, create, edit, list, find, search_content)
 */
export const FILE_TOOLS: LLMSimpleTool[] = [
  readFileTool,
  createFileTool,
  editFileTool,
  listFilesTool,
  findFilesTool,
  searchContentTool,
];

/**
 * System utility tools
 *
 * Note: Shell tools (bash/powershell) are now managed separately by platform.
 * Use `getShellTools()` from index.ts for platform-specific shell tools.
 * This array is kept for backward compatibility but is now empty.
 */
export const SYSTEM_TOOLS: LLMSimpleTool[] = [];

// Re-export user interaction tools
export {
  USER_INTERACTION_TOOLS,
  tellToUserTool,
  askToUserTool,
  setTellToUserCallback,
  setAskUserCallback,
  clearAskUserCallback,
  hasAskUserCallback,
  type AskUserRequest,
  type AskUserResponse,
  type AskUserCallback,
} from './user-interaction-tools.js';

/**
 * @deprecated Use FILE_TOOLS, USER_INTERACTION_TOOLS, SYSTEM_TOOLS separately
 */
export { FILE_TOOLS as FILE_SIMPLE_TOOLS };

// Re-export from simple-tool-executor for backward compatibility
export {
  // Callback setters
  setToolExecutionCallback,
  setToolResponseCallback,
  setPlanCreatedCallback,
  setTodoStartCallback,
  setTodoCompleteCallback,
  setTodoFailCallback,
  setToolApprovalCallback,
  setCompactCallback,
  setAssistantResponseCallback,
  setReasoningCallback,
  // Callback getters & emitters
  getToolExecutionCallback,
  requestToolApproval,
  emitPlanCreated,
  emitTodoStart,
  emitTodoComplete,
  emitTodoFail,
  emitCompact,
  emitAssistantResponse,
  emitReasoning,
  // Tool executor
  executeSimpleTool,
  executeFileTool,
  executeAgentTool,
  // Types
  type ToolApprovalResult,
} from './simple-tool-executor.js';

