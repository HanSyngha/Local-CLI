/**
 * Office Common Utilities
 *
 * Shared utility functions for Office tools (Word, Excel, PowerPoint)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Delay execution for specified milliseconds
 * Used to give applications time to fully load before LLM proceeds
 * @param ms - Milliseconds to wait
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Standard delay for application launch/open operations (3 seconds)
 * This prevents LLM from racing ahead before apps fully load
 */
export const APP_LAUNCH_DELAY_MS = 3000;

/**
 * Save a base64-encoded screenshot to the current working directory
 * LLM      working directory  
 *
 * @param base64Image - Base64 encoded image data
 * @param appName - Application name (e.g., 'word', 'excel', 'powerpoint')
 * @returns The full path to the saved screenshot file
 */
export async function saveScreenshot(base64Image: string, appName: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${appName}_screenshot_${timestamp}.jpg`;
  const filePath = path.join(process.cwd(), filename);
  const buffer = Buffer.from(base64Image, 'base64');
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Convert hex color string to RGB values
 * @param hex - Hex color string (e.g., '#FF0000' or 'FF0000')
 * @returns RGB object or null if invalid format
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result || !result[1] || !result[2] || !result[3]) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Convert RGB to Office BGR color value
 * Office COM uses BGR format: B + G*256 + R*65536
 * @param hex - Hex color string
 * @returns BGR color value for Office COM or 0 if invalid
 */
export function hexToBgrColor(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return rgb.r + rgb.g * 256 + rgb.b * 65536;
}

/**
 * Check if text contains Korean characters
 * @param text - Text to check
 * @returns true if contains Korean characters
 */
export function hasKoreanText(text: string): boolean {
  return /[-ㄱ-ㅎㅏ-ㅣ]/.test(text);
}

/**
 * Default Korean font name (English name works on all Windows regardless of UI language)
 */
export const KOREAN_FONT = 'Malgun Gothic';

/**
 * Get recommended font name for text (auto-detect Korean)
 * @param text - Text to check
 * @param defaultFont - Default font for non-Korean text (optional)
 * @returns Font name ('Malgun Gothic' for Korean, defaultFont otherwise)
 */
export function getRecommendedFont(text: string, defaultFont?: string): string | undefined {
  if (hasKoreanText(text)) {
    return KOREAN_FONT;
  }
  return defaultFont;
}

/**
 * Escape single quotes for PowerShell string
 * @param str - String to escape
 * @returns Escaped string
 */
export function escapePowerShellString(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Convert column letter (A, B, ..., Z, AA, AB, ...) to number (1, 2, ..., 26, 27, 28, ...)
 * @param column - Column letter(s)
 * @returns Column number (1-based)
 */
export function columnLetterToNumber(column: string): number {
  let result = 0;
  for (let i = 0; i < column.length; i++) {
    result = result * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result;
}

/**
 * Convert column number (1, 2, ..., 26, 27, 28, ...) to letter (A, B, ..., Z, AA, AB, ...)
 * @param num - Column number (1-based)
 * @returns Column letter(s)
 */
export function columnNumberToLetter(num: number): string {
  let result = '';
  while (num > 0) {
    num--;
    result = String.fromCharCode('A'.charCodeAt(0) + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result;
}
