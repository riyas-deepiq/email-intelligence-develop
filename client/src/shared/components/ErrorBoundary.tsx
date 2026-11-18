import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100vh',
              gap: '1rem',
              fontFamily: 'sans-serif',
              color: '#333',
            }}
          >
            <h2 style={{ margin: 0 }}>Something went wrong</h2>
            <p style={{ margin: 0, color: '#888', fontSize: '0.9rem' }}>
              Please reload the application and try again.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.5rem 1.25rem',
                cursor: 'pointer',
                border: '1px solid #ccc',
                borderRadius: 6,
                background: '#fff',
              }}
            >
              Reload page
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
