import { useEffect, useState, useCallback, useRef } from 'react';
import { useInlineTask } from '../hooks/useInlineTask';
import { useDirtyClose } from '../hooks/useDirtyClose';
import { isoWeekNumber, daysBetween } from '../utils/dateUtils';
import { cardStyle, TYPE_ICON } from '../styles/sharedStyles';
import ActivityPulse from '../components/ActivityPulse';
import PrepNotes from '../components/PrepNotes';
import ReportReadyCard from '../components/ReportReadyCard';
import DiscardConfirmDialog from '../components/DiscardConfirmDialog';

/* ── Types ── */
interface Tag { id: number; name: string; created_at: string; }
interface EntryResponse {
  id: number; created_at: string; updated_at: string; entry_date: string;
  entry_type: string; work_type: string; title: string; description: string | null;
  impact: string | null; metrics: string | null; project_id: number | null;
  project_name: string | null; status: string; visibility: string;
  is_accomplishment: number; is_lesson_learned: number; is_weekly_highlight: number;
  tags: Tag[]; links: unknown[];
}

interface GoalHealth { on_track: number; at_risk: number; behind: number; }
interface ProgramActivity {
  program_id: number; name: string; status: string; program_type: string;
  entry_count: number; goal_health: GoalHealth; due_today_count: number;
}

interface DueTodayItem {
  instance_id: number; scheduled_item_id: number; due_date: string;
  due_time: string | null; status: string; name: string;
  program_id: number | null; program_name: string | null;
  quick_complete: number; template_entry_type: string;
  template_work_type: string; project_id: number | null;
  project_name?: string | null;
  item_class?: string; recurrence_type?: string | null;
  require_acknowledgment?: number;
}
interface DueTodayData {
  today: DueTodayItem[]; overdue: DueTodayItem[];
  completed_today: number; pending_today: number; skipped_today: number;
}

interface DashboardData {
  entries_this_week: number; entries_this_month: number; entries_this_quarter: number;
  active_projects: number; goals_on_track: number; goals_at_risk: number;
  days_since_last_entry: number | null; weekly_highlight: EntryResponse | null;
  recent_entries: EntryResponse[]; gap_dates: string[];
  operational_rhythm_count: number;
  open_todos: EntryResponse[]; open_todos_count: number;
  program_activity: ProgramActivity[];
  due_today: DueTodayData | null;
  /* v2 fields */
  activity_pulse?: { entries_this_week: number; tasks_completed_this_week: number; time_since_last_entry: string };
  prep_notes?: { id: number; text: string; created_at: string; dismissed_at: string | null }[];
  report_ready?: { draft_id: number; title: string } | null;
}

interface ScheduledItemBrief {
  id: number; name: string; description: string | null; status: string; item_class: string;
  due_date: string | null; program_id: number | null; program_name: string | null;
  project_id: number | null; project_name: string | null;
  recurrence_type: string | null; mode: string;
}

interface DashboardViewProps {
  onNavigateToQuickCapture?: (prefillDate?: string) => void;
  onNavigateToTab?: (tab: string, targetId?: number, context?: { projectId?: number; date?: string }) => void;
}

/* ── Styles ── */

const listItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px',
  padding: '8px 12px', background: 'var(--input-bg)', borderRadius: '6px', marginBottom: '4px',
};

const btnStyle = (bg: string, color: string): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 600,
  cursor: 'pointer', border: 'none', background: bg, color, whiteSpace: 'nowrap',
});

/* ── Program/Project Grouping Helper ── */
interface GroupedItems<T> {
  programName: string | null;
  programId: number | null;
  projects: { projectName: string | null; items: T[] }[];
}

function groupByProgramProject<T extends { program_name?: string | null; program_id?: number | null; project_name?: string | null; project_id?: number | null; due_date?: string | null; due_time?: string | null; name: string }>(
  items: T[]
): GroupedItems<T>[] {
  const programMap = new Map<string, { programId: number | null; projectMap: Map<string, T[]> }>();
  const otherItems: T[] = [];

  items.forEach(item => {
    if (item.program_name) {
      if (!programMap.has(item.program_name)) {
        programMap.set(item.program_name, { programId: item.program_id ?? null, projectMap: new Map() });
      }
      const entry = programMap.get(item.program_name)!;
      const projKey = item.project_name ?? '__none__';
      if (!entry.projectMap.has(projKey)) entry.projectMap.set(projKey, []);
      entry.projectMap.get(projKey)!.push(item);
    } else if (item.project_name) {
      // Has project but no program — group under a synthetic "Standalone" program
      const key = '__standalone__';
      if (!programMap.has(key)) {
        programMap.set(key, { programId: null, projectMap: new Map() });
      }
      const entry = programMap.get(key)!;
      if (!entry.projectMap.has(item.project_name)) entry.projectMap.set(item.project_name, []);
      entry.projectMap.get(item.project_name)!.push(item);
    } else {
      otherItems.push(item);
    }
  });

  // Sort items within each group: due_date ascending (null last), then time ascending, then alphabetical
  const sortWithinGroup = (groupItems: T[]) => {
    return [...groupItems].sort((a, b) => {
      const aDate = a.due_date ?? null;
      const bDate = b.due_date ?? null;
      // Dated items first, null dates last
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      // Both have dates — sort ascending
      if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
      // Same date (or both null) — timed first, then by time ascending
      if (a.due_time && b.due_time) return a.due_time.localeCompare(b.due_time);
      if (a.due_time && !b.due_time) return -1;
      if (!a.due_time && b.due_time) return 1;
      // Alphabetical tiebreaker
      return a.name.localeCompare(b.name);
    });
  };

  const result: GroupedItems<T>[] = [];

  // Named programs first (alphabetical)
  const sortedPrograms = [...programMap.entries()]
    .filter(([key]) => key !== '__standalone__')
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [programName, { programId, projectMap }] of sortedPrograms) {
    const projects: { projectName: string | null; items: T[] }[] = [];
    const sortedProjects = [...projectMap.entries()].sort(([a], [b]) => {
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b);
    });
    for (const [projKey, projItems] of sortedProjects) {
      projects.push({ projectName: projKey === '__none__' ? `Other tasks for ${programName}` : projKey, items: sortWithinGroup(projItems) });
    }
    result.push({ programName, programId, projects });
  }

  // Standalone projects (has project but no program)
  const standalone = programMap.get('__standalone__');
  if (standalone) {
    const projects: { projectName: string | null; items: T[] }[] = [];
    const sortedProjects = [...standalone.projectMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [projName, projItems] of sortedProjects) {
      projects.push({ projectName: projName, items: sortWithinGroup(projItems) });
    }
    result.push({ programName: null, programId: null, projects });
  }

  // "Other" group always last
  if (otherItems.length > 0) {
    result.push({ programName: 'Other', programId: null, projects: [{ projectName: null, items: sortWithinGroup(otherItems) }] });
  }

  return result;
}

/* ── Program color helper (deterministic from name) ── */
const PROGRAM_COLORS = [
  'var(--accent-primary)', 'var(--accent-secondary)', 'var(--accent-warning)',
  'var(--color-project)', 'var(--color-cadence)', 'var(--color-goal)',
];

function getProgramColor(name: string | null, colorMap?: Record<string, string>): string {
  if (!name || name === 'Other') return 'var(--text-muted)';
  if (colorMap && colorMap[name]) return colorMap[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return PROGRAM_COLORS[Math.abs(hash) % PROGRAM_COLORS.length];
}

function recurrenceLabel(type: string | null | undefined): string {
  switch (type) {
    case 'daily': return 'weekday';
    case 'every_day': return 'daily';
    case 'weekly': return 'weekly';
    case 'biweekly': return 'biweekly';
    case 'monthly': return 'monthly';
    case 'quarterly': return 'quarterly';
    default: return type ?? '';
  }
}

/* ── Task Edit Modal Types ── */
interface TaskModalData {
  id: number; name: string; description: string; due_date: string;
  mode: string;
  instance_id: number | null;
  instance_due_date: string;
  visibility: string;
  require_acknowledgment: number;
  program_id: number | null; project_id: number | null;
  programs: { id: number; name: string }[];
  projects: { id: number; name: string; program_id: number | null }[];
}

export default function DashboardView({ onNavigateToQuickCapture: _onNavigateToQuickCapture, onNavigateToTab }: DashboardViewProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskData, setTaskData] = useState<DueTodayData | null>(null);
  const [upcomingTasks, setUpcomingTasks] = useState<DueTodayItem[]>([]);
  const [allTasks, setAllTasks] = useState<ScheduledItemBrief[]>([]);
  const [busyItems, setBusyItems] = useState<Set<number>>(new Set());
  const [taskModal, setTaskModal] = useState<TaskModalData | null>(null);
  const [taskModalBusy, setTaskModalBusy] = useState(false);
  // Snapshot of the loaded taskModal state — captured the first time taskModal
  // becomes non-null (i.e. when openTaskModal finishes loading). Used by the
  // dirty-close guard to compare current form state to original loaded state.
  const taskModalSnapshotRef = useRef<TaskModalData | null>(null);
  const [workCompletingIds, setWorkCompletingIds] = useState<Set<number>>(new Set());
  const [workCompletedIds, setWorkCompletedIds] = useState<Set<number>>(new Set());
  const [showUpcomingCadences, setShowUpcomingCadences] = useState(true);
  const [upcomingViewMode, setUpcomingViewMode] = useState<'by_date' | 'by_program'>(() => {
    try { return (localStorage.getItem('chronicle-upcoming-view') as 'by_date' | 'by_program') ?? 'by_program'; } catch { return 'by_program'; }
  });
  const [upcomingCollapsed, setUpcomingCollapsed] = useState<boolean>(() => {
    try { const s = localStorage.getItem('chronicle-dashboard-upcoming-collapsed'); return s === 'true'; } catch { return false; }
  });
  const [workCollapsed, setWorkCollapsed] = useState<boolean>(() => {
    try { const s = localStorage.getItem('chronicle-dashboard-work-collapsed'); return s === 'true'; } catch { return false; }
  });
  const [recentCollapsed, setRecentCollapsed] = useState<boolean>(() => {
    try { const s = localStorage.getItem('chronicle-dashboard-recent-collapsed'); return s === 'true'; } catch { return false; }
  });
  const [programColors, setProgramColors] = useState<Record<string, string>>({});

  // Persist collapse states (Task 17 / Req 11)
  useEffect(() => {
    try { localStorage.setItem('chronicle-dashboard-upcoming-collapsed', String(upcomingCollapsed)); } catch { /* ignore */ }
  }, [upcomingCollapsed]);
  useEffect(() => {
    try { localStorage.setItem('chronicle-dashboard-work-collapsed', String(workCollapsed)); } catch { /* ignore */ }
  }, [workCollapsed]);
  useEffect(() => {
    try { localStorage.setItem('chronicle-dashboard-recent-collapsed', String(recentCollapsed)); } catch { /* ignore */ }
  }, [recentCollapsed]);

  const fetchAllTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduled-items?status=active');
      if (res.ok) {
        const items: ScheduledItemBrief[] = await res.json();
        const oneTimeTasks = items.filter(i => i.mode === 'one_time' && i.item_class === 'task');
        const sorted = [...oneTimeTasks].sort((a, b) => {
          if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
          if (a.due_date && !b.due_date) return -1;
          if (!a.due_date && b.due_date) return 1;
          return a.name.localeCompare(b.name);
        });
        setAllTasks(sorted.slice(0, 20));
      }
    } catch { /* ignore */ }
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      const [res, progRes] = await Promise.all([fetch('/api/dashboard'), fetch('/api/programs')]);
      if (res.ok) setData(await res.json());
      if (progRes.ok) {
        const progs = await progRes.json();
        const colorMap: Record<string, string> = {};
        progs.forEach((p: { name: string; color: string | null }) => { if (p.color) colorMap[p.name] = p.color; });
        setProgramColors(colorMap);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduled-items/due');
      if (res.ok) setTaskData(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchUpcoming = useCallback(async () => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const startStr = tomorrow.toISOString().split('T')[0];
      const endStr = nextWeek.toISOString().split('T')[0];
      const res = await fetch(`/api/scheduled-items/instances?status=pending&due_date_start=${startStr}&due_date_end=${endStr}`);
      if (res.ok) {
        const instances = await res.json();
        const itemsRes = await fetch('/api/scheduled-items');
        if (itemsRes.ok) {
          const items = await itemsRes.json();
          const visibleItems = new Map(
            items
              .filter((i: { item_class: string; show_on_today?: number }) =>
                i.item_class === 'task' || (i.item_class === 'cadence' && (i.show_on_today ?? 1) === 1)
              )
              .map((i: { id: number; name: string; item_class: string; program_id: number | null; program_name: string | null; project_id: number | null; project_name: string | null; require_acknowledgment?: number; recurrence_type?: string | null }) => [i.id, i])
          );
          const upcoming: DueTodayItem[] = instances
            .filter((inst: { scheduled_item_id: number }) => visibleItems.has(inst.scheduled_item_id))
            .map((inst: { id: number; scheduled_item_id: number; due_date: string; due_time: string | null; status: string }) => {
              const item = visibleItems.get(inst.scheduled_item_id) as { id: number; name: string; item_class: string; program_id: number | null; program_name: string | null; project_id: number | null; project_name: string | null; require_acknowledgment?: number; recurrence_type?: string | null };
              return {
                instance_id: inst.id, scheduled_item_id: inst.scheduled_item_id,
                due_date: inst.due_date, due_time: inst.due_time, status: inst.status,
                name: item.name, program_id: item.program_id, program_name: item.program_name,
                quick_complete: 0, template_entry_type: 'quick_capture',
                template_work_type: 'operational_rhythm', project_id: item.project_id,
                project_name: (item as { project_name?: string | null }).project_name ?? null,
                item_class: item.item_class, recurrence_type: item.recurrence_type ?? null,
                require_acknowledgment: item.require_acknowledgment ?? 0,
              };
            })
            .sort((a: DueTodayItem, b: DueTodayItem) => a.due_date.localeCompare(b.due_date));
          setUpcomingTasks(upcoming);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchTasks(), fetchUpcoming(), fetchAllTasks(), fetchDashboard()]);
  }, [fetchTasks, fetchUpcoming, fetchAllTasks, fetchDashboard]);

  /* ── Task Edit Modal handlers ── */
  const openTaskModal = useCallback(async (itemId: number, instanceId?: number, instanceDueDate?: string) => {
    try {
      const [itemRes, progRes, projRes] = await Promise.all([
        fetch(`/api/scheduled-items/${itemId}`),
        fetch('/api/programs?status=active'),
        fetch('/api/projects'),
      ]);
      if (itemRes.ok) {
        const item = await itemRes.json();
        const progs = progRes.ok ? await progRes.json() : [];
        const projs = projRes.ok ? (await projRes.json()).filter((p: { status: string }) => p.status === 'active' || p.status === 'planning') : [];
        // Reset the dirty-close snapshot so the freshly loaded task is treated
        // as the new baseline (matters when switching between tasks without
        // closing the modal in between).
        taskModalSnapshotRef.current = null;
        setTaskModal({
          id: item.id, name: item.name ?? '', description: item.description ?? '',
          due_date: item.due_date ?? '', mode: item.mode ?? 'one_time',
          instance_id: instanceId ?? null,
          instance_due_date: instanceDueDate ?? item.due_date ?? '',
          visibility: item.template_visibility ?? 'shareable',
          require_acknowledgment: item.require_acknowledgment ?? 0,
          program_id: item.program_id ?? null,
          project_id: item.project_id ?? null, programs: progs, projects: projs,
        });
      }
    } catch { /* ignore */ }
  }, []);

  const handleModalSave = useCallback(async () => {
    if (!taskModal || taskModalBusy) return;
    setTaskModalBusy(true);
    try {
      if (taskModal.mode === 'recurring' && taskModal.instance_id) {
        // Recurring instance: reschedule this occurrence only
        // Update the instance's due_date directly
        await fetch(`/api/scheduled-items/${taskModal.id}/instances/${taskModal.instance_id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ due_date: taskModal.instance_due_date || null }),
        });
        // Also save name/description changes to the parent item
        const body: Record<string, unknown> = {
          name: taskModal.name.trim() || 'Untitled',
          description: taskModal.description.trim(),
        };
        await fetch(`/api/scheduled-items/${taskModal.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        // One-time task: update everything including due_date
        const body: Record<string, unknown> = {
          name: taskModal.name.trim() || 'Untitled',
          description: taskModal.description.trim(),
          due_date: taskModal.mode === 'recurring' ? undefined : (taskModal.due_date || null),
          program_id: taskModal.program_id || 0,
          project_id: taskModal.project_id || 0,
        };
        await fetch(`/api/scheduled-items/${taskModal.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      setTaskModal(null);
      refreshAll();
    } catch { /* ignore */ }
    finally { setTaskModalBusy(false); }
  }, [taskModal, taskModalBusy, refreshAll]);

  const handleModalComplete = useCallback(async () => {
    if (!taskModal || taskModalBusy) return;
    setTaskModalBusy(true);
    try {
      // Save name/description
      const saveBody: Record<string, unknown> = {
        name: taskModal.name.trim() || 'Untitled',
        description: taskModal.description.trim(),
      };
      if (taskModal.mode !== 'recurring') {
        saveBody.due_date = taskModal.due_date || null;
        saveBody.program_id = taskModal.program_id || null;
        saveBody.project_id = taskModal.project_id || null;
      }
      await fetch(`/api/scheduled-items/${taskModal.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveBody),
      });
      // Complete using the instance date (for recurring) or item date (for one-time)
      const completeDueDate = taskModal.mode === 'recurring'
        ? taskModal.instance_due_date
        : (taskModal.due_date || null);
      await fetch(`/api/scheduled-items/${taskModal.id}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: completeDueDate, description: taskModal.description.trim() || null, notes: null, visibility: taskModal.visibility }),
      });
      setTaskModal(null);
      refreshAll();
    } catch { /* ignore */ }
    finally { setTaskModalBusy(false); }
  }, [taskModal, taskModalBusy, refreshAll]);

  const handleModalDelete = useCallback(async () => {
    if (!taskModal || taskModalBusy) return;
    if (!confirm('Delete this task? This cannot be undone.')) return;
    setTaskModalBusy(true);
    try {
      await fetch(`/api/scheduled-items/${taskModal.id}`, { method: 'DELETE' });
      setTaskModal(null);
      refreshAll();
    } catch { /* ignore */ }
    finally { setTaskModalBusy(false); }
  }, [taskModal, taskModalBusy, refreshAll]);

  /* ── Task Edit Modal dirty-close guard ── */
  // Capture the snapshot the first time taskModal flips from null → non-null,
  // and clear it when taskModal flips back to null. This gives isDirty a stable
  // reference to compare the current form state against.
  useEffect(() => {
    if (taskModal && taskModalSnapshotRef.current === null) {
      taskModalSnapshotRef.current = { ...taskModal };
    } else if (!taskModal && taskModalSnapshotRef.current !== null) {
      taskModalSnapshotRef.current = null;
    }
  }, [taskModal]);

  const isTaskModalDirty = useCallback(() => {
    const current = taskModal;
    const snapshot = taskModalSnapshotRef.current;
    if (!current || !snapshot) return false;
    return (
      current.name !== snapshot.name ||
      current.description !== snapshot.description ||
      current.due_date !== snapshot.due_date ||
      current.instance_due_date !== snapshot.instance_due_date ||
      current.program_id !== snapshot.program_id ||
      current.project_id !== snapshot.project_id ||
      current.visibility !== snapshot.visibility
    );
  }, [taskModal]);

  const closeTaskModal = useCallback(() => { setTaskModal(null); }, []);

  const {
    handleBackdropClick: handleTaskModalBackdrop,
    handleExplicitClose: handleTaskModalExplicitClose,
    shaking: taskModalShaking,
    confirmOpen: taskModalConfirmOpen,
    confirmDiscard: taskModalConfirmDiscard,
    confirmCancel: taskModalConfirmCancel,
    confirmMessage: taskModalConfirmMessage,
  } = useDirtyClose({ isDirty: isTaskModalDirty, onClose: closeTaskModal });

  // Esc key → explicit close (goes through the dirty-close guard).
  useEffect(() => {
    if (!taskModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleTaskModalExplicitClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [taskModal, handleTaskModalExplicitClose]);

  const { loadInlineTask, closeInlineTask, renderInlineTaskPanel } = useInlineTask({ onMutate: refreshAll });

  useEffect(() => { fetchDashboard(); fetchTasks(); fetchUpcoming(); fetchAllTasks(); }, [fetchDashboard, fetchTasks, fetchUpcoming, fetchAllTasks]);

  const handleComplete = async (item: DueTodayItem) => {
    if (busyItems.has(item.instance_id)) return;
    setBusyItems(prev => new Set(prev).add(item.instance_id));
    try {
      const res = await fetch(`/api/scheduled-items/${item.scheduled_item_id}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: item.due_date, notes: null }),
      });
      if (res.ok) { refreshAll(); }
    } catch { /* ignore */ }
    finally { setBusyItems(prev => { const next = new Set(prev); next.delete(item.instance_id); return next; }); }
  };

  const handleSkip = async (item: DueTodayItem) => {
    if (busyItems.has(item.instance_id)) return;
    setBusyItems(prev => new Set(prev).add(item.instance_id));
    try {
      const res = await fetch(`/api/scheduled-items/${item.scheduled_item_id}/skip`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: item.due_date, reason: 'Skipped' }),
      });
      if (res.ok) { refreshAll(); }
    } catch { /* ignore */ }
    finally { setBusyItems(prev => { const next = new Set(prev); next.delete(item.instance_id); return next; }); }
  };

  const handleWorkComplete = async (itemId: number, dueDate: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    setWorkCompletingIds(prev => { const next = new Set(prev); next.add(itemId); return next; });
    try {
      const res = await fetch(`/api/scheduled-items/${itemId}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: dueDate, notes: null }),
      });
      if (res.ok) {
        setWorkCompletedIds(prev => { const next = new Set(prev); next.add(itemId); return next; });
        setTimeout(() => { setWorkCompletedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; }); refreshAll(); }, 800);
      }
    } catch { /* ignore */ }
    finally { setWorkCompletingIds(prev => { const next = new Set(prev); next.delete(itemId); return next; }); }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  if (!data) return <p style={{ color: 'var(--accent-danger)' }}>Failed to load.</p>;

  const overdueItems = taskData ? [...taskData.overdue].sort((a, b) => {
    if (a.due_time && b.due_time) return a.due_time.localeCompare(b.due_time);
    if (a.due_time && !b.due_time) return -1;
    if (!a.due_time && b.due_time) return 1;
    return a.name.localeCompare(b.name);
  }) : [];
  const todayItems = taskData ? [...taskData.today].sort((a, b) => {
    if (a.due_time && b.due_time) return a.due_time.localeCompare(b.due_time);
    if (a.due_time && !b.due_time) return -1;
    if (!a.due_time && b.due_time) return 1;
    return a.name.localeCompare(b.name);
  }) : [];
  const atRiskGoals = (data.goals_at_risk ?? 0);
  const hasAttention = overdueItems.length > 0 || atRiskGoals > 0;
  const recentEntries = (data.recent_entries ?? []).slice(0, 10);
  const allTodayTasks = [...overdueItems, ...todayItems];

  /* ── Grouped data for consistent rendering ── */
  const todayGrouped = groupByProgramProject(allTodayTasks);
  const upcomingGrouped = groupByProgramProject(
    showUpcomingCadences ? upcomingTasks : upcomingTasks.filter(t => t.item_class !== 'cadence')
  );
  const workGrouped = groupByProgramProject(allTasks.map(t => ({
    ...t, due_time: null as string | null,
    program_name: t.program_name, program_id: t.program_id,
    project_name: t.project_name, project_id: t.project_id,
  })));

  /* ── Render a task row (shared between Today and Upcoming) ── */
  const renderTaskRow = (item: DueTodayItem, showDate = false, useInline = false, showProject = false) => {
    const isOverdue = overdueItems.some(o => o.instance_id === item.instance_id);
    const daysOverdue = isOverdue ? daysBetween(item.due_date) : 0;
    if (isOverdue && daysOverdue === null) {
      console.warn(`[DashboardView] Could not parse due_date "${item.due_date}" for instance ${item.instance_id}; skipping overdue indicator.`);
    }
    const showOverdueBadge = isOverdue && daysOverdue !== null && daysOverdue > 0;
    const handleClick = () => {
      if (useInline) { setTaskModal(null); loadInlineTask(item.scheduled_item_id); }
      else { closeInlineTask(); openTaskModal(item.scheduled_item_id, item.instance_id, item.due_date); }
    };
    return (
      <div key={item.instance_id}>
        <div
          style={{ ...listItemStyle, ...(isOverdue ? { borderLeft: '3px solid var(--accent-danger)' } : {}), cursor: 'pointer' }}
          onClick={handleClick}
          role="button" tabIndex={0} aria-label={`Edit ${item.name}`}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
        >
          {showDate && <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '70px' }}>{item.due_date}</span>}
          {item.require_acknowledgment === 1 && (
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-warning)', flexShrink: 0 }} title="Requires acknowledgment" />
          )}
          <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</span>
          {showProject && item.project_name && (
            <span style={{ fontSize: '11px', fontWeight: 500, color: item.program_name ? getProgramColor(item.program_name, programColors) : 'var(--accent-primary)', minWidth: '160px', textAlign: 'right' }}>
              {item.project_name}
            </span>
          )}
          {item.item_class === 'cadence' && item.recurrence_type && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>↻ {recurrenceLabel(item.recurrence_type)}</span>
          )}
          {showOverdueBadge && <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent-danger)' }}>{daysOverdue}d</span>}
          {item.due_time && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.due_time}</span>}
          <button style={btnStyle('var(--btn-complete-bg)', 'var(--text-on-primary)')} onClick={e => { e.stopPropagation(); handleComplete(item); }} disabled={busyItems.has(item.instance_id)}>{busyItems.has(item.instance_id) ? '…' : 'Complete'}</button>
          <button style={btnStyle('var(--input-bg)', 'var(--text-secondary)')} onClick={e => { e.stopPropagation(); handleSkip(item); }} disabled={busyItems.has(item.instance_id)}>Skip</button>
        </div>
        {useInline && renderInlineTaskPanel(item.scheduled_item_id)}
      </div>
    );
  };

  /* ── Render grouped items (Program → Project hierarchy) ── */
  const renderGroupedTasks = (groups: GroupedItems<DueTodayItem>[], showDate = false, useInline = false) => (
    <>
      {groups.map((group, gi) => (
        <div key={`${group.programName}-${gi}`} className="dashboard-program-group">
          {group.programName && group.programName !== 'Other' && (
            <div className="dashboard-program-group-header">
              <span className="dashboard-program-dot" style={{ background: getProgramColor(group.programName, programColors) }} />
              {group.programName}
            </div>
          )}
          {group.programName === 'Other' && (
            <div className="dashboard-program-group-header">
              <span className="dashboard-program-dot" style={{ background: 'var(--text-muted)' }} />
              Other
            </div>
          )}
          {group.projects.map((proj, pi) => (
            <div key={`${proj.projectName}-${pi}`} style={{ marginLeft: group.programName && group.programName !== 'Other' ? '12px' : '0' }}>
              {proj.projectName && (
                <div className="dashboard-project-subheader">{proj.projectName}</div>
              )}
              <div style={{ paddingLeft: proj.projectName ? '12px' : '0' }}>
                {proj.items.map(item => renderTaskRow(item, showDate, useInline))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );

  /* ── Render grouped work-at-a-glance items ── */
  const renderGroupedWork = (groups: GroupedItems<ScheduledItemBrief & { due_time: string | null }>[]) => (
    <>
      {groups.map((group, gi) => (
        <div key={`${group.programName}-${gi}`} className="dashboard-program-group">
          {group.programName && group.programName !== 'Other' && (
            <div className="dashboard-program-group-header">
              <span className="dashboard-program-dot" style={{ background: getProgramColor(group.programName, programColors) }} />
              {group.programName}
            </div>
          )}
          {group.programName === 'Other' && (
            <div className="dashboard-program-group-header">
              <span className="dashboard-program-dot" style={{ background: 'var(--text-muted)' }} />
              Other
            </div>
          )}
          {group.projects.map((proj, pi) => (
            <div key={`${proj.projectName}-${pi}`} style={{ marginLeft: group.programName && group.programName !== 'Other' ? '12px' : '0' }}>
              {proj.projectName && (
                <div className="dashboard-project-subheader">{proj.projectName}</div>
              )}
              <div style={{ paddingLeft: proj.projectName ? '12px' : '0' }}>
                {proj.items.map(item => (
                  <div key={item.id}>
                    <div
                      style={{ ...listItemStyle, cursor: 'pointer', background: workCompletedIds.has(item.id) ? 'rgba(74, 222, 128, 0.15)' : 'transparent', transition: 'background 0.3s ease' }}
                      onClick={() => { setTaskModal(null); loadInlineTask(item.id); }}
                      role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTaskModal(null); loadInlineTask(item.id); } }}
                      aria-label={`Open details for ${item.name}`}
                    >
                      <button
                        onClick={(e) => handleWorkComplete(item.id, item.due_date, e)}
                        disabled={workCompletingIds.has(item.id)}
                        title="Complete task"
                        style={{ background: 'none', border: '1.5px solid var(--btn-complete-bg)', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: '10px', color: 'var(--btn-complete-bg)', flexShrink: 0 }}
                      >{workCompletedIds.has(item.id) ? '✓' : workCompletingIds.has(item.id) ? '…' : ''}</button>
                      <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</span>
                      {item.description && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</span>
                      )}
                      {item.item_class === 'cadence' && item.recurrence_type && (
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>↻ {recurrenceLabel(item.recurrence_type)}</span>
                      )}
                      {item.due_date
                        ? <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{item.due_date}</span>
                        : <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No date</span>
                      }
                    </div>
                    {renderInlineTaskPanel(item.id)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );

  return (
    <div className="dashboard-container" style={{ maxWidth: '1100px' }}>

      {/* ═══════════════════════════════════════════════════════════════════
          HEADER: Week/Date line — sticky, compact (≤ 72px).
          ActivityPulse and Needs Attention scroll normally beneath it.
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="dashboard-header">
        {(() => {
          const now = new Date();
          const weekLabel = `Week ${isoWeekNumber(now)}`;
          const dayLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
          return (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{weekLabel} · {dayLabel}</span>
              <button className="refresh-btn" onClick={refreshAll} title="Refresh data">
                <span className="refresh-icon">↻</span> Refresh
              </button>
            </div>
          );
        })()}
      </div>

      <ActivityPulse data={data.activity_pulse} />

      {hasAttention && (
        <div style={{ borderLeft: '3px solid var(--accent-danger)', padding: '12px 16px', marginBottom: '16px', background: 'var(--input-bg)', borderRadius: '0 6px 6px 0' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Needs Attention
          </h3>
          {overdueItems.length > 0 && (
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-danger)', marginRight: '12px' }}>
              ⚠ {overdueItems.length} overdue
            </span>
          )}
          {atRiskGoals > 0 && (
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--status-at-risk)' }}>
              {atRiskGoals} goal{atRiskGoals !== 1 ? 's' : ''} at risk
            </span>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          PAIRED ROW: Today's Tasks (60%) + Prep Notes (40%)
          These keep card styling and internal scroll
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="dashboard-paired-row">
        {/* LEFT: Today's Tasks */}
        <div className="dashboard-paired-panel" style={{ ...cardStyle, borderLeft: '3px solid var(--accent-primary)' }}>
          <h3 className="dashboard-section-header" style={{ background: 'var(--card-bg)' }}>
            Today's Tasks
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>
              ({allTodayTasks.length})
            </span>
          </h3>
          {allTodayTasks.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>Nothing due today.</p>}
          {allTodayTasks.length > 0 && renderGroupedTasks(todayGrouped)}
        </div>

        {/* RIGHT: Prep Notes */}
        <div className="dashboard-paired-panel" style={{ ...cardStyle, borderLeft: '3px solid var(--accent-secondary)' }}>
          <PrepNotes initialNotes={data.prep_notes} onNotesChange={refreshAll} />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          STACKED SECTIONS: Upcoming, Work at a Glance, Recent Activity
          No card styling — whitespace + dividers, natural height
          ═══════════════════════════════════════════════════════════════════ */}

      {/* ── Upcoming ── */}
      {upcomingTasks.length > 0 && (
        <>
          <hr className="dashboard-section-divider" />
          <div>
            <h3 className="dashboard-section-header" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span onClick={() => setUpcomingCollapsed(v => !v)} style={{ cursor: 'pointer', fontSize: '10px', color: 'var(--text-muted)', transition: 'transform 0.2s', transform: upcomingCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', userSelect: 'none' }}>▼</span>
              <span className="section-accent" style={{ background: 'var(--accent-warning)' }} />
              Upcoming
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>
                ({showUpcomingCadences ? upcomingTasks.length : upcomingTasks.filter(t => t.item_class !== 'cadence').length}) · next 7 days
              </span>
              {/* View mode toggle */}
              <span style={{ display: 'inline-flex', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--card-border)', marginLeft: '8px' }}>
                <button onClick={() => { setUpcomingViewMode('by_date'); try { localStorage.setItem('chronicle-upcoming-view', 'by_date'); } catch {} }}
                  style={{ padding: '2px 8px', fontSize: '10px', fontWeight: upcomingViewMode === 'by_date' ? 600 : 400, background: upcomingViewMode === 'by_date' ? 'var(--accent-primary)' : 'var(--input-bg)', color: upcomingViewMode === 'by_date' ? '#fff' : 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>
                  By Date
                </button>
                <button onClick={() => { setUpcomingViewMode('by_program'); try { localStorage.setItem('chronicle-upcoming-view', 'by_program'); } catch {} }}
                  style={{ padding: '2px 8px', fontSize: '10px', fontWeight: upcomingViewMode === 'by_program' ? 600 : 400, background: upcomingViewMode === 'by_program' ? 'var(--accent-primary)' : 'var(--input-bg)', color: upcomingViewMode === 'by_program' ? '#fff' : 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>
                  By Program
                </button>
              </span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto', fontWeight: 400 }}>
                <span
                  role="switch" aria-checked={showUpcomingCadences} aria-label="Show cadences"
                  onClick={() => setShowUpcomingCadences(v => !v)}
                  style={{
                    display: 'inline-block', width: '28px', height: '16px', borderRadius: '8px',
                    background: showUpcomingCadences ? 'var(--accent-primary)' : 'var(--input-border)',
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }}>
                  <span style={{
                    position: 'absolute', top: '2px', left: showUpcomingCadences ? '14px' : '2px',
                    width: '12px', height: '12px', borderRadius: '50%', background: '#fff',
                    transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                  }} />
                </span>
                Cadences
              </label>
            </h3>
            {!upcomingCollapsed && (
              upcomingViewMode === 'by_program'
                ? renderGroupedTasks(upcomingGrouped, true, false)
                : /* By Date: flat chronological list */
                  <div>
                    {(showUpcomingCadences ? upcomingTasks : upcomingTasks.filter(t => t.item_class !== 'cadence'))
                      .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.name.localeCompare(b.name))
                      .map(item => renderTaskRow(item, true, false, true))}
                  </div>
            )}
          </div>
        </>
      )}

      {/* ── Work at a Glance ── */}
      {allTasks.length > 0 && (
        <>
          <hr className="dashboard-section-divider" />
          <div>
            <h3 className="dashboard-section-header" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span onClick={() => setWorkCollapsed(v => !v)} style={{ cursor: 'pointer', fontSize: '10px', color: 'var(--text-muted)', transition: 'transform 0.2s', transform: workCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', userSelect: 'none' }}>▼</span>
              <span className="section-accent" style={{ background: 'var(--color-project)' }} />
              Work at a Glance
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>
                ({allTasks.length})
              </span>
            </h3>
            {!workCollapsed && (
              <>
                {renderGroupedWork(workGrouped)}
                <div style={{ textAlign: 'center', marginTop: '8px' }}>
                  <button
                    style={{ ...btnStyle('transparent', 'var(--accent-primary)'), fontSize: '12px' }}
                    onClick={() => onNavigateToTab?.('Portfolio')}
                    aria-label="View all in Portfolio"
                  >
                    View all in Portfolio →
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Recent Activity ── */}
      <>
        <hr className="dashboard-section-divider" />
        <div>
          <h3 className="dashboard-section-header" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span onClick={() => setRecentCollapsed(v => !v)} style={{ cursor: 'pointer', fontSize: '10px', color: 'var(--text-muted)', transition: 'transform 0.2s', transform: recentCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', userSelect: 'none' }}>▼</span>
            <span className="section-accent" style={{ background: 'var(--text-muted)' }} />
            Recent Activity
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>
              ({recentEntries.length})
            </span>
          </h3>
          {!recentCollapsed && (
            <>
              {recentEntries.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>No entries yet.</p>}
              {recentEntries.map(entry => {
                const ti = TYPE_ICON[entry.entry_type] ?? TYPE_ICON.note;
                return (
                  <div key={entry.id} style={{ ...listItemStyle, cursor: 'pointer' }}
                    onClick={() => onNavigateToTab?.('Timeline', entry.id, { date: entry.entry_date })}>
                    <span style={{ color: ti.color, fontSize: '14px', flexShrink: 0 }}>{ti.icon}</span>
                    <span style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)' }}>{entry.title}</span>
                    {entry.project_name && <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{entry.project_name}</span>}
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{entry.entry_date}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </>

      {/* ═══════════════════════════════════════════════════════════════════
          FOOTER: Report Ready Banner (conditional)
          ═══════════════════════════════════════════════════════════════════ */}
      <ReportReadyCard reportReady={data.report_ready} onNavigateToTab={onNavigateToTab} />

      {/* ═══════════════════════════════════════════════════════════════════
          TASK EDIT MODAL
          ═══════════════════════════════════════════════════════════════════ */}
      {taskModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={handleTaskModalBackdrop}
          role="dialog" aria-modal="true" aria-label="Edit task"
        >
          <div
            className={taskModalShaking ? 'modal-shake' : undefined}
            style={{ background: 'var(--card-bg)', borderRadius: '12px', padding: '32px', width: '100%', maxWidth: '580px', border: '1px solid var(--card-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>Edit Task</h3>
              {taskModal.mode === 'recurring' && (
                <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'var(--accent-primary)', color: '#fff', fontSize: '10px', fontWeight: 600 }}>CADENCE</span>
              )}
              {taskModal.require_acknowledgment === 1 && (
                <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'var(--accent-warning)', color: '#fff', fontSize: '10px', fontWeight: 600 }}>ACCOUNTABLE</span>
              )}
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="task-modal-name" style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Name</label>
              <input id="task-modal-name" style={{ width: '100%', padding: '10px 14px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
                value={taskModal.name} onChange={e => setTaskModal({ ...taskModal, name: e.target.value })} autoFocus />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="task-modal-description" style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Description</label>
              <textarea id="task-modal-description" style={{ width: '100%', padding: '10px 14px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' }}
                value={taskModal.description} onChange={e => setTaskModal({ ...taskModal, description: e.target.value })} placeholder="Add a description…" />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="task-modal-due-date" style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                {taskModal.mode === 'recurring' ? 'This occurrence' : 'Due Date'}
              </label>
              <input id="task-modal-due-date" type="date" style={{ width: '180px', padding: '10px 14px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
                value={taskModal.mode === 'recurring' ? taskModal.instance_due_date : taskModal.due_date}
                onChange={e => taskModal.mode === 'recurring'
                  ? setTaskModal({ ...taskModal, instance_due_date: e.target.value })
                  : setTaskModal({ ...taskModal, due_date: e.target.value })
                } />
              {taskModal.mode === 'recurring' && (
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Moving this date reschedules only this occurrence. Edit the cadence schedule from Portfolio.
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="task-modal-program" style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Program</label>
                <select id="task-modal-program" style={{ width: '100%', padding: '10px 14px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '14px', cursor: 'pointer' }}
                  value={taskModal.program_id ?? ''} onChange={e => setTaskModal({ ...taskModal, program_id: e.target.value ? parseInt(e.target.value, 10) : null })}>
                  <option value="">— None —</option>
                  {taskModal.programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="task-modal-project" style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Project</label>
                <select id="task-modal-project" style={{ width: '100%', padding: '10px 14px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '14px', cursor: 'pointer' }}
                  value={taskModal.project_id ?? ''} onChange={e => setTaskModal({ ...taskModal, project_id: e.target.value ? parseInt(e.target.value, 10) : null })}>
                  <option value="">— None —</option>
                  {(taskModal.program_id ? taskModal.projects.filter(p => p.program_id === taskModal.program_id) : taskModal.projects).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none', marginRight: 'auto' }}>
                <span
                  role="switch" aria-checked={taskModal.visibility === 'personal'} aria-label="Personal visibility"
                  onClick={() => setTaskModal({ ...taskModal, visibility: taskModal.visibility === 'personal' ? 'shareable' : 'personal' })}
                  style={{
                    display: 'inline-block', width: '32px', height: '18px', borderRadius: '9px',
                    background: taskModal.visibility === 'personal' ? 'var(--accent-primary)' : 'var(--input-border)',
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }}>
                  <span style={{
                    position: 'absolute', top: '2px', left: taskModal.visibility === 'personal' ? '16px' : '2px',
                    width: '14px', height: '14px', borderRadius: '50%', background: '#fff',
                    transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                  }} />
                </span>
                Personal
              </label>
              <button style={{ padding: '10px 20px', background: 'transparent', color: 'var(--accent-danger)', border: '1px solid var(--accent-danger)', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: taskModalBusy ? 0.5 : 1 }}
                onClick={handleModalDelete} disabled={taskModalBusy}>Delete</button>
              <button style={{ padding: '10px 20px', background: 'var(--button-primary-bg)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: taskModalBusy ? 0.5 : 1 }}
                onClick={handleModalSave} disabled={taskModalBusy}>Save</button>
              <button style={{ padding: '10px 20px', background: 'var(--btn-complete-bg)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: taskModalBusy ? 0.5 : 1 }}
                onClick={handleModalComplete} disabled={taskModalBusy}>Complete</button>
            </div>
          </div>
        </div>
      )}

      <DiscardConfirmDialog
        open={taskModalConfirmOpen}
        message={taskModalConfirmMessage}
        onDiscard={taskModalConfirmDiscard}
        onCancel={taskModalConfirmCancel}
      />
    </div>
  );
}
