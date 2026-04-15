/**
 * Configuration Manager
 *
 * LOCAL-CLI   
 * ~/.local-cli/     
 */

import { OpenConfig, EndpointConfig, ModelInfo } from '../../types/index.js';
import {
  OPEN_HOME_DIR,
  CONFIG_FILE_PATH,
  DOCS_DIR,
  BACKUPS_DIR,
  PROJECTS_DIR,
} from '../../constants.js';
import {
  ensureDirectory,
  readJsonFile,
  writeJsonFile,
  directoryExists,
} from '../../utils/file-system.js';
import { logger } from '../../utils/logger.js';

/**
 *   ( )
 */
const DEFAULT_CONFIG: OpenConfig = {
  version: '0.1.0',
  currentEndpoint: undefined,
  currentModel: undefined,
  endpoints: [],
  settings: {
    autoApprove: false,
    debugMode: false,
    streamResponse: true,
    autoSave: true,
  },
};

/**
 * ConfigManager 
 *
 *     
 */
export class ConfigManager {
  private config: OpenConfig | null = null;
  private initialized = false;

  /**
   * LOCAL-CLI 
   * ~/.local-cli/     
   */
  async initialize(): Promise<void> {
    logger.enter('ConfigManager.initialize');
    if (this.initialized) {
      logger.flow('ConfigManager already initialized');
      return;
    }

    //   
    await ensureDirectory(OPEN_HOME_DIR);

    //   
    await ensureDirectory(DOCS_DIR);
    await ensureDirectory(BACKUPS_DIR);
    await ensureDirectory(PROJECTS_DIR);

    //     
    await this.loadOrCreateConfig();

    this.initialized = true;
    logger.exit('ConfigManager.initialize', { success: true });
  }

  /**
   *       
   */
  private async loadOrCreateConfig(): Promise<void> {
    const existingConfig = await readJsonFile<OpenConfig>(CONFIG_FILE_PATH);

    if (existingConfig) {
      this.config = existingConfig;
    } else {
      //   
      this.config = { ...DEFAULT_CONFIG };
      await this.saveConfig();
    }
  }

  /**
   *  
   */
  async saveConfig(): Promise<void> {
    if (!this.config) {
      const error = new Error('Configuration not initialized');
      logger.error('Config save failed', error);
      throw error;
    }

    logger.flow('Saving configuration');
    await writeJsonFile(CONFIG_FILE_PATH, this.config);
  }

  /**
   *   
   */
  getConfig(): OpenConfig {
    if (!this.config) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }

    return this.config;
  }

  /**
   *   
   */
  getCurrentEndpoint(): EndpointConfig | null {
    const config = this.getConfig();

    if (!config.currentEndpoint) {
      return null;
    }

    return config.endpoints.find((ep) => ep.id === config.currentEndpoint) || null;
  }

  /**
   *    
   */
  getCurrentModel(): ModelInfo | null {
    const endpoint = this.getCurrentEndpoint();

    if (!endpoint || !this.config?.currentModel) {
      return null;
    }

    return endpoint.models.find((m) => m.id === this.config?.currentModel) || null;
  }

  /**
   *   
   */
  getAllEndpoints(): EndpointConfig[] {
    return this.getConfig().endpoints;
  }

  /**
   *  
   */
  async addEndpoint(endpoint: EndpointConfig): Promise<void> {
    const config = this.getConfig();

    // ID  
    const exists = config.endpoints.some((ep) => ep.id === endpoint.id);
    if (exists) {
      throw new Error(`Endpoint with ID ${endpoint.id} already exists`);
    }

    config.endpoints.push(endpoint);
    await this.saveConfig();
  }

  /**
   *  
   */
  async removeEndpoint(endpointId: string): Promise<void> {
    const config = this.getConfig();

    config.endpoints = config.endpoints.filter((ep) => ep.id !== endpointId);

    //         ( undefined)
    if (config.currentEndpoint === endpointId) {
      const firstEndpoint = config.endpoints[0];
      config.currentEndpoint = firstEndpoint?.id;

      //       
      if (firstEndpoint) {
        const firstModel = firstEndpoint.models.find((m) => m.enabled);
        config.currentModel = firstModel?.id;
      } else {
        config.currentModel = undefined;
      }
    }

    await this.saveConfig();
  }

  /**
   *   
   */
  async setCurrentEndpoint(endpointId: string): Promise<void> {
    const config = this.getConfig();

    const endpoint = config.endpoints.find((ep) => ep.id === endpointId);
    if (!endpoint) {
      throw new Error(`Endpoint ${endpointId} not found`);
    }

    config.currentEndpoint = endpointId;

    //       
    const activeModel = endpoint.models.find((m) => m.enabled);
    if (activeModel) {
      config.currentModel = activeModel.id;
    }

    await this.saveConfig();
  }

  /**
   *   
   */
  async setCurrentModel(modelId: string): Promise<void> {
    const config = this.getConfig();
    const endpoint = this.getCurrentEndpoint();

    if (!endpoint) {
      throw new Error('No endpoint selected');
    }

    const model = endpoint.models.find((m) => m.id === modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found in current endpoint`);
    }

    if (!model.enabled) {
      throw new Error(`Model ${modelId} is disabled`);
    }

    config.currentModel = modelId;
    await this.saveConfig();
  }

  async setVisionModel(endpointId: string, modelId: string): Promise<void> {
    const config = this.getConfig();
    config.visionEndpointId = endpointId;
    config.visionModelId = modelId;
    await this.saveConfig();
  }

  /**
   *   
   */
  async updateSettings(settings: Partial<OpenConfig['settings']>): Promise<void> {
    const config = this.getConfig();
    config.settings = { ...config.settings, ...settings };
    await this.saveConfig();
  }

  /**
   *     
   */
  async isInitialized(): Promise<boolean> {
    return await directoryExists(OPEN_HOME_DIR);
  }

  /**
   *    
   */
  hasEndpoints(): boolean {
    if (!this.config) {
      return false;
    }
    return this.config.endpoints.length > 0;
  }

  /**
   *   
   *       / 
   */
  async createInitialEndpoint(endpoint: EndpointConfig): Promise<void> {
    const config = this.getConfig();

    //   
    config.endpoints.push(endpoint);

    //   / 
    config.currentEndpoint = endpoint.id;

    //       
    const activeModel = endpoint.models.find((m) => m.enabled);
    if (activeModel) {
      config.currentModel = activeModel.id;
    }

    await this.saveConfig();
  }

  /**
   *   ( )
   */
  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    await this.saveConfig();
  }

  /**
   *  
   */
  async updateEndpoint(
    endpointId: string,
    updates: Partial<Omit<EndpointConfig, 'id' | 'createdAt'>>
  ): Promise<void> {
    const config = this.getConfig();
    const endpointIndex = config.endpoints.findIndex((ep) => ep.id === endpointId);

    if (endpointIndex === -1) {
      throw new Error(`Endpoint ${endpointId} not found`);
    }

    const endpoint = config.endpoints[endpointIndex]!;
    config.endpoints[endpointIndex] = {
      ...endpoint,
      ...updates,
      updatedAt: new Date(),
    };

    await this.saveConfig();
  }

  /**
   *  health  
   */
  async updateModelHealth(
    endpointId: string,
    modelId: string,
    status: 'healthy' | 'degraded' | 'unhealthy',
    _latency?: number
  ): Promise<void> {
    const config = this.getConfig();
    const endpoint = config.endpoints.find((ep) => ep.id === endpointId);

    if (!endpoint) {
      throw new Error(`Endpoint ${endpointId} not found`);
    }

    const model = endpoint.models.find((m) => m.id === modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found in endpoint ${endpointId}`);
    }

    model.healthStatus = status;
    model.lastHealthCheck = new Date();

    await this.saveConfig();
  }

  /**
   *   health   
   */
  async updateAllHealthStatus(
    healthResults: Map<string, { modelId: string; healthy: boolean; latency?: number }[]>
  ): Promise<void> {
    const config = this.getConfig();

    for (const [endpointId, modelResults] of healthResults) {
      const endpoint = config.endpoints.find((ep) => ep.id === endpointId);
      if (!endpoint) continue;

      for (const result of modelResults) {
        const model = endpoint.models.find((m) => m.id === result.modelId);
        if (model) {
          model.healthStatus = result.healthy ? 'healthy' : 'unhealthy';
          model.lastHealthCheck = new Date();
        }
      }
    }

    await this.saveConfig();
  }

  /**
   *  healthy   
   */
  getHealthyModels(): { endpoint: EndpointConfig; model: ModelInfo }[] {
    const config = this.getConfig();
    const healthyModels: { endpoint: EndpointConfig; model: ModelInfo }[] = [];

    for (const endpoint of config.endpoints) {
      for (const model of endpoint.models) {
        if (model.enabled && model.healthStatus === 'healthy') {
          healthyModels.push({ endpoint, model });
        }
      }
    }

    return healthyModels;
  }

  /**
   *     (  )
   */
  getAllModels(): { endpoint: EndpointConfig; model: ModelInfo; isCurrent: boolean }[] {
    const config = this.getConfig();
    const allModels: { endpoint: EndpointConfig; model: ModelInfo; isCurrent: boolean }[] = [];

    for (const endpoint of config.endpoints) {
      for (const model of endpoint.models) {
        const isCurrent =
          endpoint.id === config.currentEndpoint && model.id === config.currentModel;
        allModels.push({ endpoint, model, isCurrent });
      }
    }

    return allModels;
  }

  /**
   * Get enabled tool group IDs
   */
  getEnabledTools(): string[] {
    const config = this.getConfig();
    return config.enabledTools || [];
  }

  /**
   * Set enabled tool group IDs
   */
  async setEnabledTools(toolIds: string[]): Promise<void> {
    const config = this.getConfig();
    config.enabledTools = toolIds;
    await this.saveConfig();
  }

  /**
   * Enable a tool group
   */
  async enableTool(toolId: string): Promise<void> {
    const config = this.getConfig();
    const enabledTools = config.enabledTools || [];
    if (!enabledTools.includes(toolId)) {
      enabledTools.push(toolId);
      config.enabledTools = enabledTools;
      await this.saveConfig();
    }
  }

  /**
   * Disable a tool group
   */
  async disableTool(toolId: string): Promise<void> {
    const config = this.getConfig();
    const enabledTools = config.enabledTools || [];
    const index = enabledTools.indexOf(toolId);
    if (index !== -1) {
      enabledTools.splice(index, 1);
      config.enabledTools = enabledTools;
      await this.saveConfig();
    }
  }
}

/**
 * ConfigManager singleton 
 */
export const configManager = new ConfigManager();
