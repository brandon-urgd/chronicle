import { useState, useEffect } from 'react';

/**
 * PromoteToProject — Quick setup modal for promoting a task or entry to a project.
 *
 * Replaces the bare confirm() dialog with a structured modal that pre-fills
 * the project name and allows optional program/goal/status selection.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8
 */

interface ProgramOption {
  id: number;
  name: string;
  status: string;
}

interface GoalOption {
  id: number;
  title: string;
  program_id: number | null;
}

interface PromoteToProjectProps {
  /** The source entity's title/name to pre-fill as project name */
  sourceName: string;
  /** The source entity ID (task or entry) */
  sourceId: number;
  /** Type of source entity */
  sourceType: 'task' | 'entry';
  /** Pre-fill program from the source entity */
  sourceProgramId?: number | null;
  /** Called when modal is closed without action */
  onClose: () => void;
  /** Called after project is created and source entity is linked */
  onCompleted: () => void;
}

export default function PromoteToProject({
  sourceName,
  sourceId,
  sourceType,
  sourceProgramId,
  onClose,
  onCompleted,
}: PromoteToProjectProps) {
  const [projectName, setProjectName] = useState(sourceName);
  const [programId, setProgramId] = useState<number | ''>(sourceProgramId || '');
  const [goalId, setGoalId] = useState<number | ''>('');
  const [status, setStatus] = useState('active');
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [goals, setGoals] = useState<GoalOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [pRes, gRes] = await Promise.all([
          fetch('/api/programs'),
          fetch('/api/goals'),
        ]);
        if (pRes.ok) setPrograms(await pRes.json());
        if (gRes.ok) setGoals(await gRes.json());
      } catch { /* ignore */ }
    })();
  }, []);

  // Filter goals by selected program
  const filteredGoals = programId
    ? goals.filter(g => g.program_id === programId)
    : goals;

  async function handleCreate(skipSetup: boolean) {
    setBusy(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        name: skipSetup ? sourceName : projectName.trim() || sourceName,
        status: skipSetup ? 'active' : status,
      };
      if (!skipSetup) {
        if (programId) body.program_id = programId;
        if (goalId) body.goal_id = goalId;
      }

      const projRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!projRes.ok) {
        setError('Failed to create project');
        setBusy(false);
        return;
      }

      const proj = await projRes.json();

      // Link source entity to the new project
      if (sourceType === 'task') {
        await fetch(`/api/scheduled-items/${sourceId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: proj.id }),
        });
      } else {
        await fetch(`/api/entries/${sourceId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: proj.id }),
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
    padding: '24px', maxWidth: '460px', width: '90%',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    border: '1px solid var(--card-border)',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: '6px',
    fontSize: '13px', border: '1px solid var(--input-border)',
    background: 'var(--input-bg)', color: 'var(--text-primary)',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '12px', color: 'var(--text-muted)',
    marginBottom: '4px', fontWeight: 600,
  };

  return (
    <div style={overlayStyle} onClick={onClose} role="dialog" aria-modal="true" aria-label="Promote to Project">
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>
            Create Project
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Project Name</label>
          <input
            style={inputStyle}
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            aria-label="Project name"
            autoFocus
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Program (optional)</label>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={programId}
              onChange={e => {
                const v = e.target.value ? parseInt(e.target.value, 10) : '';
                setProgramId(v);
                setGoalId('');
              }}
              aria-label="Program"
            >
              <option value="">— None —</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Goal (optional)</label>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={goalId}
              onChange={e => setGoalId(e.target.value ? parseInt(e.target.value, 10) : '')}
              aria-label="Goal"
            >
              <option value="">— None —</option>
              {filteredGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Status</label>
          <select
            style={{ ...inputStyle, cursor: 'pointer', width: '160px' }}
            value={status}
            onChange={e => setStatus(e.target.value)}
            aria-label="Status"
          >
            <option value="active">Active</option>
            <option value="planning">Planning</option>
            <option value="paused">Paused</option>
          </select>
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
  );
}
