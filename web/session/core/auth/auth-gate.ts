/**
 * Auth Gate
 *
 * CLI      + Dashboard  
 *
 * :
 * 1. loadCredentials() →  
 * 2.  1  → refreshTokenFromServer()  
 * 3. / → performOAuthLogin() + /api/auth/me  plan 
 * 4.   process.exit(1)
 * 5. syncModelsFromDashboard() → /v1/models → configManager  
 */

import chalk from 'chalk';
import {
  loadCredentials,
  performOAuthLogin,
  saveCredentials,
  refreshTokenFromServer,
  type DashboardCredentials,
} from './oauth-login.js';
import { configManager } from '../config/config-manager.js';
import { SERVICE_ID } from '../../constants.js';
import { logger } from '../../utils/logger.js';
import type { EndpointConfig, ModelInfo } from '../../types/index.js';
import { syncVisionToolState } from '../../tools/registry.js';
import { reportError } from '../telemetry/error-reporter.js';

/**
 *   credentials return
 *       process.exit(1)
 */
export async function ensureAuthenticated(
  dashboardUrl: string,
): Promise<DashboardCredentials> {
  // 1.  credentials 
  const existing = await loadCredentials();

  if (existing) {
    // Dashboard URL    sign in
    if (existing.dashboardUrl !== dashboardUrl) {
      logger.warn('Auth: dashboardUrl changed, forcing re-login', {
        old: existing.dashboardUrl,
        new: dashboardUrl,
      });
      console.log(chalk.yellow(`\n  Dashboard  . sign in .`));
    } else {
      const expiresAt = new Date(existing.expiresAt);
      const now = new Date();
      const oneHourMs = 60 * 60 * 1000;
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();

      //   1   →  
      if (timeUntilExpiry > oneHourMs) {
        return existing;
      }

      //   1  →   
      if (timeUntilExpiry > 0) {
        const refreshed = await refreshTokenFromServer(existing);
        if (refreshed) {
          return refreshed;
        }
        //       
        return existing;
      }
    }
  }

  // 2.    → OAuth sign in
  console.log(chalk.cyan(`\n  Dashboard: ${dashboardUrl}`));

  const creds = await performOAuthLogin(dashboardUrl);

  if (!creds) {
    console.log(chalk.red('\n  sign in .  .\n'));
    process.exit(1);
  }

  console.log(chalk.green('  sign in !'));
  if (creds.displayName) {
    console.log(chalk.dim(`  : ${creds.displayName} (${creds.provider || ''})`));
  }
  if (creds.email) {
    console.log(chalk.dim(`  : ${creds.email}`));
  }

  // 3. /api/auth/me plan  
  try {
    const meRes = await fetch(`${dashboardUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    });
    if (meRes.ok) {
      const meData = (await meRes.json()) as {
        plan?: { name: string; displayName: string; tier: string };
      };
      if (meData.plan) {
        creds.plan = meData.plan;
        await saveCredentials(creds);
        console.log(chalk.dim(`  : ${meData.plan.displayName}`));
      }
    }
  } catch {
    // Plan fetch   (sign in  )
  }

  console.log(chalk.dim(`  : ${new Date(creds.expiresAt).toLocaleString()}\n`));

  return creds;
}

/**
 * Dashboard    configManager  
 *
 * GET ${dashboardUrl}/v1/models  → _hanseol    
 * → configManager "dashboard" endpoint  /
 */
export async function syncModelsFromDashboard(
  dashboardUrl: string,
  token: string,
): Promise<void> {
  logger.flow('Syncing models from Dashboard');

  const DASHBOARD_ENDPOINT_ID = 'dashboard';

  try {
    const res = await fetch(`${dashboardUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Service-Id': SERVICE_ID },
    });

    if (!res.ok) {
      throw new Error(`GET /v1/models failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      data: Array<{
        id: string;
        _hanseol?: {
          id: string;
          modelName: string;
          displayName: string;
          maxTokens: number;
          supportsVision?: boolean;
        };
      }>;
    };

    // _hanseol    
    const models: ModelInfo[] = (data.data || []).map((m) => ({
      id: m._hanseol?.id || m.id,
      name: m._hanseol?.displayName || m.id,
      apiModelId: m._hanseol?.modelName || m.id,
      maxTokens: m._hanseol?.maxTokens || 128000,
      enabled: true,
      supportsVision: m._hanseol?.supportsVision || false,
    }));

    logger.flow('Models fetched from Dashboard', {
      count: models.length,
      models: models.map((m) => m.id),
    });

    const config = configManager.getConfig();

    //   endpoint   — Dashboard endpoint 
    config.endpoints = config.endpoints.filter((ep) => ep.id === DASHBOARD_ENDPOINT_ID);

    if (models.length === 0) {
      // Dashboard   endpoint    
      config.endpoints = [];
      config.currentEndpoint = undefined;
      config.currentModel = undefined;
      await configManager.saveConfig();
      logger.warn('Dashboard returned no models — cleared all endpoints');
      return;
    }

    const existingIndex = config.endpoints.findIndex((ep) => ep.id === DASHBOARD_ENDPOINT_ID);

    if (existingIndex >= 0) {
      //  dashboard endpoint  (  +  )
      config.endpoints[existingIndex]!.models = models;
      config.endpoints[existingIndex]!.apiKey = token;
      config.endpoints[existingIndex]!.updatedAt = new Date();
    } else {
      //  
      const endpoint: EndpointConfig = {
        id: DASHBOARD_ENDPOINT_ID,
        name: 'Dashboard',
        baseUrl: `${dashboardUrl}/v1`,
        apiKey: token,
        models,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      config.endpoints.push(endpoint);
    }

    //  endpoint dashboard 
    config.currentEndpoint = DASHBOARD_ENDPOINT_ID;

    //            
    const currentModelExists = models.some((m) => m.id === config.currentModel);
    if (!config.currentModel || !currentModelExists) {
      config.currentModel = models[0]?.id;
    }

    await configManager.saveConfig();

    logger.flow('Dashboard models synced to configManager', {
      endpointId: DASHBOARD_ENDPOINT_ID,
      modelCount: models.length,
      currentModel: config.currentModel,
    });

    // Sync vision tool state based on VL model availability
    await syncVisionToolState();
  } catch (error) {
    logger.errorSilent('Failed to sync models from Dashboard', error as Error);
    reportError(error, { type: 'modelSync' }).catch(() => {});
    throw error;
  }
}
