import { useState } from 'react';

/**
 * GoalCloseOut — Guided modal for closing a goal.
 *
 * Steps:
 * 1. Confirmation prompt
 * 2. Final progress note (optional — creates a goal progress log entry with status_at_time "completed")
 * 3. List linked projects not yet completed with option to close or leave active
 *
 * Guard: do not allow closing goals with zero linked projects and zero progress log entries.
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8
 */

interface LinkedProject {
  id: number;
  name: string;
  status: string;
}

interface GoalCloseOutProps {
  goalId: number;
  goalTitle: string;
  /** Projects linked to this goal */
  linkedProjects: LinkedProject[];
  /** Number of existing progress log entries for this goal */
  progressLogCount: number;
  /** Called when modal is closed without action */
  onClose: () => void;
  /** Called after goal is successfully closed */
  onCompleted: () => void;
}

export default function GoalCloseOut({
  goalId,
  goalTitle,
  linkedProjects,
  progressLogCount,
  onClose,
  onCompleted,
}: GoalCloseOutProps) {
  const [step, setStep] = useState(1);
  const [progressNote, setProgressNote] = useState('');
  const [closeProjectIds, setCloseProjectIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard: cannot close goal with zero linked projects and zero progress logs
  const canClose = linkedProjects.length > 0 || progressLogCount > 0;

  // Active (non-completed) linked projects
  const activeLinkedProjects = linkedProjects.filter(p => p.status !== 'completed');

  function toggleProjectClose(projectId: number) {
    setCloseProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  async function handleConfirm() {
    setBusy(true);
    setError(null);

    try {
      // Close selected linked projects
      for (const projId of closeProjectIds) {
        const res = await fetch(`/api/projects/${projId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'completed',
            actual_end_date: new Date().toISOString().slice(0, 10),
          }),
        });
        if (!res.ok) {
          const proj = linkedProjects.find(p => p.id === projId);
          setError(`Failed to close project: "${proj?.name ?? projId}"`);
          setBusy(false);
          return;
        }
      }

      // Update goal status to completed
      const goalRes = await fetch(`/api/goals/${goalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!goalRes.ok) {
        setError('Failed to update goal status');
        setBusy(false);
        return;
      }

      // Create progress log entry if note provided
      if (progressNote.trim()) {
        await fetch(`/api/goals/${goalId}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            note: progressNote.trim(),
            status_at_time: 'completed',
          }),
        });
      }

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
    padding: '24px', maxWidth: '500px', width: '90%',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    border: '1px solid var(--card-border)',
    maxHeight: '80vh', overflowY: 'auto',
  };

  const btnPrimary: React.CSSProperties = {
    padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
    cursor: busy ? 'not-allowed' : 'pointer',
    background: 'var(--button-primary-bg)', color: '#fff', border: 'none',
    opacity: busy ? 0.6 : 1,
  };

  const btnSecondary: React.CSSProperties = {
    padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', background: 'var(--input-bg)',
    color: 'var(--text-secondary)', border: '1px solid var(--card-border)',
  };

  return (
    <div style={overlayStyle} onClick={onClose} role="dialog" aria-modal="true" aria-label="Close Goal">
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>
            Close Goal
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
        </div>

        {/* Guard: cannot close empty goals */}
        {!canClose && (
          <div>
            <p style={{ fontSize: '13px', color: 'var(--accent-danger)', marginBottom: '16px' }}>
              Cannot close this goal — it has no linked projects and no progress log entries.
              Add at least one project or progress note before closing.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {canClose && (
          <>
            {/* Step 1: Confirmation */}
            {step === 1 && (
              <div>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  Complete this goal: <strong>{goalTitle}</strong>?
                </p>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button style={btnSecondary} onClick={onClose}>Cancel</button>
                  <button style={btnPrimary} onClick={() => setStep(2)}>Continue</button>
                </div>
              </div>
            )}

            {/* Step 2: Final Progress Note */}
            {step === 2 && (
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 600 }}>
                  Final Progress Note (optional)
                </label>
                <textarea
                  value={progressNote}
                  onChange={e => setProgressNote(e.target.value)}
                  placeholder="Final summary, outcomes achieved..."
                  style={{
                    width: '100%', minHeight: '80px', padding: '10px 12px',
                    borderRadius: '6px', fontSize: '13px', resize: 'vertical',
                    border: '1px solid var(--input-border)', background: 'var(--input-bg)',
                    color: 'var(--text-primary)', fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <button style={btnSecondary} onClick={() => setStep(1)}>Back</button>
                  <button style={btnPrimary} onClick={() => setStep(3)}>Continue</button>
                </div>
              </div>
            )}

            {/* Step 3: Linked Projects */}
            {step === 3 && (
              <div>
                {activeLinkedProjects.length > 0 ? (
                  <>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                      The following linked projects are not yet completed. Select any you'd like to close:
                    </p>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '12px', padding: '8px', background: 'var(--input-bg)', borderRadius: '6px' }}>
                      {activeLinkedProjects.map(p => (
                        <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={closeProjectIds.has(p.id)}
                            onChange={() => toggleProjectClose(p.id)}
                            style={{ accentColor: 'var(--accent-primary)' }}
                          />
                          <span style={{ flex: 1 }}>{p.name}</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{p.status}</span>
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    All linked projects are already completed. Ready to close the goal.
                  </p>
                )}

                {error && (
                  <p style={{ fontSize: '12px', color: 'var(--accent-danger)', marginTop: '8px' }}>{error}</p>
                )}

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <button style={btnSecondary} onClick={() => setStep(2)}>Back</button>
                  <button style={btnPrimary} onClick={handleConfirm} disabled={busy}>
                    {busy ? 'Closing…' : 'Complete Goal'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
