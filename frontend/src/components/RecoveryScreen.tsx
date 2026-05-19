import { useState, useEffect } from 'react';

interface BackupInfo {
  filename: string;
  age_days: number;
}

interface RecoveryScreenProps {
  error: string;
  onRetry: () => void;
  onStartFresh: () => void;
  onRestore: () => void;
}

export default function RecoveryScreen({ error, onRetry, onStartFresh, onRestore }: RecoveryScreenProps) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/recovery/backup-info')
      .then(r => r.json())
      .then(data => setBackups(data.backups ?? []))
      .catch(() => {});
  }, []);

  async function handleStartFresh() {
    setActionBusy(true);
    setActionResult(null);
    try {
      const res = await fetch('/api/recovery/start-fresh', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionResult('Database reset. Restarting…');
        setTimeout(() => onStartFresh(), 1500);
      } else {
        setActionResult(data.error || 'Failed to reset database');
      }
    } catch {
      setActionResult('Network error');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRetry() {
    setActionBusy(true);
    setActionResult(null);
    try {
      const res = await fetch('/api/recovery/retry', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onRetry();
      } else {
        setActionResult(data.message || 'Retry failed — please restart the app');
      }
    } catch {
      setActionResult('Network error');
    } finally {
      setActionBusy(false);
    }
  }

  const mostRecentBackup = backups.length > 0 ? backups[0] : null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', padding: '40px', background: 'var(--bg-primary)', color: 'var(--text-primary)',
    }}>
      <div style={{
        maxWidth: '520px', width: '100%', background: 'var(--card-bg)',
        border: '1px solid var(--card-border)', borderRadius: '12px', padding: '32px',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>⚠️</div>
          <h1 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px' }}>
            Chronicle could not open the database
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
            The database file is inaccessible or corrupted.
          </p>
        </div>

        {/* Error Details */}
        <div style={{
          background: 'var(--input-bg)', borderRadius: '8px', padding: '12px',
          marginBottom: '20px', fontSize: '12px', color: 'var(--accent-danger)',
          fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word',
        }}>
          {error}
        </div>

        {/* Backup Info */}
        {mostRecentBackup && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Most recent backup: <strong>{mostRecentBackup.filename}</strong>
            {' '}({mostRecentBackup.age_days === 0 ? 'today' : `${mostRecentBackup.age_days} day${mostRecentBackup.age_days === 1 ? '' : 's'} ago`})
          </p>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={onRestore}
            disabled={actionBusy}
            style={{
              padding: '12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: 'var(--accent-primary)', color: '#fff', fontSize: '14px', fontWeight: 600,
              opacity: actionBusy ? 0.6 : 1,
            }}
          >
            Restore from Backup
          </button>
          <button
            onClick={handleStartFresh}
            disabled={actionBusy}
            style={{
              padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)',
              cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--text-primary)',
              fontSize: '14px', fontWeight: 500, opacity: actionBusy ? 0.6 : 1,
            }}
          >
            Start Fresh
          </button>
          <button
            onClick={handleRetry}
            disabled={actionBusy}
            style={{
              padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)',
              cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)',
              fontSize: '13px', fontWeight: 400, opacity: actionBusy ? 0.6 : 1,
            }}
          >
            Try Again
          </button>
        </div>

        {/* Action Result */}
        {actionResult && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px', textAlign: 'center' }}>
            {actionResult}
          </p>
        )}
      </div>
    </div>
  );
}
