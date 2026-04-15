/**
 * Orchestration Types
 *
 * Plan & Execute   
 */

import { Message, TodoItem } from '../types/index.js';
import { LLMClient } from '../core/llm/llm-client.js';
import { CompactResult } from '../core/compact/index.js';

/**
 *  
 * Note: 'classifying' phase removed - all requests now go through planning
 */
export type ExecutionPhase = 'idle' | 'planning' | 'executing' | 'compacting';

/**
 * Plan Execution 
 */
export interface PlanExecutionState {
  todos: TodoItem[];
  currentTodoId: string | undefined;
  executionPhase: ExecutionPhase;
  isInterrupted: boolean;
  currentActivity: string;
}

/**
 * Ask User 
 * - options: LLM  2-4 
 * - "Other ( )"  UI  
 */
export interface AskUserRequest {
  question: string;
  options: string[];  // 2-4  (LLM )
}

/**
 * Ask User 
 */
export interface AskUserResponse {
  selectedOption: string;
  isOther: boolean;
  customText?: string;
}

/**
 * Ask User 
 */
export interface AskUserState {
  askUserRequest: AskUserRequest | null;
}

/**
 *   
 */
export interface StateCallbacks {
  setTodos: (todos: TodoItem[] | ((prev: TodoItem[]) => TodoItem[])) => void;
  setCurrentTodoId: (id: string | undefined | ((prev: string | undefined) => string | undefined)) => void;
  setExecutionPhase: (phase: ExecutionPhase) => void;
  setIsInterrupted: (interrupted: boolean) => void;
  setCurrentActivity: (activity: string) => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setAskUserRequest: (request: AskUserRequest | null) => void;
  // Planning LLM ask-user callback (Promise-based for planning phase)
  askUser?: (request: AskUserRequest) => Promise<AskUserResponse>;
  // Pending user message callbacks (for injecting messages during execution)
  getPendingMessage?: () => string | null;
  clearPendingMessage?: () => void;
  // LLM retry exhausted — UI Enter  
  setRetryPending?: (pending: boolean) => void;
}

/**
 *  
 */
export interface ExecutionContext {
  llmClient: LLMClient;
  messages: Message[];
  todos: TodoItem[];
  isInterruptedRef: { current: boolean };
  callbacks: StateCallbacks;
}

/**
 *  
 */
export interface ExecutionResult {
  success: boolean;
  messages: Message[];
  error?: string;
}

/**
 * Plan Execution Actions 
 */
export interface PlanExecutionActions {
  retryPending: boolean;
  setRetryPending: (pending: boolean) => void;
  setTodos: (todos: TodoItem[] | ((prev: TodoItem[]) => TodoItem[])) => void;
  handleTodoUpdate: (todo: TodoItem) => void;
  handleAskUserResponse: (response: AskUserResponse) => void;
  handleInterrupt: () => 'paused' | 'stopped' | 'none';
  executeAutoMode: (
    userMessage: string,
    llmClient: LLMClient,
    messages: Message[],
    setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void
  ) => Promise<void>;
  executePlanMode: (
    userMessage: string,
    llmClient: LLMClient,
    messages: Message[],
    setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void
  ) => Promise<void>;
  resumeTodoExecution: (
    userMessage: string,
    llmClient: LLMClient,
    messages: Message[],
    setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void
  ) => Promise<void>;
  // executeDirectMode removed - all requests now use Plan Mode
  performCompact: (
    llmClient: LLMClient,
    messages: Message[],
    setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void
  ) => Promise<CompactResult>;
  shouldAutoCompact: () => boolean;
  getContextRemainingPercent: () => number;
  getContextUsageInfo: () => { tokens: number; percent: number };
}
