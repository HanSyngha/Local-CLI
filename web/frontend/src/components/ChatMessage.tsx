import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Bot, AlertCircle, Sparkles, Zap, User } from 'lucide-react';
import type { WSEvent } from '@/lib/websocket';
import ToolCard from './ToolCard';

interface ChatMessageProps {
  event: WSEvent;
  onAskUserResponse?: (question: string, selectedOption: string) => void;
}

function CodeBlock({ language, children }: { language: string; children: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-xl overflow-hidden my-3 ring-1 ring-[var(--glass-border)]">
      <div className="flex items-center justify-between px-4 py-2 bg-[#0d1117] text-[11px] text-[var(--text-tertiary)]">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          <span className="font-mono">{language || 'code'}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/5 transition-colors"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400">{t('chat.copied')}</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              {t('chat.copyCode')}
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.8rem', background: '#0d1117' }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

const markdownComponents = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match) {
      return <CodeBlock language={match[1]}>{codeString}</CodeBlock>;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

/* Avatar with gradient ring */
function AgentAvatar({ color = 'accent' }: { color?: 'accent' | 'amber' | 'red' | 'blue' | 'purple' }) {
  const gradients: Record<string, string> = {
    accent: 'from-[var(--accent)] to-purple-500',
    amber: 'from-amber-400 to-orange-500',
    red: 'from-red-400 to-rose-500',
    blue: 'from-blue-400 to-cyan-500',
    purple: 'from-purple-400 to-pink-500',
  };
  return (
    <div className={`relative w-8 h-8 rounded-xl bg-gradient-to-br ${gradients[color]} p-[1.5px] flex-shrink-0`}>
      <div className="w-full h-full rounded-[10px] bg-[var(--bg-primary)] flex items-center justify-center">
        <Bot size={14} className="text-[var(--text-secondary)]" />
      </div>
    </div>
  );
}

export default function ChatMessage({ event, onAskUserResponse }: ChatMessageProps) {
  const { t } = useTranslation();

  const p = event.payload || {};

  // User message (sent by user via execute)
  if (event.type === 'user_message') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="flex justify-end mb-4"
      >
        <div className="flex items-start gap-3 max-w-[85%] sm:max-w-[80%] flex-row-reverse">
          <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 p-[1.5px] flex-shrink-0">
            <div className="w-full h-full rounded-[10px] bg-[var(--bg-primary)] flex items-center justify-center">
              <User size={14} className="text-[var(--text-secondary)]" />
            </div>
          </div>
          <div className="bg-[var(--accent)]/[0.08] backdrop-blur-sm border border-[var(--accent)]/15 px-4 py-3 rounded-2xl rounded-tr-lg shadow-elevation-1">
            <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
              {(p.message as string) || ''}
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Tell user (message from agent during execution)
  if (event.type === 'tell_user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="flex justify-start mb-4"
      >
        <div className="flex items-start gap-3 max-w-[85%] sm:max-w-[80%]">
          <AgentAvatar />
          <div className="bg-[var(--bg-secondary)]/80 backdrop-blur-sm border border-[var(--glass-border)] px-4 py-3 rounded-2xl rounded-tl-lg shadow-elevation-1">
            <div className="text-sm leading-relaxed markdown-content">
              <ReactMarkdown components={markdownComponents}>
                {(p.message as string) || ''}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // Session complete (final response from agent)
  if (event.type === 'session:complete') {
    const content = (p.message as string) || '';
    if (!content) return null;

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="flex justify-start mb-4"
      >
        <div className="flex items-start gap-3 max-w-[85%] sm:max-w-[80%]">
          <AgentAvatar />
          <div className="bg-[var(--bg-secondary)]/80 backdrop-blur-sm border border-[var(--glass-border)] px-4 py-3 rounded-2xl rounded-tl-lg shadow-elevation-1">
            <div className="text-sm leading-relaxed markdown-content">
              <ReactMarkdown components={markdownComponents}>
                {content}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // Tool call / Tool result
  if (event.type === 'tool:call' || event.type === 'tool:result') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mb-2 ml-11"
      >
        <ToolCard event={event} />
      </motion.div>
    );
  }

  // Planning events
  if (event.type === 'planning:start' || event.type === 'planning:todo' || event.type === 'planning:complete') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-start gap-3 mb-4"
      >
        <AgentAvatar color="amber" />
        <div className="bg-amber-500/[0.06] border border-amber-500/15 px-4 py-3 rounded-2xl rounded-tl-lg backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles size={12} className="text-amber-400" />
            <p className="text-[11px] font-semibold text-amber-400 uppercase tracking-wide">{t('chat.planning')}</p>
          </div>
          {event.type === 'planning:todo' && Array.isArray(p.titles) && (
            <ul className="text-sm text-[var(--text-secondary)] space-y-1">
              {(p.titles as string[]).map((title: string, i: number) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-2"
                >
                  <span className="text-amber-400/60 text-xs mt-0.5">{i + 1}.</span>
                  {title}
                </motion.li>
              ))}
            </ul>
          )}
          {event.type === 'planning:complete' && (
            <p className="text-sm text-[var(--text-secondary)]">
              {t('chat.planCreated', { count: p.count as number })}
            </p>
          )}
        </div>
      </motion.div>
    );
  }

  // Execution start
  if (event.type === 'execution:start') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex justify-center mb-3"
      >
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--accent)] bg-[var(--accent)]/8 px-3.5 py-1.5 rounded-full ring-1 ring-[var(--accent)]/15 font-medium">
          <Zap size={11} />
          {t('chat.executingTodo')}
        </span>
      </motion.div>
    );
  }

  // Error
  if (event.type === 'error') {
    return (
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: [0, -3, 3, -2, 2, 0] }}
        transition={{ duration: 0.4 }}
        className="flex items-start gap-3 mb-4"
      >
        <AgentAvatar color="red" />
        <div className="bg-red-500/[0.07] border border-red-500/20 px-4 py-3 rounded-2xl rounded-tl-lg backdrop-blur-sm shadow-lg shadow-red-500/5">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={12} className="text-red-400" />
            <p className="text-[11px] font-semibold text-red-400">{t('chat.failed')}</p>
          </div>
          <p className="text-sm text-red-300/80">{(p.message as string) || 'Unknown error'}</p>
        </div>
      </motion.div>
    );
  }

  // Compact events
  if (event.type === 'compact:start' || event.type === 'compact:complete') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex justify-center mb-3"
      >
        <span className="text-[11px] text-[var(--text-tertiary)] bg-[var(--bg-tertiary)]/40 px-3.5 py-1.5 rounded-full ring-1 ring-[var(--border)]">
          Context compacted
        </span>
      </motion.div>
    );
  }

  // Session state
  if (event.type === 'session:state') {
    return null;
  }

  // Ask user (interactive question)
  if (event.type === 'ask_user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-3 mb-4"
      >
        <AgentAvatar color="blue" />
        <div className="bg-blue-500/[0.04] border border-blue-500/15 px-4 py-3 rounded-2xl rounded-tl-lg backdrop-blur-sm">
          <p className="text-sm text-[var(--text-primary)] mb-3">{p.question as string}</p>
          {Array.isArray(p.options) && (
            <div className="flex flex-wrap gap-2">
              {(p.options as string[]).map((opt: string, i: number) => (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onAskUserResponse?.(p.question as string, opt)}
                  className="text-xs py-1.5 px-3.5 rounded-lg font-medium
                    bg-[var(--accent)]/10 text-[var(--accent)] ring-1 ring-[var(--accent)]/20
                    hover:bg-[var(--accent)] hover:text-white hover:ring-0
                    transition-all duration-200"
                >
                  {opt}
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // Subagent events
  if (event.type === 'subagent:start' || event.type === 'subagent:complete') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center gap-2 mb-2.5 ml-11"
      >
        <div className="w-5 h-5 rounded-md bg-purple-500/10 flex items-center justify-center ring-1 ring-purple-500/25">
          <Bot size={10} className="text-purple-400" />
        </div>
        <span className="text-[11px] text-purple-400 font-medium">
          {event.type === 'subagent:start'
            ? `Sub-agent: ${(p.name as string) || 'working'}`
            : 'Sub-agent completed'}
        </span>
      </motion.div>
    );
  }

  return null;
}
