import { useRef, useState, useEffect } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { APP_VERSION } from '../constants';

interface AboutModalProps {
  onClose: () => void;
}

const sectionStyle: React.CSSProperties = { marginBottom: '1.25rem' };
const h3Style: React.CSSProperties = { margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' };

export default function AboutModal({ onClose }: AboutModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(overlayRef, { onEscape: onClose, initialFocusRef: closeRef });

  const [versionInfo, setVersionInfo] = useState<{ app_version: string; schema_version: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/version');
        if (res.ok) setVersionInfo(await res.json());
      } catch { /* fallback to constant */ }
    })();
  }, []);

  const displayVersion = versionInfo?.app_version ?? APP_VERSION;

  const [copyConfirm, setCopyConfirm] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function handleCopyDiagnostic() {
    setCopyError(null);
    setFallbackText(null);
    let text: string;
    try {
      const res = await fetch('/api/diagnostics');
      if (!res.ok) {
        setCopyError(`Failed to load diagnostics (HTTP ${res.status})`);
        return;
      }
      text = await res.text();
    } catch {
      setCopyError('Failed to load diagnostics');
      return;
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setCopyConfirm(true);
        setTimeout(() => setCopyConfirm(false), 2000);
        return;
      } catch {
        // clipboard permission denied or similar — fall through to textarea
      }
    }
    setFallbackText(text);
  }

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="About Chronicle"
    >
      <div
        style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '12px', padding: '32px', maxWidth: '640px', width: '90%',
          maxHeight: '85vh', overflowY: 'auto', color: 'var(--text-primary)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>About</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '18px', color: 'var(--text-muted)', padding: '4px 8px',
            }}
          >✕</button>
        </div>

        {/* App Name & Tagline */}
        <div style={sectionStyle}>
          <div style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '2px', marginBottom: '4px' }}>CHRONICLE</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Professional Narrative System</div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            Capture daily work, organize under programs and projects, track operational cadence, and generate leadership-ready reports — all from a single desktop app.
          </p>
        </div>

        {/* v3.0.0 Release Notes */}
        <div style={sectionStyle}>
          <h3 style={h3Style}>What's New in v3.0.0</h3>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            <li>Unified data model — tasks are the only input, entries are the output</li>
            <li>Time Distribution page — see where you spend your time by program/project</li>
            <li>Dashboard view modes — toggle Upcoming between "By Date" and "By Program"</li>
            <li>Graceful DB recovery — recovery screen instead of crash on database errors</li>
            <li>File attachments — upload, download, and delete files on entries/projects</li>
            <li>Timeline delete — remove entries directly from the edit form</li>
            <li>Section persistence — Dashboard collapse states survive page refresh</li>
            <li>Server-side search — Portfolio search now queries the backend</li>
          </ul>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0' }}>
            For full feature details, workflows, and MCP integration — see the <strong>Guide</strong> tab.
          </p>
        </div>

        {/* Tech Stack (compact) */}
        <div style={sectionStyle}>
          <h3 style={h3Style}>Tech Stack</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.8 }}>
            React 19 · TypeScript · Vite · Rust (axum 0.7, tokio) · rusqlite · SQLite (WAL) · Tauri 1.6 · @react-pdf/renderer
          </p>
        </div>

        {/* Creator Credit */}
        <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--card-border)' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: '0 0 4px' }}>
            Created by Brandon Hill-Rogers
          </p>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 6px' }}>
            brandon@urgdstudios.com · ur/gd Studios
          </p>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
            Version {displayVersion}
          </p>
        </div>

        {/* Copy Diagnostic Info */}
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleCopyDiagnostic}
              style={{
                background: 'var(--accent-primary)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Copy Diagnostic Info
            </button>
            {copyConfirm && (
              <span
                role="status"
                aria-live="polite"
                style={{ fontSize: '12px', color: 'var(--accent-secondary)', fontWeight: 600 }}
              >
                Copied
              </span>
            )}
            {copyError && (
              <span
                role="status"
                aria-live="polite"
                style={{ fontSize: '12px', color: 'var(--accent-danger)' }}
              >
                {copyError}
              </span>
            )}
          </div>
          {fallbackText !== null && (
            <div style={{ marginTop: '8px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 4px' }}>
                Clipboard unavailable — select all and copy manually:
              </p>
              <textarea
                readOnly
                value={fallbackText}
                onFocus={e => e.currentTarget.select()}
                style={{
                  width: '100%',
                  minHeight: '160px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '11px',
                  background: 'var(--card-bg)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--card-border)',
                  borderRadius: '6px',
                  padding: '8px',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
