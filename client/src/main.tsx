import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/app/App';
import { queryClient } from '@/app/query/queryClient';
import { persistCache, restoreCache } from '@/app/query/persistCache';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import '@/styles/global.css';

function render(): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('Application root element was not found.');

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

Promise.race([
  restoreCache(queryClient),
  new Promise((resolve) => setTimeout(resolve, 250)),
]).finally(() => {
  persistCache(queryClient);
  render();
});
