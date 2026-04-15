/**
 * Settings Component
 * LLM Endpoint management and system configuration
 * Matches CLI's settings functionality
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import type { Language } from '../i18n/translations';
import './Settings.css';

// Types matching CLI
export interface ModelInfo {
  id: string;
  name: string;
  maxTokens: number;
  enabled: boolean;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy';
  lastHealthCheck?: Date;
}

type LLMProvider = 'openai' | 'anthropic' | 'gemini' | 'zai' | 'qwen' | 'deepseek' | 'ollama' | 'lmstudio' | 'xai' | 'other';

const PROVIDER_OPTIONS: { id: LLMProvider; name: string; defaultBaseUrl: string; icon: string }[] = [
  { id: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', icon: '⬡' },
  { id: 'anthropic', name: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', icon: '◈' },
  { id: 'gemini', name: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', icon: '◆' },
  { id: 'zai', name: 'Z.AI (GLM)', defaultBaseUrl: 'https://api.z.ai/api/paas/v4', icon: 'Z' },
  { id: 'qwen', name: 'Alibaba Qwen', defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', icon: 'Q' },
  { id: 'deepseek', name: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com', icon: '⊛' },
  { id: 'ollama', name: 'Ollama', defaultBaseUrl: 'http://localhost:11434/v1', icon: '🦙' },
  { id: 'lmstudio', name: 'LM Studio', defaultBaseUrl: 'http://localhost:1234/v1', icon: '⊞' },
  { id: 'xai', name: 'x.ai (Grok)', defaultBaseUrl: 'https://api.x.ai/v1', icon: '𝕏' },
  { id: 'other', name: 'Other', defaultBaseUrl: '', icon: '⚙' },
];

export interface EndpointConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  provider?: LLMProvider;
  models: ModelInfo[];
  createdAt?: Date;
  updatedAt?: Date;
}

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsView = 'main' | 'llms' | 'llm-add' | 'llm-edit' | 'llm-delete' | 'appearance' | 'tools' | 'jarvis';

// Color palette type
type ColorPalette = 'default' | 'rose' | 'mint' | 'lavender' | 'peach' | 'sky';

// Font size range: 10-18px
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 18;

// Palette options (translation keys used for labels)
const COLOR_PALETTE_OPTIONS: { value: ColorPalette; labelKey: string; color: string }[] = [
  { value: 'default', labelKey: 'palette.default', color: '#3B82F6' },
  { value: 'rose', labelKey: 'palette.rose', color: '#F472B6' },
  { value: 'mint', labelKey: 'palette.mint', color: '#34D399' },
  { value: 'lavender', labelKey: 'palette.lavender', color: '#A78BFA' },
  { value: 'peach', labelKey: 'palette.peach', color: '#FB923C' },
  { value: 'sky', labelKey: 'palette.sky', color: '#38BDF8' },
];

// Font family options
type FontFamily = 'default' | 'Cafe24Syongsyong' | 'Cafe24Dongdong' | 'Cafe24PROSlimMax' | 'Cafe24Oneprettynight' | 'Cafe24SsurroundAir' | 'Cafe24Moyamoya';

const FONT_FAMILY_OPTIONS: { value: FontFamily; labelKey: string; cssFamily: string }[] = [
  { value: 'default', labelKey: 'font.default', cssFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { value: 'Cafe24Syongsyong', labelKey: 'font.cafe24Syongsyong', cssFamily: "'Cafe24Syongsyong', -apple-system, sans-serif" },
  { value: 'Cafe24Dongdong', labelKey: 'font.cafe24Dongdong', cssFamily: "'Cafe24Dongdong', -apple-system, sans-serif" },
  { value: 'Cafe24PROSlimMax', labelKey: 'font.cafe24SlimMax', cssFamily: "'Cafe24PROSlimMax', -apple-system, sans-serif" },
  { value: 'Cafe24Oneprettynight', labelKey: 'font.cafe24Oneprettynight', cssFamily: "'Cafe24Oneprettynight', -apple-system, sans-serif" },
  { value: 'Cafe24SsurroundAir', labelKey: 'font.cafe24SsurroundAir', cssFamily: "'Cafe24SsurroundAir', -apple-system, sans-serif" },
  { value: 'Cafe24Moyamoya', labelKey: 'font.cafe24Moyamoya', cssFamily: "'Cafe24Moyamoya', -apple-system, sans-serif" },
];

interface FormData {
  provider: LLMProvider;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelName: string;
  maxContextLength: string;
}

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
  const { t, language, setLanguage } = useTranslation();
  const [view, setView] = useState<SettingsView>('main');
  const [endpoints, setEndpoints] = useState<EndpointConfig[]>([]);
  const [currentEndpointId, setCurrentEndpointId] = useState<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Appearance settings
  const [fontSize, setFontSize] = useState<number>(12);
  const [uiScale, setUiScale] = useState<number>(1);
  const [colorPalette, setColorPalette] = useState<ColorPalette>('default');
  const [fontFamily, setFontFamily] = useState<FontFamily>('default');

  // Form state
  const [formData, setFormData] = useState<FormData>({
    provider: 'other',
    name: '',
    baseUrl: '',
    apiKey: '',
    modelId: '',
    modelName: '',
    maxContextLength: '128000',
  });

  // External tools settings
  const [vscodeAutoDetected, setVscodeAutoDetected] = useState(false);
  const [vscodePath, setVscodePath] = useState<string>('');
  const [vscodePathSaved, setVscodePathSaved] = useState(false);

  // Vision model settings
  const [visionModels, setVisionModels] = useState<{ endpointId: string; endpointName: string; modelId: string; modelName: string }[]>([]);
  const [selectedVisionModel, setSelectedVisionModel] = useState<string>('');

  // Load endpoints
  const loadEndpoints = useCallback(async () => {
    if (!window.electronAPI?.llm) {
      setError('LLM API not available');
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.electronAPI.llm.getEndpoints();
      if (result.success && result.endpoints) {
        setEndpoints(result.endpoints);
        setCurrentEndpointId(result.currentEndpointId || null);
      }
    } catch (err) {
      window.electronAPI?.log?.error('[Settings] Failed to load endpoints', { error: err instanceof Error ? err.message : String(err) });
      setError('Failed to load endpoints');
    } finally {
      setIsLoading(false);
    }
  }, []);


  // Load appearance settings
  const loadAppearanceSettings = useCallback(async () => {
    if (!window.electronAPI?.config) return;
    try {
      const config = await window.electronAPI.config.getAll();
      const configAny2 = config as unknown as Record<string, unknown>;
      if (configAny2?.fontSize && typeof configAny2.fontSize === 'number') {
        setFontSize(configAny2.fontSize as number);
      }
      if (configAny2?.colorPalette) {
        setColorPalette(configAny2.colorPalette as ColorPalette);
      }
      if (configAny2?.uiScale && typeof configAny2.uiScale === 'number') {
        setUiScale(configAny2.uiScale);
      }
      const configAny = config as unknown as Record<string, unknown>;
      if (configAny?.fontFamily && typeof configAny.fontFamily === 'string') {
        setFontFamily(configAny.fontFamily as FontFamily);
      }
    } catch (err) {
      window.electronAPI?.log?.error('[Settings] Failed to load appearance settings', { error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  // Save appearance settings
  const saveAppearanceSetting = useCallback(
    async (key: string, value: number | string) => {
      if (!window.electronAPI?.config) return;
      try {
        await window.electronAPI.config.set(key as any, value);
        if (key === 'fontSize') {
          document.documentElement.style.setProperty('--user-font-size', `${value}px`);
        } else if (key === 'colorPalette') {
          document.querySelector('.app-root')?.setAttribute('data-palette', value as string);
        } else if (key === 'fontFamily') {
          const opt = FONT_FAMILY_OPTIONS.find((f) => f.value === value);
          if (opt) {
            document.documentElement.style.setProperty('--font-sans', opt.cssFamily);
          }
        } else if (key === 'uiScale' && typeof value === 'number') {
          document.documentElement.style.setProperty('--ui-scale', String(value));
        }
      } catch (err) {
        window.electronAPI?.log?.error(`[Settings] Failed to save ${key}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  // Logout handler
  const handleLogout = useCallback(async () => {
    if (!window.electronAPI?.auth) return;
    try {
      await window.electronAPI.auth.logout();
    } catch (err) {
      window.electronAPI?.log?.error('[Settings] Failed to logout', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  // Load vision model settings
  const loadVisionSettings = useCallback(async () => {
    if (!window.electronAPI?.config) return;
    try {
      const config = await window.electronAPI.config.getAll();
      const models: { endpointId: string; endpointName: string; modelId: string; modelName: string }[] = [];
      for (const ep of config.endpoints || []) {
        for (const m of ep.models || []) {
          if (m.supportsVision && m.enabled) {
            models.push({ endpointId: ep.id, endpointName: ep.name || ep.id, modelId: m.id, modelName: m.name || m.id });
          }
        }
      }
      setVisionModels(models);
      setSelectedVisionModel(config.visionModelId ? `${config.visionEndpointId || ''}::${config.visionModelId}` : '');
    } catch { /* ignore */ }
  }, []);

  const saveVisionModel = useCallback(async (value: string) => {
    if (!window.electronAPI?.config) return;
    setSelectedVisionModel(value);
    if (!value) {
      await window.electronAPI.config.set('visionEndpointId', '');
      await window.electronAPI.config.set('visionModelId', '');
    } else {
      const [epId, modelId] = value.split('::');
      await window.electronAPI.config.set('visionEndpointId', epId);
      await window.electronAPI.config.set('visionModelId', modelId);
    }
  }, []);

  // Load VSCode settings
  const loadVscodeSettings = useCallback(async () => {
    if (!window.electronAPI?.vscode) return;
    try {
      const availResult = await window.electronAPI.vscode.isAvailable();
      setVscodeAutoDetected(availResult.autoDetected);
      const pathResult = await window.electronAPI.vscode.getPath();
      setVscodePath(pathResult.path || '');
    } catch (err) {
      window.electronAPI?.log?.error('[Settings] Failed to load VSCode settings', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  // Save VSCode path
  const saveVscodePath = useCallback(async (path: string) => {
    if (!window.electronAPI?.vscode) return;
    try {
      await window.electronAPI.vscode.setPath(path || null);
      setVscodePathSaved(true);
      setTimeout(() => setVscodePathSaved(false), 2000);
    } catch (err) {
      window.electronAPI?.log?.error('[Settings] Failed to save VSCode path', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (isOpen) {
      loadEndpoints();
      loadAppearanceSettings();
      loadVscodeSettings();
      setView('main');
      setError(null);
      setSuccessMessage(null);
    }
  }, [isOpen, loadEndpoints, loadAppearanceSettings, loadVscodeSettings]);

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view === 'main') {
          onClose();
        } else {
          setView('main');
          setError(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, view, onClose]);

  // Reset form
  const resetForm = useCallback(() => {
    setFormData({
      provider: 'other',
      name: '',
      baseUrl: '',
      apiKey: '',
      modelId: '',
      modelName: '',
      maxContextLength: '128000',
    });
    setError(null);
  }, []);

  // Open add form
  const handleAddEndpoint = useCallback(() => {
    resetForm();
    setSelectedEndpoint(null);
    setView('llm-add');
  }, [resetForm]);

  // Open edit form
  const handleEditEndpoint = useCallback((endpoint: EndpointConfig) => {
    setSelectedEndpoint(endpoint);
    setFormData({
      provider: (endpoint.provider as LLMProvider) || 'other',
      name: endpoint.name,
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey || '',
      modelId: endpoint.models[0]?.id || '',
      modelName: endpoint.models[0]?.name || '',
      maxContextLength: String(endpoint.models[0]?.maxTokens || 128000),
    });
    setError(null);
    setView('llm-edit');
  }, []);

  // Open delete confirmation
  const handleDeletePrompt = useCallback((endpoint: EndpointConfig) => {
    setSelectedEndpoint(endpoint);
    setView('llm-delete');
  }, []);

  // Use ref to always have current formData (avoids stale closure issues)
  const formDataRef = React.useRef(formData);
  React.useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  // Test and save endpoint
  const handleSaveEndpoint = useCallback(async () => {
    // Guard against undefined API
    if (!window.electronAPI?.llm) {
      setError('LLM API not available');
      return;
    }

    // Use ref to get current formData (avoids stale closure)
    const currentFormData = formDataRef.current;
    if (!currentFormData) {
      setError('Form data not initialized');
      return;
    }

    // Validation
    if (!currentFormData.name?.trim()) {
      setError('Name is required');
      return;
    }
    if (!currentFormData.baseUrl?.trim()) {
      setError('Base URL is required');
      return;
    }
    if (!currentFormData.modelId?.trim()) {
      setError('Model ID is required');
      return;
    }

    setIsTesting(true);
    setError(null);

    try {
      // Test connection
      const testResult = await window.electronAPI.llm.testConnection(
        currentFormData.baseUrl,
        currentFormData.apiKey || undefined,
        currentFormData.modelId
      );

      if (!testResult.success) {
        setError(testResult.error || 'Connection test failed');
        setIsTesting(false);
        return;
      }

      // Save endpoint
      const endpointData: Omit<EndpointConfig, 'id' | 'createdAt' | 'updatedAt'> = {
        name: currentFormData.name.trim(),
        baseUrl: currentFormData.baseUrl.trim(),
        apiKey: currentFormData.apiKey?.trim() || undefined,
        provider: currentFormData.provider,
        models: [{
          id: currentFormData.modelId.trim(),
          name: currentFormData.modelName?.trim() || currentFormData.modelId.trim(),
          maxTokens: parseInt(currentFormData.maxContextLength) || 128000,
          enabled: true,
          healthStatus: 'healthy',
        }],
      };

      let result;
      if (view === 'llm-edit' && selectedEndpoint) {
        result = await window.electronAPI.llm.updateEndpoint(selectedEndpoint.id, endpointData);
      } else {
        result = await window.electronAPI.llm.addEndpoint(endpointData);
      }

      if (result.success) {
        setSuccessMessage(view === 'llm-edit' ? 'Endpoint updated' : 'Endpoint added');
        setTimeout(() => setSuccessMessage(null), 2000);
        await loadEndpoints();
        setView('llms');
      } else {
        setError(result.error || 'Failed to save endpoint');
      }
    } catch (err) {
      window.electronAPI?.log?.error('[Settings] Failed to save endpoint', { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : 'Failed to save endpoint. Please try again.');
    } finally {
      setIsTesting(false);
    }
  }, [view, selectedEndpoint, loadEndpoints]);

  // Delete endpoint
  const handleDeleteEndpoint = useCallback(async () => {
    if (!selectedEndpoint) return;

    try {
      const result = await window.electronAPI.llm.removeEndpoint(selectedEndpoint.id);
      if (result.success) {
        setSuccessMessage('Endpoint deleted');
        setTimeout(() => setSuccessMessage(null), 2000);
        await loadEndpoints();
        setView('llms');
      } else {
        setError(result.error || 'Failed to delete endpoint');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [selectedEndpoint, loadEndpoints]);

  // Set current endpoint
  const handleSetCurrent = useCallback(async (endpointId: string) => {
    try {
      const result = await window.electronAPI.llm.setCurrentEndpoint(endpointId);
      if (result.success) {
        setCurrentEndpointId(endpointId);
        setSuccessMessage('Current endpoint updated');
        setTimeout(() => setSuccessMessage(null), 2000);
      }
    } catch (err) {
      window.electronAPI?.log?.error('[Settings] Failed to set current endpoint', { error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  // Health check
  const handleHealthCheck = useCallback(async () => {
    setIsLoading(true);
    try {
      await window.electronAPI.llm.healthCheckAll();
      await loadEndpoints();
    } catch (err) {
      window.electronAPI?.log?.error('[Settings] Health check failed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsLoading(false);
    }
  }, [loadEndpoints]);

  // Get health icon and color
  const getHealthDisplay = (status?: string) => {
    switch (status) {
      case 'healthy':
        return { icon: '\u2713', color: 'var(--color-success)', label: 'Healthy' };
      case 'degraded':
        return { icon: '\u26A0', color: 'var(--color-warning)', label: 'Degraded' };
      case 'unhealthy':
        return { icon: '\u2717', color: 'var(--color-error)', label: 'Unhealthy' };
      default:
        return { icon: '?', color: 'var(--color-text-muted)', label: 'Unknown' };
    }
  };

  if (!isOpen) return null;

  return (
    <div className="settings-backdrop">
      <div className="settings-dialog">
        {/* Header */}
        <div className="settings-header">
          <div className="settings-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
            <span>
              {view === 'main' && t('settings.title')}
              {view === 'llms' && 'Settings > LLM Endpoints'}
              {view === 'llm-add' && 'Add New Endpoint'}
              {view === 'llm-edit' && 'Edit Endpoint'}
              {view === 'llm-delete' && 'Delete Endpoint'}
              {view === 'appearance' && t('settings.appearance.title')}
              {view === 'tools' && t('settings.tools.title')}
              {view === 'jarvis' && '🤖  '}
            </span>
          </div>
          <button className="settings-close" onClick={onClose} title={t('settings.close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        {/* Success Message */}
        {successMessage && (
          <div className="settings-success">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="settings-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Content */}
        <div className="settings-content">
          {/* Main Menu */}
          {view === 'main' && (
            <div className="settings-menu">
              <button className="menu-item" onClick={() => { setView('llms'); loadEndpoints(); }}>
                <div className="menu-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
                  </svg>
                </div>
                <div className="menu-content">
                  <span className="menu-label">LLM Endpoints</span>
                  <span className="menu-description">Manage AI model connections</span>
                </div>
                <span className="menu-badge">{endpoints.length}</span>
                <svg className="menu-arrow" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                </svg>
              </button>

              <button className="menu-item" onClick={() => setView('appearance')}>
                <div className="menu-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
                  </svg>
                </div>
                <div className="menu-content">
                  <span className="menu-label">{t('settings.appearance')}</span>
                  <span className="menu-description">{t('settings.appearance.desc')}</span>
                </div>
                <svg className="menu-arrow" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                </svg>
              </button>

              <button className="menu-item" onClick={() => { setView('tools'); loadVscodeSettings(); loadVisionSettings(); }}>
                <div className="menu-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
                  </svg>
                </div>
                <div className="menu-content">
                  <span className="menu-label">{t('settings.tools')}</span>
                  <span className="menu-description">{t('settings.tools.desc')}</span>
                </div>
                <svg className="menu-arrow" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                </svg>
              </button>

              <button className="menu-item" onClick={() => setView('jarvis')}>
                <div className="menu-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                </div>
                <div className="menu-content">
                  <span className="menu-label">🤖  </span>
                  <span className="menu-description">   </span>
                </div>
                <svg className="menu-arrow" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                </svg>
              </button>
            </div>
          )}

          {/* LLMs List View */}
          {view === 'llms' && (
            <div className="llms-view">
              <div className="llms-header">
                <button className="add-endpoint-btn" onClick={handleAddEndpoint}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                  </svg>
                  Add Endpoint
                </button>
                <button
                  className="refresh-btn"
                  onClick={handleHealthCheck}
                  disabled={isLoading}
                  title="Health Check"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={isLoading ? 'spinning' : ''}>
                    <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                  </svg>
                </button>
              </div>

              {endpoints.length === 0 ? (
                <div className="empty-state">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
                  </svg>
                  <p>No endpoints configured</p>
                  <span>Add an endpoint to connect to an LLM</span>
                </div>
              ) : (
                <div className="endpoints-list">
                  {endpoints.map((endpoint) => {
                    const health = getHealthDisplay(endpoint.models[0]?.healthStatus);
                    const isCurrent = endpoint.id === currentEndpointId;

                    return (
                      <div key={endpoint.id} className={`endpoint-item ${isCurrent ? 'current' : ''}`}>
                        <div className="endpoint-info">
                          <div className="endpoint-header">
                            <span className="endpoint-name">
                              {endpoint.models[0]?.id || endpoint.name}
                              {isCurrent && <span className="current-badge">Current</span>}
                            </span>
                            <span
                              className="health-indicator"
                              style={{ color: health.color }}
                              title={health.label}
                            >
                              {health.icon}
                            </span>
                          </div>
                          <div className="endpoint-details">
                            <span className="endpoint-provider">
                              <span className="provider-icon">{PROVIDER_OPTIONS.find(p => p.id === endpoint.provider)?.icon || '⚙'}</span>
                              {endpoint.name}
                            </span>
                            <span className="endpoint-url">{endpoint.baseUrl}</span>
                          </div>
                        </div>
                        <div className="endpoint-actions">
                          {!isCurrent && (
                            <button
                              className="action-btn"
                              onClick={() => handleSetCurrent(endpoint.id)}
                              title="Set as Current"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                              </svg>
                            </button>
                          )}
                          <button
                            className="action-btn"
                            onClick={() => handleEditEndpoint(endpoint)}
                            title="Edit"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                            </svg>
                          </button>
                          <button
                            className="action-btn danger"
                            onClick={() => handleDeletePrompt(endpoint)}
                            title="Delete"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button className="back-button" onClick={() => setView('main')} title={t('settings.back')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                </svg>
                {t('settings.back')}
              </button>
            </div>
          )}

          {/* Add/Edit Endpoint Form */}
          {(view === 'llm-add' || view === 'llm-edit') && (
            <div className="endpoint-form">
              <div className="form-group">
                <label>Provider</label>
                <select
                  className="provider-select"
                  value={formData.provider}
                  onChange={(e) => {
                    const provider = e.target.value as LLMProvider;
                    const providerOption = PROVIDER_OPTIONS.find(p => p.id === provider);
                    setFormData({
                      ...formData,
                      provider,
                      name: formData.name || providerOption?.name || '',
                      baseUrl: providerOption?.defaultBaseUrl || formData.baseUrl,
                    });
                  }}
                >
                  {PROVIDER_OPTIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.icon} {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Display Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., My OpenAI, Local Ollama"
                />
              </div>

              <div className="form-group">
                <label>Base URL</label>
                <input
                  type="text"
                  value={formData.baseUrl}
                  onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                  placeholder="e.g., http://localhost:11434/v1"
                />
              </div>

              <div className="form-group">
                <label>API Key <span className="optional">(optional)</span></label>
                <input
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>

              <div className="form-group">
                <label>Model ID</label>
                <input
                  type="text"
                  value={formData.modelId}
                  onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                  placeholder="e.g., qwen2.5-coder:32b, gpt-4"
                />
              </div>

              <div className="form-group">
                <label>Model Display Name <span className="optional">(optional)</span></label>
                <input
                  type="text"
                  value={formData.modelName}
                  onChange={(e) => setFormData({ ...formData, modelName: e.target.value })}
                  placeholder="Defaults to Model ID"
                />
              </div>

              <div className="form-group">
                <label>Max Context Length</label>
                <input
                  type="number"
                  value={formData.maxContextLength}
                  onChange={(e) => setFormData({ ...formData, maxContextLength: e.target.value })}
                  placeholder="128000"
                />
              </div>

              <div className="form-actions">
                <button className="cancel-btn" onClick={() => setView('llms')}>
                  Cancel
                </button>
                <button
                  className="save-btn"
                  onClick={handleSaveEndpoint}
                  disabled={isTesting}
                >
                  {isTesting ? 'Testing...' : 'Test & Save'}
                </button>
              </div>
            </div>
          )}

          {/* Delete Confirmation */}
          {view === 'llm-delete' && selectedEndpoint && (
            <div className="delete-confirm">
              <div className="delete-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
              </div>
              <h3>Delete Endpoint?</h3>
              <p>
                Are you sure you want to delete <strong>{selectedEndpoint.name}</strong>?
                This action cannot be undone.
              </p>
              <div className="delete-actions">
                <button className="cancel-btn" onClick={() => setView('llms')}>
                  Cancel
                </button>
                <button className="delete-btn" onClick={handleDeleteEndpoint}>
                  Delete
                </button>
              </div>
            </div>
          )}

          {/* Appearance Settings */}
          {view === 'appearance' && (
            <div className="appearance-view">
              {/* Language */}
              <div className="setting-section">
                <label className="setting-label">{t('appearance.language')}</label>
                <div className="language-selector">
                  {(['ko', 'en'] as Language[]).map((lang) => (
                    <button
                      key={lang}
                      className={`language-option ${language === lang ? 'selected' : ''}`}
                      onClick={() => setLanguage(lang)}
                    >
                      {t(`lang.${lang}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Family */}
              <div className="setting-section">
                <label className="setting-label">{t('appearance.fontFamily')}</label>
                <div className="font-family-grid">
                  {FONT_FAMILY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`font-family-option ${fontFamily === opt.value ? 'selected' : ''}`}
                      style={{ fontFamily: opt.cssFamily }}
                      onClick={() => {
                        setFontFamily(opt.value);
                        saveAppearanceSetting('fontFamily', opt.value);
                      }}
                      title={t(opt.labelKey)}
                    >
                      <span className="font-family-label">{t(opt.labelKey)}</span>
                      <span className="font-family-preview" style={{ fontFamily: opt.cssFamily }}> ABC</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size */}
              <div className="setting-section">
                <label className="setting-label">{t('appearance.fontSize')}</label>
                <div className="font-size-control">
                  <input
                    type="range"
                    min={FONT_SIZE_MIN}
                    max={FONT_SIZE_MAX}
                    value={fontSize}
                    onChange={(e) => {
                      const newSize = parseInt(e.target.value, 10);
                      setFontSize(newSize);
                      saveAppearanceSetting('fontSize', newSize);
                    }}
                    className="font-size-slider"
                  />
                  <span className="font-size-value">{fontSize}px</span>
                </div>
                <div className="font-size-preview" style={{ fontSize: `${fontSize}px` }}>
                  {t('appearance.fontPreview')}
                </div>
              </div>

              {/* UI Scale */}
              <div className="setting-section">
                <label className="setting-label">UI  (//)</label>
                <div className="font-size-control">
                  <input
                    type="range"
                    min={80}
                    max={150}
                    step={10}
                    value={Math.round((uiScale ?? 1) * 100)}
                    onChange={(e) => {
                      const newScale = parseInt(e.target.value, 10) / 100;
                      setUiScale(newScale);
                      saveAppearanceSetting('uiScale', newScale);
                    }}
                    className="font-size-slider"
                  />
                  <span className="font-size-value">{Math.round((uiScale ?? 1) * 100)}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  <span>80%</span>
                  <span>100% ()</span>
                  <span>150%</span>
                </div>
              </div>

              {/* Color Palette */}
              <div className="setting-section">
                <label className="setting-label">{t('appearance.colorTheme')}</label>
                <div className="palette-grid">
                  {COLOR_PALETTE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={`palette-option ${colorPalette === option.value ? 'selected' : ''}`}
                      onClick={() => {
                        setColorPalette(option.value);
                        saveAppearanceSetting('colorPalette', option.value);
                      }}
                      title={t(option.labelKey)}
                    >
                      <div className="palette-color" style={{ background: option.color }} />
                      <span className="palette-label">{t(option.labelKey)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button className="back-button" onClick={() => setView('main')} title={t('settings.back')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                </svg>
                {t('settings.back')}
              </button>
            </div>
          )}

          {/* External Tools Settings */}
          {view === 'tools' && (
            <div className="appearance-view">
              <div className="setting-section">
                <label className="setting-label">{t('tools.vscodePath')}</label>
                {vscodeAutoDetected ? (
                  <div className="vscode-auto-detected">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#10B981' }}>
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                    <span>{t('tools.autoDetected')}</span>
                  </div>
                ) : (
                  <div className="vscode-not-detected">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#F59E0B' }}>
                      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                    </svg>
                    <span>{t('tools.notFound')}</span>
                  </div>
                )}
                <div className="vscode-path-input-wrapper">
                  <input
                    type="text"
                    className="vscode-path-input"
                    value={vscodePath}
                    onChange={(e) => setVscodePath(e.target.value)}
                    placeholder={vscodeAutoDetected ? t('tools.autoPlaceholder') : t('tools.manualPlaceholder')}
                    disabled={vscodeAutoDetected}
                  />
                  {!vscodeAutoDetected && (
                    <button className="vscode-path-save-btn" onClick={() => saveVscodePath(vscodePath)} disabled={vscodePathSaved}>
                      {vscodePathSaved ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                        </svg>
                      ) : t('tools.save')}
                    </button>
                  )}
                </div>
                <div className="vscode-path-hint">
                  {vscodeAutoDetected ? t('tools.autoHint') : t('tools.manualHint')}
                </div>
              </div>

              {visionModels.length > 0 && (
                <div className="setting-section" style={{ marginTop: '16px' }}>
                  <label className="setting-label">Vision Model ( )</label>
                  <select
                    className="vscode-path-input"
                    value={selectedVisionModel}
                    onChange={(e) => saveVisionModel(e.target.value)}
                    style={{ padding: '6px 8px', cursor: 'pointer' }}
                  >
                    <option value="">Auto (  Vision  )</option>
                    {visionModels.map(vm => (
                      <option key={`${vm.endpointId}::${vm.modelId}`} value={`${vm.endpointId}::${vm.modelId}`}>
                        {vm.modelName} ({vm.endpointName})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button className="back-button" onClick={() => setView('main')} title={t('settings.back')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                </svg>
                {t('settings.back')}
              </button>
            </div>
          )}

          {/* Jarvis View */}
          {view === 'jarvis' && (
            <JarvisSettings onBack={() => setView('main')} />
          )}
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <span className="keyboard-hint">ESC</span>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// Jarvis Settings Sub-component
// =============================================================================

const JarvisSettings: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [pollInterval, setPollInterval] = useState(30);
  const [autoStart, setAutoStart] = useState(true);
  const [autoStartChat, setAutoStartChat] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const config = await (window as any).electronAPI?.jarvis?.getConfig();
        if (config) {
          setEnabled(config.enabled);
          setPollInterval(config.pollIntervalMinutes);
          setAutoStart(config.autoStartOnBoot);
        }
        const chatAutoStart = await (window as any).electronAPI?.autoStart?.getChat();
        if (chatAutoStart !== undefined) setAutoStartChat(chatAutoStart);
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
  }, []);

  const updateConfig = useCallback(async (updates: Record<string, unknown>) => {
    try {
      await (window as any).electronAPI?.jarvis?.setConfig(updates);
    } catch { /* ignore */ }
  }, []);

  const handleToggleEnabled = useCallback(async () => {
    const newValue = !enabled;
    setEnabled(newValue);
    await updateConfig({ enabled: newValue });
    //   —  
  }, [enabled, updateConfig]);

  const handleIntervalChange = useCallback(async (value: number) => {
    setPollInterval(value);
    await updateConfig({ pollIntervalMinutes: value });
  }, [updateConfig]);

  const handleAutoStartToggle = useCallback(async () => {
    const newValue = !autoStart;
    setAutoStart(newValue);
    await updateConfig({ autoStartOnBoot: newValue });
  }, [autoStart, updateConfig]);

  const handleAutoStartChatToggle = useCallback(async () => {
    const newValue = !autoStartChat;
    setAutoStartChat(newValue);
    try {
      await (window as any).electronAPI?.autoStart?.setChat(newValue);
    } catch { /* ignore */ }
  }, [autoStartChat]);

  if (loading) {
    return (
      <div className="appearance-view">
        <div className="empty-state"><p> ...</p></div>
      </div>
    );
  }

  return (
    <div className="appearance-view">
      {/*   */}
      <div className="setting-section">
        <label className="setting-label"> </label>
        <div className="setting-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
            {enabled ? '   ' : ' '}
          </span>
          <button
            className={`toggle-btn ${enabled ? 'toggle-btn--active' : ''}`}
            onClick={handleToggleEnabled}
            style={{
              width: '44px', height: '24px', borderRadius: '12px', border: 'none',
              background: enabled ? '#D4A574' : 'var(--color-border-muted)',
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: '2px',
              left: enabled ? '22px' : '2px',
              width: '20px', height: '20px', borderRadius: '50%',
              background: 'white', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>
      </div>

      {/*   */}
      <div className="setting-section">
        <label className="setting-label"> : {pollInterval}</label>
        <input
          type="range"
          min={5}
          max={120}
          step={5}
          value={pollInterval}
          onChange={(e) => handleIntervalChange(Number(e.target.value))}
          className="font-size-slider"
          disabled={!enabled}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-text-muted)' }}>
          <span>5</span>
          <span>120</span>
        </div>
      </div>

      {/* Windows     —  */}
      <div className="setting-section">
        <label className="setting-label">Windows     </label>
        <div className="setting-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
            {autoStartChat ? '     ' : '   '}
          </span>
          <button
            onClick={handleAutoStartChatToggle}
            style={{
              width: '44px', height: '24px', borderRadius: '12px', border: 'none',
              background: autoStartChat ? '#D4A574' : 'var(--color-border-muted)',
              position: 'relative', cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: '2px',
              left: autoStartChat ? '22px' : '2px',
              width: '20px', height: '20px', borderRadius: '50%',
              background: 'white', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>
      </div>

      {/* Windows     —  */}
      <div className="setting-section">
        <label className="setting-label">Windows     </label>
        <div className="setting-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
            {autoStart ? '    ' : '   '}
          </span>
          <button
            onClick={handleAutoStartToggle}
            disabled={!enabled}
            style={{
              width: '44px', height: '24px', borderRadius: '12px', border: 'none',
              background: (enabled && autoStart) ? '#D4A574' : 'var(--color-border-muted)',
              position: 'relative', cursor: enabled ? 'pointer' : 'default',
              transition: 'background 0.2s', opacity: enabled ? 1 : 0.5,
            }}
          >
            <span style={{
              position: 'absolute', top: '2px',
              left: (enabled && autoStart) ? '22px' : '2px',
              width: '20px', height: '20px', borderRadius: '50%',
              background: 'white', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>
      </div>

      {/*  */}
      {enabled && (
        <div className="setting-section" style={{ marginTop: '8px' }}>
          <div style={{
            padding: '10px 12px', borderRadius: '8px',
            background: 'rgba(212, 165, 116, 0.1)', border: '1px solid rgba(212, 165, 116, 0.2)',
            fontSize: '11px', lineHeight: '1.6', color: 'var(--color-text-secondary)',
          }}>
            <strong>  :</strong><br />
            • {pollInterval}   task <br />
            • Manager LLM   task <br />
            •      <br />
            •   → ""  <br />
            {autoStartChat && '•      '}{autoStartChat && <br />}
            {autoStart && '•      '}
          </div>
        </div>
      )}

      <button className="back-button" onClick={onBack} title={t('settings.back')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
        </svg>
        {t('settings.back')}
      </button>
    </div>
  );
};

export default Settings;
