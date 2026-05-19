import { useCallback, useEffect, useState } from 'react';
import { useDirtyClose } from '../hooks/useDirtyClose';
import DiscardConfirmDialog from './DiscardConfirmDialog';

/**
 * PromoteToGoal — Modal for promoting a project to a goal with SMART fields.
 *
 * Pre-fills:
 * - Goal title from project name
 * - Goal description from project description
 * - Goal program_id from project's program_id
 *
 * Dirty-close behavior (Requirement 11):
 * - `isDirty()` returns true when the goal title input is non-empty.
 * - Backdrop click routes through `useDirtyClose.handleBackdropClick`
 *   (clean → close, dirty → 400ms shake).
 * - Esc / X route through `useDirtyClose.handleExplicitClose`
 *   (clean → close, dirty → Discard confirm dialog).
 * - Successful goal creation closes directly via `onCompleted` and does NOT
 *   flow through the hook.
 *
 * Requirements: 11.2, 11.3, 11.4, 11.5, 11.9, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8
 */

interface ProjectData {
  id: number;
  name: string;
  description: string | null;
  program_id: number | null;
}

interface PromoteToGoalProps {
  /** The project being promoted */
  project: ProjectData;
  /** Called when modal is closed without action */
  onClose: () => void;
  /** Called after goal is created and project is linked */
  onCompleted: () => void;
}

/**
 * Computes the pre-fill values for the Promote to Goal modal.
 * Exported for testability (Property 16).
 */
export function computeGoalPreFill(project: ProjectData) {
  return {
    title: project.name,
    description: project.description ?? '',
    program_id: project.program_id,
  };
}

export default function PromoteToGoal({
  project,
  onClose,
  onCompleted,
}: PromoteToGoalProps) {
  const preFill = computeGoalPreFill(project);

  const [title, setTitle] = useState(preFill.title);
  const [description, setDescription] = useState(preFill.description);
  const [specific, setSpecific] = useState('');
  const [measurable, setMeasurable] = useState('');
  const [achievable, setAchievable] = useState('');
  const [relevant, setRelevant] = useState('');
  const [timeBound, setTimeBound] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Dirty-state close guard (Requirement 11) ──
   * The goal title is the only required input and is what we consider
   * "unsaved work" for this modal: if the user has typed anything into it,
   * closing without saving should be guarded.
   */
  const isDirty = useCallback((): boolean => {
    return title.trim().length > 0;
  }, [title]);

  const {
    handleBackdropClick,
    handleExplicitClose,
    shaking,
    confirmOpen,
    confirmDiscard,
    confirmCancel,
    confirmMessage,
  } = useDirtyClose({ isDirty, onClose });

  // Esc key → explicit close (routes through the dirty-close guard).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleExplicitClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleExplicitClose]);

  async function handleCreate(skipSetup: boolean) {
    setBusy(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        title: skipSetup ? preFill.title : title.trim() || preFill.title,
        description: skipSetup ? preFill.description : (description.trim() || null),
        program_id: preFill.program_id ?? null,
        status: 'on_track',
      };

      if (!skipSetup) {
        if (specific.trim()) body.specific = specific.trim();
        if (measurable.trim()) body.measurable = measurable.trim();
        if (achievable.trim()) body.achievable = achievable.trim();
        if (relevant.trim()) body.relevant = relevant.trim();
        if (timeBound.trim()) body.time_bound = timeBound.trim();
        if (targetDate) body.target_date = targetDate;
      }

      const goalRes = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!goalRes.ok) {
        setError('Failed to create goal');
        setBusy(false);
        return;
      }

      const goal = await goalRes.json();

      // Link the project to the new goal via goal_id
      await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goal.id }),
      });

      onCompleted();
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setBusy(false);
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  };

  const modalStyle: React.CSSProperties = {
    background: 'var(--card-bg)', borderRadius: '12px',
    padding: '24px', maxWidth: '520px', width: '90%',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    border: '1px solid var(--card-border)',
    maxHeight: '80vh', overflowY: 'auto',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: '6px',
    fontSize: '13px', border: '1px solid var(--input-border)',
    background: 'var(--input-bg)', color: 'var(--text-primary)',
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle, minHeight: '50px', resize: 'vertical', fontFamily: 'inherit',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '12px', color: 'var(--text-muted)',
    marginBottom: '4px', fontWeight: 600,
  };

  return (
    <>
      <div style={overlayStyle} onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-label="Promote to Goal">
        <div
          style={modalStyle}
          className={shaking ? 'modal-shake' : undefined}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>
              Promote to Goal
            </h3>
            <button onClick={handleExplicitClose} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
            Create a goal from <strong>{project.name}</strong>. SMART fields are optional.
          </p>

          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Goal Title</label>
            <input
              style={inputStyle}
              value={title}
              onChange={e => setTitle(e.target.value)}
              aria-label="Goal title"
              autoFocus
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Description</label>
            <textarea
              style={textareaStyle}
              value={description}
              onChange={e => setDescription(e.target.value)}
              aria-label="Goal description"
            />
          </div>

          {/* SMART Fields */}
          <div style={{ marginBottom: '10px', paddingTop: '10px', borderTop: '1px solid var(--card-border)' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              SMART Fields (optional)
            </span>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={labelStyle}>Specific</label>
            <textarea style={textareaStyle} value={specific} onChange={e => setSpecific(e.target.value)} aria-label="Specific" />
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={labelStyle}>Measurable</label>
            <textarea style={textareaStyle} value={measurable} onChange={e => setMeasurable(e.target.value)} aria-label="Measurable" />
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={labelStyle}>Achievable</label>
            <textarea style={textareaStyle} value={achievable} onChange={e => setAchievable(e.target.value)} aria-label="Achievable" />
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={labelStyle}>Relevant</label>
            <textarea style={textareaStyle} value={relevant} onChange={e => setRelevant(e.target.value)} aria-label="Relevant" />
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={labelStyle}>Time-bound</label>
            <textarea style={textareaStyle} value={timeBound} onChange={e => setTimeBound(e.target.value)} aria-label="Time-bound" />
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Target Date</label>
            <input
              type="date"
              style={{ ...inputStyle, width: '180px' }}
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              aria-label="Target date"
            />
          </div>

          {error && (
            <p style={{ fontSize: '12px', color: 'var(--accent-danger)', marginBottom: '12px' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => handleCreate(true)}
              disabled={busy}
              style={{
                padding: '8px 14px', borderRadius: '6px', fontSize: '12px',
                cursor: busy ? 'not-allowed' : 'pointer',
                background: 'var(--input-bg)', color: 'var(--text-secondary)',
                border: '1px solid var(--card-border)', fontWeight: 500,
                opacity: busy ? 0.6 : 1,
              }}
            >
              Skip — I'll set this up later
            </button>
            <button
              onClick={() => handleCreate(false)}
              disabled={busy}
              style={{
                padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                background: 'var(--button-primary-bg)', color: '#fff', border: 'none',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
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
