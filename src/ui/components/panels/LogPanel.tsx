/**
 * Log Browser Component for CLI
 *
 * Displays session logs with interactive selection and content viewing
 * Supports category-based log file splitting
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { readFile, readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { PROJECTS_DIR } from '../../../constants.js';
import { getStreamLogger } from '../../../utils/json-stream-logger.js';
import type { StreamLogEntry, LogCategory } from '../../../utils/json-stream-logger.js';

interface LogBrowserProps {
  onClose: () => void;
}

type LogSource = 'current' | 'list' | 'content';

interface LogFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  category?: LogCategory | 'all' | 'error'; //  
}

//  
const CATEGORY_COLORS: Record<string, string> = {
  all: 'white',
  chat: 'green',
  tool: 'yellow',
  http: 'blue',
  llm: 'magenta',
  subagent: '#f97316',
  ui: 'cyan',
  system: 'gray',
  debug: 'dim',
  error: 'red',
};

//  
const CATEGORY_LABELS: Record<string, string> = {
  all: '📋 All',
  chat: '💬 Chat',
  tool: '🔧 Tool',
  http: '🌐 HTTP',
  llm: '🤖 LLM',
  subagent: '🤖 SubAgent',
  ui: '🖥️ UI',
  system: '⚙️ System',
  debug: '🐛 Debug',
  error: '❌ Error',
};

const MAX_LOG_LINES = 50;
const LOG_LEVEL_COLORS: Record<string, string> = {
  error: 'red',
  tool_error: 'red',
  tool_start: 'cyan',
  tool_end: 'green',
  assistant_response: 'blue',
  user_input: 'yellow',
  planning_start: 'magenta',
  planning_end: 'magenta',
  info: 'gray',
  debug: 'gray',
};

export const LogBrowser: React.FC<LogBrowserProps> = ({ onClose }) => {
  //     ( )
  const [logSource, setLogSource] = useState<LogSource>('list');
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<StreamLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Get current working directory log path
  const getCurrentLogDir = useCallback(() => {
    const cwd = process.cwd();
    const safeCwd = cwd.replace(/[/\\:]/g, '-').replace(/^-/, '');
    return join(PROJECTS_DIR, safeCwd);
  }, []);

  //   
  const getCategoryFromFileName = (fileName: string): LogFile['category'] => {
    if (fileName.endsWith('_log.json')) return 'all';
    if (fileName.endsWith('_error.json')) return 'error';
    if (fileName.endsWith('_chat.json')) return 'chat';
    if (fileName.endsWith('_tool.json')) return 'tool';
    if (fileName.endsWith('_http.json')) return 'http';
    if (fileName.endsWith('_llm.json')) return 'llm';
    if (fileName.endsWith('_subagent.json')) return 'subagent';
    if (fileName.endsWith('_ui.json')) return 'ui';
    if (fileName.endsWith('_system.json')) return 'system';
    if (fileName.endsWith('_debug.json')) return 'debug';
    return undefined;
  };

  // Load log files list
  const loadLogFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const logDir = getCurrentLogDir();
      const files = await readdir(logDir);
      const logFileList: LogFile[] = [];

      for (const file of files) {
        //  JSON    (  )
        if (file.endsWith('.json') && (
          file.endsWith('_log.json') ||
          file.endsWith('_error.json') ||
          file.endsWith('_chat.json') ||
          file.endsWith('_tool.json') ||
          file.endsWith('_http.json') ||
          file.endsWith('_llm.json') ||
          file.endsWith('_subagent.json') ||
          file.endsWith('_ui.json') ||
          file.endsWith('_system.json') ||
          file.endsWith('_debug.json')
        )) {
          const filePath = join(logDir, file);
          const stats = await stat(filePath);
          const category = getCategoryFromFileName(file);
          logFileList.push({
            name: file,
            path: filePath,
            size: stats.size,
            modifiedAt: stats.mtimeMs,
            category,
          });
        }
      }

      // Sort by: category (all first, then by name), then modified time (newest first)
      logFileList.sort((a, b) => {
        // Category priority: all > error > specific categories
        const categoryOrder = ['all', 'error', 'chat', 'tool', 'http', 'llm', 'subagent', 'ui', 'system', 'debug'];
        const aOrder = a.category ? categoryOrder.indexOf(a.category) : 999;
        const bOrder = b.category ? categoryOrder.indexOf(b.category) : 999;

        // Same session files grouped together by extracting session ID
        const aSession = a.name.split('_')[0];
        const bSession = b.name.split('_')[0];

        if (aSession !== bSession) {
          // Different sessions: sort by modified time
          return b.modifiedAt - a.modifiedAt;
        }

        // Same session: sort by category order
        return aOrder - bOrder;
      });

      setLogFiles(logFileList);
    } catch (err) {
      setError(`Failed to load log files: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [getCurrentLogDir]);

  // Load log content from file
  const loadLogContent = useCallback(async (filePath: string) => {
    setLoading(true);
    setError(null);
    try {
      let content = await readFile(filePath, 'utf-8');

      // File might not have closing bracket yet if logger is still writing
      // This applies to both current session and category files
      const trimmed = content.trimEnd();
      if (!trimmed.endsWith(']')) {
        // Add closing bracket to make valid JSON
        content = trimmed + '\n]';
      }

      // Parse JSON array
      const entries: StreamLogEntry[] = JSON.parse(content);
      setLogEntries(entries);
      setScrollOffset(Math.max(0, entries.length - MAX_LOG_LINES));
    } catch (err) {
      setError(`Failed to load log: ${err instanceof Error ? err.message : String(err)}`);
      setLogEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load current session log
  const loadCurrentSessionLog = useCallback(async () => {
    const streamLogger = getStreamLogger();
    if (!streamLogger) {
      setError('No active session log');
      return;
    }

    const logPath = streamLogger.getFilePath();
    if (!logPath) {
      setError('Session log path not available');
      return;
    }

    await loadLogContent(logPath);
  }, [loadLogContent]);

  // Initial load
  useEffect(() => {
    if (logSource === 'current') {
      loadCurrentSessionLog();
    } else if (logSource === 'list') {
      loadLogFiles();
    }
  }, [logSource, loadCurrentSessionLog, loadLogFiles]);

  // Handle keyboard input
  useInput((inputChar, key) => {
    if (key.escape) {
      if (logSource === 'content') {
        setLogSource('list');
        setLogEntries([]);
      } else {
        onClose();
      }
      return;
    }

    // Tab to switch between current/list
    if (key.tab && logSource !== 'content') {
      setLogSource(logSource === 'current' ? 'list' : 'current');
      return;
    }

    // Scroll in content view
    if (logSource === 'current' || logSource === 'content') {
      if (key.upArrow || inputChar === 'k') {
        setScrollOffset(prev => Math.max(0, prev - 1));
      } else if (key.downArrow || inputChar === 'j') {
        setScrollOffset(prev => Math.min(Math.max(0, logEntries.length - MAX_LOG_LINES), prev + 1));
      } else if (inputChar === 'g') {
        setScrollOffset(0);
      } else if (inputChar === 'G') {
        setScrollOffset(Math.max(0, logEntries.length - MAX_LOG_LINES));
      }
    }
  });

  // Handle log file selection
  const handleFileSelect = (item: { label: string; value: string }) => {
    setSelectedFile(item.value);
    setLogSource('content');
    loadLogContent(item.value);
  };

  // Format timestamp
  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  // Render log entry
  const renderLogEntry = (entry: StreamLogEntry, index: number) => {
    const typeColor = LOG_LEVEL_COLORS[entry.type] || 'white';
    const categoryColor = entry.category ? CATEGORY_COLORS[entry.category] : 'white';
    const time = formatTimestamp(entry.timestamp);
    const typeLabel = entry.type.replace(/_/g, ' ').toUpperCase().padEnd(12);
    const categoryLabel = entry.category ? `[${entry.category.toUpperCase().padEnd(6)}]` : '';
    const content = entry.content.length > 70
      ? entry.content.substring(0, 67) + '...'
      : entry.content;

    return (
      <Box key={index} flexDirection="row">
        <Text color="gray" dimColor>{time} </Text>
        {entry.category && <Text color={categoryColor}>{categoryLabel} </Text>}
        <Text color={typeColor}>[{typeLabel}] </Text>
        <Text>{content}</Text>
      </Box>
    );
  };

  // Visible entries
  const visibleEntries = logEntries.slice(scrollOffset, scrollOffset + MAX_LOG_LINES);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>Log Browser</Text>
        <Text color="gray"> - </Text>
        <Text
          color={logSource === 'current' ? 'cyan' : 'gray'}
          bold={logSource === 'current'}
        >
          [Current]
        </Text>
        <Text color="gray"> / </Text>
        <Text
          color={logSource === 'list' || logSource === 'content' ? 'cyan' : 'gray'}
          bold={logSource === 'list' || logSource === 'content'}
        >
          [All Logs]
        </Text>
        <Text color="gray" dimColor>  (Tab: switch, ESC: close)</Text>
      </Box>

      {/* Loading state */}
      {loading && (
        <Text color="yellow">Loading...</Text>
      )}

      {/* Error state */}
      {error && (
        <Text color="red">{error}</Text>
      )}

      {/* Log file list view */}
      {logSource === 'list' && !loading && !error && (
        <>
          {logFiles.length === 0 ? (
            <Text color="yellow">No log files found</Text>
          ) : (
            <SelectInput
              items={logFiles.map(file => {
                const categoryLabel = file.category ? CATEGORY_LABELS[file.category] || file.category : '📄';
                const nameParts = file.name.split('_');
                const firstPart = nameParts[0] ?? 'unknown';
                const sessionId = firstPart.slice(0, 8);
                return {
                  label: `${categoryLabel} [${sessionId}] (${formatSize(file.size)}) - ${new Date(file.modifiedAt).toLocaleString()}`,
                  value: file.path,
                };
              })}
              onSelect={handleFileSelect}
              limit={15}
            />
          )}
        </>
      )}

      {/* Current session log or content view */}
      {(logSource === 'current' || logSource === 'content') && !loading && !error && (
        <>
          {logEntries.length === 0 ? (
            <Text color="yellow">No log entries</Text>
          ) : (
            <>
              <Box flexDirection="column" height={MAX_LOG_LINES}>
                {visibleEntries.map((entry, idx) => renderLogEntry(entry, idx))}
              </Box>
              <Box marginTop={1}>
                <Text color="gray" dimColor>
                  Showing {scrollOffset + 1}-{Math.min(scrollOffset + MAX_LOG_LINES, logEntries.length)} of {logEntries.length} entries
                  {' '}(↑↓/jk: scroll, g/G: top/bottom)
                </Text>
              </Box>
            </>
          )}
        </>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          {logSource === 'current' && 'Current session log'}
          {logSource === 'list' && 'Select a log file to view'}
          {logSource === 'content' && selectedFile && `Viewing: ${basename(selectedFile)}`}
        </Text>
      </Box>
    </Box>
  );
};
