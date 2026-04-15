/**
 * LLM Simple Tools Index
 *
 * LLM tool_call   (Sub-LLM )
 *    shell  export
 */

import { isNativeWindows } from '../../../utils/platform-utils.js';
import { LLMSimpleTool } from '../../types.js';

// Common tools (all platforms)
export * from './file-tools.js';
export * from './todo-tools.js';
export * from './ask-user-tool.js';
export * from './final-response-tool.js';

// Bash tools (WSL/Linux)
export * from './bash-tool.js';
import { bashTool } from './bash-tool.js';
import { BACKGROUND_BASH_TOOLS } from './background-bash-tool.js';
export { BACKGROUND_BASH_TOOLS } from './background-bash-tool.js';

// PowerShell tools (Native Windows)
export * from './powershell-tool.js';
import { powershellTool } from './powershell-tool.js';
import { BACKGROUND_POWERSHELL_TOOLS } from './background-powershell-tool.js';
export { BACKGROUND_POWERSHELL_TOOLS } from './background-powershell-tool.js';

/**
 * Get shell tools based on current platform
 *
 * - Native Windows: powershell + powershell_background_*
 * - WSL/Linux: bash + bash_background_*
 */
export function getShellTools(): LLMSimpleTool[] {
  if (isNativeWindows()) {
    return [powershellTool, ...BACKGROUND_POWERSHELL_TOOLS];
  }

  // WSL/Linux
  return [bashTool, ...BACKGROUND_BASH_TOOLS];
}
