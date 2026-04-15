/**
 * LLM Simple Tools Index (Web Session)
 *
 * LLM tool_call   (Sub-LLM )
 * Web session:  bash   (Docker Linux )
 */

import { LLMSimpleTool } from '../../types.js';

// Common tools (all platforms)
export * from './file-tools.js';
export * from './todo-tools.js';
export * from './final-response-tool.js';

// Bash tools (Linux only in web session)
export * from './bash-tool.js';
import { bashTool } from './bash-tool.js';
import { BACKGROUND_BASH_TOOLS } from './background-bash-tool.js';
export { BACKGROUND_BASH_TOOLS } from './background-bash-tool.js';

/**
 * Get shell tools — always bash in web session (Docker Linux)
 */
export function getShellTools(): LLMSimpleTool[] {
  return [bashTool, ...BACKGROUND_BASH_TOOLS];
}
