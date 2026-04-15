/**
 * LOCAL-CLI - Application Router
 * Routes to ChatApp or TaskApp based on window type (IPC query)
 * No authentication required (open source version)
 */

import React, { useState, useEffect, lazy, Suspense } from 'react';
import { LanguageProvider } from './i18n/LanguageContext';
import ChatApp from './ChatApp';
import TaskApp from './TaskApp';

// Jarvis lazy load ( )
const JarvisApp = lazy(() => import('./JarvisApp'));

// Re-export types for backward compatibility (until IDE files are deleted in Phase 4)
export interface EditorTab {
  id: string;
  name: string;
  path: string;
  content: string;
  language: string;
  isDirty: boolean;
  isActive: boolean;
  isDiff?: boolean;
  originalContent?: string;
  type?: 'file' | 'todo';
}

export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  isExpanded?: boolean;
}

export const TODO_TAB_ID = '__todo__';
export type ColorPalette = 'default' | 'rose' | 'mint' | 'lavender' | 'peach' | 'sky';

const App: React.FC = () => {
  const [windowType, setWindowType] = useState<'chat' | 'task' | 'jarvis' | null>(null);

  useEffect(() => {
    const detectWindowType = async () => {
      try {
        const type = await window.electronAPI?.window?.getWindowType?.();
        console.log('[App] Window type detected:', type);
        setWindowType(type || 'chat');
      } catch (e) {
        console.error('[App] getWindowType failed:', e);
        setWindowType('chat');
      }
    };
    detectWindowType();
  }, []);

  // Show nothing until window type is determined (prevents flash of wrong UI)
  if (windowType === null) return null;

  const renderApp = () => {
    if (windowType === 'jarvis') {
      return (
        <Suspense fallback={null}>
          <JarvisApp />
        </Suspense>
      );
    }
    if (windowType === 'task') return <TaskApp />;
    return <ChatApp />;
  };

  return (
    <LanguageProvider>
      {renderApp()}
    </LanguageProvider>
  );
};

export default App;
