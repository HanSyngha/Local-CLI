/**
 * Jarvis Mode - Types
 *
 * Jarvis    .
 *   , Manager LLM   task //.
 */

// =============================================================================
// Config
// =============================================================================

export interface JarvisConfig {
  /**   (default: false) */
  enabled: boolean;
  /**   -   (default: 30, range: 5~120) */
  pollIntervalMinutes: number;
  /** Windows     (default: true when enabled) */
  autoStartOnBoot: boolean;
  /** Jarvis dedicated  ID (  Electron   ) */
  modelId?: string;
  /** Jarvis dedicated  ID (  Electron   ) */
  endpointId?: string;
}

export const DEFAULT_JARVIS_CONFIG: JarvisConfig = {
  enabled: false,
  pollIntervalMinutes: 30,
  autoStartOnBoot: true,
};

// =============================================================================
// Manager LLM Tool Types
// =============================================================================

/** Manager Planner  task */
export interface DelegationResult {
  success: boolean;
  response: string;
  toolCalls: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
    success: boolean;
  }>;
  iterations: number;
  error?: string;
}

/** Manager   — report (,  ) */
export interface JarvisReport {
  type: 'report';
  message: string;
}

/** Manager   —   (blocking) */
export interface JarvisApprovalRequest {
  type: 'approval';
  id: string;
  message: string;
}

export interface JarvisApprovalResponse {
  approved: boolean;
}

/** Manager   —  (blocking) */
export interface JarvisQuestion {
  type: 'question';
  id: string;
  question: string;
  options?: string[];
}

export interface JarvisQuestionResponse {
  answer: string;
}

// =============================================================================
// Memory (Layer 1 —  )
// =============================================================================

export interface JarvisMemoryEntry {
  id: string;
  key: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface JarvisMemory {
  entries: JarvisMemoryEntry[];
  lastGreeting: string;
  lastPollTime: string;
}

export const DEFAULT_JARVIS_MEMORY: JarvisMemory = {
  entries: [],
  lastGreeting: '',
  lastPollTime: '',
};

// =============================================================================
// Service State
// =============================================================================

export type JarvisStatus = 'idle' | 'polling' | 'analyzing' | 'executing' | 'waiting_user';

export interface JarvisState {
  status: JarvisStatus;
  isRunning: boolean;
  lastPollTime: string | null;
  nextPollTime: string | null;
  currentTask: string | null;
}

// =============================================================================
// Chat Message (Jarvis UI)
// =============================================================================

export type JarvisChatMessageType =
  | 'jarvis'           // Jarvis 
  | 'user'             //  
  | 'approval_request' //   
  | 'question'         //  
  | 'execution_status' //   
  | 'system';          //  

export interface JarvisChatMessage {
  id: string;
  type: JarvisChatMessageType;
  content: string;
  timestamp: number;
  /** approval/question  */
  requestId?: string;
  options?: string[];
  /**     */
  resolved?: boolean;
  resolvedValue?: string;
}
