/**
 * Model Selector Component
 *
 * Allows switching between healthy LLM models via /model command
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { configManager } from '../../core/config/config-manager.js';
import { LLMClient } from '../../core/llm/llm-client.js';
import { EndpointConfig, ModelInfo } from '../../types/index.js';

interface ModelSelectorProps {
  onSelect: (endpointId: string, modelId: string) => void;
  onCancel: () => void;
}

interface SelectItem {
  label: string;
  value: string;
}

interface ModelWithEndpoint {
  endpoint: EndpointConfig;
  model: ModelInfo;
  isCurrent: boolean;
  isHealthy: boolean;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ onSelect, onCancel }) => {
  const [models, setModels] = useState<ModelWithEndpoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load models and health status
  useEffect(() => {
    const loadModels = async () => {
      setIsLoading(true);

      try {
        // Get all models
        const allModels = configManager.getAllModels();

        // Run health check
        const healthResults = await LLMClient.healthCheckAll();

        // Build model list with health status
        const modelsWithHealth: ModelWithEndpoint[] = allModels.map((m) => {
          const endpointHealth = healthResults.get(m.endpoint.id);
          const modelHealth = endpointHealth?.find((h) => h.modelId === m.model.id);

          return {
            endpoint: m.endpoint,
            model: m.model,
            isCurrent: m.isCurrent,
            isHealthy: modelHealth?.healthy ?? m.model.healthStatus === 'healthy',
          };
        });

        setModels(modelsWithHealth);
      } catch {
        // Load without health check if it fails
        const allModels = configManager.getAllModels();
        setModels(
          allModels.map((m) => ({
            endpoint: m.endpoint,
            model: m.model,
            isCurrent: m.isCurrent,
            isHealthy: m.model.healthStatus === 'healthy',
          }))
        );
      } finally {
        setIsLoading(false);
      }
    };

    loadModels();
  }, []);

  // Handle keyboard input
  useInput((_inputChar, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  // Handle model selection
  const handleSelect = useCallback(
    async (item: SelectItem) => {
      const [endpointId, modelId] = item.value.split(':');
      if (!endpointId || !modelId) return;

      // Find the model
      const model = models.find(
        (m) => m.endpoint.id === endpointId && m.model.id === modelId
      );

      if (!model) return;

      // Don't select unhealthy models
      if (!model.isHealthy) {
        return;
      }

      // Don't select if already current
      if (model.isCurrent) {
        onCancel();
        return;
      }

      // Switch endpoint and model
      try {
        await configManager.setCurrentEndpoint(endpointId);
        await configManager.setCurrentModel(modelId);
        onSelect(endpointId, modelId);
      } catch {
        // Ignore errors
        onCancel();
      }
    },
    [models, onSelect, onCancel]
  );

  // Build menu items
  const menuItems: SelectItem[] = models.map((m) => {
    const healthIcon = m.isHealthy ? '✓' : '✗';
    const currentLabel = m.isCurrent ? ' (current)' : '';
    const endpointName = m.endpoint.name;

    return {
      label: `${m.model.name} (${endpointName})${currentLabel} ${healthIcon}`,
      value: `${m.endpoint.id}:${m.model.id}`,
    };
  });

  if (isLoading) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text color="cyan" bold>
            Select Model
          </Text>
        </Box>
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="gray">Loading models...</Text>
        </Box>
      </Box>
    );
  }

  if (models.length === 0) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text color="cyan" bold>
            Select Model
          </Text>
        </Box>
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="gray">No models configured. Use /settings → LLMs to add endpoints.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>ESC: close</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="cyan" bold>
          Select Model
        </Text>
      </Box>

      {/* Models List */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <SelectInput items={menuItems} onSelect={handleSelect} />
      </Box>

      {/* Legend */}
      <Box marginTop={1} paddingX={1}>
        <Text color="green">✓ healthy </Text>
        <Text color="red">✗ offline (cannot select)</Text>
      </Box>

      {/* Hint for adding new models */}
      <Box paddingX={1}>
        <Text color="gray" dimColor>💡   : </Text>
        <Text color="yellow">/settings</Text>
        <Text color="gray" dimColor> → </Text>
        <Text color="yellow">LLMs</Text>
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>↑↓: move | Enter: select | ESC: cancel</Text>
      </Box>
    </Box>
  );
};
