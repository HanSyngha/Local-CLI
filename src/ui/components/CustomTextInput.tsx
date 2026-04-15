/**
 * Custom Text Input Component
 *
 * Replaces ink-text-input with full control over cursor positioning and keyboard shortcuts
 * Supports multi-line paste detection and display
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdin } from 'ink';

// Threshold for collapsing multi-line content
const MULTILINE_COLLAPSE_THRESHOLD = 10;

interface CustomTextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onHistoryPrev?: () => void;
  onHistoryNext?: () => void;
  placeholder?: string;
  focus?: boolean;
}

export const CustomTextInput: React.FC<CustomTextInputProps> = ({
  value,
  onChange,
  onSubmit,
  onHistoryPrev,
  onHistoryNext,
  placeholder = '',
  focus = true,
}) => {
  const { stdin, setRawMode } = useStdin();
  const [cursorPosition, setCursorPosition] = useState(value.length);
  const previousValueLength = useRef<number>(value.length);

  // Track if we should show collapsed view (only after paste, cleared on any edit)
  const [isCollapsedView, setIsCollapsedView] = useState(false);

  // Use refs to access latest values without recreating handleData
  const valueRef = useRef(value);
  const cursorPositionRef = useRef(cursorPosition);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const onHistoryPrevRef = useRef(onHistoryPrev);
  const onHistoryNextRef = useRef(onHistoryNext);
  const setIsCollapsedViewRef = useRef(setIsCollapsedView);

  // Flag to distinguish internal input from external value changes
  const isInternalChangeRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    valueRef.current = value;
    cursorPositionRef.current = cursorPosition;
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
    onHistoryPrevRef.current = onHistoryPrev;
    onHistoryNextRef.current = onHistoryNext;
    setIsCollapsedViewRef.current = setIsCollapsedView;
  });

  // Synchronize cursor position when value changes externally
  useEffect(() => {
    // When value is cleared, reset cursor to start and clear collapsed view
    if (value.length === 0) {
      setCursorPosition(0);
      previousValueLength.current = 0;
      setIsCollapsedView(false);
      isInternalChangeRef.current = false;
      return;
    }

    // When value increases (e.g., file inserted), move cursor to end
    // But only if it's an external change, not internal typing
    if (value.length > previousValueLength.current) {
      if (!isInternalChangeRef.current) {
        // External change (e.g., file inserted) - move cursor to end
        setCursorPosition(value.length);
      }
      // Reset the flag after processing
      isInternalChangeRef.current = false;
      previousValueLength.current = value.length;
      return;
    }

    // When value decreases (e.g., external deletion), adjust cursor if needed
    if (value.length < cursorPosition) {
      setCursorPosition(value.length);
    }

    isInternalChangeRef.current = false;
    previousValueLength.current = value.length;
  }, [value, cursorPosition]);

  // Store handleData in a ref so it doesn't cause useEffect re-runs
  const handleDataRef = useRef((data: Buffer) => {
    const str = data.toString();
    const currentValue = valueRef.current;
    const currentCursor = cursorPositionRef.current;

    // Helper: Delete word before cursor (shared by Alt+Backspace, Ctrl+Backspace, Ctrl+W)
    const deleteWordBeforeCursor = (value: string, cursor: number) => {
      if (cursor > 0) {
        const beforeCursor = value.slice(0, cursor);
        const afterCursor = value.slice(cursor);

        // Find start of current word
        let newPos = cursor - 1;
        // Skip trailing spaces
        while (newPos > 0 && beforeCursor[newPos] === ' ') {
          newPos--;
        }
        // Delete until space or start
        while (newPos > 0 && beforeCursor[newPos - 1] !== ' ') {
          newPos--;
        }

        const newValue = beforeCursor.slice(0, newPos) + afterCursor;
        isInternalChangeRef.current = true;
        onChangeRef.current(newValue);
        setCursorPosition(newPos);
      }
    };

    // Handle different key sequences
    // Check for special escape sequences first
    if (str.startsWith('\x1b')) {
      // Alt+Enter or Shift+Enter - insert newline (multi-line input)
      // Alt+Enter: ESC + CR (\x1b\r) or ESC + LF (\x1b\n)
      // Shift+Enter: Kitty/modern terminals send \x1b[13;2u or \x1b[27;2;13~
      if (str === '\x1b\r' || str === '\x1b\n' || str === '\x1b[13;2u' || str === '\x1b[27;2;13~') {
        const newValue = currentValue.slice(0, currentCursor) + '\n' + currentValue.slice(currentCursor);
        isInternalChangeRef.current = true;
        onChangeRef.current(newValue);
        setCursorPosition(currentCursor + 1);
        return;
      }

      // ESC sequences (arrow keys, home, end, etc.)
      if (str === '\x1b[H' || str === '\x1b[1~') {
        // Home key
        setCursorPosition(0);
        return;
      }
      if (str === '\x1b[F' || str === '\x1b[4~') {
        // End key
        setCursorPosition(currentValue.length);
        return;
      }
      if (str === '\x1b[3~') {
        // Delete key - delete character after cursor
        if (currentCursor < currentValue.length) {
          const newValue = currentValue.slice(0, currentCursor) + currentValue.slice(currentCursor + 1);
          isInternalChangeRef.current = true;
          onChangeRef.current(newValue);
        }
        return;
      }
      if (str === '\x1b[D') {
        // Left arrow
        setCursorPosition(Math.max(0, currentCursor - 1));
        return;
      }
      if (str === '\x1b[C') {
        // Right arrow
        setCursorPosition(Math.min(currentValue.length, currentCursor + 1));
        return;
      }
      if (str === '\x1b[A') {
        // Up arrow - navigate to previous history entry
        if (onHistoryPrevRef.current) {
          onHistoryPrevRef.current();
        }
        return;
      }
      if (str === '\x1b[B') {
        // Down arrow - navigate to next history entry
        if (onHistoryNextRef.current) {
          onHistoryNextRef.current();
        }
        return;
      }
      if (str === '\x1b\x7f' || str === '\x1b\x08') {
        // Alt + Backspace - delete word before cursor (handled below with Ctrl+Backspace)
        deleteWordBeforeCursor(currentValue, currentCursor);
        return;
      }
      // Ignore other escape sequences
      return;
    }

    // Ctrl+A - move to start of line (like Home)
    if (str === '\x01') {
      setCursorPosition(0);
      return;
    }

    // Ctrl+E - move to end of line (like End)
    if (str === '\x05') {
      setCursorPosition(currentValue.length);
      return;
    }

    // Ctrl+C is handled by parent component's useInput hook
    if (str === '\x03') {
      // Ignore Ctrl+C in custom input, let parent handle it
      return;
    }

    // Ctrl+W / Ctrl+Backspace - delete word before cursor
    if (str === '\x17') {
      deleteWordBeforeCursor(currentValue, currentCursor);
      return;
    }

    // Regular backspace
    if (str === '\x7f' || str === '\x08') {
      if (currentCursor > 0) {
        const newValue = currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor);
        isInternalChangeRef.current = true;
        onChangeRef.current(newValue);
        setCursorPosition(currentCursor - 1);
      }
      return;
    }

    // Enter key - submit (only if single character, not part of paste)
    if ((str === '\r' || str === '\n') && str.length === 1) {
      if (onSubmitRef.current) {
        onSubmitRef.current(currentValue);
      }
      return;
    }

    // Multi-character paste detection:
    // When pasting, terminal sends multiple characters at once.
    // If str.length > 1 and contains newlines, it's a paste operation.
    // Also handle single-character input that's part of rapid paste (detected by length > 1).
    const isPaste = str.length > 1;

    if (isPaste) {
      // Paste detected - allow all characters including newlines
      // Filter out only truly problematic control characters (not newlines)
      // Keep tab (\x09) and newline (\x0A, \x0D), remove other control characters
      const sanitized = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      if (sanitized.length > 0) {
        const newValue = currentValue.slice(0, currentCursor) + sanitized + currentValue.slice(currentCursor);
        isInternalChangeRef.current = true;
        onChangeRef.current(newValue);
        setCursorPosition(currentCursor + sanitized.length);

        // Show collapsed view if pasted content has many lines
        const lineCount = sanitized.split('\n').length;
        if (lineCount > MULTILINE_COLLAPSE_THRESHOLD) {
          setIsCollapsedViewRef.current(true);
        }
      }
      return;
    }

    // Any other edit clears collapsed view
    setIsCollapsedViewRef.current(false);

    // Regular character input (printable characters including multi-byte UTF-8 like )
    // Filter out control characters (0x00-0x1F and 0x7F) but allow everything else
    // This allows ASCII printable chars, extended ASCII, and multi-byte UTF-8 characters
    const charCode = str.charCodeAt(0);
    if (charCode >= 0x20 && charCode !== 0x7F) {
      const newValue = currentValue.slice(0, currentCursor) + str + currentValue.slice(currentCursor);
      isInternalChangeRef.current = true;
      onChangeRef.current(newValue);
      setCursorPosition(currentCursor + str.length);
    }
  });

  useEffect(() => {
    if (!focus || !stdin) {
      return;
    }

    // Set raw mode to capture all keystrokes
    setRawMode?.(true);

    const handler = handleDataRef.current;
    stdin.on('data', handler);

    return () => {
      stdin.off('data', handler);
      // Note: Don't call setRawMode(false) here - other components (SelectInput) may still need raw mode
    };
  }, [focus, stdin, setRawMode]); // handleDataRef.current is stable

  // Render the input with cursor (supports multi-line)
  const renderValue = () => {
    if (value.length === 0) {
      return (
        <Text>
          {focus && <Text inverse> </Text>}
          <Text dimColor>{placeholder}</Text>
        </Text>
      );
    }

    const beforeCursor = value.slice(0, cursorPosition);
    const atCursor = value[cursorPosition] || ' ';
    const afterCursor = value.slice(cursorPosition + 1);

    // Check if content has multiple lines
    const hasNewlines = value.includes('\n');

    if (!hasNewlines) {
      // Single line rendering (original behavior)
      return (
        <Text>
          {beforeCursor}
          {focus && <Text inverse>{atCursor}</Text>}
          {!focus && atCursor !== ' ' && <Text>{atCursor}</Text>}
          {afterCursor}
        </Text>
      );
    }

    // Multi-line rendering
    // Split by newlines and render each line, placing cursor correctly
    const lines = value.split('\n');
    const lineCount = lines.length;

    // Show collapsed view only when isCollapsedView is true (set after paste, cleared on edit)
    if (lineCount > MULTILINE_COLLAPSE_THRESHOLD && isCollapsedView) {
      const firstLine = lines[0] || '';
      const previewMax = Math.min((process.stdout.columns || 80) - 20, 60);
      const truncatedFirstLine = firstLine.length > previewMax ? firstLine.slice(0, previewMax) + '...' : firstLine;
      return (
        <Box>
          <Text color="cyan">{lineCount} lines pasted</Text>
          <Text color="gray"> │ </Text>
          <Text dimColor>{truncatedFirstLine}</Text>
          {focus && <Text inverse> </Text>}
        </Box>
      );
    }

    let charCount = 0;
    let cursorLineIndex = 0;
    let cursorPosInLine = 0;

    // Find which line the cursor is on
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lineLength = line.length;
      if (charCount + lineLength >= cursorPosition) {
        cursorLineIndex = i;
        cursorPosInLine = cursorPosition - charCount;
        break;
      }
      charCount += lineLength + 1; // +1 for the newline character
    }

    return (
      <Box flexDirection="column">
        {lines.map((line, lineIndex) => {
          const isCursorLine = lineIndex === cursorLineIndex;

          if (!isCursorLine) {
            return <Text key={lineIndex}>{line || ' '}</Text>;
          }

          // Render line with cursor
          const beforeCursorInLine = line.slice(0, cursorPosInLine);
          const atCursorChar = line[cursorPosInLine] || ' ';
          const afterCursorInLine = line.slice(cursorPosInLine + 1);

          return (
            <Text key={lineIndex}>
              {beforeCursorInLine}
              {focus && <Text inverse>{atCursorChar}</Text>}
              {!focus && atCursorChar !== ' ' && <Text>{atCursorChar}</Text>}
              {afterCursorInLine}
            </Text>
          );
        })}
      </Box>
    );
  };

  return renderValue();
};

export default CustomTextInput;
