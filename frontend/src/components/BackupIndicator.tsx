import { useEffect, useState } from 'react';

interface BackupStatus {
  last_backup_date: string | null;
  last_backup_filename: string | null;
  backup_count: number;
  stale: boolean;
}

export default function BackupIndicator() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    setLoading(true);
    try {
      const res = await fetch('/api/backup/status');
      if (res.ok) setStatus(await res.json());
    } catch { /* backend may be down */ }
    finally { setLoading(false); }
  }

  if (loading) return null;

  const hasBackup = status?.last_backup_date != null;
  const isStale = status?.stale === true;

  let displayText = 'No auto-backup yet';
  if (hasBackup && status?.last_backup_date) {
    const d = new Date(status.last_backup_date);
    const date = d.toLocaleDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    displayText = `Last auto-backup: ${date} at ${time}`;
  }

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '13px',
    marginBottom: '12px',
    background: isStale ? 'rgba(180, 83, 9, 0.1)' : 'rgba(63, 125, 88, 0.08)',
    border: isStale ? '1px solid rgba(180, 83, 9, 0.2)' : '1px solid var(--card-border)',
    color: isStale ? 'var(--accent-warning, #b45309)' : 'var(--text-secondary)',
  };

  return (
    <div style={containerStyle} data-testid="backup-indicator">
      {isStale && <span style={{ fontSize: '14px' }} aria-label="Stale backup warning">⚠️</span>}
      <span>{displayText}</span>
    </div>
  );
}
