/**
 * Browser Sub-Agent
 *
 * Browser lifecycle + auth + SubAgent delegation.
 * Confluence/Jira/Search agent    .
 */

import { LLMClient } from '../../core/llm/llm-client.js';
import { LLMSimpleTool, ToolResult } from '../../tools/types.js';
import { BrowserServiceConfig } from '../../types/index.js';
import { SubAgent } from '../common/sub-agent.js';
import { configManager } from '../../core/config/config-manager.js';
import {
  ensureAuthenticated,
  launchSubAgentBrowser,
  getSubAgentBrowserClient,
  ATLASSIAN_LOGIN_INDICATORS,
  LoginIndicators,
} from './browser-profile-manager.js';
import { logger } from '../../utils/logger.js';

export interface BrowserSubAgentConfig {
  requiresAuth: boolean;
  serviceType: 'confluence' | 'jira' | 'search';
  loginIndicators?: LoginIndicators;
  maxIterations?: number;
  /** Launch browser in headless mode (default: true) */
  headless?: boolean;
}

export class BrowserSubAgent {
  constructor(
    private llmClient: LLMClient,
    private serviceName: string,
    private tools: LLMSimpleTool[],
    private systemPrompt: string,
    private config: BrowserSubAgentConfig
  ) {}

  async run(instruction: string, sourceUrl?: string): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // 1. URL 
      const url = sourceUrl || this.resolveServiceUrl();
      if (!url && this.config.serviceType !== 'search') {
        return {
          success: false,
          error: this.getUrlNotConfiguredMessage(),
        };
      }

      // 2.  
      const headless = this.config.headless !== undefined ? this.config.headless : true;
      const launchResult = await launchSubAgentBrowser(headless);
      if (!launchResult.success) {
        return {
          success: false,
          error: launchResult.error || 'Failed to launch browser. Chrome or Edge must be installed.',
        };
      }

      // 3.  (search )
      if (this.config.requiresAuth && url) {
        const indicators = this.config.loginIndicators || ATLASSIAN_LOGIN_INDICATORS;
        const authResult = await ensureAuthenticated(url, indicators);
        if (!authResult.success) {
          return {
            success: false,
            error: `Authentication failed: ${authResult.error}`,
          };
        }
      }

      // 4. URL  instruction 
      const enrichedInstruction = url
        ? `[Target URL: ${url}]\n\n${instruction}`
        : instruction;

      // 5. agent  BrowserClient 
      const client = getSubAgentBrowserClient();
      const boundTools = this.bindToolsToClient(client);

      // 6. SubAgent delegation
      const agent = new SubAgent(
        this.llmClient,
        this.serviceName,
        boundTools,
        this.systemPrompt,
        { maxIterations: this.config.maxIterations ?? 25 }
      );

      const result = await agent.run(enrichedInstruction);

      const duration = Date.now() - startTime;
      logger.info(`BrowserSubAgent[${this.serviceName}] completed`, {
        success: result.success,
        duration,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`BrowserSubAgent[${this.serviceName}] error`, { error: errorMsg });
      return {
        success: false,
        error: `Browser sub-agent error: ${errorMsg}`,
      };
    }
  }

  /**
   * config.json  URL 
   */
  private resolveServiceUrl(): string | undefined {
    try {
      const config = configManager.getConfig();
      const services: BrowserServiceConfig[] = config.browserServices || [];
      const first = services.find(s => s.type === this.config.serviceType);
      return first?.url;
    } catch {
      return undefined;
    }
  }

  /**
   * URL    
   */
  private getUrlNotConfiguredMessage(): string {
    const typeLabel = this.config.serviceType === 'confluence' ? 'Confluence' : 'Jira';
    return `${typeLabel} URL is not configured.\n\n` +
      `How to configure: Add browserServices to config.json.\n` +
      `Example:\n` +
      `{\n` +
      `  "browserServices": [\n` +
      `    { "type": "${this.config.serviceType}", "name": "My ${typeLabel}", "url": "https://${this.config.serviceType}.example.com" }\n` +
      `  ]\n` +
      `}`;
  }

  /**
   * agent  BrowserClient 
   * browser-tools.ts  singleton browserClient ,
   * agent dedicated client     
   */
  private bindToolsToClient(client: import('../../tools/browser/browser-client.js').BrowserClient): LLMSimpleTool[] {
    return this.tools.map(tool => ({
      ...tool,
      execute: async (args: Record<string, unknown>) => {
        const toolName = tool.definition.function.name;
        return this.executeToolWithClient(toolName, args, client);
      },
    }));
  }

  /**
   * BrowserClient     
   */
  private async executeToolWithClient(
    toolName: string,
    args: Record<string, unknown>,
    client: import('../../tools/browser/browser-client.js').BrowserClient
  ): Promise<ToolResult> {
    try {
      let result: { success: boolean; error?: string; [key: string]: unknown };

      switch (toolName) {
        case 'browser_navigate':
          result = await client.navigate(args['url'] as string);
          break;
        case 'browser_screenshot':
          result = await client.screenshot(args['full_page'] as boolean);
          if (result.success && (result as { image?: string }).image) {
            return { success: true, result: `Screenshot captured (base64 image, ${((result as { image?: string }).image || '').length} chars)` };
          }
          break;
        case 'browser_click':
          result = await client.click(args['selector'] as string);
          break;
        case 'browser_fill':
          result = await client.fill(args['selector'] as string, args['value'] as string);
          break;
        case 'browser_get_text':
          result = await client.getText(args['selector'] as string | undefined);
          break;
        case 'browser_get_html':
          result = await client.getHtml();
          break;
        case 'browser_get_page_info':
          result = await client.getPageInfo();
          break;
        case 'browser_focus':
          result = await client.focus();
          break;
        case 'browser_press_key':
          result = await client.pressKey(args['key'] as string, args['selector'] as string | undefined);
          break;
        case 'browser_type':
          result = await client.type(args['text'] as string, args['selector'] as string | undefined);
          break;
        case 'browser_execute_script':
          result = await client.executeScript(args['script'] as string);
          break;
        case 'browser_wait':
          result = await client.waitFor(args['selector'] as string, args['timeout'] as number | undefined);
          break;
        case 'browser_send':
          result = await client.send(args['method'] as string, args['params'] as Record<string, unknown> | undefined);
          break;
        default:
          return { success: false, error: `Unknown browser tool: ${toolName}` };
      }

      if (!result.success) {
        return { success: false, error: result.error || 'Unknown error' };
      }

      //   
      const { success: _, error: _err, ...rest } = result;
      const resultText = Object.keys(rest).length > 0
        ? JSON.stringify(rest, null, 2)
        : result['message'] || '(success)';

      return { success: true, result: typeof resultText === 'string' ? resultText : JSON.stringify(resultText) };
    } catch (error) {
      return {
        success: false,
        error: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
