/**
 * Session Browser Component
 *
 * Displays saved sessions for loading with interactive selection
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { sessionManager, SessionSummary } from '../../../core/session/session-manager.js';

interface SessionBrowserProps {
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

interface SelectItem {
  label: string;
  value: string;
}

const MAX_VISIBLE_SESSIONS = 10;

export const SessionBrowser: React.FC<SessionBrowserProps> = ({
  onSelect,
  onCancel,
}) => {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      try {
        setLoading(true);
        const loadedSessions = await sessionManager.listSessions();
        setSessions(loadedSessions);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        setLoading(false);
      }
    };

    loadSessions();
  }, []);

  // Custom keyboard handling
  useInput((_inputChar, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
  });

  // Handle Enter key from SelectInput
  const handleSelect = (item: SelectItem) => {
    onSelect(item.value);
  };

  // Loading state
  if (loading) {
    return (
      <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text color="cyan">   ...</Text>
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box borderStyle="single" borderColor="red" paddingX={1} flexDirection="column">
        <Text color="red">  : {error}</Text>
        <Text dimColor>Press ESC to cancel</Text>
      </Box>
    );
  }

  // Empty state
  if (sessions.length === 0) {
    return (
      <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
        <Text color="yellow">  .</Text>
        <Text dimColor>Press ESC to cancel</Text>
      </Box>
    );
  }

  // Convert SessionSummary to SelectItem format
  const items: SelectItem[] = sessions.map((session) => {
    const date = new Date(session.updatedAt).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    
    // Format: "Session Name (messages) - 2024-11-10 14:30"
    let label = `${session.name.substring(0, 30)}`;
    if (session.name.length > 30) {
      label += '...';
    }
    label += ` (${session.messageCount} messages) - ${date}`;
    
    // Add first message preview if available
    if (session.firstMessage) {
      const preview = session.firstMessage.substring(0, 40);
      label += `\n   "${preview}${session.firstMessage.length > 40 ? '...' : ''}"`;
    }

    return {
      label,
      value: session.id,
    };
  });

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text color="cyan" bold>
          Saved sessions list
        </Text>
      </Box>

      {/* Session List */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <SelectInput
          items={items}
          onSelect={handleSelect}
          limit={MAX_VISIBLE_SESSIONS}
        />
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓: move | Enter: select | ESC: cancel
        </Text>
      </Box>
    </Box>
  );
};
