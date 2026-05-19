import { useCallback, useEffect, useRef, useState } from 'react';
import EntryFormView from '../views/EntryFormView';
import { inlinePanelStyle, inlineBtnStyle } from '../styles/inlineEditStyles';
import { useDirtyClose } from './useDirtyClose';
import DiscardConfirmDialog from '../components/DiscardConfirmDialog';

/**
 * Shared inline entry detail/edit panel hook (v1.3).
 * Provides state, handlers, and a render function for the inline entry
 * detail panel used in PortfolioView (and available for any future view).
 * Mirrors the useInlineTask pattern for consistency.
 *
 * v2.5.1 — wired to the shared dirty-state close guard (Requirement 11):
 *   - Detail view has no user input → always clean; outside click / Esc /
 *     ✕ close immediately as before.
 *   - Edit mode wraps EntryFormView which emits dirty transitions via
 *     onDirtyChange. When the form is dirty:
 *       · Outside click → panel shakes (.modal-shake, 400ms) and stays open.
 *       · Esc / ✕ → DiscardConfirmDialog prompts before discarding.
 */

export interface InlineEntryData {
  id: number; title: string; entry_type: string; entry_date: string;
  description: string | null; status: string | null;
  program_id: number | null; program_name: string | null;
  project_name: string | null; project_id: number | null;
  is_pinned: number;
  tags: { id: number; name: string }[];
}

interface UseInlineEntryOptions {
  /** Called after any mutation (pin/delete/promote) to refresh parent data. */
  onMutate?: () => void | Promise<void>;
  /** Navigate to a tab (e.g. Timeline) with optional target. */
  onNavigateToTab?: (tab: string, targetId?: number, context?: { projectId?: number; date?: string }) => void;
}

export function useInlineEntry(options: UseInlineEntryOptions = {}) {
  const [inlineEntryId, setInlineEntryId] = useState<number | null>(null);
  const [inlineEntryData, setInlineEntryData] = useState<InlineEntryData | null>(null);
  const [inlineEditMode, setInlineEditMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  /* ── Dirty-state tracking (Requirement 11) ──
     Only edit mode can be dirty; the detail view has no user input.
     EntryFormView drives this via its onDirtyChange callback. */
  const [formIsDirty, setFormIsDirty] = useState(false);

  async function loadInlineEntry(id: number) {
    try {
      const res = await fetch(`/api/entries/${id}`);
      if (res.ok) {
        // eslint-disable-next-line no-console
        console.log('[loadInlineEntry] resetting inlineEditMode=false');
        setInlineEntryData(await res.json());
        setInlineEntryId(id);
        setInlineEditMode(false);
        setFormIsDirty(false);
      }
    } catch { /* ignore */ }
  }

  const closeInlineEntry = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[closeInlineEntry] resetting inlineEditMode=false');
    setInlineEntryId(null);
    setInlineEntryData(null);
    setInlineEditMode(false);
    setFormIsDirty(false);
  }, []);

  /* ── Dirty-close wiring ── */
  const isDirty = useCallback(
    () => inlineEditMode && formIsDirty,
    [inlineEditMode, formIsDirty],
  );
  const {
    handleBackdropClick,
    handleExplicitClose,
    shaking,
    confirmOpen,
    confirmDiscard,
    confirmCancel,
    confirmMessage,
  } = useDirtyClose({ isDirty, onClose: closeInlineEntry });

  /* ── Outside-click detection for the inline panel ── */
  const panelRef = useRef<HTMLDivElement>(null);
  const handleDocumentMouseDown = useCallback((e: MouseEvent) => {
    if (inlineEntryId === null) return;
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      handleBackdropClick();
    }
  }, [inlineEntryId, handleBackdropClick]);

  useEffect(() => {
    if (inlineEntryId === null) {
      return undefined;
    }
    // Delay to avoid closing immediately from the click that opened the panel.
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleDocumentMouseDown);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, [inlineEntryId, handleDocumentMouseDown]);

  /* ── Esc key listener (explicit close intent) ── */
  useEffect(() => {
    if (inlineEntryId === null) return undefined;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Let the confirm dialog own Esc while it is open.
      if (confirmOpen) return;
      e.stopPropagation();
      handleExplicitClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [inlineEntryId, confirmOpen, handleExplicitClose]);

  async function handleTogglePin(entryId: number) {
    if (busy) return;
    setBusy(true);
    setInlineError(null);
    try {
      const res = await fetch(`/api/entries/${entryId}/pin`, { method: 'PATCH' });
      if (res.ok) loadInlineEntry(entryId);
      else setInlineError('Failed to toggle pin. Please try again.');
    } catch { setInlineError('Network error. Please check your connection.'); }
    finally { setBusy(false); }
  }

  async function handleEntryDelete(entryId: number) {
    if (busy) return;
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    setBusy(true);
    setInlineError(null);
    try {
      const res = await fetch(`/api/entries/${entryId}`, { method: 'DELETE' });
      if (res.ok) { closeInlineEntry(); await options.onMutate?.(); }
      else { setInlineError('Failed to delete entry. Please try again.'); }
    } catch { setInlineError('Network error. Please check your connection.'); }
    finally { setBusy(false); }
  }

  async function handlePromoteToProject(entryId: number, title: string) {
    if (busy) return;
    if (!confirm(`Create a project from "${title}"? The entry will be linked to the new project.`)) return;
    setBusy(true);
    setInlineError(null);
    try {
      const projectBody: Record<string, unknown> = { name: title, status: 'active' };
      if (inlineEntryData?.program_id) projectBody.program_id = inlineEntryData.program_id;
      const projRes = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectBody),
      });
      if (projRes.ok) {
        const proj = await projRes.json();
        await fetch(`/api/entries/${entryId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: proj.id }),
        });
        closeInlineEntry();
        await options.onMutate?.();
      } else { setInlineError('Failed to promote entry. Please try again.'); }
    } catch { setInlineError('Network error. Please check your connection.'); }
    finally { setBusy(false); }
  }

  /** Render the inline entry detail/edit panel for a given entryId. */
  function renderInlineEntryPanel(entryId: number): React.ReactNode {
    if (inlineEntryId !== entryId || !inlineEntryData) return null;

    const panelClassName = shaking ? 'modal-shake' : undefined;

    // eslint-disable-next-line no-console
    console.log('[renderInlineEntryPanel]', { entryId, inlineEditMode, inlineEntryId });

    if (inlineEditMode) {
      return (
        <>
          <div ref={panelRef} className={panelClassName} style={inlinePanelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-entry)' }}>Editing Entry</span>
              <button style={inlineBtnStyle('var(--input-bg)', 'var(--text-secondary)')}
                onClick={() => setInlineEditMode(false)}>← Back</button>
            </div>
            <EntryFormView
              editEntryId={entryId}
              onSaved={() => { closeInlineEntry(); options.onMutate?.(); }}
              onCancel={() => setInlineEditMode(false)}
              onDirtyChange={setFormIsDirty}
            />
          </div>
          <DiscardConfirmDialog
            open={confirmOpen}
            message={confirmMessage}
            onDiscard={confirmDiscard}
            onCancel={confirmCancel}
          />
        </>
      );
    }

    const d = inlineEntryData;
    const isPinned = d.is_pinned ?? 0;
    return (
      <>
        <div ref={panelRef} className={panelClassName} style={inlinePanelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>{d.title}</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>{d.entry_type?.replace('_', ' ')}</span>
                <span>·</span>
                <span>{d.entry_date}</span>
                {d.program_name && <><span>·</span><span style={{ color: 'var(--accent-primary)' }}>{d.program_name}</span></>}
                {d.project_name && <><span>·</span><span>{d.project_name}</span></>}
                {d.status && <><span>·</span><span>{d.status.replace('_', ' ')}</span></>}
              </div>
            </div>
            <button style={inlineBtnStyle('var(--input-bg)', 'var(--text-muted)')}
              onClick={handleExplicitClose}>✕ Close</button>
          </div>
          {d.description && (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
              {d.description}
            </div>
          )}
          {inlineError && (
            <div style={{ marginBottom: '10px', padding: '6px 10px', borderRadius: '6px', background: 'var(--accent-danger)', color: '#fff', fontSize: '12px' }} role="alert">
              {inlineError}
            </div>
          )}
          {d.tags && d.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
              {d.tags.map((t: { id: number; name: string }) => (
                <span key={t.id} style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 600, background: 'var(--input-bg)', color: 'var(--text-secondary)' }}>
                  {t.name}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button style={{ ...inlineBtnStyle('var(--button-primary-bg)', '#fff'), opacity: busy ? 0.5 : 1 }}
              onClick={() => setInlineEditMode(true)} disabled={busy}>Edit</button>
            <button style={{ ...inlineBtnStyle(isPinned ? 'var(--accent-warning)' : 'var(--input-bg)', isPinned ? '#fff' : 'var(--text-secondary)'), opacity: busy ? 0.5 : 1 }}
              onClick={() => handleTogglePin(entryId)} disabled={busy}>{isPinned ? '★ Pinned' : '☆ Pin'}</button>
            <button style={{ ...inlineBtnStyle('var(--input-bg)', 'var(--text-secondary)'), opacity: busy ? 0.5 : 1 }}
              onClick={() => options.onNavigateToTab?.('Timeline', entryId)} disabled={busy}>View in Timeline</button>
            {!d.project_id && (
              <button style={{ ...inlineBtnStyle('var(--accent-secondary)', '#fff'), opacity: busy ? 0.5 : 1 }}
                onClick={() => handlePromoteToProject(entryId, d.title)} disabled={busy}>Promote to Project</button>
            )}
            <button style={{ ...inlineBtnStyle('transparent', 'var(--accent-danger)'), opacity: busy ? 0.5 : 1 }}
              onClick={() => handleEntryDelete(entryId)} disabled={busy}>Delete</button>
          </div>
        </div>
        <DiscardConfirmDialog
          open={confirmOpen}
          message={confirmMessage}
          onDiscard={confirmDiscard}
          onCancel={confirmCancel}
        />
      </>
    );
  }

  return {
    inlineEntryId,
    inlineEntryData,
    loadInlineEntry,
    closeInlineEntry,
    renderInlineEntryPanel,
  };
}
