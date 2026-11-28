import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  contextLabel?: string;
  onReset?: () => void;
  resetLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error || 'Unexpected UI error.'),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.contextLabel ? `: ${this.props.contextLabel}` : ''}]`, error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { contextLabel, onReset, resetLabel = 'Return Home' } = this.props;

    return (
      <div className="flex h-full min-h-[280px] w-full items-center justify-center bg-[var(--bg)] p-6 text-[var(--ink)]">
        <div className="sd-card w-full max-w-lg p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--bad)] bg-[var(--bg)] text-[var(--bad)]">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                {contextLabel ? `Could not load ${contextLabel}` : 'Something went wrong'}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--mute)]">
                Your local study data is safe. Retry loading this view or return to the home dashboard.
              </p>
              {this.state.errorMessage && (
                <div className="font-mono-num mt-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[11px] break-words text-[var(--bad)]">
                  {this.state.errorMessage}
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
            {onReset && (
              <button
                type="button"
                onClick={() => {
                  this.handleRetry();
                  onReset();
                }}
                className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
              >
                <Home className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{resetLabel}</span>
              </button>
            )}
            <button
              type="button"
              onClick={this.handleRetry}
              className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
