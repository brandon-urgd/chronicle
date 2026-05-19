/**
 * Shared inline edit panel styles (v1.3).
 * Used by useInlineTask, useInlineEntry, and PortfolioView entity edit forms
 * to ensure consistent look-and-feel across all inline panels.
 */

export const inlinePanelStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)', border: '1px solid var(--accent-primary)',
  borderRadius: '8px', padding: '16px', margin: '6px 0 10px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
};

export const inlineBtnStyle = (bg: string, color: string): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
  cursor: 'pointer', background: bg, color, border: 'none', whiteSpace: 'nowrap',
});

export const inlineInputStyle: React.CSSProperties = {
  padding: '6px 10px', background: 'var(--input-bg)', border: '1px solid var(--input-border)',
  borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none',
};
