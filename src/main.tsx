import {StrictMode, Component, type ReactNode, type ErrorInfo} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Error boundary to catch and display crashes instead of black screen
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crash:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#ff4444', fontFamily: 'monospace', whiteSpace: 'pre-wrap', background: '#111', minHeight: '100vh', boxSizing: 'border-box' }}>
          <h2 style={{ color: '#ff0000', marginBottom: 16 }}>App Error</h2>
          <p style={{ color: '#ff8888', fontSize: 14 }}>{this.state.error.message}</p>
          <pre style={{ color: '#888', fontSize: 12, marginTop: 12, overflow: 'auto' }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Wrap in DOMContentLoaded to ensure WebView is ready
document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (!root) {
    document.body.innerHTML = '<div style="color:red;padding:20px;font-family:monospace">Error: #root element not found</div>';
    return;
  }
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});
