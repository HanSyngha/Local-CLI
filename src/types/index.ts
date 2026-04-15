/**
 * LOCAL-CLI Type Definitions
 *
 *    TypeScript  
 */

/**
 *  
 */
export interface EndpointConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  provider?: import('../core/llm/providers.js').LLMProvider;
  models: ModelInfo[];
  healthCheckInterval?: number;
  priority?: number;
  fallbackTo?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 *  
 */
export interface ModelInfo {
  id: string;
  name: string;
  /** Actual model name for API calls (e.g., "claude-3-5-sonnet"). Falls back to name if not set. */
  apiModelId?: string;
  maxTokens: number;
  costPerMToken?: number;
  enabled: boolean;
  lastHealthCheck?: Date;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy';
  supportsVision?: boolean;
}

/**
 * LLM 
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * Tool Call
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * LLM  
 */
export interface LLMRequestOptions {
  model: string;
  messages: Message[];
  temperature?: number;
  stream?: boolean;
  max_tokens?: number;
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

/**
 * LLM Response
 */
export interface LLMResponse {
  choices: {
    message: {
      role: 'assistant' | 'system' | 'user';
      content: string;
      tool_calls?: ToolCall[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'function_call';
    index?: number;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model?: string;
}

/**
 * Tool 
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/**
 *  
 */
export interface SessionMemory {
  sessionId: string;
  tags: string[];
  messages: Message[];
  memory: Record<string, unknown>;
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    model: string;
    totalTokens: number;
    directories: string[];
    includedFiles: string[];
  };
}

/**
 *   
 */
/** Browser service configuration for sub-agents */
export interface BrowserServiceConfig {
  type: 'confluence' | 'jira';
  name: string;
  url: string;
}

/** Research URL for deep research agent to search additional sources */
export interface ResearchUrlConfig {
  name: string;
  url: string;
}

export interface OpenConfig {
  version: string;
  currentEndpoint?: string;
  currentModel?: string;
  /** Selected vision model (for read_image). Falls back to first vision-capable model if not set. */
  visionEndpointId?: string;
  visionModelId?: string;
  endpoints: EndpointConfig[];
  settings: {
    autoApprove: boolean;
    debugMode: boolean;
    streamResponse: boolean;
    autoSave: boolean;
  };
  /** Enabled optional tool group IDs (persisted across sessions) */
  enabledTools?: string[];
  /** Browser service URLs for sub-agents (Confluence, Jira) */
  browserServices?: BrowserServiceConfig[];
  /** Additional URLs for deep research agent to search (Confluence, internal wikis, etc.) */
  researchUrls?: ResearchUrlConfig[];
}

/**
 * TODO Item type for Plan-and-Execute Architecture
 * Simplified: title only, no description
 */
export interface TodoItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

/**
 * Planning result from Planning LLM
 */
export interface PlanningResult {
  /** Short title summarizing the overall task (becomes session name) */
  title?: string;
  todos: TodoItem[];
  estimatedTime?: string;
  complexity: 'simple' | 'moderate' | 'complex';
  /** Direct response when no planning is needed */
  directResponse?: string;
  /** Clarification messages from ask_to_user during planning (Q&A pairs) */
  clarificationMessages?: Message[];
}

/**
 * TODO status type
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

