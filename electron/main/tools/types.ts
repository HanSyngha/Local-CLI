/**
 * Tool Types and Interfaces
 *
 * 6     
 * CLI parity: src/tools/types.ts
 *
 * Categories:
 * 1. LLM Simple Tools - LLM tool_call , Sub-LLM 
 * 2. LLM Agent Tools - LLM tool_call , Sub-LLM 
 * 3. System Simple Tools -    , Sub-LLM 
 * 4. System Agent Tools -    , Sub-LLM 
 * 5. User Commands -  / 
 * 6. MCP Tools - Model Context Protocol 
 */

import type { ToolDefinition, LLMClient } from '../core';

/**
 * Tool categories for classification and registration
 */
export type ToolCategory =
  | 'llm-simple'
  | 'llm-agent'
  | 'llm-planning'  // Planning LLM dedicated tools
  | 'system-simple'
  | 'system-agent'
  | 'user-command'
  | 'mcp';

/**
 * Default categories for browser tools
 */
export const BROWSER_CATEGORIES: ToolCategory[] = ['llm-simple'];

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Context passed to system tools
 */
export interface SystemContext {
  userMessage: string;
  messages: Array<{ role: string; content: string }>;
  currentDirectory: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 1. LLM Simple Tool Interface
 * - LLM tool_call 
 * - Sub-LLM  
 */
export interface LLMSimpleTool {
  /** Tool definition for LLM */
  definition: ToolDefinition;
  /** Execute the tool with given arguments */
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
  /** Categories this tool belongs to */
  categories: ToolCategory[];
  /** Optional description for registration */
  description?: string;
}

/**
 * 2. LLM Agent Tool Interface
 * - LLM tool_call 
 * - Sub-LLM   task 
 */
export interface LLMAgentTool {
  /** Tool definition for LLM */
  definition: ToolDefinition;
  /** Execute the tool with given arguments and LLM client */
  execute: (args: Record<string, unknown>, llmClient: LLMClient) => Promise<ToolResult>;
  /** Categories this tool belongs to */
  categories: ToolCategory[];
  /** Flag indicating this tool requires Sub-LLM */
  requiresSubLLM: true;
  /** Optional description for registration */
  description?: string;
}

/**
 * 3. System Simple Tool Interface
 * -     
 * - Sub-LLM  
 */
export interface SystemSimpleTool {
  /** Unique tool name */
  name: string;
  /** Execute the tool with system context */
  execute: (context: SystemContext) => Promise<ToolResult>;
  /** Condition to trigger this tool automatically */
  triggerCondition: (context: SystemContext) => boolean;
  /** Categories this tool belongs to */
  categories: ToolCategory[];
  /** Optional description for registration */
  description?: string;
}

/**
 * 4. System Agent Tool Interface
 * -     
 * - Sub-LLM   task 
 */
export interface SystemAgentTool {
  /** Unique tool name */
  name: string;
  /** Execute the tool with system context and LLM client */
  execute: (context: SystemContext, llmClient: LLMClient) => Promise<ToolResult>;
  /** Condition to trigger this tool automatically */
  triggerCondition: (context: SystemContext) => boolean;
  /** Categories this tool belongs to */
  categories: ToolCategory[];
  /** Flag indicating this tool requires Sub-LLM */
  requiresSubLLM: true;
  /** Optional description for registration */
  description?: string;
}

/**
 * 5. User Command Interface
 * -  /   
 */
export interface UserCommand {
  /** Command name (e.g., '/help', '/settings') */
  name: string;
  /** Command aliases (e.g., '/quit' for '/exit') */
  aliases?: string[];
  /** Short description for help display */
  description: string;
  /** Execute the command */
  execute: (args: string[], context: UserCommandContext) => Promise<UserCommandResult>;
  /** Categories this command belongs to */
  categories: ToolCategory[];
}

/**
 * Context passed to user commands
 */
export interface UserCommandContext {
  messages: Array<{ role: string; content: string }>;
  setMessages: (messages: Array<{ role: string; content: string }>) => void;
  exit: () => void;
  // UI callbacks
  onShowSessionBrowser?: () => void;
  onShowSettings?: () => void;
  onShowModelSelector?: () => void;
}

/**
 * Result from user command execution
 */
export interface UserCommandResult {
  handled: boolean;
  shouldContinue: boolean;
  message?: string;
}

/**
 * 6. MCP Tool Interface
 * - Model Context Protocol 
 * -   
 */
export interface MCPTool {
  /** Tool definition for MCP */
  definition: ToolDefinition;
  /** MCP server identifier */
  serverName: string;
  /** Execute the tool through MCP protocol */
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
  /** Categories this tool belongs to */
  categories: ToolCategory[];
  /** Optional description for registration */
  description?: string;
}

/**
 * Union type of all tool types
 */
export type AnyTool =
  | LLMSimpleTool
  | LLMAgentTool
  | SystemSimpleTool
  | SystemAgentTool
  | UserCommand
  | MCPTool;

/**
 * Type guard: Check if tool is LLM Simple Tool
 */
export function isLLMSimpleTool(tool: AnyTool): tool is LLMSimpleTool {
  return 'definition' in tool && 'execute' in tool && !('requiresSubLLM' in tool) && !('serverName' in tool);
}

/**
 * Type guard: Check if tool is LLM Agent Tool
 */
export function isLLMAgentTool(tool: AnyTool): tool is LLMAgentTool {
  return 'definition' in tool && 'requiresSubLLM' in tool && tool.requiresSubLLM === true;
}

/**
 * Type guard: Check if tool is System Simple Tool
 */
export function isSystemSimpleTool(tool: AnyTool): tool is SystemSimpleTool {
  return 'triggerCondition' in tool && !('requiresSubLLM' in tool);
}

/**
 * Type guard: Check if tool is System Agent Tool
 */
export function isSystemAgentTool(tool: AnyTool): tool is SystemAgentTool {
  return 'triggerCondition' in tool && 'requiresSubLLM' in tool && tool.requiresSubLLM === true;
}

/**
 * Type guard: Check if tool is User Command
 */
export function isUserCommand(tool: AnyTool): tool is UserCommand {
  return 'name' in tool && 'aliases' in tool || ('name' in tool && !('definition' in tool) && !('triggerCondition' in tool));
}

/**
 * Type guard: Check if tool is MCP Tool
 */
export function isMCPTool(tool: AnyTool): tool is MCPTool {
  return 'serverName' in tool && 'definition' in tool;
}

