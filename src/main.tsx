import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';
import 'katex/dist/katex.min.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary
    contextLabel="StudyWeb"
    onReset={() => window.location.reload()}
    resetLabel="Reload Page"
  >
    <App />
  </ErrorBoundary>
);
