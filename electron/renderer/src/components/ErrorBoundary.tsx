/**
 * Error Boundary Component
 * React     UI 
 */

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    window.electronAPI?.log?.error('[ErrorBoundary] Caught an error', { error: error.message, componentStack: errorInfo?.componentStack });
    this.setState({ errorInfo });

    //     ()
    try {
      //    
    } catch {
      // 
    }
  }

  handleReload = (): void => {
    window.electronAPI?.window.reload();
  };

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <style>{`
            .error-boundary {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              padding: 40px;
              background-color: var(--bg-primary, #0d1117);
              color: var(--text-primary, #e6edf3);
              font-family: 'Inter', -apple-system, sans-serif;
            }
            .error-icon {
              width: 80px;
              height: 80px;
              margin-bottom: 24px;
              color: #f85149;
            }
            .error-title {
              font-size: 24px;
              font-weight: 600;
              margin-bottom: 12px;
            }
            .error-message {
              font-size: 16px;
              color: var(--text-secondary, #8b949e);
              margin-bottom: 24px;
              text-align: center;
              max-width: 500px;
            }
            .error-details {
              background-color: var(--bg-secondary, #161b22);
              border: 1px solid var(--border-default, #30363d);
              border-radius: 8px;
              padding: 16px;
              margin-bottom: 24px;
              max-width: 600px;
              max-height: 200px;
              overflow: auto;
              font-family: 'JetBrains Mono', monospace;
              font-size: 12px;
              white-space: pre-wrap;
              word-break: break-all;
            }
            .error-actions {
              display: flex;
              gap: 12px;
            }
            .error-btn {
              padding: 10px 20px;
              border-radius: 6px;
              border: none;
              font-size: 14px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s;
            }
            .error-btn-primary {
              background: linear-gradient(135deg, #38BDF8 0%, #0EA5E9 100%);
              color: white;
            }
            .error-btn-primary:hover {
              transform: translateY(-1px);
              box-shadow: 0 4px 12px rgba(56, 189, 248, 0.4);
            }
            .error-btn-secondary {
              background-color: var(--bg-secondary, #21262d);
              color: var(--text-primary, #e6edf3);
              border: 1px solid var(--border-default, #30363d);
            }
            .error-btn-secondary:hover {
              background-color: var(--bg-tertiary, #30363d);
            }
          `}</style>

          <svg className="error-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>

          <h1 className="error-title">Something went wrong</h1>
          <p className="error-message">
            An unexpected error occurred. You can try reloading the application or resetting the view.
          </p>

          {this.state.error && (
            <div className="error-details">
              <strong>{this.state.error.name}:</strong> {this.state.error.message}
              {this.state.errorInfo && (
                <>
                  {'\n\n'}
                  <strong>Component Stack:</strong>
                  {this.state.errorInfo.componentStack}
                </>
              )}
            </div>
          )}

          <div className="error-actions">
            <button className="error-btn error-btn-primary" onClick={this.handleReload}>
              Reload Application
            </button>
            <button className="error-btn error-btn-secondary" onClick={this.handleReset}>
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
