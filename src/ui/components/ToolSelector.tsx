/**
 * Tool Selector Component
 *
 * Allows enabling/disabling optional tool groups via /tool command
 * UI style matches ModelSelector for consistency
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { execSync } from 'child_process';
import Spinner from 'ink-spinner';
import { toolRegistry, OptionalToolGroup } from '../../tools/registry.js';
import { getPlatform } from '../../utils/platform-utils.js';

/**
 * Check if browser is available for CDP connection
 * CDP approach uses PowerShell to launch Chrome/Edge directly (no browser-server.exe needed)
 */
function isBrowserAvailable(): boolean {
  const platform = getPlatform();

  // Native Windows: browser-client.ts launches Chrome/Edge directly
  // Actual browser detection happens at launch time
  if (platform === 'native-windows') {
    return true;
  }

  // WSL: browser-client.ts uses PowerShell to launch Windows Chrome/Edge
  // Actual browser detection happens at launch time
  if (platform === 'wsl') {
    return true;
  }

  // Native Linux: check if Chrome/Chromium is installed
  try {
    execSync('which google-chrome || which chromium-browser || which chromium', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface ToolSelectorProps {
  onClose: () => void;
}

interface SelectItem {
  label: string;
  value: string;
}

export const ToolSelector: React.FC<ToolSelectorProps> = ({ onClose }) => {
  const [toolGroups, setToolGroups] = useState<OptionalToolGroup[]>(() =>
    toolRegistry.getOptionalToolGroups().filter(g => !g.autoManaged)
  );
  const [isToggling, setIsToggling] = useState(false);
  const [togglingGroup, setTogglingGroup] = useState<{ name: string; enabling: boolean } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Handle keyboard input
  useInput((_input, key) => {
    if (key.escape && !isToggling) {
      onClose();
    }
    // Clear error message on any key press
    if (errorMessage) {
      setErrorMessage(null);
    }
  });

  // Handle tool group selection (toggle)
  const handleSelect = useCallback(
    async (item: SelectItem) => {
      if (isToggling) return;

      const groupId = item.value;
      const group = toolGroups.find(g => g.id === groupId);
      const groupName = group?.name || groupId;
      const isEnabling = !group?.enabled;

      // Check browser availability when enabling browser tools (Linux only)
      if (groupId === 'browser' && isEnabling && !isBrowserAvailable()) {
        setErrorMessage('Chrome/Chromium not found. Please install Chrome or Chromium.');
        return;
      }

      setIsToggling(true);
      setTogglingGroup({ name: groupName, enabling: isEnabling });
      setErrorMessage(null);

      try {
        const result = await toolRegistry.toggleToolGroup(groupId);
        setToolGroups(toolRegistry.getOptionalToolGroups().filter(g => !g.autoManaged));

        // Show error if validation failed
        if (!result.success && result.error) {
          setErrorMessage(result.error);
        }
      } finally {
        setIsToggling(false);
        setTogglingGroup(null);
      }
    },
    [isToggling, toolGroups]
  );

  // Build menu items
  const menuItems: SelectItem[] = toolGroups.map((group) => {
    const statusIcon = group.enabled ? '●' : '○';
    const statusText = group.enabled ? ' (enabled)' : '';
    const toolCount = group.tools.length;

    return {
      label: `${statusIcon} ${group.name} (${toolCount} tools)${statusText}`,
      value: group.id,
    };
  });

  if (toolGroups.length === 0) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text color="cyan" bold>
            Optional Tools
          </Text>
        </Box>
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="gray">No optional tools available.</Text>
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
          Optional Tools
        </Text>
      </Box>

      {/* Performance Notice */}
      <Box paddingX={1} marginBottom={1} flexDirection="column">
        <Text color="yellow" dimColor>
          ⚠ Too many tools can slow down performance. Enable only what you need.
        </Text>
        <Text color="yellow" dimColor>
          ⚠      .   .
        </Text>
      </Box>

      {/* Tool Groups List */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <SelectInput items={menuItems} onSelect={handleSelect} />
      </Box>

      {/* Legend */}
      <Box marginTop={1} paddingX={1}>
        <Text color="green">● enabled </Text>
        <Text color="gray">○ disabled</Text>
      </Box>

      {/* Description of selected tools */}
      {toolGroups.some((g) => g.enabled) && (
        <Box paddingX={1}>
          <Text color="yellow">Active: </Text>
          <Text color="white">
            {toolGroups
              .filter((g) => g.enabled)
              .map((g) => g.name)
              .join(', ')}
          </Text>
        </Box>
      )}

      {/* Error Message */}
      {errorMessage && (
        <Box
          marginTop={1}
          borderStyle="single"
          borderColor="red"
          paddingX={1}
          flexDirection="column"
        >
          <Text color="red" bold>
            ✗ Enable Failed
          </Text>
          <Text color="white">{errorMessage}</Text>
        </Box>
      )}

      {/* Loading indicator with spinner */}
      {isToggling && togglingGroup && (
        <Box marginTop={1} paddingX={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text color="yellow">
            {' '}
            {togglingGroup.enabling
              ? `Starting ${togglingGroup.name}...`
              : `Stopping ${togglingGroup.name}...`}
          </Text>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>↑↓: move | Enter: toggle | ESC: close</Text>
      </Box>
    </Box>
  );
};
