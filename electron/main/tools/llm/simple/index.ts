/**
 * LLM Simple Tools Index
 *
 * LLM tool_call   (Sub-LLM )
 * CLI parity: src/tools/llm/simple/index.ts
 *
 * Note: Electron uses PowerShell instead of bash (Windows native)
 */

import type { LLMSimpleTool } from '../../types';

// =============================================================================
// File Tools
// =============================================================================

export {
  FILE_TOOLS,
  SYSTEM_TOOLS,
  readFileTool,
  createFileTool,
  editFileTool,
  listFilesTool,
  findFilesTool,
  searchContentTool,
  setWorkingDirectory,
  getWorkingDirectory,
} from './file-tools';

// =============================================================================
// PowerShell Tools (Windows Native - replaces bash)
// =============================================================================

export {
  POWERSHELL_TOOLS,
  BACKGROUND_POWERSHELL_TOOLS,
  powershellTool,
  powershellBackgroundStartTool,
  powershellBackgroundReadTool,
  powershellBackgroundStopTool,
  setWorkingDirectory as setPowerShellWorkingDirectory,
} from './powershell-tool';

// =============================================================================
// TODO Tools
// =============================================================================

export {
  TODO_TOOLS,
  writeTodosTool,
  setTodoWriteCallback,
  getTodoWriteCallback,
} from './todo-tools';

export type { TodoItem, TodoWriteCallback } from './todo-tools';

// =============================================================================
// User Interaction Tools
// =============================================================================

export {
  USER_INTERACTION_TOOLS,
  USER_TOOLS,
  tellToUserTool,
  askToUserTool,
  setTellToUserCallback,
  setAskUserCallback,
  clearAskUserCallback,
  hasAskUserCallback,
} from './user-interaction-tools';

export type {
  TellToUserCallback,
  AskUserCallback,
  AskUserRequest,
  AskUserResponse,
} from './user-interaction-tools';

// =============================================================================
// Final Response Tool
// =============================================================================

export {
  FINAL_RESPONSE_TOOLS,
  finalResponseTool,
  FinalResponseTool,
  setGetTodosCallback,
  setFinalResponseCallback,
  clearFinalResponseCallbacks,
} from './final-response-tool';

export type {
  GetTodosCallback,
  FinalResponseCallback,
} from './final-response-tool';

// =============================================================================
// Planning Tools
// =============================================================================

export {
  PLANNING_TOOLS,
  createTodosTool,
  respondToUserTool,
} from './planning-tools';

// =============================================================================
// Simple Tool Executor (Callbacks & Execution)
// =============================================================================

export {
  executeSimpleTool,
  executeFileTool,
  clearAllCallbacks,
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
} from './simple-tool-executor';

export type { ToolApprovalResult } from './simple-tool-executor';

// =============================================================================
// Import for combined exports
// =============================================================================

import { FILE_TOOLS } from './file-tools';
import { POWERSHELL_TOOLS } from './powershell-tool';
import { TODO_TOOLS } from './todo-tools';
import { USER_TOOLS } from './user-interaction-tools';
import { finalResponseTool } from './final-response-tool';
import { PLANNING_TOOLS } from './planning-tools';

/**
 * Get shell tools based on current platform
 * Note: Electron always uses PowerShell (Windows native)
 */
export function getShellTools(): LLMSimpleTool[] {
  return POWERSHELL_TOOLS;
}

/**
 * All LLM Simple tools combined
 */
export const ALL_SIMPLE_TOOLS: LLMSimpleTool[] = [
  ...FILE_TOOLS,
  ...POWERSHELL_TOOLS,
  ...TODO_TOOLS,
  ...USER_TOOLS,
  finalResponseTool,
];

// Note: PLANNING_TOOLS is already exported at line 100-104
