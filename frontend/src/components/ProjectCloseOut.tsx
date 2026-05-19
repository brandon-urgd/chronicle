import { useState } from 'react';

/**
 * ProjectCloseOut — Guided modal for closing an active project.
 *
 * Steps:
 * 1. Confirmation prompt
 * 2. actual_end_date input (default: today)
 * 3. Closing note (optional — creates a project progress log entry)
 * 4. List remaining active tasks with bulk-complete option
 *
 * On confirm: updates project status to "completed", sets actual_end_date.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8
 */

interface ActiveTask {
  id: number;
  name: string;
  due_date: string | null;
}

interface ProjectCloseOutProps {
  projectId: number;
  projectName: string;
  activeTasks: ActiveTask[];
  onClose: () => void;
  onCompleted: () => void;
}

export default function ProjectCloseOut({
  projectId,
  projectName,
  activeTasks,
  onClose,
  onCompleted,
}: ProjectCloseOutProps) {
  const [step, setStep] = useState(1);
  const [actualEndDate, setActualEndDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [closingNote, setClosingNote] = useState('');
  const [bulkCompleteTasks, setBulkCompleteTasks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);

    try {
      // Bulk-complete remaining tasks if selected
      if (bulkCompleteTasks && activeTasks.length > 0) {
        for (const task of activeTasks) {
          const res = await fetch(`/api/scheduled-items/${task.id}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ due_date: task.due_date ?? null, notes: null }),
          });
          if (!res.ok) {
            setError(`Failed to complete task: "${task.name}"`);
            setBusy(false);
            return;
          }
        }
      }

      // Update project status to completed with actual_end_date
      const updateRes = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          actual_end_date: actualEndDate || null,
        }),
      });
      if (!updateRes.ok) {
        setError('Failed to update project status');
        setBusy(false);
        return;
      }

      // Create progress log entry if closing note provided
      if (closingNote.trim()) {
        await fetch(`/api/projects/${projectId}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            note: closingNote.trim(),
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
    <div style={overlayStyle} onClick={onClose} role="dialog" aria-modal="true" aria-label="Close Project">
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>
            Close Project
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
        </div>

        {/* Step 1: Confirmation */}
        {step === 1 && (
          <div>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Are you sure you want to close <strong>{projectName}</strong>? This will mark the project as completed.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={onClose}>Cancel</button>
              <button style={btnPrimary} onClick={() => setStep(2)}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 2: End Date */}
        {step === 2 && (
          <div>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 600 }}>
              Actual End Date
            </label>
            <input
              type="date"
              value={actualEndDate}
              onChange={e => setActualEndDate(e.target.value)}
              style={{
                padding: '8px 12px', borderRadius: '6px', fontSize: '13px',
                border: '1px solid var(--input-border)', background: 'var(--input-bg)',
                color: 'var(--text-primary)', width: '200px',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button style={btnSecondary} onClick={() => setStep(1)}>Back</button>
              <button style={btnPrimary} onClick={() => setStep(3)}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 3: Closing Note */}
        {step === 3 && (
          <div>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 600 }}>
              Closing Note (optional)
            </label>
            <textarea
              value={closingNote}
              onChange={e => setClosingNote(e.target.value)}
              placeholder="Summary of outcomes, lessons learned..."
              style={{
                width: '100%', minHeight: '80px', padding: '10px 12px',
                borderRadius: '6px', fontSize: '13px', resize: 'vertical',
                border: '1px solid var(--input-border)', background: 'var(--input-bg)',
                color: 'var(--text-primary)', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button style={btnSecondary} onClick={() => setStep(2)}>Back</button>
              <button style={btnPrimary} onClick={() => setStep(4)}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 4: Remaining Tasks */}
        {step === 4 && (
          <div>
            {activeTasks.length > 0 ? (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  This project has <strong>{activeTasks.length}</strong> remaining active task{activeTasks.length > 1 ? 's' : ''}:
                </p>
                <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '12px', padding: '8px', background: 'var(--input-bg)', borderRadius: '6px' }}>
                  {activeTasks.map(t => (
                    <div key={t.id} style={{ fontSize: '12px', color: 'var(--text-primary)', padding: '4px 0' }}>
                      • {t.name} {t.due_date && <span style={{ color: 'var(--text-muted)' }}>({t.due_date})</span>}
                    </div>
                  ))}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={bulkCompleteTasks}
                    onChange={e => setBulkCompleteTasks(e.target.checked)}
                    style={{ accentColor: 'var(--accent-primary)' }}
                  />
                  Complete all remaining tasks
                </label>
              </>
            ) : (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                No remaining active tasks. Ready to close.
              </p>
            )}

            {error && (
              <p style={{ fontSize: '12px', color: 'var(--accent-danger)', marginTop: '8px' }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button style={btnSecondary} onClick={() => setStep(3)}>Back</button>
              <button style={btnPrimary} onClick={handleConfirm} disabled={busy}>
                {busy ? 'Closing…' : 'Close Project'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
