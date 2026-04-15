/**
 * Tool Registry
 *
 *    
 *     
 *
 * CLI parity: src/tools/registry.ts
 *
 * Features:
 * - Multi-category registration (     )
 * - Type-safe tool retrieval
 * - LLM tool definitions export
 * - Optional tools with enable/disable support
 */

import type { ToolDefinition } from '../core';
import type {
  AnyTool,
  ToolCategory,
  LLMSimpleTool,
  LLMAgentTool,
} from './types';
import { isLLMSimpleTool, isLLMAgentTool } from './types';
import { configManager } from '../core/config';
import { logger } from '../utils/logger';

// Import Core Tools from new structure
import {
  FILE_TOOLS,
  POWERSHELL_TOOLS,
  TODO_TOOLS,
  USER_TOOLS,
  finalResponseTool,
  PLANNING_TOOLS,
} from './llm/simple';

// Import Optional Tools (CLI parity: tools/browser)
import { BROWSER_TOOLS } from './browser';
import { VISION_TOOLS, findVisionModel } from './llm/simple/read-image-tool';

// Import Desktop Control agent tool (Electron exclusive)
import { createDesktopControlTool } from '../agents/desktop-control';

// Import office sub-agent tools (Agent as a Tool)
import {
  createWordCreateRequestTool,
  createWordModifyRequestTool,
  createExcelCreateRequestTool,
  createExcelModifyRequestTool,
  createPowerPointCreateRequestTool,
  createPowerPointModifyRequestTool,
} from '../agents/office';

// Import browser sub-agent tools (CLI parity: src/agents/browser)
import {
  createConfluenceRequestTool,
  createJiraRequestTool,
  createSearchRequestTool,
} from '../agents/browser';

// =============================================================================
// Types
// =============================================================================

/**
 * Enable result with optional error message
 */
export interface EnableResult {
  success: boolean;
  error?: string;
}

/**
 * Optional tool group definition
 */
export interface OptionalToolGroup {
  id: string;
  name: string;
  description: string;
  tools: LLMSimpleTool[];
  enabled: boolean;
  onEnable?: () => Promise<EnableResult>;
  onDisable?: () => Promise<void>;
  autoManaged?: boolean;  // If true, hidden from tool UI (managed by system)
}

// =============================================================================
// Optional Tool Groups Configuration
// =============================================================================

function getOptionalToolGroupsConfig(): OptionalToolGroup[] {
  return [
    {
      id: 'browser',
      name: 'Browser Automation',
      description: 'Control Chrome/Edge browser (navigate, click, screenshot, etc.)',
      tools: BROWSER_TOOLS,
      enabled: false,
    },
    {
      id: 'vision',
      name: 'Vision (Image Reading)',
      description: 'Read and analyze images using a registered Vision Language Model',
      tools: VISION_TOOLS,
      enabled: false,
      autoManaged: true,
    },
    {
      id: 'desktop-control',
      name: 'Desktop Control (Vision)',
      description: 'AI controls Windows desktop via screenshot analysis — mouse, keyboard, any application (requires VL model)',
      tools: [createDesktopControlTool()],
      enabled: false,
    },
    // Office tools removed — now provided as sub-agent tools
    // (word_create_agent, word_modify_agent, excel_create_agent, excel_modify_agent, powerpoint_create_agent, powerpoint_modify_agent)
  ];
}

// =============================================================================
// Tool Registry Class
// =============================================================================

class ToolRegistry {
  private tools: Map<string, AnyTool> = new Map();
  private categoryIndex: Map<ToolCategory, Set<string>> = new Map();
  private optionalToolGroups: Map<string, OptionalToolGroup> = new Map();
  private enabledOptionalTools: Set<string> = new Set();

  constructor() {
    // Initialize category index
    const categories: ToolCategory[] = ['llm-simple', 'llm-agent', 'llm-planning'];
    for (const category of categories) {
      this.categoryIndex.set(category, new Set());
    }

    // Initialize optional tool groups
    for (const group of getOptionalToolGroupsConfig()) {
      this.optionalToolGroups.set(group.id, { ...group });
    }
  }

  /**
   * Register a tool
   */
  register(tool: AnyTool): void {
    let name: string;
    if ('definition' in tool) {
      name = tool.definition.function.name;
    } else if ('name' in tool) {
      name = (tool as { name: string }).name;
    } else {
      throw new Error('Tool must have a name or definition');
    }

    this.tools.set(name, tool);

    // Index by categories
    if ('categories' in tool) {
      for (const category of (tool as LLMSimpleTool).categories) {
        this.categoryIndex.get(category)?.add(name);
      }
    }
  }

  /**
   * Register multiple tools
   */
  registerAll(tools: AnyTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get tool by name
   */
  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tools in a category
   */
  getByCategory(category: ToolCategory): AnyTool[] {
    const names = this.categoryIndex.get(category) || new Set();
    return Array.from(names)
      .map((name) => this.tools.get(name))
      .filter((tool): tool is AnyTool => tool !== undefined);
  }

  /**
   * Get all LLM Simple tools
   */
  getLLMSimpleTools(): LLMSimpleTool[] {
    return this.getByCategory('llm-simple').filter(isLLMSimpleTool);
  }

  /**
   * Get all LLM Agent tools
   */
  getLLMAgentTools(): LLMAgentTool[] {
    return this.getByCategory('llm-agent').filter(isLLMAgentTool);
  }

  /**
   * Get all LLM Planning tools
   */
  getLLMPlanningTools(): LLMSimpleTool[] {
    return this.getByCategory('llm-planning').filter(isLLMSimpleTool);
  }

  /**
   * Get LLM Planning tool definitions (for Planning LLM)
   */
  getLLMPlanningToolDefinitions(): ToolDefinition[] {
    return this.getLLMPlanningTools().map((tool) => tool.definition);
  }

  /**
   * Get all LLM tool definitions (for chatCompletion)
   */
  getLLMToolDefinitions(): ToolDefinition[] {
    const llmTools = [
      ...this.getLLMSimpleTools(),
      ...this.getLLMAgentTools(),
    ];
    return llmTools.map((tool) => tool.definition);
  }

  /**
   * Enable an optional tool group
   */
  async enableToolGroup(groupId: string, persist: boolean = true, skipValidation: boolean = false): Promise<EnableResult> {
    logger.enter('enableToolGroup', { groupId, persist, skipValidation });
    const group = this.optionalToolGroups.get(groupId);
    if (!group) {
      logger.warn('Tool group not found', { groupId });
      return { success: false, error: `Tool group '${groupId}' not found` };
    }

    // Run validation if onEnable callback exists
    if (!skipValidation && group.onEnable) {
      const result = await group.onEnable();
      if (!result.success) {
        logger.warn('Tool group validation failed', { groupId, error: result.error });
        return result;
      }
    }

    group.enabled = true;

    // Register tools to the main registry
    for (const tool of group.tools) {
      this.register(tool);
      this.enabledOptionalTools.add(tool.definition.function.name);
    }

    // Persist state to config
    if (persist) {
      configManager.enableTool(groupId).catch(() => {});
    }

    logger.info('Tool group enabled', { groupId, toolCount: group.tools.length });
    logger.exit('enableToolGroup', { success: true });
    return { success: true };
  }

  /**
   * Disable an optional tool group
   */
  async disableToolGroup(groupId: string, persist: boolean = true): Promise<boolean> {
    logger.enter('disableToolGroup', { groupId, persist });
    const group = this.optionalToolGroups.get(groupId);
    if (!group) {
      logger.warn('Tool group not found for disable', { groupId });
      return false;
    }

    group.enabled = false;

    // Remove tools from the main registry
    for (const tool of group.tools) {
      const toolName = tool.definition.function.name;
      this.tools.delete(toolName);
      this.enabledOptionalTools.delete(toolName);

      // Remove from category index
      for (const category of tool.categories) {
        this.categoryIndex.get(category)?.delete(toolName);
      }
    }

    // Call onDisable callback
    if (group.onDisable) {
      try {
        await group.onDisable();
      } catch {
        // Ignore cleanup errors
      }
    }

    // Persist state to config
    if (persist) {
      configManager.disableTool(groupId).catch(() => {});
    }

    logger.info('Tool group disabled', { groupId });
    logger.exit('disableToolGroup', { success: true });
    return true;
  }

  /**
   * Toggle an optional tool group
   */
  async toggleToolGroup(groupId: string): Promise<EnableResult> {
    const group = this.optionalToolGroups.get(groupId);
    if (!group) {
      return { success: false, error: `Tool group '${groupId}' not found` };
    }

    if (group.enabled) {
      const success = await this.disableToolGroup(groupId);
      return { success };
    } else {
      return await this.enableToolGroup(groupId);
    }
  }

  /**
   * Get all optional tool groups with their current state
   */
  getOptionalToolGroups(): OptionalToolGroup[] {
    return Array.from(this.optionalToolGroups.values());
  }

  /**
   * Check if an optional tool group is enabled
   */
  isToolGroupEnabled(groupId: string): boolean {
    return this.optionalToolGroups.get(groupId)?.enabled ?? false;
  }

  /**
   * Get enabled optional tool group IDs
   */
  getEnabledToolGroupIds(): string[] {
    return Array.from(this.optionalToolGroups.values())
      .filter(g => g.enabled)
      .map(g => g.id);
  }

  /**
   * Get enabled optional tools info for planning prompt
   */
  getEnabledOptionalToolsInfo(): string {
    const enabledGroups = Array.from(this.optionalToolGroups.values())
      .filter(g => g.enabled);

    if (enabledGroups.length === 0) {
      return '';
    }

    const lines: string[] = ['', '**Currently enabled optional tools:**'];
    for (const group of enabledGroups) {
      lines.push(`- **${group.name}**: ${group.description}`);
    }
    return lines.join('\n');
  }

  /**
   * Get tool summary for planning prompt
   */
  getToolSummaryForPlanning(): string {
    const lines: string[] = [];
    const simpleTools = this.getLLMSimpleTools();
    const agentTools = this.getLLMAgentTools();

    for (const tool of [...simpleTools, ...agentTools]) {
      const name = tool.definition.function.name;
      const desc = tool.definition.function.description?.split('\n')[0] || '';
      const shortDesc = desc.length > 80 ? desc.slice(0, 77) + '...' : desc;
      lines.push(`- \`${name}\`: ${shortDesc}`);
    }

    return lines.join('\n');
  }

  /**
   * Get tool count statistics
   */
  getStats(): { total: number; core: number; optional: number; categories: Record<string, number> } {
    const stats: Record<string, number> = {};
    for (const [category, names] of this.categoryIndex) {
      stats[category] = names.size;
    }

    const coreCount = FILE_TOOLS.length + POWERSHELL_TOOLS.length + TODO_TOOLS.length + USER_TOOLS.length + 1; // +1 for final_response
    const optionalCount = this.enabledOptionalTools.size;

    return {
      total: this.tools.size,
      core: coreCount,
      optional: optionalCount,
      categories: stats,
    };
  }

  /**
   * List all registered tool names
   */
  listAll(): string[] {
    return Array.from(this.tools.keys());
  }
}

// =============================================================================
// Global Registry Instance
// =============================================================================

export const toolRegistry = new ToolRegistry();

// =============================================================================
// Initialize Registry
// =============================================================================

export function initializeToolRegistry(): void {
  // LLM Simple Tools - File operations
  toolRegistry.registerAll(FILE_TOOLS);

  // LLM Simple Tools - PowerShell (Windows native)
  toolRegistry.registerAll(POWERSHELL_TOOLS);

  // LLM Simple Tools - TODO management
  toolRegistry.registerAll(TODO_TOOLS);

  // LLM Simple Tools - User interaction
  toolRegistry.registerAll(USER_TOOLS);

  // LLM Simple Tools - Final response
  toolRegistry.register(finalResponseTool);

  // LLM Planning Tools
  toolRegistry.registerAll(PLANNING_TOOLS);

  // Note: External service tools not included

  // Office sub-agent tools (Agent as a Tool)
  // Electron runs on Windows, so always register
  toolRegistry.register(createWordCreateRequestTool());
  toolRegistry.register(createWordModifyRequestTool());
  toolRegistry.register(createExcelCreateRequestTool());
  toolRegistry.register(createExcelModifyRequestTool());
  toolRegistry.register(createPowerPointCreateRequestTool());
  toolRegistry.register(createPowerPointModifyRequestTool());

  // Browser sub-agent tools (CLI parity)
  // Search: always available (no URL needed)
  toolRegistry.register(createSearchRequestTool());
  // Confluence/Jira: only register when URL is configured in browserServices
  try {
    const config = configManager.getAll() as unknown as { browserServices?: Array<{ type: string }> };
    const browserServices = config.browserServices || [];
    if (browserServices.some(s => s.type === 'confluence')) {
      toolRegistry.register(createConfluenceRequestTool());
    }
    if (browserServices.some(s => s.type === 'jira')) {
      toolRegistry.register(createJiraRequestTool());
    }
  } catch {
    // Config not loaded yet — skip conditional registration
  }
}

/**
 * Initialize optional tool groups from saved config
 */
export async function initializeOptionalTools(): Promise<void> {
  try {
    const enabledToolIds = configManager.getEnabledTools();
    for (const toolId of enabledToolIds) {
      await toolRegistry.enableToolGroup(toolId, false, true);
    }
  } catch {
    // Config not initialized yet
  }
}

/**
 * Sync vision tool state based on VL model availability.
 * Enables vision tools if a VL model exists, disables if not.
 */
export async function syncVisionToolState(): Promise<void> {
  const vlModel = findVisionModel();
  if (vlModel) {
    if (!toolRegistry.isToolGroupEnabled('vision')) {
      await toolRegistry.enableToolGroup('vision', false, true);
      logger.info('Vision tools auto-enabled (VL model found)', {
        model: vlModel.model.name || vlModel.model.id,
      });
    }
  } else {
    if (toolRegistry.isToolGroupEnabled('vision')) {
      await toolRegistry.disableToolGroup('vision', false);
      logger.info('Vision tools auto-disabled (no VL model)');
    }
  }
}

// =============================================================================
// Auto-initialize on import
// =============================================================================

initializeToolRegistry();

export default toolRegistry;
