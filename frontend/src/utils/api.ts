/**
 * API base URL setup for Tauri production mode.
 *
 * In dev mode, the Vite proxy forwards `/api/...` to the backend.
 * In Tauri production, the frontend loads from the filesystem, so
 * relative `/api/...` URLs don't resolve. This module patches the
 * global fetch to prepend the backend URL when needed.
 *
 * Port discovery: the backend auto-selects a free port in 8180-8199.
 * Each fetch attempt tries the last-known port first, then probes others.
 *
 * Call `patchFetchForTauri()` once at app startup (in main.tsx).
 */

const PORT_RANGE_START = 8180;
const PORT_RANGE_END = 8199;

let lastKnownPort = PORT_RANGE_START;
let portConfirmed = false;

function isTauriProduction(): boolean {
  const hasTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;
  if (!hasTauri) return false;
  const proto = window.location.protocol;
  return proto === 'tauri:' || proto === 'https:' || proto === 'file:';
}

export function patchFetchForTauri(): void {
  if (!isTauriProduction()) return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input !== 'string' || !input.startsWith('/api')) {
      return originalFetch(input, init);
    }

    // If port is confirmed, use it directly
    if (portConfirmed) {
      return originalFetch(`http://127.0.0.1:${lastKnownPort}${input}`, init);
    }

    // Try last known port first (fast path)
    try {
      const res = await originalFetch(`http://127.0.0.1:${lastKnownPort}${input}`, init);
      portConfirmed = true;
      return res;
    } catch {
      // Last known port failed — probe the range
    }

    // Probe all ports — return first success
    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (port === lastKnownPort) continue; // already tried
      try {
        const res = await originalFetch(`http://127.0.0.1:${port}${input}`, init);
        lastKnownPort = port;
        portConfirmed = true;
        return res;
      } catch {
        continue;
      }
    }

    // All failed — throw so the caller's retry logic handles it
    throw new Error('Backend not reachable on any port');
  };
}
