import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', this.props.name, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="font-mono text-center py-12 px-5">
          <div className="text-2xl mb-3 opacity-30">⚠</div>
          <div className="text-sm mb-2" style={{ color: 'var(--scanner-text2)' }}>
            {this.props.name || 'This section'} encountered an error
          </div>
          <div className="text-[10px] mb-3" style={{ color: 'var(--scanner-text3)' }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="font-mono text-[10px] font-bold tracking-wide px-3 py-1.5 rounded"
            style={{ background: 'var(--scanner-accent)', color: '#000', border: 'none', cursor: 'pointer' }}
          >
            ↻ RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
