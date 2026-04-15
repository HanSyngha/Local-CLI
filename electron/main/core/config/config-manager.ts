/**
 * Config Manager for Electron Main Process
 *
 * CLI parity: src/core/config/config-manager.ts
 *
 * Unified configuration management:
 * - UI settings (theme, layout, etc.)
 * - LLM endpoints and models
 * - Tool settings
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { isMainThread } from 'worker_threads';
import { logger } from '../../utils/logger';

// Dynamic electron import for worker_threads compatibility
function getElectronApp(): { getVersion(): string } | null {
  try {
    return require('electron').app;
  } catch {
    return null;
  }
}
import { reportError } from '../telemetry/error-reporter';

// =============================================================================
// Types (CLI parity)
// =============================================================================

export interface ModelInfo {
  id: string;
  name: string;
  /** Actual model name for API calls (e.g., "claude-3-5-sonnet"). Falls back to name if not set. */
  apiModelId?: string;
  maxTokens: number;
  enabled: boolean;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy';
  lastHealthCheck?: Date;
  costPerMToken?: number;
  supportsVision?: boolean;
}

export interface EndpointConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  provider?: import('../llm/providers').LLMProvider;
  models: ModelInfo[];
  createdAt?: Date;
  updatedAt?: Date;
}

// Color palette type
export type ColorPalette = 'default' | 'rose' | 'mint' | 'lavender' | 'peach' | 'sky';

// Font size (10-18px range)
export type FontSize = number;

// Unified config structure
export interface AppConfig {
  // UI Settings
  theme: 'light' | 'dark' | 'system';
  colorPalette: ColorPalette;
  fontSize: FontSize;
  uiScale?: number; // UI   (0.8 ~ 1.5, default: 1)
  lastOpenedDirectory?: string;
  recentDirectories: string[];
  sidebarWidth: number;
  bottomPanelHeight: number;
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  // LLM Settings (CLI parity)
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
    maxTokens: number;
    temperature: number;
  };

  // Tool settings
  enabledTools: string[];

  // External tools
  vscodePath?: string; // Custom VSCode path (if not in PATH)

  /** Browser service URLs for sub-agents (Confluence, Jira) — CLI parity */
  browserServices?: { type: 'confluence' | 'jira'; name: string; url: string }[];
  /** Additional URLs for deep research agent to search — CLI parity */
  researchUrls?: { name: string; url: string }[];

  // Auto-start settings
  autoStartChat?: boolean; // Boot with Chat window (default: true)

  // Jarvis Mode
  jarvis?: {
    enabled: boolean;
    pollIntervalMinutes: number;
    autoStartOnBoot: boolean;
  };
}

// System status type
interface SystemStatus {
  version: string;
  sessionId: string;
  workingDir: string;
  endpointUrl: string;
  llmModel: string;
  configPath: string;
}

// =============================================================================
// Default Config
// =============================================================================

const DEFAULT_CONFIG: AppConfig = {
  // UI defaults
  theme: 'light',
  colorPalette: 'default',
  fontSize: 12,
  uiScale: 1,
  recentDirectories: [],
  sidebarWidth: 260,
  bottomPanelHeight: 300,
  enabledTools: [],

  // LLM defaults
  endpoints: [],
  settings: {
    autoApprove: false,
    debugMode: false,
    streamResponse: true,
    autoSave: true,
    maxTokens: 4096,
    temperature: 0.7,
  },
};

// =============================================================================
// Config Path Helper
// =============================================================================

function getConfigPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'local-bot', 'config.json');
  }
  return path.join(os.homedir(), '.local-bot', 'config.json');
}

// =============================================================================
// Config Manager Class
// =============================================================================

class ConfigManager {
  private configPath: string;
  private config: AppConfig;
  private initialized: boolean = false;
  private currentSessionId: string | null = null;

  constructor() {
    this.configPath = getConfigPath();
    this.config = { ...DEFAULT_CONFIG };
    // Load config immediately (sync) for llm-client access
    this.loadConfigSync();
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize config manager (async)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Config path', { configPath: this.configPath });

    await this.ensureConfigDirectory();
    await this.load();

    this.initialized = true;
  }

  /**
   * Ensure config directory exists
   */
  private async ensureConfigDirectory(): Promise<void> {
    try {
      const dir = path.dirname(this.configPath);
      await fs.promises.mkdir(dir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create config directory', error);
    }
  }

  /**
   * Load config synchronously (for constructor)
   */
  private loadConfigSync(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(data);
        this.config = { ...DEFAULT_CONFIG, ...loaded };
        logger.info('Config loaded (sync)', {
          path: this.configPath,
          endpoints: this.config.endpoints?.length || 0
        });
      }
    } catch (error) {
      logger.error('Failed to load config (sync)', error);
      reportError(error, { type: 'config', method: 'loadSync' }).catch(() => {});
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  /**
   * Load config (async)
   */
  async load(): Promise<AppConfig> {
    try {
      const content = await fs.promises.readFile(this.configPath, 'utf-8');
      const loadedConfig = JSON.parse(content);
      this.config = { ...DEFAULT_CONFIG, ...loadedConfig };
      logger.info('Config loaded', {
        endpoints: this.config.endpoints?.length || 0,
        theme: this.config.theme
      });
    } catch (error) {
      this.config = { ...DEFAULT_CONFIG };
      logger.info('Using default config (file not found)');
    }
    return this.config;
  }

  /**
   * Save config
   */
  async save(): Promise<void> {
    // Worker threads must NOT write to config.json to avoid race conditions
    // Workers only update in-memory config; main process owns the file
    if (!isMainThread) return;

    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await fs.promises.writeFile(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        'utf-8'
      );
      logger.debug('Config saved');
    } catch (error) {
      logger.error('Failed to save config', error);
      reportError(error, { type: 'config', method: 'save' }).catch(() => {});
    }
  }

  /**
   * Reload config from file
   */
  reloadConfig(): void {
    this.loadConfigSync();
  }

  // ===========================================================================
  // General Config Access
  // ===========================================================================

  getConfigPath(): string {
    return this.configPath;
  }

  getConfigDirectory(): string {
    return path.dirname(this.configPath);
  }

  getAll(): AppConfig {
    return { ...this.config };
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  async set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
    this.config[key] = value;
    await this.save();
  }

  async update(updates: Partial<AppConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await this.save();
  }

  // ===========================================================================
  // UI Settings
  // ===========================================================================

  async setTheme(theme: 'light' | 'dark' | 'system'): Promise<void> {
    await this.set('theme', theme);
  }

  getTheme(): 'light' | 'dark' | 'system' {
    return this.config.theme;
  }

  async addRecentDirectory(directory: string): Promise<void> {
    const recent = this.config.recentDirectories.filter(d => d !== directory);
    recent.unshift(directory);
    this.config.recentDirectories = recent.slice(0, 10);
    this.config.lastOpenedDirectory = directory;
    await this.save();
  }

  getRecentDirectories(): string[] {
    return [...this.config.recentDirectories];
  }

  // ===========================================================================
  // Endpoint Management (CLI parity)
  // ===========================================================================

  /**
   * Get all endpoints
   */
  getEndpoints(): { endpoints: EndpointConfig[]; currentEndpointId?: string; currentModelId?: string } {
    return {
      endpoints: this.config.endpoints || [],
      currentEndpointId: this.config.currentEndpoint,
      currentModelId: this.config.currentModel,
    };
  }

  /**
   * Get all endpoints (CLI parity alias)
   */
  getAllEndpoints(): EndpointConfig[] {
    return this.config.endpoints || [];
  }

  /**
   * Get current endpoint
   */
  getCurrentEndpoint(): EndpointConfig | null {
    if (!this.config.currentEndpoint) {
      return this.config.endpoints[0] || null;
    }
    return this.config.endpoints.find(ep => ep.id === this.config.currentEndpoint) || null;
  }

  /**
   * Get current model
   */
  getCurrentModel(): ModelInfo | null {
    const endpoint = this.getCurrentEndpoint();
    if (!endpoint) return null;

    if (this.config.currentModel) {
      return endpoint.models.find(m => m.id === this.config.currentModel) || endpoint.models[0] || null;
    }
    return endpoint.models[0] || null;
  }

  /**
   * Add endpoint
   */
  async addEndpoint(endpointData: Omit<EndpointConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<EndpointConfig> {
    const endpoint: EndpointConfig = {
      ...endpointData,
      id: `ep-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.config.endpoints.push(endpoint);

    // Set as current if first endpoint
    if (this.config.endpoints.length === 1) {
      this.config.currentEndpoint = endpoint.id;
      if (endpoint.models.length > 0) {
        this.config.currentModel = endpoint.models[0].id;
      }
    }

    await this.save();
    logger.info('Endpoint added', { endpointId: endpoint.id, name: endpoint.name });

    return endpoint;
  }

  /**
   * Update endpoint
   */
  async updateEndpoint(
    endpointId: string,
    updates: Partial<Omit<EndpointConfig, 'id' | 'createdAt'>>
  ): Promise<boolean> {
    const index = this.config.endpoints.findIndex(ep => ep.id === endpointId);
    if (index === -1) return false;

    this.config.endpoints[index] = {
      ...this.config.endpoints[index],
      ...updates,
      updatedAt: new Date(),
    };

    await this.save();
    logger.info('Endpoint updated', { endpointId });

    return true;
  }

  /**
   * Remove endpoint
   */
  async removeEndpoint(endpointId: string): Promise<boolean> {
    const index = this.config.endpoints.findIndex(ep => ep.id === endpointId);
    if (index === -1) return false;

    this.config.endpoints.splice(index, 1);

    // Update current endpoint if removed
    if (this.config.currentEndpoint === endpointId) {
      this.config.currentEndpoint = this.config.endpoints[0]?.id;
      this.config.currentModel = this.config.endpoints[0]?.models[0]?.id;
    }

    await this.save();
    logger.info('Endpoint removed', { endpointId });

    return true;
  }

  /**
   * Set current endpoint
   */
  async setCurrentEndpoint(endpointId: string): Promise<boolean> {
    const endpoint = this.config.endpoints.find(ep => ep.id === endpointId);
    if (!endpoint) return false;

    this.config.currentEndpoint = endpointId;

    // Set first model as current
    if (endpoint.models.length > 0) {
      this.config.currentModel = endpoint.models[0].id;
    }

    await this.save();
    logger.info('Current endpoint set', { endpointId });

    return true;
  }

  /**
   * Set current model
   */
  async setCurrentModel(modelId: string): Promise<boolean> {
    const endpoint = this.getCurrentEndpoint();
    if (!endpoint) return false;

    const model = endpoint.models.find(m => m.id === modelId);
    if (!model) return false;

    this.config.currentModel = modelId;
    await this.save();

    return true;
  }

  /**
   * Check if endpoints exist
   */
  hasEndpoints(): boolean {
    return this.config.endpoints.length > 0;
  }

  // ===========================================================================
  // Connection Testing
  // ===========================================================================

  /**
   * Test connection to an endpoint
   */
  async testConnection(
    baseUrl: string,
    apiKey: string | undefined,
    modelId: string
  ): Promise<{ success: boolean; error?: string; latency?: number }> {
    const startTime = Date.now();

    try {
      let url = baseUrl.trim();
      if (!url.endsWith('/')) url += '/';
      url += 'chat/completions';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(30000),
      });

      const latency = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}`;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch {
          if (errorText) {
            errorMessage = errorText.substring(0, 200);
          }
        }

        return { success: false, error: errorMessage };
      }

      return { success: true, latency };
    } catch (error) {
      const latency = Date.now() - startTime;

      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          return { success: false, error: 'Connection timeout', latency };
        }
        return { success: false, error: error.message, latency };
      }

      return { success: false, error: 'Unknown error', latency };
    }
  }

  /**
   * Health check all endpoints
   */
  async healthCheckAll(): Promise<void> {
    for (const endpoint of this.config.endpoints) {
      for (const model of endpoint.models) {
        const result = await this.testConnection(
          endpoint.baseUrl,
          endpoint.apiKey,
          model.id
        );

        model.healthStatus = result.success ? 'healthy' : 'unhealthy';
        model.lastHealthCheck = new Date();
      }
    }

    await this.save();
  }

  // ===========================================================================
  // System Status
  // ===========================================================================

  /**
   * Get system status
   */
  getStatus(): SystemStatus {
    const endpoint = this.getCurrentEndpoint();
    const model = this.getCurrentModel();

    return {
      version: getElectronApp()?.getVersion() ?? 'unknown',
      sessionId: this.currentSessionId || 'No active session',
      workingDir: process.cwd(),
      endpointUrl: endpoint?.baseUrl || 'Not configured',
      llmModel: model ? `${model.name} (${model.id})` : 'Not configured',
      configPath: this.configPath,
    };
  }

  /**
   * Set current session ID
   */
  setCurrentSessionId(sessionId: string | null): void {
    this.currentSessionId = sessionId;
  }

  // ===========================================================================
  // Tool Management
  // ===========================================================================

  getEnabledTools(): string[] {
    return this.config.enabledTools || [];
  }

  async setEnabledTools(toolIds: string[]): Promise<void> {
    this.config.enabledTools = toolIds;
    await this.save();
  }

  async enableTool(toolId: string): Promise<void> {
    const enabledTools = this.config.enabledTools || [];
    if (!enabledTools.includes(toolId)) {
      enabledTools.push(toolId);
      this.config.enabledTools = enabledTools;
      await this.save();
    }
  }

  async disableTool(toolId: string): Promise<void> {
    const enabledTools = this.config.enabledTools || [];
    const index = enabledTools.indexOf(toolId);
    if (index !== -1) {
      enabledTools.splice(index, 1);
      this.config.enabledTools = enabledTools;
      await this.save();
    }
  }

  // ===========================================================================
  // Reset
  // ===========================================================================

  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    await this.save();
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const configManager = new ConfigManager();
export default configManager;
