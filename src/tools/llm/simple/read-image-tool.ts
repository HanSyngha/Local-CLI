/**
 * Read Image Tool (Vision Language Model)
 *
 * LLM Simple Tool ,  VL   HTTP .
 *  LLM read_image  VL  + 
 *    return.
 *
 * :  LLM   . Message   .
 */

import fs from 'node:fs';
import path from 'node:path';
import { configManager } from '../../../core/config/config-manager.js';
import type { LLMSimpleTool, ToolResult } from '../../types.js';
import type { ModelInfo, EndpointConfig } from '../../../types/index.js';

/** Max image size: 100MB */
const MAX_IMAGE_SIZE = 100 * 1024 * 1024;

/** Supported image formats */
const SUPPORTED_FORMATS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/**
 * Find the selected (or first available) vision model from configured endpoints
 */
export function findVisionModel(): { endpoint: EndpointConfig; model: ModelInfo } | null {
  const config = configManager.getConfig();

  // Prefer user-selected vision model if set
  if (config.visionModelId) {
    for (const endpoint of config.endpoints) {
      if (config.visionEndpointId && endpoint.id !== config.visionEndpointId) continue;
      for (const model of endpoint.models) {
        if (model.id === config.visionModelId && model.supportsVision && model.enabled) {
          return { endpoint, model };
        }
      }
    }
  }

  // Fallback: first enabled vision model
  for (const endpoint of config.endpoints) {
    for (const model of endpoint.models) {
      if (model.supportsVision && model.enabled) {
        return { endpoint, model };
      }
    }
  }
  return null;
}

/**
 * Get all available vision models
 */
export function getAllVisionModels(): { endpointId: string; endpointName: string; modelId: string; modelName: string }[] {
  const config = configManager.getConfig();
  const result: { endpointId: string; endpointName: string; modelId: string; modelName: string }[] = [];
  for (const endpoint of config.endpoints) {
    for (const model of endpoint.models) {
      if (model.supportsVision && model.enabled) {
        result.push({
          endpointId: endpoint.id,
          endpointName: endpoint.name || endpoint.id,
          modelId: model.id,
          modelName: model.name || model.id,
        });
      }
    }
  }
  return result;
}

/**
 * read_image tool definition
 */
const readImageTool: LLMSimpleTool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_image',
      description: `Read an image file and analyze it using a Vision Language Model (VL).
You MUST provide a detailed analysis prompt with specific items to check.
The prompt should include a numbered list of things to identify, describe, or verify.

Example prompt:
"Describe this screenshot in detail. Check for:
1. Overall layout structure
2. UI components (buttons, forms, labels)
3. Text content visible
4. Color scheme and styling
5. Any error messages or warnings"

Supported formats: PNG, JPEG, GIF, WebP, BMP. Max size: 100MB.`,
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Brief explanation of why you are reading this image',
          },
          file_path: {
            type: 'string',
            description: 'Absolute path to the image file',
          },
          prompt: {
            type: 'string',
            description: 'Detailed analysis prompt with specific things to check in the image',
          },
        },
        required: ['reason', 'file_path', 'prompt'],
      },
    },
  },
  categories: ['llm-simple'],
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args['file_path'] as string;
    const prompt = args['prompt'] as string;

    if (!filePath || !prompt) {
      return { success: false, error: 'file_path and prompt are required' };
    }

    // 1. Resolve path
    const resolvedPath = path.resolve(filePath);

    // 2. Check file exists
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `File not found: ${resolvedPath}` };
    }

    // 3. Validate extension
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType = SUPPORTED_FORMATS[ext];
    if (!mimeType) {
      return {
        success: false,
        error: `Unsupported image format: ${ext}. Supported: ${Object.keys(SUPPORTED_FORMATS).join(', ')}`,
      };
    }

    // 4. Check file size
    const stat = fs.statSync(resolvedPath);
    if (stat.size > MAX_IMAGE_SIZE) {
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
      return {
        success: false,
        error: `Image too large: ${sizeMB}MB. Maximum: ${MAX_IMAGE_SIZE / (1024 * 1024)}MB`,
      };
    }

    // 5. Find VL model
    const vlModelInfo = findVisionModel();
    if (!vlModelInfo) {
      return {
        success: false,
        error: 'No Vision Language Model (VL) registered. Please register a VL model in the Dashboard or settings.',
      };
    }

    const { endpoint: vlEndpoint, model: vlModel } = vlModelInfo;

    // 6. Read image and encode to base64
    const imageBuffer = fs.readFileSync(resolvedPath);
    const base64 = imageBuffer.toString('base64');
    const imageDataUrl = `data:${mimeType};base64,${base64}`;

    // 7. Build chat/completions URL
    let baseUrl = vlEndpoint.baseUrl.trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    const chatUrl = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;

    // 8. Call VL model
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (vlEndpoint.apiKey) {
        headers['Authorization'] = `Bearer ${vlEndpoint.apiKey}`;
      }


      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const response = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: vlModel.apiModelId || vlModel.name || vlModel.id,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `VL model request failed (${response.status}): ${errorText.slice(0, 500)}`,
        };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const vlResponse = data.choices?.[0]?.message?.content || '';
      if (!vlResponse) {
        return {
          success: false,
          error: 'VL model returned empty response',
        };
      }

      const fileName = path.basename(resolvedPath);
      const truncatedVl = vlResponse.length > 5000
        ? vlResponse.slice(0, 5000) + '\n...(vision analysis truncated)'
        : vlResponse;
      return {
        success: true,
        result: `Image Analysis (${fileName}, via ${vlModel.name || vlModel.id}):\n\n${truncatedVl}`,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'VL model request timed out (120s)' };
      }
      return {
        success: false,
        error: `VL model request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Vision tools array for optional tool group registration
 */
export const VISION_TOOLS: LLMSimpleTool[] = [readImageTool];
