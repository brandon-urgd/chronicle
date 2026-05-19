import { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useDirtyClose } from '../hooks/useDirtyClose';
import DiscardConfirmDialog from './DiscardConfirmDialog';

/* ── Types ── */
interface ProgramBrief { id: number; name: string; status: string; color: string | null; }
interface ProjectBrief { id: number; name: string; goal_id: number | null; status: string; program_id: number | null; }
interface GoalBrief { id: number; program_id: number | null; }

export type CaptureMode = 'log' | 'task' | 'rhythm';

interface CaptureSheetProps {
  prefillDate?: string;
  prefillProgramId?: number;
  prefillProjectId?: number;
  prefillAsTask?: boolean;
  prefillAsCadence?: boolean;
  onClose?: () => void;
  onSaved?: () => void;
}

const CAPTURE_MODE_KEY = 'chronicle-capture-mode';
const CAPTURE_CONTEXT_KEY = 'chronicle-capture-context';
interface CaptureContext { lastProgramId: number | null; lastProjectId: number | null; lastTags: number[]; lastWorkType: string; }
function writeCaptureContext(c: CaptureContext) { try { localStorage.setItem(CAPTURE_CONTEXT_KEY, JSON.stringify(c)); } catch {} }

function readCaptureMode(): CaptureMode {
  try {
    const stored = localStorage.getItem(CAPTURE_MODE_KEY);
    if (stored === 'log' || stored === 'task' || stored === 'rhythm') return stored;
  } catch {}
  return 'log';
}

function writeCaptureMode(mode: CaptureMode) {
  try { localStorage.setItem(CAPTURE_MODE_KEY, mode); } catch {}
}

export function inferEntryType(title: string) {
  const t = title.trim();
  if (/^Decision:/i.test(t)) return { entry_type: 'decision', displayType: 'Decision', cleanTitle: t.replace(/^Decision:\s*/i, '') };
  if (/^Milestone:/i.test(t)) return { entry_type: 'milestone', displayType: 'Milestone', cleanTitle: t.replace(/^Milestone:\s*/i, '') };
  return { entry_type: 'quick_capture', displayType: 'Note', cleanTitle: t };
}

export function parseBatchLines(text: string) {
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0).map(line => {
    const { entry_type, displayType } = inferEntryType(line);
    return { line, entry_type, displayType };
  });
}

const S = {
  input: { width: '100%', padding: '10px 14px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' } as React.CSSProperties,
  label: { display: 'block', marginBottom: '4px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 500 } as React.CSSProperties,
  field: { marginBottom: '14px' } as React.CSSProperties,
  btnP: { padding: '10px 20px', background: 'var(--button-primary-bg)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  btnS: { padding: '10px 20px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--card-border)', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' } as React.CSSProperties,
};

const pill = (active: boolean, color?: string | null): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px',
  borderRadius: '16px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
  color: active ? 'var(--text-on-primary)' : 'var(--text-secondary)',
  background: active ? (color || 'var(--accent-primary)') : 'var(--input-bg)',
  border: `1px solid ${active ? (color || 'var(--accent-primary)') : 'var(--input-border)'}`,
  transition: 'all 0.15s ease',
});

/* Segmented control pill style */
const segmentPill = (active: boolean): React.CSSProperties => ({
  padding: '6px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  color: active ? 'var(--text-on-primary)' : 'var(--text-secondary)',
  background: active ? 'var(--accent-primary)' : 'transparent',
  border: 'none',
  transition: 'all 0.15s ease',
});

export const ENTRY_STATUSES = ['completed', 'in_progress', 'ongoing', 'paused'] as const;
export const TASK_STATUSES = ['active', 'paused'] as const;

export default function CaptureSheet({ prefillDate, prefillProgramId, prefillProjectId, prefillAsTask, prefillAsCadence, onClose, onSaved }: CaptureSheetProps) {
  /* ── Determine initial mode from prefill props or localStorage ── */
  const getInitialMode = (): CaptureMode => {
    if (prefillAsCadence) return 'rhythm';
    if (prefillAsTask) return 'task';
    return readCaptureMode();
  };

  const [captureMode, setCaptureMode] = useState<CaptureMode>(getInitialMode);
  const [title, setTitle] = useState('');
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(prefillProgramId ?? null);
  const [projectId, setProjectId] = useState<number | ''>(prefillProjectId ?? '');
  const [entryDate, setEntryDate] = useState(prefillDate || new Date().toISOString().split('T')[0]);
  const [entryStatus, setEntryStatus] = useState<string>('completed');
  const [showMoreOptions, setShowMoreOptions] = useState(!!prefillDate); // Reveal date/status if prefillDate set
  const [batchMode, setBatchMode] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [frequency, setFrequency] = useState<string>('Weekly');
  const dueDateManuallySet = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [requireAcknowledgment, setRequireAcknowledgment] = useState(false);
  const [programs, setPrograms] = useState<ProgramBrief[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectBrief[]>([]);
  const [allGoals, setAllGoals] = useState<GoalBrief[]>([]);
  const [programFocusIdx, setProgramFocusIdx] = useState(-1);
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLTextAreaElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<{ title: string; prog?: string; proj?: string; count: number } | null>(null);

  /* ── Dirty-state close guard (Requirement 11) ── */
  const isDirty = useCallback((): boolean => {
    if (title.trim().length > 0) return true;
    if (batchText.trim().length > 0) return true;
    // Program or project diverge from prefilled baseline
    if (selectedProgramId !== (prefillProgramId ?? null)) return true;
    const baselineProject: number | '' = prefillProjectId ?? '';
    if (projectId !== baselineProject) return true;
    return false;
  }, [title, batchText, selectedProgramId, projectId, prefillProgramId, prefillProjectId]);

  const handleClose = useCallback(() => { onClose?.(); }, [onClose]);
  const {
    handleBackdropClick,
    handleExplicitClose,
    shaking,
    confirmOpen,
    confirmDiscard,
    confirmCancel,
    confirmMessage,
  } = useDirtyClose({ isDirty, onClose: handleClose });

  useFocusTrap(overlayRef, { onEscape: handleExplicitClose });

  useEffect(() => {
    (async () => {
      try {
        const [projR, progR, goalR] = await Promise.all([fetch('/api/projects'), fetch('/api/programs?status=active'), fetch('/api/goals')]);
        if (projR.ok) { const d = await projR.json(); setAllProjects(d.map((p: ProjectBrief & { goal_id?: number | null }) => ({ id: p.id, name: p.name, goal_id: p.goal_id ?? null, status: p.status ?? 'active', program_id: p.program_id ?? null })).sort((a: ProjectBrief, b: ProjectBrief) => a.name.localeCompare(b.name))); }
        if (progR.ok) { const d = await progR.json(); setPrograms(d.map((p: ProgramBrief) => ({ id: p.id, name: p.name, status: p.status, color: p.color ?? null })).sort((a: ProgramBrief, b: ProgramBrief) => a.name.localeCompare(b.name))); }
        if (goalR.ok) { const d = await goalR.json(); setAllGoals(d.map((g: GoalBrief) => ({ id: g.id, program_id: g.program_id ?? null }))); }
      } catch {}
    })();
  }, []);

  /* Auto-select program from project's parent when prefillProjectId is set */
  useEffect(() => {
    if (prefillProjectId && allProjects.length > 0 && allGoals.length > 0) {
      const proj = allProjects.find(p => p.id === prefillProjectId);
      if (proj) {
        // Direct program_id on project
        if (proj.program_id && !prefillProgramId) {
          setSelectedProgramId(proj.program_id);
        }
        // Goal-chain program resolution
        else if (proj.goal_id && !prefillProgramId) {
          const goal = allGoals.find(g => g.id === proj.goal_id);
          if (goal?.program_id) setSelectedProgramId(goal.program_id);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillProjectId, allProjects, allGoals]);

  useEffect(() => { titleRef.current?.focus(); }, []);

  /* Persist mode changes to localStorage */
  function handleModeChange(newMode: CaptureMode) {
    setCaptureMode(newMode);
    writeCaptureMode(newMode);
    // Reset status based on mode
    if (newMode === 'log') setEntryStatus('completed');
    else setEntryStatus('active');
    // Reset batch mode
    setBatchMode(false);
    setBatchText('');
    // Reset title focus
    setTimeout(() => titleRef.current?.focus(), 50);
  }

  function resolveProgram(projId: number): number | null {
    const p = allProjects.find(x => x.id === projId);
    if (p?.program_id) return p.program_id;
    if (!p?.goal_id) return null;
    const g = allGoals.find(x => x.id === p.goal_id);
    return g?.program_id ?? null;
  }

  const filteredProjects = (selectedProgramId
    ? allProjects.filter(p => {
        if (p.program_id === selectedProgramId) return true;
        if (p.goal_id) { const g = allGoals.find(x => x.id === p.goal_id); return g?.program_id === selectedProgramId; }
        return false;
      })
    : allProjects).filter(p => p.status === 'active' || p.status === 'planning');

  function handleProgramSelect(pid: number) {
    if (selectedProgramId === pid) { setSelectedProgramId(null); }
    else { setSelectedProgramId(pid); if (projectId) { const r = resolveProgram(projectId as number); if (r && r !== pid) setProjectId(''); } }
  }

  function handleProjectChange(v: number | '') {
    setProjectId(v);
    if (v) { const r = resolveProgram(v); if (r) setSelectedProgramId(r); }
  }

  function saveCtx() { writeCaptureContext({ lastProgramId: selectedProgramId, lastProjectId: projectId ? (projectId as number) : null, lastTags: [], lastWorkType: 'operational_rhythm' }); }

  const getDayCount = useCallback(async (): Promise<number> => {
    try { const today = new Date().toISOString().split('T')[0]; const r = await fetch(`/api/entries?date_start=${today}&date_end=${today}`); if (r.ok) { const d = await r.json(); return d.length + 1; } } catch {} return 1;
  }, []);

  function showConfirm(t: string) {
    const prog = programs.find(p => p.id === selectedProgramId);
    const proj = allProjects.find(p => p.id === projectId);
    getDayCount().then(c => { setConfirm({ title: t, prog: prog?.name, proj: proj?.name, count: c }); setTimeout(() => setConfirm(null), 800); });
  }

  async function saveLog(resetAfter: boolean) {
    if (!title.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { entry_type } = inferEntryType(title);
      const resolvedEntryType = (entry_type === 'quick_capture' && (prefillProjectId || projectId)) ? 'project_update' : entry_type;
      // v3.0: Log mode creates a task with auto_complete=true (unified flow)
      const body: Record<string, unknown> = {
        name: title.trim(),
        mode: 'one_time',
        item_class: 'task',
        template_entry_type: resolvedEntryType,
        template_work_type: projectId ? 'project' : 'operational_rhythm',
        auto_complete: true,
        completion_details: {
          entry_type: resolvedEntryType,
          visibility: 'shareable',
        },
      };
      if (selectedProgramId) body.program_id = selectedProgramId;
      if (projectId) body.project_id = projectId;
      const r = await fetch('/api/scheduled-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) { saveCtx(); showConfirm(title.trim()); onSaved?.(); if (resetAfter) resetForm(); else onClose?.(); }
      else { setSaveError('Failed to save entry. Please try again.'); }
    } catch { setSaveError('Network error. Please check your connection.'); } finally { setSaving(false); }
  }

  async function saveTask() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { entry_type } = inferEntryType(title);
      const resolvedEntryType = (entry_type === 'quick_capture' && (prefillProjectId || projectId)) ? 'project_update' : entry_type;
      const body: Record<string, unknown> = { name: title.trim(), mode: 'one_time', item_class: 'task', template_entry_type: resolvedEntryType, template_work_type: 'operational_rhythm', due_date: dueDate || null, status: 'active' };
      if (dueTime) body.time_of_day = dueTime;
      if (selectedProgramId) body.program_id = selectedProgramId;
      if (projectId) body.project_id = projectId;
      const r = await fetch('/api/scheduled-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) { saveCtx(); showConfirm(title.trim()); onSaved?.(); onClose?.(); }
      else { setSaveError('Failed to create task. Please try again.'); }
    } catch { setSaveError('Network error. Please check your connection.'); } finally { setSaving(false); }
  }

  async function saveRhythm() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { entry_type } = inferEntryType(title);
      const resolvedEntryType = (entry_type === 'quick_capture' && (prefillProjectId || projectId)) ? 'project_update' : entry_type;
      const fMap: Record<string, string> = { 'Every Day': 'every_day', 'Every Weekday': 'daily', 'Weekly': 'weekly', 'Biweekly': 'biweekly', 'Monthly': 'monthly', 'Quarterly': 'quarterly' };
      const body: Record<string, unknown> = { name: title.trim(), mode: 'recurring', item_class: 'cadence', template_entry_type: resolvedEntryType, template_work_type: 'operational_rhythm', due_date: dueDate || null, status: 'active', recurrence_type: fMap[frequency] || 'weekly' };
      if (dueTime) body.time_of_day = dueTime;
      if (selectedProgramId) body.program_id = selectedProgramId;
      if (projectId) body.project_id = projectId;
      if (requireAcknowledgment) body.require_acknowledgment = 1;
      const d = dueDate ? new Date(dueDate + 'T12:00:00') : new Date();
      if (frequency === 'Weekly' || frequency === 'Biweekly') body.day_of_week = d.getDay() + 1; // US Traditional: 1=Sun, 2=Mon, ..., 7=Sat
      if (frequency === 'Monthly' || frequency === 'Quarterly') body.day_of_month = Math.min(d.getDate(), 28);
      const r = await fetch('/api/scheduled-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) { saveCtx(); showConfirm(title.trim()); onSaved?.(); onClose?.(); }
      else { setSaveError('Failed to Create Cadence. Please try again.'); }
    } catch { setSaveError('Network error. Please check your connection.'); } finally { setSaving(false); }
  }

  function resetForm() { setTitle(''); setEntryStatus(captureMode === 'log' ? 'completed' : 'active'); setDueDate(''); setDueTime(''); setFrequency('Weekly'); setBatchMode(false); setBatchText(''); dueDateManuallySet.current = false; titleRef.current?.focus(); }

  /* ── Batch save functions ── */
  async function saveBatchLogs() {
    const lines = parseBatchLines(batchText);
    if (lines.length === 0 || saving) return;
    setSaving(true);
    try {
      for (const { line, entry_type } of lines) {
        const resolvedEntryType = (entry_type === 'quick_capture' && (prefillProjectId || projectId)) ? 'project_update' : entry_type;
        // v3.0: Batch log mode uses auto_complete (unified flow)
        const body: Record<string, unknown> = {
          name: line,
          mode: 'one_time',
          item_class: 'task',
          template_entry_type: resolvedEntryType,
          template_work_type: projectId ? 'project' : 'operational_rhythm',
          auto_complete: true,
          completion_details: {
            entry_type: resolvedEntryType,
            visibility: 'shareable',
          },
        };
        if (selectedProgramId) body.program_id = selectedProgramId;
        if (projectId) body.project_id = projectId;
        await fetch('/api/scheduled-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      saveCtx();
      showConfirm(`${lines.length} entries created`);
      onSaved?.();
      onClose?.();
    } catch {} finally { setSaving(false); }
  }

  async function saveBatchTasks() {
    const lines = batchText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0 || saving) return;
    setSaving(true);
    try {
      for (const line of lines) {
        const { entry_type } = inferEntryType(line);
        const resolvedEntryType = (entry_type === 'quick_capture' && (prefillProjectId || projectId)) ? 'project_update' : entry_type;
        const body: Record<string, unknown> = { name: line, mode: 'one_time', item_class: 'task', template_entry_type: resolvedEntryType, template_work_type: 'operational_rhythm', due_date: dueDate || null, status: 'active' };
        if (dueTime) body.time_of_day = dueTime;
        if (selectedProgramId) body.program_id = selectedProgramId;
        if (projectId) body.project_id = projectId;
        await fetch('/api/scheduled-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      saveCtx();
      showConfirm(`${lines.length} tasks created`);
      onSaved?.();
      onClose?.();
    } catch {} finally { setSaving(false); }
  }

  async function saveBatchRhythms() {
    const lines = batchText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0 || saving) return;
    setSaving(true);
    try {
      const fMap: Record<string, string> = { 'Every Day': 'every_day', 'Every Weekday': 'daily', 'Weekly': 'weekly', 'Biweekly': 'biweekly', 'Monthly': 'monthly', 'Quarterly': 'quarterly' };
      const d = dueDate ? new Date(dueDate + 'T12:00:00') : new Date();
      for (const line of lines) {
        const { entry_type } = inferEntryType(line);
        const resolvedEntryType = (entry_type === 'quick_capture' && (prefillProjectId || projectId)) ? 'project_update' : entry_type;
        const body: Record<string, unknown> = { name: line, mode: 'recurring', item_class: 'cadence', template_entry_type: resolvedEntryType, template_work_type: 'operational_rhythm', due_date: dueDate || null, status: 'active', recurrence_type: fMap[frequency] || 'weekly' };
        if (dueTime) body.time_of_day = dueTime;
        if (selectedProgramId) body.program_id = selectedProgramId;
        if (projectId) body.project_id = projectId;
        if (frequency === 'Weekly' || frequency === 'Biweekly') body.day_of_week = d.getDay() + 1; // US Traditional: 1=Sun, 2=Mon, ..., 7=Sat
        if (frequency === 'Monthly' || frequency === 'Quarterly') body.day_of_month = Math.min(d.getDate(), 28);
        await fetch('/api/scheduled-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      saveCtx();
      showConfirm(`${lines.length} cadences created`);
      onSaved?.();
      onClose?.();
    } catch {} finally { setSaving(false); }
  }

  function toggleBatchMode() {
    setBatchMode(!batchMode);
    setBatchText('');
    if (!batchMode) setTimeout(() => batchRef.current?.focus(), 50);
    else setTimeout(() => titleRef.current?.focus(), 50);
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && title.trim()) {
      e.preventDefault();
      if (captureMode === 'log') saveLog(false);
      else if (captureMode === 'task') saveTask();
      else if (captureMode === 'rhythm') saveRhythm();
    }
    if (e.key === 'Tab' && programs.length > 0 && !e.shiftKey) { e.preventDefault(); setProgramFocusIdx(0); pillsRef.current?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); handleExplicitClose(); }
  }

  function handlePillsKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setProgramFocusIdx(p => Math.min(p + 1, programs.length - 1)); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setProgramFocusIdx(p => Math.max(p - 1, 0)); }
    else if (e.key === 'Enter' && programFocusIdx >= 0 && programFocusIdx < programs.length) { e.preventDefault(); handleProgramSelect(programs[programFocusIdx].id); }
    else if (e.key === 'Escape') { e.preventDefault(); handleExplicitClose(); }
  }

  const inferred = title.trim() ? inferEntryType(title) : null;
  const ord = (n: number) => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;

  return (
    <div
      ref={overlayRef}
      className="quick-capture-overlay"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Capture Entry"
    >
      <div
        className={`quick-capture-panel${shaking ? ' modal-shake' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ position: 'relative' }}>
          {confirm && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', padding: '24px 32px', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>✓</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{confirm.title}</div>
                {(confirm.prog || confirm.proj) && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{[confirm.prog, confirm.proj].filter(Boolean).join(' → ')}</div>}
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{ord(confirm.count)} entry today</div>
              </div>
            </div>
          )}

      {/* ── Segmented Mode Selector ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: 'fit-content', margin: '0 auto 16px', padding: '4px', background: 'var(--input-bg)', borderRadius: '24px', border: '1px solid var(--input-border)' }} role="tablist" aria-label="Capture mode">
        {(['log', 'task', 'rhythm'] as CaptureMode[]).map(m => (
          <button
            key={m}
            style={segmentPill(captureMode === m)}
            onClick={() => handleModeChange(m)}
            role="tab"
            aria-selected={captureMode === m}
            aria-controls={`capture-panel-${m}`}
          >
            {m === 'log' ? 'Log' : m === 'task' ? 'Task' : 'Cadence'}
          </button>
        ))}
      </div>

      {/* ── Mode-specific form content ── */}
      {saveError && (
        <div style={{ marginBottom: '12px', padding: '8px 12px', borderRadius: '6px', background: 'var(--accent-danger)', color: 'var(--text-on-danger)', fontSize: '12px', fontWeight: 500 }} role="alert">
          {saveError}
        </div>
      )}
      {captureMode === 'log' && (
        <div id="capture-panel-log" role="tabpanel">
          {/* Batch link in corner */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 500 }} onClick={toggleBatchMode} role="button" aria-label={batchMode ? 'Switch to single entry' : 'Switch to batch mode'}>
              {batchMode ? '← Single' : 'Batch ↗'}
            </span>
          </div>

          {!batchMode ? (
            <>
              <div style={S.field}>
                <label style={S.label}>Title</label>
                <input ref={titleRef} style={S.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="What did you work on?" onKeyDown={handleTitleKeyDown} aria-label="Entry title" />
                {inferred && inferred.entry_type !== 'quick_capture' && <span style={{ fontSize: '11px', color: 'var(--accent-secondary)', marginTop: '4px', display: 'block' }}>Type: {inferred.displayType}</span>}
              </div>

              {programs.length > 0 && (
                <div style={S.field}>
                  <label style={S.label}>Program</label>
                  <div ref={pillsRef} tabIndex={0} onKeyDown={handlePillsKeyDown} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', outline: 'none' }} role="listbox" aria-label="Select program">
                    {programs.map((p, i) => (
                      <span key={p.id} style={{ ...pill(selectedProgramId === p.id, p.color), outline: programFocusIdx === i ? '2px solid var(--accent-primary)' : 'none', outlineOffset: '2px' }} onClick={() => handleProgramSelect(p.id)}>
                        {p.name}{selectedProgramId === p.id && ' ×'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={S.label}>Project (optional)</label>
                  <select style={{ ...S.input, cursor: 'pointer' }} value={projectId} onChange={e => handleProjectChange(e.target.value ? parseInt(e.target.value, 10) : '')} aria-label="Project">
                    <option value="">— None —</option>
                    {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>

              {/* More options toggle */}
              {!showMoreOptions && (
                <div style={{ marginBottom: '12px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 500 }} onClick={() => setShowMoreOptions(true)} role="button">More options</span>
                </div>
              )}

              {/* Date override and status selector (revealed by "More options") */}
              {showMoreOptions && (
                <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap', padding: '10px', background: 'var(--input-bg)', borderRadius: '8px', border: '1px solid var(--input-border)' }}>
                  <div>
                    <label style={S.label}>Date</label>
                    <input type="date" style={{ ...S.input, width: '160px' }} value={entryDate} onChange={e => setEntryDate(e.target.value)} aria-label="Date" />
                  </div>
                  <div>
                    <label style={S.label}>Status</label>
                    <select style={{ ...S.input, width: '140px', cursor: 'pointer' }} value={entryStatus} onChange={e => setEntryStatus(e.target.value)} aria-label="Status">
                      {ENTRY_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {prefillDate && <div style={{ marginBottom: '12px', padding: '6px 12px', background: 'var(--input-bg)', borderRadius: '6px', fontSize: '13px', color: 'var(--accent-secondary)' }}>Backfill for: {prefillDate}</div>}

              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                <button style={{ ...S.btnP, opacity: saving || !title.trim() ? 0.5 : 1 }} onClick={() => saveLog(false)} disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Save'}</button>
                <button style={{ ...S.btnS, opacity: saving || !title.trim() ? 0.5 : 1 }} onClick={() => saveLog(true)} disabled={saving || !title.trim()}>Save & New</button>
              </div>
            </>
          ) : (
            <>
              <div style={S.field}>
                <label style={S.label}>One entry per line</label>
                <textarea ref={batchRef} style={{ ...S.input, minHeight: '120px', resize: 'vertical', fontFamily: 'inherit' }} value={batchText} onChange={e => setBatchText(e.target.value)} placeholder={"Reviewed Q3 metrics\nDecision: Approved new vendor\nUpdated deployment docs"} aria-label="Batch entries" />
                {batchText.trim() && <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>{parseBatchLines(batchText).length} entries will be created</span>}
              </div>

              {programs.length > 0 && (
                <div style={S.field}>
                  <label style={S.label}>Program</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} role="listbox" aria-label="Select program">
                    {programs.map(p => (
                      <span key={p.id} style={pill(selectedProgramId === p.id, p.color)} onClick={() => handleProgramSelect(p.id)}>
                        {p.name}{selectedProgramId === p.id && ' ×'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '14px' }}>
                <label style={S.label}>Project (optional)</label>
                <select style={{ ...S.input, cursor: 'pointer' }} value={projectId} onChange={e => handleProjectChange(e.target.value ? parseInt(e.target.value, 10) : '')} aria-label="Project">
                  <option value="">— None —</option>
                  {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                <button style={{ ...S.btnP, opacity: saving || !batchText.trim() ? 0.5 : 1 }} onClick={saveBatchLogs} disabled={saving || !batchText.trim()}>{saving ? 'Saving…' : 'Save All'}</button>
              </div>
            </>
          )}
        </div>
      )}

      {captureMode === 'task' && (
        <div id="capture-panel-task" role="tabpanel">
          {/* Batch link in corner */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 500 }} onClick={toggleBatchMode} role="button" aria-label={batchMode ? 'Switch to single task' : 'Switch to batch mode'}>
              {batchMode ? '← Single' : 'Batch ↗'}
            </span>
          </div>

          {!batchMode ? (
            <>
              <div style={S.field}>
                <label style={S.label}>Name</label>
                <input ref={titleRef} style={S.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to be done?" onKeyDown={handleTitleKeyDown} aria-label="Task name" />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <div>
                  <label style={S.label}>Due date (optional)</label>
                  <input type="date" style={{ ...S.input, width: '160px' }} value={dueDate} onChange={e => { dueDateManuallySet.current = true; setDueDate(e.target.value); }} aria-label="Due date" />
                </div>
                <div>
                  <label style={S.label}>Time (optional)</label>
                  <input type="time" style={{ ...S.input, width: '130px' }} value={dueTime} onChange={e => setDueTime(e.target.value)} aria-label="Due time" />
                </div>
              </div>

              {programs.length > 0 && (
                <div style={S.field}>
                  <label style={S.label}>Program</label>
                  <div ref={pillsRef} tabIndex={0} onKeyDown={handlePillsKeyDown} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', outline: 'none' }} role="listbox" aria-label="Select program">
                    {programs.map((p, i) => (
                      <span key={p.id} style={{ ...pill(selectedProgramId === p.id, p.color), outline: programFocusIdx === i ? '2px solid var(--accent-primary)' : 'none', outlineOffset: '2px' }} onClick={() => handleProgramSelect(p.id)}>
                        {p.name}{selectedProgramId === p.id && ' ×'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '14px' }}>
                <label style={S.label}>Project (optional)</label>
                <select style={{ ...S.input, cursor: 'pointer' }} value={projectId} onChange={e => handleProjectChange(e.target.value ? parseInt(e.target.value, 10) : '')} aria-label="Project">
                  <option value="">— None —</option>
                  {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                <button style={{ ...S.btnP, opacity: saving || !title.trim() ? 0.5 : 1 }} onClick={saveTask} disabled={saving || !title.trim()}>{saving ? 'Creating…' : 'Create Task'}</button>
              </div>
            </>
          ) : (
            <>
              <div style={S.field}>
                <label style={S.label}>One task per line</label>
                <textarea ref={batchRef} style={{ ...S.input, minHeight: '120px', resize: 'vertical', fontFamily: 'inherit' }} value={batchText} onChange={e => setBatchText(e.target.value)} placeholder={"Review PR #42\nUpdate deployment docs\nSchedule team sync"} aria-label="Batch tasks" />
                {batchText.trim() && <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>{batchText.split('\n').map(l => l.trim()).filter(l => l.length > 0).length} tasks will be created</span>}
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <div>
                  <label style={S.label}>Due date (optional, shared)</label>
                  <input type="date" style={{ ...S.input, width: '160px' }} value={dueDate} onChange={e => { dueDateManuallySet.current = true; setDueDate(e.target.value); }} aria-label="Due date" />
                </div>
                <div>
                  <label style={S.label}>Time (optional)</label>
                  <input type="time" style={{ ...S.input, width: '130px' }} value={dueTime} onChange={e => setDueTime(e.target.value)} aria-label="Due time" />
                </div>
              </div>

              {programs.length > 0 && (
                <div style={S.field}>
                  <label style={S.label}>Program</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} role="listbox" aria-label="Select program">
                    {programs.map(p => (
                      <span key={p.id} style={pill(selectedProgramId === p.id, p.color)} onClick={() => handleProgramSelect(p.id)}>
                        {p.name}{selectedProgramId === p.id && ' ×'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '14px' }}>
                <label style={S.label}>Project (optional)</label>
                <select style={{ ...S.input, cursor: 'pointer' }} value={projectId} onChange={e => handleProjectChange(e.target.value ? parseInt(e.target.value, 10) : '')} aria-label="Project">
                  <option value="">— None —</option>
                  {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                <button style={{ ...S.btnP, opacity: saving || !batchText.trim() ? 0.5 : 1 }} onClick={saveBatchTasks} disabled={saving || !batchText.trim()}>{saving ? 'Creating…' : 'Create All Tasks'}</button>
              </div>
            </>
          )}
        </div>
      )}

      {captureMode === 'rhythm' && (
        <div id="capture-panel-rhythm" role="tabpanel">
          {/* Batch link in corner */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 500 }} onClick={toggleBatchMode} role="button" aria-label={batchMode ? 'Switch to single cadence' : 'Switch to batch mode'}>
              {batchMode ? '← Single' : 'Batch ↗'}
            </span>
          </div>          {!batchMode ? (
            <>
              <div style={S.field}>
                <label style={S.label}>Name</label>
                <input ref={titleRef} style={S.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="What's the recurring cadence?" onKeyDown={handleTitleKeyDown} aria-label="Cadence name" />
              </div>

              <div style={S.field}>
                <label style={S.label}>Frequency</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(['Every Day', 'Every Weekday', 'Weekly', 'Biweekly', 'Monthly', 'Quarterly'] as const).map(f => (
                    <span key={f} style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', color: frequency === f ? 'var(--text-on-primary)' : 'var(--text-secondary)', background: frequency === f ? 'var(--accent-primary)' : 'var(--input-bg)', border: `1px solid ${frequency === f ? 'var(--accent-primary)' : 'var(--input-border)'}` }} tabIndex={0} role="option" aria-selected={frequency === f} onClick={() => setFrequency(f)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFrequency(f); } }}>{f}</span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <div>
                  <label style={S.label}>Start date</label>
                  <input type="date" style={{ ...S.input, width: '160px' }} value={dueDate} onChange={e => { dueDateManuallySet.current = true; setDueDate(e.target.value); }} aria-label="Start date" />
                </div>
                <div>
                  <label style={S.label}>Time (optional)</label>
                  <input type="time" style={{ ...S.input, width: '130px' }} value={dueTime} onChange={e => setDueTime(e.target.value)} aria-label="Time" />
                </div>
              </div>

              {/* Schedule preview */}
              {(() => {
                const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const d = dueDate ? new Date(dueDate + 'T12:00:00') : new Date();
                const dayName = DAY_NAMES[d.getDay()];
                const dayNum = d.getDate();
                const ordinal = dayNum === 1 || dayNum === 21 || dayNum === 31 ? 'st' : dayNum === 2 || dayNum === 22 ? 'nd' : dayNum === 3 || dayNum === 23 ? 'rd' : 'th';
                let desc = '';
                if (frequency === 'Weekly') desc = `Every ${dayName}`;
                else if (frequency === 'Biweekly') desc = `Every other ${dayName}`;
                else if (frequency === 'Monthly') desc = `Monthly on the ${dayNum}${ordinal}`;
                else if (frequency === 'Quarterly') desc = 'Every quarter';
                return desc ? (
                  <div style={{ marginBottom: '14px', padding: '6px 10px', borderRadius: '6px', background: 'var(--accent-primary)', color: 'var(--text-on-primary)', fontSize: '12px', fontWeight: 600 }}>
                    📅 {desc}{dueTime ? ` at ${dueTime}` : ''} — starts {dueDate || 'today'}
                  </div>
                ) : null;
              })()}

              {programs.length > 0 && (
                <div style={S.field}>
                  <label style={S.label}>Program</label>
                  <div ref={pillsRef} tabIndex={0} onKeyDown={handlePillsKeyDown} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', outline: 'none' }} role="listbox" aria-label="Select program">
                    {programs.map((p, i) => (
                      <span key={p.id} style={{ ...pill(selectedProgramId === p.id, p.color), outline: programFocusIdx === i ? '2px solid var(--accent-primary)' : 'none', outlineOffset: '2px' }} onClick={() => handleProgramSelect(p.id)}>
                        {p.name}{selectedProgramId === p.id && ' ×'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '14px' }}>
                <label style={S.label}>Project (optional)</label>
                <select style={{ ...S.input, cursor: 'pointer' }} value={projectId} onChange={e => handleProjectChange(e.target.value ? parseInt(e.target.value, 10) : '')} aria-label="Project">
                  <option value="">— None —</option>
                  {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                  <span
                    role="switch" aria-checked={requireAcknowledgment}
                    onClick={() => setRequireAcknowledgment(v => !v)}
                    style={{
                      display: 'inline-block', width: '28px', height: '16px', borderRadius: '8px',
                      background: requireAcknowledgment ? 'var(--accent-warning)' : 'var(--input-border)',
                      position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                    }}>
                    <span style={{
                      position: 'absolute', top: '2px', left: requireAcknowledgment ? '14px' : '2px',
                      width: '12px', height: '12px', borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                    }} />
                  </span>
                  Requires acknowledgment
                </label>
                <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', marginLeft: '24px' }}>
                  Won't auto-complete when past due — stays overdue until manually completed
                </span>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                <button style={{ ...S.btnP, opacity: saving || !title.trim() ? 0.5 : 1 }} onClick={saveRhythm} disabled={saving || !title.trim()}>{saving ? 'Creating…' : 'Create Cadence'}</button>
              </div>
            </>
          ) : (
            <>
              <div style={S.field}>
                <label style={S.label}>Frequency (shared for all)</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                  {(['Weekly', 'Biweekly', 'Monthly', 'Quarterly'] as const).map(f => (
                    <span key={f} style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', color: frequency === f ? 'var(--text-on-primary)' : 'var(--text-secondary)', background: frequency === f ? 'var(--accent-primary)' : 'var(--input-bg)', border: `1px solid ${frequency === f ? 'var(--accent-primary)' : 'var(--input-border)'}` }} tabIndex={0} role="option" aria-selected={frequency === f} onClick={() => setFrequency(f)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFrequency(f); } }}>{f}</span>
                  ))}
                </div>
              </div>

              <div style={S.field}>
                <label style={S.label}>One cadence per line</label>
                <textarea ref={batchRef} style={{ ...S.input, minHeight: '120px', resize: 'vertical', fontFamily: 'inherit' }} value={batchText} onChange={e => setBatchText(e.target.value)} placeholder={"Weekly standup\nSprint retrospective\nMetrics review"} aria-label="Batch cadences" />
                {batchText.trim() && <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>{batchText.split('\n').map(l => l.trim()).filter(l => l.length > 0).length} cadences will be created</span>}
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <div>
                  <label style={S.label}>Start date</label>
                  <input type="date" style={{ ...S.input, width: '160px' }} value={dueDate} onChange={e => { dueDateManuallySet.current = true; setDueDate(e.target.value); }} aria-label="Start date" />
                </div>
                <div>
                  <label style={S.label}>Time (optional)</label>
                  <input type="time" style={{ ...S.input, width: '130px' }} value={dueTime} onChange={e => setDueTime(e.target.value)} aria-label="Time" />
                </div>
              </div>

              {programs.length > 0 && (
                <div style={S.field}>
                  <label style={S.label}>Program</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} role="listbox" aria-label="Select program">
                    {programs.map(p => (
                      <span key={p.id} style={pill(selectedProgramId === p.id, p.color)} onClick={() => handleProgramSelect(p.id)}>
                        {p.name}{selectedProgramId === p.id && ' ×'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '14px' }}>
                <label style={S.label}>Project (optional)</label>
                <select style={{ ...S.input, cursor: 'pointer' }} value={projectId} onChange={e => handleProjectChange(e.target.value ? parseInt(e.target.value, 10) : '')} aria-label="Project">
                  <option value="">— None —</option>
                  {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                <button style={{ ...S.btnP, opacity: saving || !batchText.trim() ? 0.5 : 1 }} onClick={saveBatchRhythms} disabled={saving || !batchText.trim()}>{saving ? 'Creating…' : 'Create All Cadences'}</button>
              </div>
            </>
          )}
        </div>
      )}
        </div>
      </div>
      <DiscardConfirmDialog
        open={confirmOpen}
        message={confirmMessage}
        onDiscard={confirmDiscard}
        onCancel={confirmCancel}
      />
    </div>
  );
}
