import { useState } from 'react';

export interface ReportReadyCardProps {
  reportReady: { draft_id: number; title: string } | null | undefined;
  onNavigateToTab?: (tab: string) => void;
}

/**
 * ReportReadyCard — a full-width footer banner in Tier 4 of the Dashboard.
 * Shown only when a report draft with status "ready" exists (report_ready is not null).
 * Displays the draft title, an "Open →" link to navigate to Reports, and a dismiss button (×).
 * Dismissal is session-only (state resets on app relaunch).
 *
 * Validates: Requirements 2.13, 2.14, 2.15, 2.16
 */
export default function ReportReadyCard({ reportReady, onNavigateToTab }: ReportReadyCardProps) {
  const [dismissed, setDismissed] = useState(false);

  // Don't render if no report is ready or if dismissed for this session
  if (!reportReady || dismissed) return null;

  return (
    <div
      className="report-ready-card"
      role="banner"
      aria-label={`Report ready: ${reportReady.title}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 16px',
        background: 'var(--input-bg)',
        borderLeft: '3px solid var(--accent-primary)',
        borderRadius: '6px',
        marginTop: '4px',
      }}
    >
      <span
        style={{
          fontSize: '13px',
          color: 'var(--text-primary)',
          fontWeight: 500,
          flex: 1,
        }}
      >
        📄 Report ready: <strong>{reportReady.title}</strong>
      </span>

      <button
        onClick={() => onNavigateToTab?.('Reports')}
        style={{
          padding: '4px 12px',
          borderRadius: '5px',
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          border: 'none',
          background: 'var(--accent-primary)',
          color: '#fff',
          whiteSpace: 'nowrap',
        }}
        aria-label={`Open report: ${reportReady.title}`}
      >
        Open →
      </button>

      <button
        onClick={() => setDismissed(true)}
        style={{
          flexShrink: 0,
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '16px',
          fontWeight: 600,
          cursor: 'pointer',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-muted)',
          lineHeight: 1,
        }}
        aria-label="Dismiss report ready banner"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
