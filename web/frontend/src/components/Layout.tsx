import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  Bot,
  Store,
  Shield,
  Users,
  MonitorDot,
  HardDrive,
  AlertTriangle,
  Settings,
  Menu,
  X,
  Sun,
  Moon,
  Languages,
  LogOut,
  ChevronDown,
  FileText,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useThemeStore } from '@/stores/theme.store';
import clsx from 'clsx';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
    isActive
      ? 'text-white'
      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/40 hover:text-[var(--text-primary)]',
  );

export default function Layout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleLang = () => {
    const next = i18n.language === 'ko' ? 'en' : 'ko';
    i18n.changeLanguage(next);
  };

  const NavItem = ({ to, icon: Icon, label, end }: { to: string; icon: typeof MessageSquare; label: string; end?: boolean }) => (
    <NavLink to={to} end={end} className={navLinkClass} onClick={() => setMobileOpen(false)}>
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.div
              layoutId="nav-active"
              className="absolute inset-0 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent)]/80 shadow-glow-sm"
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-3">
            <Icon size={18} />
            {sidebarOpen && <span>{label}</span>}
          </span>
        </>
      )}
    </NavLink>
  );

  const sidebar = (
    <nav className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-[var(--glass-border)]">
        <div className="relative w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 shadow-glow-sm">
          <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" />
        </div>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2"
          >
            <span className="font-bold text-lg text-[var(--text-primary)]">LOCAL BOT</span>
            <span className="text-xs font-medium text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded-md">Web</span>
          </motion.div>
        )}
      </div>

      {/* Main nav */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1 scrollbar-hidden">
        <NavItem to="/sessions" icon={MessageSquare} label={t('nav.sessions')} />
        <NavItem to="/agents/new" icon={Bot} label={t('nav.agents')} />
        <NavItem to="/marketplace" icon={Store} label={t('nav.marketplace')} />

        {isAdmin && (
          <>
            <div className="pt-5 pb-2">
              {sidebarOpen && (
                <span className="px-3 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-[0.15em]">
                  {t('nav.admin')}
                </span>
              )}
            </div>
            <NavItem to="/admin" icon={Shield} label={t('nav.dashboard')} end />
            <NavItem to="/admin/users" icon={Users} label={t('nav.users')} />
            <NavItem to="/admin/sessions" icon={MonitorDot} label={t('nav.allSessions')} />
            <NavItem to="/admin/resources" icon={HardDrive} label={t('nav.resources')} />
            <NavItem to="/admin/errors" icon={AlertTriangle} label={t('nav.errors')} />
            <NavItem to="/admin/settings" icon={Settings} label={t('nav.settings')} />
            <a
              href="/api/health"
              target="_blank"
              rel="noopener noreferrer"
              className={navLinkClass({ isActive: false })}
              onClick={() => setMobileOpen(false)}
            >
              <FileText size={18} />
              {sidebarOpen && <span>{t('nav.apiDocs', 'API Docs')}</span>}
            </a>
          </>
        )}
      </div>

      {/* User section */}
      {sidebarOpen && user && (
        <div className="border-t border-[var(--glass-border)] p-3">
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-tertiary)]/40 transition-all duration-200"
            >
              <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-[var(--accent)] to-purple-600 flex items-center justify-center flex-shrink-0 shadow-glow-sm">
                <span className="text-white text-sm font-medium">
                  {user.name?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {user.name}
                </div>
                <div className="text-[11px] text-[var(--text-tertiary)] truncate">{user.email}</div>
              </div>
              <ChevronDown
                size={14}
                className={clsx(
                  'text-[var(--text-tertiary)] transition-transform duration-200',
                  userMenuOpen && 'rotate-180',
                )}
              />
            </button>

            <AnimatePresence>
              {userMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full left-0 right-0 mb-1.5 glass-panel rounded-xl shadow-elevation-3 overflow-hidden"
                >
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-[var(--error)] hover:bg-[var(--error)]/5 transition-colors"
                  >
                    <LogOut size={15} />
                    {t('auth.logout')}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </nav>
  );

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--bg-primary)]">
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'hidden lg:flex flex-col border-r border-[var(--glass-border)] bg-[var(--bg-secondary)]/70 backdrop-blur-xl transition-all duration-300 flex-shrink-0',
          sidebarOpen ? 'w-64' : 'w-[68px]',
        )}
      >
        {sidebar}
      </aside>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="drawer-overlay fixed inset-0 z-40 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed left-0 top-0 bottom-0 w-[280px] bg-[var(--bg-secondary)] border-r border-[var(--glass-border)] z-50 lg:hidden shadow-elevation-4"
            >
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-[var(--glass-border)] bg-[var(--bg-secondary)]/60 backdrop-blur-xl flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (window.innerWidth < 1024) {
                  setMobileOpen(!mobileOpen);
                } else {
                  setSidebarOpen(!sidebarOpen);
                }
              }}
              className="p-2 rounded-xl hover:bg-[var(--bg-tertiary)]/40 transition-colors text-[var(--text-secondary)]"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>

          <div className="flex items-center gap-1">
            {/* cmd+k hint */}
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] ring-1 ring-[var(--border)] hover:ring-[var(--border-hover)] transition-all mr-1"
            >
              <span>Search</span>
              <kbd className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[9px] font-mono">⌘K</kbd>
            </button>
            <button
              onClick={toggleLang}
              className="p-2 rounded-xl hover:bg-[var(--bg-tertiary)]/40 transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title={i18n.language === 'ko' ? 'English' : ''}
            >
              <Languages size={18} />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl hover:bg-[var(--bg-tertiary)]/40 transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
