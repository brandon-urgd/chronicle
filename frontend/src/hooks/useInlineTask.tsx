import { useState, useEffect, useRef, useCallback } from 'react';
import { inlinePanelStyle, inlineBtnStyle, inlineInputStyle } from '../styles/inlineEditStyles';
import { useDirtyClose } from './useDirtyClose';
import DiscardConfirmDialog from '../components/DiscardConfirmDialog';

/**
 * Shared inline task panel hook (Task 16.2).
 * Provides state, handlers, and a render function for the inline task
 * edit panel used in PortfolioView and DashboardView.
 */

export interface InlineTaskData {
  id: number; name: string; status: string;
  mode: string; recurrence_type: string | null; due_date: string | null;
  day_of_week: number | null; day_of_month: number | null;
  time_of_day: string | null; item_class: string;
  program_id: number | null; project_id: number | null;
  program_name: string | null; project_name: string | null;
  require_acknowledgment?: number;
}

interface ProgramOption { id: number; name: string; status: string; }
interface ProjectOption { id: number; name: string; status: string; goal_id: number | null; program_id: number | null; }
interface GoalOption { id: number; program_id: number | null; }

interface UseInlineTaskOptions {
  /** Called after any mutation (save/complete/skip/delete/promote) to refresh parent data. */
  onMutate?: () => void | Promise<void>;
  /** Navigate to a tab (e.g. Timeline) with optional target entry ID. */
  onNavigateToTab?: (tab: string, targetId?: number) => void;
  /** When true, hides Complete/Skip/Promote buttons — shows only Save/Delete (cadence edit mode). */
  editOnly?: boolean;
}

export function useInlineTask(options: UseInlineTaskOptions = {}) {
  const DAY_NAMES = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function describeSchedule(data: InlineTaskData): string | null {
    if (data.mode !== 'recurring' || !data.recurrence_type) return null;
    const parts: string[] = [];
    switch (data.recurrence_type) {
      case 'every_day': parts.push('Every day'); break;
      case 'daily': parts.push('Every weekday'); break;
      case 'weekly':
        parts.push(data.day_of_week != null ? `Every ${DAY_NAMES[data.day_of_week]}` : 'Weekly');
        break;
      case 'biweekly':
        parts.push(data.day_of_week != null ? `Every other ${DAY_NAMES[data.day_of_week]}` : 'Biweekly');
        break;
      case 'monthly':
        parts.push(data.day_of_month != null ? `Monthly on the ${data.day_of_month}${data.day_of_month === 1 ? 'st' : data.day_of_month === 2 ? 'nd' : data.day_of_month === 3 ? 'rd' : 'th'}` : 'Monthly');
        break;
      case 'quarterly': parts.push('Quarterly'); break;
      case 'annual': parts.push('Annually'); break;
      default: parts.push(data.recurrence_type);
    }
    if (data.time_of_day) parts.push(`at ${data.time_of_day}`);
    return parts.join(' ');
  }
  const [inlineTaskId, setInlineTaskId] = useState<number | null>(null);
  const [inlineTaskData, setInlineTaskData] = useState<InlineTaskData | null>(null);
  const [taskEditName, setTaskEditName] = useState('');
  const [taskEditDescription, setTaskEditDescription] = useState('');
  const [taskEditDueDate, setTaskEditDueDate] = useState('');
  const [taskEditProgramId, setTaskEditProgramId] = useState<number | ''>('');
  const [taskEditProjectId, setTaskEditProjectId] = useState<number | ''>('');
  const [taskEditShowOnToday, setTaskEditShowOnToday] = useState(1);
  const [taskEditRecurrenceType, setTaskEditRecurrenceType] = useState<string>('');
  const [taskEditDayOfWeek, setTaskEditDayOfWeek] = useState<number | ''>('');
  const [taskEditDayOfMonth, setTaskEditDayOfMonth] = useState<number | ''>('');
  const [taskEditTimeOfDay, setTaskEditTimeOfDay] = useState<string>('');
  const [taskEditRequireAck, setTaskEditRequireAck] = useState(0);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [nextPendingDate, setNextPendingDate] = useState<string | null>(null);
  const [showCompleteForm, setShowCompleteForm] = useState(false);
  const [completeDescription, setCompleteDescription] = useState('');
  const [completeImpact, setCompleteImpact] = useState('');
  const [completeMetrics, setCompleteMetrics] = useState('');
  const [completedEntryId, setCompletedEntryId] = useState<number | null>(null);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [goals, setGoals] = useState<GoalOption[]>([]);

  // Snapshot of the loaded form values — captured by loadInlineTask and
  // cleared when the panel closes. Used by the dirty-close guard (useDirtyClose)
  // to compare current form state against the baseline. Requirement 11.9.
  interface FormSnapshot {
    name: string;
    description: string;
    dueDate: string;
    programId: number | '';
    projectId: number | '';
    showOnToday: number;
    recurrenceType: string;
    dayOfWeek: number | '';
    dayOfMonth: number | '';
    timeOfDay: string;
    requireAck: number;
  }
  const formSnapshotRef = useRef<FormSnapshot | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [pRes, prRes, gRes] = await Promise.all([
          fetch('/api/programs?status=active'), fetch('/api/projects'), fetch('/api/goals'),
        ]);
        if (pRes.ok) setPrograms(await pRes.json());
        if (prRes.ok) { const d = await prRes.json(); setProjects(d.filter((p: ProjectOption) => p.status === 'active' || p.status === 'planning')); }
        if (gRes.ok) setGoals(await gRes.json());
      } catch { /* ignore */ }
    })();
  }, []);

  function resolveProjectProgram(projId: number): number | null {
    const proj = projects.find(p => p.id === projId);
    if (proj?.program_id) return proj.program_id;
    if (proj?.goal_id) { const g = goals.find(x => x.id === proj.goal_id); return g?.program_id ?? null; }
    return null;
  }

  const filteredProjects = taskEditProgramId
    ? projects.filter(p => {
        if (p.program_id === taskEditProgramId) return true;
        if (p.goal_id) { const g = goals.find(x => x.id === p.goal_id); return g?.program_id === taskEditProgramId; }
        return false;
      })
    : projects;

  async function loadInlineTask(id: number) {
    try {
      const res = await fetch(`/api/scheduled-items/${id}`);
      if (res.ok) {
        const data = await res.json();
        setInlineTaskData(data);
        setInlineTaskId(id);
        setTaskEditName(data.name ?? '');
        setTaskEditDescription(data.description ?? '');
        setTaskEditDueDate(data.due_date ?? '');
        setTaskEditProgramId(data.program_id ?? '');
        setTaskEditProjectId(data.project_id ?? '');
        setTaskEditShowOnToday(data.show_on_today ?? 1);
        setTaskEditRecurrenceType(data.recurrence_type ?? '');
        setTaskEditDayOfWeek(data.day_of_week ?? '');
        setTaskEditDayOfMonth(data.day_of_month ?? '');
        setTaskEditTimeOfDay(data.time_of_day ?? '');
        setTaskEditRequireAck(data.require_acknowledgment ?? 0);
        setCompletedEntryId(null);
        setInlineError(null);
        // Capture the baseline form snapshot for the dirty-close guard.
        // Mirrors the individual setters above; these values are what
        // isDirty() compares against. Requirement 11.9.
        formSnapshotRef.current = {
          name: data.name ?? '',
          description: data.description ?? '',
          dueDate: data.due_date ?? '',
          programId: data.program_id ?? '',
          projectId: data.project_id ?? '',
          showOnToday: data.show_on_today ?? 1,
          recurrenceType: data.recurrence_type ?? '',
          dayOfWeek: data.day_of_week ?? '',
          dayOfMonth: data.day_of_month ?? '',
          timeOfDay: data.time_of_day ?? '',
          requireAck: data.require_acknowledgment ?? 0,
        };
        // For recurring cadences, fetch the next pending instance date
        if (data.mode === 'recurring') {
          try {
            const instRes = await fetch(`/api/scheduled-items/${id}/instances?status=pending&limit=1`);
            if (instRes.ok) {
              const instances = await instRes.json();
              setNextPendingDate(instances.length > 0 ? instances[0].due_date : data.due_date);
            } else {
              setNextPendingDate(data.due_date);
            }
          } catch { setNextPendingDate(data.due_date); }
        } else {
          setNextPendingDate(null);
        }
      }
    } catch { /* ignore */ }
  }

  async function handleTaskSave(taskId: number) {
    if (busy) return;
    setBusy(true);
    setInlineError(null);
    try {
      const body: Record<string, unknown> = {};
      if (taskEditName.trim()) body.name = taskEditName.trim();
      body.description = taskEditDescription.trim();
      body.due_date = taskEditDueDate || null;
      body.program_id = taskEditProgramId || 0;
      body.project_id = taskEditProjectId || 0;
      body.show_on_today = taskEditShowOnToday;

      // Include cadence schedule fields if this is a recurring item
      const isCadence = inlineTaskData?.mode === 'recurring';
      if (isCadence) {
        body.recurrence_type = taskEditRecurrenceType || null;
        body.day_of_week = taskEditDayOfWeek !== '' ? Number(taskEditDayOfWeek) : null;
        body.day_of_month = taskEditDayOfMonth !== '' ? Number(taskEditDayOfMonth) : null;
        body.time_of_day = taskEditTimeOfDay || null;
        body.require_acknowledgment = taskEditRequireAck;
      }

      const res = await fetch(`/api/scheduled-items/${taskId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        // If cadence schedule changed, clear pending instances and regenerate
        if (isCadence) {
          const scheduleChanged =
            taskEditRecurrenceType !== (inlineTaskData?.recurrence_type ?? '') ||
            (taskEditDayOfWeek !== '' ? Number(taskEditDayOfWeek) : null) !== inlineTaskData?.day_of_week ||
            (taskEditDayOfMonth !== '' ? Number(taskEditDayOfMonth) : null) !== inlineTaskData?.day_of_month ||
            taskEditTimeOfDay !== (inlineTaskData?.time_of_day ?? '');
          if (scheduleChanged) {
            // Clear pending instances and regenerate via backend
            await fetch(`/api/scheduled-items/${taskId}/instances/regenerate`, { method: 'POST' }).catch(() => {});
          }
        }
        setInlineTaskId(null); setInlineTaskData(null); await options.onMutate?.();
      }
      else { setInlineError('Failed to save task. Please try again.'); }
    } catch { setInlineError('Network error. Please check your connection.'); }
    finally { setBusy(false); }
  }

  async function handleTaskComplete(taskId: number, dueDate: string | null) {
    if (busy) return;
    setBusy(true);
    setInlineError(null);
    try {
      const body: Record<string, unknown> = { due_date: dueDate, notes: null };
      if (completeDescription.trim()) body.description = completeDescription.trim();
      if (completeImpact.trim()) body.impact = completeImpact.trim();
      if (completeMetrics.trim()) body.metrics = completeMetrics.trim();
      const res = await fetch(`/api/scheduled-items/${taskId}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const entryId = data?.entry_id ?? null;
        setCompletedEntryId(entryId);
        setShowCompleteForm(false); setCompleteDescription(''); setCompleteImpact(''); setCompleteMetrics('');
        await options.onMutate?.();
      }
      else { setInlineError('Failed to complete task. Please try again.'); }
    } catch { setInlineError('Network error. Please check your connection.'); }
    finally { setBusy(false); }
  }

  async function handleTaskSkip(taskId: number, dueDate: string | null) {
    if (busy) return;
    setBusy(true);
    setInlineError(null);
    try {
      const res = await fetch(`/api/scheduled-items/${taskId}/skip`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: dueDate, reason: 'Skipped' }),
      });
      if (res.ok) { setInlineTaskId(null); setInlineTaskData(null); await options.onMutate?.(); }
      else { setInlineError('Failed to skip task. Please try again.'); }
    } catch { setInlineError('Network error. Please check your connection.'); }
    finally { setBusy(false); }
  }

  async function handleTaskDelete(taskId: number) {
    if (busy) return;
    if (!confirm('Delete this task? This cannot be undone.')) return;
    setBusy(true);
    setInlineError(null);
    try {
      const res = await fetch(`/api/scheduled-items/${taskId}`, { method: 'DELETE' });
      if (res.ok) { setInlineTaskId(null); setInlineTaskData(null); await options.onMutate?.(); }
      else { setInlineError('Failed to delete task. Please try again.'); }
    } catch { setInlineError('Network error. Please check your connection.'); }
    finally { setBusy(false); }
  }

  async function handleTaskPromoteToProject(taskId: number, taskName: string) {
    if (busy) return;
    if (!confirm(`Create a project from "${taskName}"? The task will be linked to the new project.`)) return;
    setBusy(true);
    try {
      const projectBody: Record<string, unknown> = { name: taskName, status: 'active' };
      if (inlineTaskData?.program_id) projectBody.program_id = inlineTaskData.program_id;
      const projRes = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectBody),
      });
      if (projRes.ok) {
        const proj = await projRes.json();
        await fetch(`/api/scheduled-items/${taskId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: proj.id }),
        });
        setInlineTaskId(null); setInlineTaskData(null);
        await options.onMutate?.();
      }
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }

  function closeInlineTask() {
    setInlineTaskId(null);
    setInlineTaskData(null);
    setShowCompleteForm(false);
    setCompleteDescription('');
    setCompleteImpact('');
    setCompleteMetrics('');
    setCompletedEntryId(null);
    setInlineError(null);
    formSnapshotRef.current = null;
  }

  // isDirty predicate — pure comparison of current form state against the
  // snapshot captured at load time. Requirements 11.8, 11.9.
  const isDirty = useCallback(() => {
    const snap = formSnapshotRef.current;
    if (!snap) return false;
    return (
      taskEditName !== snap.name ||
      taskEditDescription !== snap.description ||
      taskEditDueDate !== snap.dueDate ||
      taskEditProgramId !== snap.programId ||
      taskEditProjectId !== snap.projectId ||
      taskEditShowOnToday !== snap.showOnToday ||
      taskEditRecurrenceType !== snap.recurrenceType ||
      taskEditDayOfWeek !== snap.dayOfWeek ||
      taskEditDayOfMonth !== snap.dayOfMonth ||
      taskEditTimeOfDay !== snap.timeOfDay ||
      taskEditRequireAck !== snap.requireAck
    );
  }, [
    taskEditName, taskEditDescription, taskEditDueDate,
    taskEditProgramId, taskEditProjectId, taskEditShowOnToday,
    taskEditRecurrenceType, taskEditDayOfWeek, taskEditDayOfMonth,
    taskEditTimeOfDay, taskEditRequireAck,
  ]);

  const {
    handleBackdropClick,
    handleExplicitClose,
    shaking,
    confirmOpen,
    confirmDiscard,
    confirmCancel,
    confirmMessage,
  } = useDirtyClose({ isDirty, onClose: closeInlineTask });

  // Click-outside to close: ref for the panel container. Routes through
  // useDirtyClose so dirty panels shake instead of closing. Requirements 11.2, 11.3.
  const panelRef = useRef<HTMLDivElement>(null);
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (inlineTaskId && panelRef.current && !panelRef.current.contains(e.target as Node)) {
      handleBackdropClick();
    }
  }, [inlineTaskId, handleBackdropClick]);

  useEffect(() => {
    if (inlineTaskId) {
      // Delay to avoid closing immediately from the click that opened it
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClickOutside); };
    }
    return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, [inlineTaskId, handleClickOutside]);

  // Esc key → explicit close (goes through the dirty-close guard).
  // Requirements 11.4, 11.5.
  useEffect(() => {
    if (!inlineTaskId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleExplicitClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [inlineTaskId, handleExplicitClose]);

  /** Render the inline task detail/edit panel for a given taskId. */
  function renderInlineTaskPanel(taskId: number): React.ReactNode {
    if (inlineTaskId !== taskId || !inlineTaskData) return null;

    const panelStyle = inlinePanelStyle;
    const btnStyle = inlineBtnStyle;
    const inputStyle = inlineInputStyle;

    return (
      <>
      <div ref={panelRef} style={panelStyle} className={shaking ? 'modal-shake' : undefined}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-task)' }}>Task Details</span>
          <button style={btnStyle('var(--input-bg)', 'var(--text-muted)')}
            onClick={handleExplicitClose}>✕ Close</button>
        </div>
        {inlineError && (
          <div style={{ marginBottom: '10px', padding: '6px 10px', borderRadius: '6px', background: 'var(--accent-danger)', color: '#fff', fontSize: '12px' }} role="alert">
            {inlineError}
          </div>
        )}
        {completedEntryId && (
          <div style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: '6px', background: 'var(--status-on-track)', color: '#fff', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>✓ Task completed</span>
            <button
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => { closeInlineTask(); options.onNavigateToTab?.('Timeline', completedEntryId); }}
            >View Entry →</button>
          </div>
        )}
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Name</label>
          <input style={{ ...inputStyle, width: '100%' }}
            value={taskEditName} onChange={e => setTaskEditName(e.target.value)} aria-label="Task name" />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Description (optional)</label>
          <textarea style={{ ...inputStyle, width: '100%', minHeight: '50px', resize: 'vertical', fontFamily: 'inherit' }}
            value={taskEditDescription} onChange={e => setTaskEditDescription(e.target.value)} aria-label="Task description" placeholder="Add a description…" />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{options.editOnly && inlineTaskData.mode === 'recurring' ? 'Start date' : 'Due date (optional)'}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="date" style={{ ...inputStyle, width: '180px' }}
              value={taskEditDueDate} onChange={e => setTaskEditDueDate(e.target.value)} aria-label={options.editOnly && inlineTaskData.mode === 'recurring' ? 'Cadence start date' : 'Task due date'} />
            {taskEditDueDate && (
              <button
                style={{ ...btnStyle('var(--input-bg)', 'var(--text-muted)'), padding: '5px 8px' }}
                onClick={() => setTaskEditDueDate('')}
                aria-label="Clear date"
                title="Clear date"
              >×</button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Program</label>
            <select style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}
              value={taskEditProgramId}
              onChange={e => { const v = e.target.value ? parseInt(e.target.value, 10) : ''; setTaskEditProgramId(v); if (v && taskEditProjectId) { const r = resolveProjectProgram(taskEditProjectId as number); if (r && r !== v) setTaskEditProjectId(''); } }}
              aria-label="Task program">
              <option value="">— None —</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Project</label>
            <select style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}
              value={taskEditProjectId}
              onChange={e => { const v = e.target.value ? parseInt(e.target.value, 10) : ''; setTaskEditProjectId(v); if (v) { const r = resolveProjectProgram(v); if (r) setTaskEditProgramId(r); } }}
              aria-label="Task project">
              <option value="">— None —</option>
              {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
          Status: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{inlineTaskData.status}</span>
          {inlineTaskData.item_class === 'cadence' && (
            <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '4px', background: 'var(--accent-primary)', color: '#fff', fontSize: '10px', fontWeight: 600 }}>CADENCE</span>
          )}
          {inlineTaskData.item_class === 'task' && (
            <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '4px', background: 'var(--color-task)', color: '#fff', fontSize: '10px', fontWeight: 600 }}>TASK</span>
          )}
          {inlineTaskData.require_acknowledgment === 1 && (
            <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '4px', background: 'var(--accent-warning)', color: '#fff', fontSize: '10px', fontWeight: 600 }}>ACCOUNTABLE</span>
          )}
        </div>
        {inlineTaskData.mode === 'recurring' && !options.editOnly && (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', fontStyle: 'italic' }}>
            📅 {describeSchedule(inlineTaskData)}
          </div>
        )}
        {inlineTaskData.mode === 'recurring' && options.editOnly && (
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer', userSelect: 'none' }}>
              <span
                role="switch" aria-checked={!!taskEditShowOnToday} aria-label="Show on Today"
                onClick={() => setTaskEditShowOnToday(taskEditShowOnToday ? 0 : 1)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTaskEditShowOnToday(taskEditShowOnToday ? 0 : 1); } }}
                tabIndex={0}
                style={{
                  display: 'inline-block', width: '32px', height: '18px', borderRadius: '9px',
                  background: taskEditShowOnToday ? 'var(--accent-primary)' : 'var(--input-border)',
                  position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                }}>
                <span style={{
                  position: 'absolute', top: '2px', left: taskEditShowOnToday ? '16px' : '2px',
                  width: '14px', height: '14px', borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                }} />
              </span>
              Show on Today
            </label>
            {/* Editable schedule fields */}
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '0 0 130px' }}>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>Frequency</label>
                <select style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}
                  value={taskEditRecurrenceType}
                  onChange={e => setTaskEditRecurrenceType(e.target.value)}
                  aria-label="Recurrence frequency">
                  <option value="every_day">Every Day</option>
                  <option value="daily">Every Weekday</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
              {(taskEditRecurrenceType === 'weekly' || taskEditRecurrenceType === 'biweekly') && (
                <div style={{ flex: '0 0 130px' }}>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>Day of Week</label>
                  <select style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}
                    value={taskEditDayOfWeek}
                    onChange={e => setTaskEditDayOfWeek(e.target.value ? parseInt(e.target.value, 10) : '')}
                    aria-label="Day of week">
                    <option value="">— Select —</option>
                    {DAY_NAMES.slice(1).map((d, i) => <option key={i + 1} value={i + 1}>{d}</option>)}
                  </select>
                </div>
              )}
              {taskEditRecurrenceType === 'monthly' && (
                <div style={{ flex: '0 0 100px' }}>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>Day of Month</label>
                  <input type="number" min={1} max={31} style={{ ...inputStyle, width: '100%' }}
                    value={taskEditDayOfMonth}
                    onChange={e => setTaskEditDayOfMonth(e.target.value ? parseInt(e.target.value, 10) : '')}
                    aria-label="Day of month" />
                </div>
              )}
              <div style={{ flex: '0 0 100px' }}>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>Time</label>
                <input type="time" style={{ ...inputStyle, width: '100%' }}
                  value={taskEditTimeOfDay}
                  onChange={e => setTaskEditTimeOfDay(e.target.value)}
                  aria-label="Time of day" />
              </div>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Saving will regenerate upcoming instances based on the new schedule.
            </p>
            {/* Require Acknowledgment toggle */}
            <div style={{ marginTop: '10px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer', userSelect: 'none' }}>
                <span
                  role="switch" aria-checked={!!taskEditRequireAck} aria-label="Requires acknowledgment"
                  onClick={() => setTaskEditRequireAck(taskEditRequireAck ? 0 : 1)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTaskEditRequireAck(taskEditRequireAck ? 0 : 1); } }}
                  tabIndex={0}
                  style={{
                    display: 'inline-block', width: '32px', height: '18px', borderRadius: '9px',
                    background: taskEditRequireAck ? 'var(--accent-warning)' : 'var(--input-border)',
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }}>
                  <span style={{
                    position: 'absolute', top: '2px', left: taskEditRequireAck ? '16px' : '2px',
                    width: '14px', height: '14px', borderRadius: '50%', background: '#fff',
                    transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                  }} />
                </span>
                Requires acknowledgment
              </label>
              <p style={{ margin: '4px 0 0', fontSize: '10px', color: 'var(--text-muted)' }}>
                When on, this cadence won't auto-complete when past due.
              </p>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button style={{ ...btnStyle('var(--button-primary-bg)', '#fff'), opacity: busy ? 0.5 : 1 }}
            onClick={() => handleTaskSave(taskId)} disabled={busy}>Save</button>
          {!options.editOnly && (
            <>
              <button style={{ ...btnStyle('var(--btn-complete-bg)', '#fff'), opacity: busy ? 0.5 : 1 }}
                onClick={() => handleTaskComplete(taskId, nextPendingDate ?? inlineTaskData.due_date)} disabled={busy}>Quick Complete</button>
              <button style={{ ...btnStyle('var(--accent-primary)', '#fff'), opacity: busy ? 0.5 : 1 }}
                onClick={() => setShowCompleteForm(!showCompleteForm)} disabled={busy}>
                {showCompleteForm ? '▲ Hide Details' : '▼ Complete with Details'}
              </button>
              <button style={{ ...btnStyle('var(--input-bg)', 'var(--text-secondary)'), opacity: busy ? 0.5 : 1 }}
                onClick={() => handleTaskSkip(taskId, nextPendingDate ?? inlineTaskData.due_date)} disabled={busy}>Skip</button>
            </>
          )}
          <button style={{ ...btnStyle('transparent', 'var(--accent-danger)'), opacity: busy ? 0.5 : 1 }}
            onClick={() => handleTaskDelete(taskId)} disabled={busy}>Delete</button>
          {!options.editOnly && !inlineTaskData.project_id && inlineTaskData.item_class !== 'cadence' && (
            <button style={{ ...btnStyle('var(--input-bg)', 'var(--accent-primary)'), opacity: busy ? 0.5 : 1 }}
              onClick={() => handleTaskPromoteToProject(taskId, inlineTaskData.name)} disabled={busy}>Promote to Project</button>
          )}
        </div>
        {!options.editOnly && showCompleteForm && (
          <div style={{ marginTop: '12px', padding: '12px', background: 'var(--input-bg)', borderRadius: '8px', border: '1px solid var(--input-border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Complete with Details
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>Description / What was done</label>
              <textarea
                style={{ ...inputStyle, width: '100%', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
                value={completeDescription}
                onChange={e => setCompleteDescription(e.target.value)}
                placeholder="What did you do? Key details..."
                aria-label="Completion description"
              />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>Impact (optional)</label>
              <textarea
                style={{ ...inputStyle, width: '100%', minHeight: '40px', resize: 'vertical', fontFamily: 'inherit' }}
                value={completeImpact}
                onChange={e => setCompleteImpact(e.target.value)}
                placeholder="What was the impact or outcome?"
                aria-label="Completion impact"
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>Metrics (optional)</label>
              <input
                style={{ ...inputStyle, width: '100%' }}
                value={completeMetrics}
                onChange={e => setCompleteMetrics(e.target.value)}
                placeholder="Any numbers or measurements"
                aria-label="Completion metrics"
              />
            </div>
            <button
              style={{ ...btnStyle('var(--btn-complete-bg)', '#fff'), padding: '8px 20px', fontSize: '13px', opacity: busy ? 0.5 : 1 }}
              onClick={() => handleTaskComplete(taskId, nextPendingDate ?? inlineTaskData.due_date)}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Complete & Save Details'}
            </button>
          </div>
        )}
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
    inlineTaskId,
    inlineTaskData,
    taskEditName,
    taskEditDescription,
    taskEditDueDate,
    completedEntryId,
    loadInlineTask,
    handleTaskSave,
    handleTaskComplete,
    handleTaskSkip,
    handleTaskDelete,
    handleTaskPromoteToProject,
    closeInlineTask,
    renderInlineTaskPanel,
    setTaskEditName,
    setTaskEditDescription,
    setTaskEditDueDate,
  };
}
