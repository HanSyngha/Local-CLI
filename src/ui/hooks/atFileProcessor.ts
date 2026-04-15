/**
 * @ File Processor
 *
 * Utilities for detecting @ triggers and processing file selections
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface AtTriggerInfo {
  detected: boolean;
  position: number;
  filter: string;
}

/**
 * Detect '@' trigger in input string
 * Returns position and filter text after @
 */
export function detectAtTrigger(input: string): AtTriggerInfo {
  // Find '@' at start or after space
  const atMatch = input.match(/(^|[\s])@([^\s]*?)$/);

  if (!atMatch) {
    return { detected: false, position: -1, filter: '' };
  }

  const position = atMatch.index! + atMatch[1]!.length; // Position of '@'
  const filter = atMatch[2] || ''; // Text after '@'

  return {
    detected: true,
    position,
    filter,
  };
}

/**
 * Insert file paths into input string at cursor position
 * Removes the '@' trigger and filter text
 * Ensures cursor is positioned right after the inserted path for continued typing
 */
export function insertFilePaths(
  input: string,
  atPosition: number,
  filterLength: number,
  filePaths: string[]
): string {
  // Remove '@filter' from input
  const before = input.slice(0, atPosition);
  const after = input.slice(atPosition + 1 + filterLength);

  // Format file paths as @path1 @path2 @path3
  const formattedPaths = filePaths.map((p) => `@${p}`).join(' ');

  // Insert paths with space after for continued typing
  // If there's text after the cursor, trim the result
  // Otherwise, keep trailing space so user can continue typing immediately
  if (after.trim()) {
    return `${before}${formattedPaths} ${after}`.trim();
  } else {
    // No text after cursor - add space for continued typing
    return `${before}${formattedPaths} `;
  }
}

/**
 * Result of processing @file references
 */
export interface ProcessedMessage {
  /** The processed message with file contents included */
  content: string;
  /** List of files that were successfully read */
  includedFiles: string[];
  /** List of files that failed to read */
  failedFiles: string[];
}

/**
 * Extract @path references from a message
 * Matches patterns like @/path/to/file.ts or @relative/path.js
 */
export function extractFileReferences(input: string): string[] {
  // Match @followed by a path (absolute or relative, with optional extension)
  // Stops at whitespace or end of string
  const regex = /@([^\s@]+)/g;
  const matches: string[] = [];
  let match;

  while ((match = regex.exec(input)) !== null) {
    const filePath = match[1];
    // Filter out obvious non-paths (single characters, etc.)
    if (filePath && filePath.length > 1 && (filePath.includes('/') || filePath.includes('.'))) {
      matches.push(filePath);
    }
  }

  return matches;
}

/**
 * Process a message by reading @file references and including their contents
 * Returns the processed message with file contents appended
 */
export async function processFileReferences(input: string): Promise<ProcessedMessage> {
  const fileRefs = extractFileReferences(input);

  if (fileRefs.length === 0) {
    return {
      content: input,
      includedFiles: [],
      failedFiles: [],
    };
  }

  const includedFiles: string[] = [];
  const failedFiles: string[] = [];
  const fileContents: string[] = [];

  for (const filePath of fileRefs) {
    try {
      // Resolve path (relative to cwd)
      const resolvedPath = path.resolve(process.cwd(), filePath);

      // Security: Prevent path traversal attacks
      if (!resolvedPath.startsWith(process.cwd())) {
        failedFiles.push(filePath);
        continue;
      }

      // Check if file exists
      const stat = await fs.stat(resolvedPath);

      if (stat.isDirectory()) {
        // For directories, list contents instead
        const entries = await fs.readdir(resolvedPath);
        fileContents.push(`\n--- Directory: ${filePath} ---\n${entries.join('\n')}\n---`);
        includedFiles.push(filePath);
      } else {
        // Read file content
        const content = await fs.readFile(resolvedPath, 'utf-8');
        const ext = path.extname(filePath).slice(1) || 'txt';
        fileContents.push(`\n--- File: ${filePath} ---\n\`\`\`${ext}\n${content}\n\`\`\`\n---`);
        includedFiles.push(filePath);
      }
    } catch (error) {
      failedFiles.push(filePath);
    }
  }

  // Build final message
  // Remove @path references from original message and append file contents
  let cleanedInput = input;
  for (const filePath of new Set(fileRefs)) {
    cleanedInput = cleanedInput.replaceAll(`@${filePath}`, `[${filePath}]`);
  }

  const finalContent = fileContents.length > 0
    ? `${cleanedInput}\n\n<attached_files>${fileContents.join('\n')}</attached_files>`
    : cleanedInput;

  return {
    content: finalContent,
    includedFiles,
    failedFiles,
  };
}
