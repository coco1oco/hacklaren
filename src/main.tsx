import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initPwa } from './lib/pwaUpdate';
import { App } from './App';
import './index.css';

// App-shell service worker (prompt mode, never auto-reloads). Patient data is cached by Firestore persistence, never by the SW.
initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
