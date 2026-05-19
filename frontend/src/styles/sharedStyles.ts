/**
 * Shared style definitions used across multiple views and components.
 * Centralizes common patterns to avoid duplication and ensure consistency.
 *
 * For inline edit panel styles (used by useInlineTask, useInlineEntry, PortfolioView),
 * see inlineEditStyles.ts.
 */

/* ── Card / Section Styles ── */

/** Standard card container used in DashboardView, PortfolioView, TimelineView. */
export const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--card-border)',
  borderRadius: '8px', boxShadow: 'var(--shadow-soft)', padding: '20px',
};

/** Section container used in ReportsView, SettingsView, EntryFormView, SetupWizard. */
export const sectionStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--card-border)',
  borderRadius: '8px', boxShadow: 'var(--shadow-soft)', padding: '24px', marginBottom: '20px',
};

/* ── Input / Label Styles ── */

/** Standard form input used across all form views. */
export const formInputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', background: 'var(--input-bg)',
  border: '1px solid var(--input-border)', borderRadius: '8px',
  color: 'var(--text-primary)', fontSize: '14px', outline: 'none',
};

/** Standard form label used across all form views. */
export const formLabelStyle: React.CSSProperties = {
  display: 'block', marginBottom: '6px', color: 'var(--text-secondary)', fontSize: '13px',
};

/** Standard form field wrapper with bottom margin. */
export const fieldStyle: React.CSSProperties = { marginBottom: '14px' };

/* ── Button Styles ── */

/** Primary action button (solid background). */
export const btnPrimary: React.CSSProperties = {
  padding: '10px 20px', background: 'var(--button-primary-bg)', color: 'var(--text-on-primary)',
  border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
};

/** Secondary action button (transparent with border). */
export const btnSecondary: React.CSSProperties = {
  padding: '10px 20px', background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--card-border)', borderRadius: '8px', fontSize: '14px', cursor: 'pointer',
};

/** Small utility button (compact, bordered). */
export const btnSmall: React.CSSProperties = {
  padding: '4px 10px', background: 'transparent',
  border: '1px solid var(--input-border)', borderRadius: '6px',
  fontSize: '12px', cursor: 'pointer',
};

/** Danger button (small, outlined in red). */
export const btnDanger: React.CSSProperties = {
  padding: '4px 10px', background: 'transparent', color: 'var(--accent-danger)',
  border: '1px solid var(--accent-danger)', borderRadius: '6px',
  fontSize: '12px', cursor: 'pointer',
};

/* ── Chip / Pill / Badge Styles ── */

/** Colored chip used for program names, status labels, etc. */
export const chipStyle = (color: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '3px',
  padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
  color, background: `${color}22`,
});

/** Selectable pill used for filter buttons, scope selectors. */
export const pillStyle = (active: boolean, color?: string | null): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '4px',
  padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: 600,
  cursor: 'pointer',
  color: active ? 'var(--text-on-primary)' : 'var(--text-secondary)',
  background: active ? (color || 'var(--accent-primary)') : 'var(--input-bg)',
  border: `1px solid ${active ? (color || 'var(--accent-primary)') : 'var(--input-border)'}`,
  transition: 'all 0.15s',
});

/** Scope/filter button used in TimelineView and ReportsView. */
export const scopeBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
  border: active ? '1px solid var(--accent-primary)' : '1px solid var(--card-border)',
  background: active ? 'var(--accent-primary)' : 'transparent',
  color: active ? 'var(--text-on-primary)' : 'var(--text-secondary)', transition: 'all 0.15s',
});

/* ── Heading Styles ── */

/** Standard heading used in SettingsView sections. */
export const headingStyle: React.CSSProperties = {
  margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary)',
};

/** Section heading used in SettingsView top-level sections. */
export const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 20px', fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)',
};

/* ── Type Icon Config ── */

/** Entry type icon/color mapping used in DashboardView, PortfolioView, TimelineView. */
export const TYPE_ICON: Record<string, { icon: string; color: string }> = {
  decision: { icon: '◆', color: 'var(--accent-warning)' },
  milestone: { icon: '★', color: 'var(--status-on-track)' },
  action_item: { icon: '☐', color: 'var(--accent-danger)' },
  note: { icon: '—', color: 'var(--text-muted)' },
  quick_capture: { icon: '—', color: 'var(--text-muted)' },
  project_update: { icon: '—', color: 'var(--text-muted)' },
  operational_rhythm: { icon: '—', color: 'var(--text-muted)' },
  development: { icon: '—', color: 'var(--text-muted)' },
  recognition: { icon: '—', color: 'var(--text-muted)' },
};

export const DEFAULT_ICON = { icon: '—', color: 'var(--text-muted)' };

/* ── Dashboard Section Styles ── */

/** Sticky section header used in Dashboard sectioned stream layout. */
export const stickyHeaderStyle: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 10,
  background: 'var(--bg-primary)', padding: '8px 0 12px',
  margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)',
  display: 'flex', alignItems: 'center', gap: '8px',
};

/** Program group header (uppercase, muted, with dot). */
export const programGroupHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px',
  fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 0 2px',
};

/** Project sub-header under a program group. */
export const projectSubHeaderStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)',
  padding: '2px 0 2px 12px',
};

/* ── Status Config ── */

/** Status badge configuration used in PortfolioView. */
export const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  on_track: { color: 'var(--status-on-track)', label: 'On Track' },
  at_risk: { color: 'var(--status-at-risk)', label: 'At Risk' },
  behind: { color: 'var(--status-behind)', label: 'Behind' },
  completed: { color: 'var(--status-completed)', label: 'Completed' },
  paused: { color: 'var(--status-paused)', label: 'Paused' },
  active: { color: 'var(--status-on-track)', label: 'Active' },
  planning: { color: 'var(--status-completed)', label: 'Planning' },
  sunset: { color: 'var(--status-behind)', label: 'Sunset' },
};
