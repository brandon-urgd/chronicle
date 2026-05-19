import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { patchFetchForTauri } from './utils/api'

// In Tauri production mode, rewrite /api/* URLs to hit the local backend.
patchFetchForTauri();

// Prevent the browser/webview from navigating when files are dropped
// outside of a designated drop zone. The RestoreFlow component handles
// its own drag-and-drop events on the drop zone element.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
