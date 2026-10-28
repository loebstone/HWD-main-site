import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { getSession, getRosterEntry } from '@workspace/api-client-react';
import { prepareProtectedVisit } from '@/lib/sign-in-navigation';

import './index.css';

async function start() {
  const result = await prepareProtectedVisit(window.location, getSession, getRosterEntry,
    (url) => window.location.replace(url));
  if (result === "redirect") return;
  createRoot(document.getElementById('root')!, {
    // Keeps caught errors off reportError(), which would raise the dev overlay.
    onCaughtError: (error, errorInfo) => {
      console.error(error, errorInfo.componentStack);
    },
  }).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

void start();
