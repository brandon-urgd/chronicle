import { useEffect, useState, useCallback, useRef } from 'react';
import { readAppState, patchAppState } from '../utils/appState';
import { PRESET_COLORS } from '../constants';
import { useInlineTask } from '../hooks/useInlineTask';
import { useInlineEntry } from '../hooks/useInlineEntry';
import { inlinePanelStyle, inlineBtnStyle, inlineInputStyle } from '../styles/inlineEditStyles';
import { cardStyle as sharedCardStyle, chipStyle, STATUS_CONFIG, TYPE_ICON, DEFAULT_ICON } from '../styles/sharedStyles';
import PromoteToGoal from '../components/PromoteToGoal';

/* ── Types ── */
interface Program {
  id: number; name: string; description: string | null; program_type: string;
  status: string; color: string | null; sort_order: number;
  metrics: {
    total_entries: number; active_goals: number; total_goals: number;
    active_projects: number; total_projects: number; goals_on_track: number;
    goals_at_risk: number; scheduled_items_count: number; scheduled_completion_rate: number;
  };
  goals: { id: number; title: string; status: string }[];
}

interface Goal {
  id: number; title: string; status: string; program_id: number | null;
  program_name: string | null; linked_projects_count: number;
  description: string | null; target_date: string | null;
  specific: string | null; measurable: string | null;
  achievable: string | null; relevant: string | null;
  time_bound: string | null;
}

interface Project {
  id: number; name: string; status: string; goal_id: number | null;
  program_id: number | null; program_name: string | null;
  metrics: string | null;
  entries: EntryBrief[];
}

interface EntryBrief {
  id: number; title: string; entry_type: string; entry_date: string;
  project_id: number | null; project_name: string | null;
  program_id: number | null; is_pinned?: number;
}

interface ScheduledItem {
  id: number; name: string; mode: string; status: string;
  item_class: string; program_id: number | null; program_name: string | null;
  project_id: number | null; project_name: string | null;
  recurrence_type: string | null; due_date: string | null;
  day_of_week: number | null; day_of_month: number | null;
  time_of_day: string | null;
}

interface StakeholderResponse {
  id: number; name: string; email: string | null;
  role: string | null; notes: string | null; created_at: string;
}

interface ProgramEditData {
  name: string; description: string; program_type: string;
  status: string; color: string; owner: string;
}

interface ProjectEditData {
  name: string; description: string; status: string;
  program_id: number | ''; goal_id: number | '';
  start_date: string; target_end_date: string; metrics: string;
}

interface GoalEditData {
  title: string; description: string; status: string;
  specific: string; measurable: string; achievable: string;
  relevant: string; time_bound: string; target_date: string;
  program_id: number | '';
}

interface PortfolioViewProps {
  onNavigateToQuickCapture?: (prefillDate?: string, prefillProgramId?: number, prefillProjectId?: number, prefillAsTask?: boolean, prefillAsCadence?: boolean) => void;
  onNavigateToTab?: (tab: string, targetId?: number, context?: { projectId?: number; date?: string }) => void;
}

/* ── Styles ── */
const cardStyle: React.CSSProperties = {
  ...sharedCardStyle, marginBottom: '12px',
};

const PROGRAM_TYPES = ['Primary', 'Strategic', 'Operational', 'Carrier', 'Support'];

export default function PortfolioView({ onNavigateToQuickCapture, onNavigateToTab }: PortfolioViewProps) {
  const DAY_NAMES = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function describeSchedule(item: { recurrence_type: string | null; day_of_week: number | null; day_of_month: number | null; time_of_day: string | null; mode: string }): string {
    if (item.mode !== 'recurring' || !item.recurrence_type) return item.recurrence_type ?? item.mode;
    let desc = '';
    switch (item.recurrence_type) {
      case 'every_day': desc = 'Every day'; break;
      case 'daily': desc = 'Every weekday'; break;
      case 'weekly': desc = item.day_of_week != null ? `Every ${DAY_NAMES[item.day_of_week]}` : 'Weekly'; break;
      case 'biweekly': desc = item.day_of_week != null ? `Every other ${DAY_NAMES[item.day_of_week]}` : 'Biweekly'; break;
      case 'monthly': { const d = item.day_of_month; desc = d != null ? `Monthly on the ${d}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}` : 'Monthly'; break; }
      case 'quarterly': desc = 'Quarterly'; break;
      case 'annual': desc = 'Annually'; break;
      default: desc = item.recurrence_type;
    }
    if (item.time_of_day) desc += ` at ${item.time_of_day}`;
    return desc;
  }
  const [programs, setPrograms] = useState<Program[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [entries, setEntries] = useState<EntryBrief[]>([]);
  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[]>([]);
  const [expandedPrograms, setExpandedPrograms] = useState<Set<number>>(() => {
    try { const s = readAppState(); return new Set(s.portfolioView?.expandedPrograms ?? []); } catch { return new Set(); }
  });
  const [expandedGoals, setExpandedGoals] = useState<Set<number>>(() => {
    try { const s = readAppState(); return new Set(s.portfolioView?.expandedGoals ?? []); } catch { return new Set(); }
  });
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(() => {
    try { const s = readAppState(); return new Set(s.portfolioView?.expandedProjects ?? []); } catch { return new Set(); }
  });
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState<boolean>(() => {
    try { const s = readAppState(); return s.portfolioView?.showCompleted ?? false; } catch { return false; }
  });

  // Bulk task completion state (Task 11.1)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [bulkCompleting, setBulkCompleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Individual task completion flash state (Task 20.8)
  const [completingTaskIds, setCompletingTaskIds] = useState<Set<number>>(new Set());
  const [completedFlashIds, setCompletedFlashIds] = useState<Set<number>>(new Set());

  // Consolidated "+ New" dropdown state
  const [showNewDropdown, setShowNewDropdown] = useState(false);
  const newDropdownRef = useRef<HTMLDivElement>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [preSearchExpansion, setPreSearchExpansion] = useState<{
    programs: Set<number>; goals: Set<number>; projects: Set<number>;
  } | null>(null);

  const [showNewProgram, setShowNewProgram] = useState(false);
  const [newProgramName, setNewProgramName] = useState('');
  const [newProgramDescription, setNewProgramDescription] = useState('');
  const [newProgramType, setNewProgramType] = useState('Primary');
  const [newProgramStatus, setNewProgramStatus] = useState('active');
  const [newProgramColor, setNewProgramColor] = useState('');
  const [newProgramOwner, setNewProgramOwner] = useState('');

  // Program edit state
  const [editingProgramId, setEditingProgramId] = useState<number | null>(null);
  const [programEditData, setProgramEditData] = useState<ProgramEditData | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectProgramId, setNewProjectProgramId] = useState<number | ''>('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectStatus, setNewProjectStatus] = useState('active');
  const [newProjectGoalId, setNewProjectGoalId] = useState<number | ''>('');
  const [newProjectStartDate, setNewProjectStartDate] = useState('');
  const [newProjectTargetEndDate, setNewProjectTargetEndDate] = useState('');

  // Inline project edit state
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [projectEditData, setProjectEditData] = useState<ProjectEditData | null>(null);

  // Promote to Goal modal state (Task 20.10)
  const [promoteToGoalProject, setPromoteToGoalProject] = useState<{ id: number; name: string; description: string | null; program_id: number | null } | null>(null);

  // New Goal form state
  const [showNewGoal, setShowNewGoal] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDescription, setNewGoalDescription] = useState('');
  const [newGoalStatus, setNewGoalStatus] = useState('on_track');
  const [newGoalProgramId, setNewGoalProgramId] = useState<number | ''>('');
  const [newGoalTargetDate, setNewGoalTargetDate] = useState('');

  // Inline goal edit state
  const [editingGoalId, setEditingGoalId] = useState<number | null>(null);
  const [goalEditData, setGoalEditData] = useState<GoalEditData | null>(null);

  // Stakeholder state for project edit
  const [projectStakeholders, setProjectStakeholders] = useState<StakeholderResponse[]>([]);
  const [stakeholderSearch, setStakeholderSearch] = useState('');
  const [stakeholderResults, setStakeholderResults] = useState<StakeholderResponse[]>([]);
  const [newStakeholderName, setNewStakeholderName] = useState('');
  const [newStakeholderEmail, setNewStakeholderEmail] = useState('');
  const [newStakeholderRole, setNewStakeholderRole] = useState('');
  const fetchAll = useCallback(async () => {
    try {
      const [pRes, gRes, prRes, eRes, sRes] = await Promise.all([
        fetch('/api/programs'), fetch('/api/goals'), fetch('/api/projects'),
        fetch('/api/entries?limit=500'), fetch('/api/scheduled-items'),
      ]);
      if (pRes.ok) setPrograms(await pRes.json());
      if (gRes.ok) setGoals(await gRes.json());
      if (prRes.ok) setProjects(await prRes.json());
      if (eRes.ok) setEntries(await eRes.json());
      if (sRes.ok) setScheduledItems(await sRes.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Pin/star toggle for entry rows (Task 14.3)
  async function handleToggleEntryPin(entryId: number, currentPinned: number | undefined, e: React.MouseEvent) {
    e.stopPropagation();
    const newVal = currentPinned ? 0 : 1;
    try {
      const res = await fetch(`/api/entries/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_pinned: newVal }),
      });
      if (res.ok) {
        setEntries(prev => prev.map(en => en.id === entryId ? { ...en, is_pinned: newVal } : en));
      }
    } catch { /* ignore */ }
  }

  // Individual task completion with flash (Task 20.8)
  async function handleQuickCompleteTask(taskId: number, dueDate: string | null, e: React.MouseEvent) {
    e.stopPropagation();
    setCompletingTaskIds(prev => { const next = new Set(prev); next.add(taskId); return next; });
    try {
      const res = await fetch(`/api/scheduled-items/${taskId}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: dueDate, notes: null }),
      });
      if (res.ok) {
        setCompletedFlashIds(prev => { const next = new Set(prev); next.add(taskId); return next; });
        setTimeout(() => {
          setCompletedFlashIds(prev => { const next = new Set(prev); next.delete(taskId); return next; });
          fetchAll();
        }, 800);
      }
    } catch { /* ignore */ }
    finally { setCompletingTaskIds(prev => { const next = new Set(prev); next.delete(taskId); return next; }); }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (newDropdownRef.current && !newDropdownRef.current.contains(e.target as Node)) {
        setShowNewDropdown(false);
      }
    }
    if (showNewDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showNewDropdown]);

  // Search filtering: when search changes, save expansion state and expand matching items
  useEffect(() => {
    if (searchQuery.trim()) {
      // Save current expansion state before first search
      if (!preSearchExpansion) {
        setPreSearchExpansion({
          programs: new Set(expandedPrograms),
          goals: new Set(expandedGoals),
          projects: new Set(expandedProjects),
        });
      }
      // Expand programs/goals/projects that contain matching items
      const q = searchQuery.toLowerCase();
      const matchingProgramIds = new Set<number>();
      const matchingGoalIds = new Set<number>();
      const matchingProjectIds = new Set<number>();

      programs.forEach(p => {
        if (p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q))) matchingProgramIds.add(p.id);
      });
      goals.forEach(g => {
        if (g.title.toLowerCase().includes(q) || (g.description && g.description.toLowerCase().includes(q))) {
          matchingGoalIds.add(g.id);
          if (g.program_id) matchingProgramIds.add(g.program_id);
        }
      });
      projects.forEach(p => {
        if (p.name.toLowerCase().includes(q) || entries.some(e => e.project_id === p.id && e.title.toLowerCase().includes(q))) {
          matchingProjectIds.add(p.id);
          if (p.program_id) matchingProgramIds.add(p.program_id);
          if (p.goal_id) {
            matchingGoalIds.add(p.goal_id);
            const goal = goals.find(g => g.id === p.goal_id);
            if (goal?.program_id) matchingProgramIds.add(goal.program_id);
          }
        }
        // Also check entries from the separate entries array (list endpoint returns entries: [])
        if (entries.some(e => e.project_id === p.id && e.title.toLowerCase().includes(q))) {
          matchingProjectIds.add(p.id);
          if (p.program_id) matchingProgramIds.add(p.program_id);
          if (p.goal_id) {
            matchingGoalIds.add(p.goal_id);
            const goal = goals.find(g => g.id === p.goal_id);
            if (goal?.program_id) matchingProgramIds.add(goal.program_id);
          }
        }
      });
      // Also search task names — expand parent project and program when a task matches
      scheduledItems.forEach(item => {
        if (item.name.toLowerCase().includes(q)) {
          if (item.project_id) {
            matchingProjectIds.add(item.project_id);
            const proj = projects.find(pr => pr.id === item.project_id);
            if (proj?.program_id) matchingProgramIds.add(proj.program_id);
            if (proj?.goal_id) {
              matchingGoalIds.add(proj.goal_id);
              const goal = goals.find(g => g.id === proj.goal_id);
              if (goal?.program_id) matchingProgramIds.add(goal.program_id);
            }
          }
          if (item.program_id) matchingProgramIds.add(item.program_id);
        }
      });

      setExpandedPrograms(matchingProgramIds);
      setExpandedGoals(matchingGoalIds);
      setExpandedProjects(matchingProjectIds);
    } else if (preSearchExpansion) {
      // Restore previous expansion state
      setExpandedPrograms(preSearchExpansion.programs);
      setExpandedGoals(preSearchExpansion.goals);
      setExpandedProjects(preSearchExpansion.projects);
      setPreSearchExpansion(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Inline task edit panel — shared hook (with Complete with Details)
  const {
    inlineTaskId,
    loadInlineTask: hookLoadInlineTask, closeInlineTask: closeTask,
    renderInlineTaskPanel,
  } = useInlineTask({ onMutate: fetchAll });

  // Inline cadence edit panel — edit-only mode (no Complete/Skip)
  const {
    inlineTaskId: inlineCadenceId,
    loadInlineTask: hookLoadCadence, closeInlineTask: closeCadence,
    renderInlineTaskPanel: renderCadencePanel,
  } = useInlineTask({ onMutate: fetchAll, editOnly: true });

  // Inline entry detail/edit panel — shared hook
  const {
    inlineEntryId,
    loadInlineEntry: hookLoadInlineEntry, closeInlineEntry: closeEntry,
    renderInlineEntryPanel,
  } = useInlineEntry({ onMutate: fetchAll, onNavigateToTab });

  /* Debounce-write expanded sets to localStorage (R6.2) */
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      patchAppState({
        portfolioView: {
          expandedPrograms: [...expandedPrograms],
          expandedGoals: [...expandedGoals],
          expandedProjects: [...expandedProjects],
          showCompleted,
        },
      });
    }, 300);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [expandedPrograms, expandedGoals, expandedProjects, showCompleted]);

  // ── Inline entry loader — wraps hook to close task panel ──
  async function loadInlineEntry(id: number) {
    closeTask();
    hookLoadInlineEntry(id);
  }

  // ── Inline task loader — wraps hook to close entry panel ──
  async function loadInlineTask(id: number) {
    closeEntry();
    closeCadence();
    hookLoadInlineTask(id);
  }

  // ── Inline cadence loader — wraps hook to close other panels ──
  async function loadCadence(id: number) {
    closeEntry();
    closeTask();
    hookLoadCadence(id);
  }

  // ── Inline project edit loader ──
  async function loadProjectForEdit(id: number) {
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        setEditingProjectId(id);
        setProjectEditData({
          name: data.name ?? '',
          description: data.description ?? '',
          status: data.status ?? 'active',
          program_id: data.program_id ?? '',
          goal_id: data.goal_id ?? '',
          start_date: data.start_date ?? '',
          target_end_date: data.target_end_date ?? '',
          metrics: data.metrics ?? '',
        });
        setProjectStakeholders(data.stakeholders ?? []);
        setStakeholderSearch('');
        setStakeholderResults([]);
        setNewStakeholderName('');
        setNewStakeholderEmail('');
        setNewStakeholderRole('');
      }
    } catch { /* ignore */ }
  }

  async function handleProjectEditSave() {
    if (!editingProjectId || !projectEditData) return;
    try {
      const body: Record<string, unknown> = {
        name: projectEditData.name,
        description: projectEditData.description,
        status: projectEditData.status,
        program_id: projectEditData.program_id || 0,
        goal_id: projectEditData.goal_id || 0,
        start_date: projectEditData.start_date || null,
        target_end_date: projectEditData.target_end_date || null,
        metrics: projectEditData.metrics,
      };
      const res = await fetch(`/api/projects/${editingProjectId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) { setEditingProjectId(null); setProjectEditData(null); fetchAll(); }
    } catch { /* ignore */ }
  }

  async function handleProjectDelete(projectId: number) {
    if (!confirm('Delete this project? Linked entries will be unlinked but not deleted. This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) { setEditingProjectId(null); setProjectEditData(null); fetchAll(); }
    } catch { /* ignore */ }
  }

  // ── Stakeholder helpers ──
  async function handleUnlinkStakeholder(projectId: number, stakeholderId: number) {
    try {
      const res = await fetch(`/api/projects/${projectId}/stakeholders/${stakeholderId}`, { method: 'DELETE' });
      if (res.ok) {
        setProjectStakeholders(prev => prev.filter(s => s.id !== stakeholderId));
      }
    } catch { /* ignore */ }
  }

  async function searchStakeholders(query: string) {
    setStakeholderSearch(query);
    if (!query.trim()) { setStakeholderResults([]); return; }
    try {
      const res = await fetch('/api/stakeholders');
      if (res.ok) {
        const all: StakeholderResponse[] = await res.json();
        const q = query.toLowerCase();
        setStakeholderResults(all.filter(s =>
          s.name.toLowerCase().includes(q) &&
          !projectStakeholders.some(ps => ps.id === s.id)
        ));
      }
    } catch { setStakeholderResults([]); }
  }

  async function handleLinkStakeholder(projectId: number, stakeholderId: number) {
    try {
      const res = await fetch(`/api/projects/${projectId}/stakeholders/${stakeholderId}`, {
        method: 'POST',
      });
      if (res.ok) {
        const linked = stakeholderResults.find(s => s.id === stakeholderId);
        if (linked) setProjectStakeholders(prev => [...prev, linked]);
        setStakeholderSearch('');
        setStakeholderResults([]);
      }
    } catch { /* ignore */ }
  }

  async function handleAddNewStakeholder(projectId: number) {
    if (!newStakeholderName.trim()) return;
    try {
      const createRes = await fetch('/api/stakeholders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newStakeholderName.trim(),
          email: newStakeholderEmail.trim() || null,
          role: newStakeholderRole.trim() || null,
        }),
      });
      if (createRes.ok) {
        const created: StakeholderResponse = await createRes.json();
        const linkRes = await fetch(`/api/projects/${projectId}/stakeholders/${created.id}`, {
          method: 'POST',
        });
        if (linkRes.ok) {
          setProjectStakeholders(prev => [...prev, created]);
          setNewStakeholderName('');
          setNewStakeholderEmail('');
          setNewStakeholderRole('');
        }
      }
    } catch { /* ignore */ }
  }

  // ── Program edit/delete handlers ──
  async function loadProgramForEdit(id: number) {
    try {
      const res = await fetch(`/api/programs/${id}`);
      if (res.ok) {
        const data = await res.json();
        setEditingProgramId(id);
        setProgramEditData({
          name: data.name ?? '',
          description: data.description ?? '',
          program_type: data.program_type ?? 'Primary',
          status: data.status ?? 'active',
          color: data.color ?? '',
          owner: data.owner ?? '',
        });
      }
    } catch { /* ignore */ }
  }

  async function handleProgramEditSave() {
    if (!editingProgramId || !programEditData) return;
    try {
      const body: Record<string, unknown> = {
        name: programEditData.name,
        description: programEditData.description,
        program_type: programEditData.program_type || 'Primary',
        status: programEditData.status,
        color: programEditData.color || null,
        owner: programEditData.owner || null,
      };
      const res = await fetch(`/api/programs/${editingProgramId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) { setEditingProgramId(null); setProgramEditData(null); fetchAll(); }
    } catch { /* ignore */ }
  }

  async function handleProgramDelete(id: number) {
    if (!window.confirm('Are you sure you want to delete this program? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/programs/${id}`, { method: 'DELETE' });
      if (res.ok) { setEditingProgramId(null); setProgramEditData(null); fetchAll(); }
    } catch { /* ignore */ }
  }

  // ── Goal edit loader ──
  async function loadGoalForEdit(id: number) {
    try {
      const res = await fetch(`/api/goals/${id}`);
      if (res.ok) {
        const data = await res.json();
        setEditingGoalId(id);
        setGoalEditData({
          title: data.title ?? '',
          description: data.description ?? '',
          status: data.status ?? 'on_track',
          specific: data.specific ?? '',
          measurable: data.measurable ?? '',
          achievable: data.achievable ?? '',
          relevant: data.relevant ?? '',
          time_bound: data.time_bound ?? '',
          target_date: data.target_date ?? '',
          program_id: data.program_id ?? '',
        });
      }
    } catch { /* ignore */ }
  }

  async function handleGoalEditSave() {
    if (!editingGoalId || !goalEditData) return;
    try {
      const body: Record<string, unknown> = {
        title: goalEditData.title,
        description: goalEditData.description,
        status: goalEditData.status,
        specific: goalEditData.specific,
        measurable: goalEditData.measurable,
        achievable: goalEditData.achievable,
        relevant: goalEditData.relevant,
        time_bound: goalEditData.time_bound,
        target_date: goalEditData.target_date || null,
        program_id: goalEditData.program_id || 0,
      };
      const res = await fetch(`/api/goals/${editingGoalId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) { setEditingGoalId(null); setGoalEditData(null); fetchAll(); }
    } catch { /* ignore */ }
  }

  async function handleGoalDelete(goalId: number) {
    if (!confirm('Delete this goal? Linked projects will be unlinked but not deleted. This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/goals/${goalId}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) { setEditingGoalId(null); setGoalEditData(null); fetchAll(); }
    } catch { /* ignore */ }
  }

  // ── Render inline goal edit form ──
  function renderGoalEditForm(goalId: number) {
    if (editingGoalId !== goalId || !goalEditData) return null;
    return (
      <div style={inlinePanelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-goal)' }}>Edit Goal</span>
          <button style={inlineBtnStyle('var(--input-bg)', 'var(--text-muted)')}
            onClick={() => { setEditingGoalId(null); setGoalEditData(null); }}>✕ Close</button>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Title</label>
            <input style={{ ...inlineInputStyle, width: '100%' }} value={goalEditData.title}
              aria-label="Goal title"
              onChange={e => setGoalEditData({ ...goalEditData, title: e.target.value })} />
          </div>
          <div style={{ flex: '0 0 140px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Status</label>
            <select style={{ ...inlineInputStyle, width: '100%', cursor: 'pointer' }} value={goalEditData.status}
              aria-label="Goal status"
              onChange={e => setGoalEditData({ ...goalEditData, status: e.target.value })}>
              <option value="on_track">On Track</option>
              <option value="at_risk">At Risk</option>
              <option value="behind">Behind</option>
              <option value="completed">Completed</option>
              <option value="paused">Paused</option>
            </select>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Program</label>
            <select style={{ ...inlineInputStyle, width: '100%', cursor: 'pointer' }} value={goalEditData.program_id}
              aria-label="Goal program"
              onChange={e => setGoalEditData({ ...goalEditData, program_id: e.target.value ? parseInt(e.target.value, 10) : '' })}>
              <option value="">— None —</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Description</label>
          <textarea style={{ ...inlineInputStyle, width: '100%', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
            value={goalEditData.description}
            aria-label="Goal description"
            onChange={e => setGoalEditData({ ...goalEditData, description: e.target.value })} />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Target Date</label>
          <input type="date" style={{ ...inlineInputStyle, width: '180px' }} value={goalEditData.target_date}
            aria-label="Goal target date"
            onChange={e => setGoalEditData({ ...goalEditData, target_date: e.target.value })} />
        </div>
        {/* SMART Fields */}
        <div style={{ marginBottom: '10px', paddingTop: '8px', borderTop: '1px solid var(--card-border)' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SMART Fields</span>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Specific</label>
          <textarea style={{ ...inlineInputStyle, width: '100%', minHeight: '40px', resize: 'vertical', fontFamily: 'inherit' }}
            value={goalEditData.specific}
            aria-label="Goal specific (SMART)"
            onChange={e => setGoalEditData({ ...goalEditData, specific: e.target.value })} />
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Measurable</label>
          <textarea style={{ ...inlineInputStyle, width: '100%', minHeight: '40px', resize: 'vertical', fontFamily: 'inherit' }}
            value={goalEditData.measurable}
            aria-label="Goal measurable (SMART)"
            onChange={e => setGoalEditData({ ...goalEditData, measurable: e.target.value })} />
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Achievable</label>
          <textarea style={{ ...inlineInputStyle, width: '100%', minHeight: '40px', resize: 'vertical', fontFamily: 'inherit' }}
            value={goalEditData.achievable}
            aria-label="Goal achievable (SMART)"
            onChange={e => setGoalEditData({ ...goalEditData, achievable: e.target.value })} />
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Relevant</label>
          <textarea style={{ ...inlineInputStyle, width: '100%', minHeight: '40px', resize: 'vertical', fontFamily: 'inherit' }}
            value={goalEditData.relevant}
            aria-label="Goal relevant (SMART)"
            onChange={e => setGoalEditData({ ...goalEditData, relevant: e.target.value })} />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Time-bound</label>
          <textarea style={{ ...inlineInputStyle, width: '100%', minHeight: '40px', resize: 'vertical', fontFamily: 'inherit' }}
            value={goalEditData.time_bound}
            aria-label="Goal time-bound (SMART)"
            onChange={e => setGoalEditData({ ...goalEditData, time_bound: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button style={inlineBtnStyle('var(--button-primary-bg)', 'var(--text-on-primary)')} onClick={handleGoalEditSave}>Save</button>
          <button style={inlineBtnStyle('var(--input-bg)', 'var(--text-secondary)')}
            onClick={() => { setEditingGoalId(null); setGoalEditData(null); }}>Close</button>
          <span style={{ flex: 1 }} />
          <button style={{ ...inlineBtnStyle('transparent', 'var(--accent-danger)'), fontSize: '11px' }}
            onClick={() => handleGoalDelete(goalId)}>Delete Goal</button>
        </div>
      </div>
    );
  }

  // ── Render inline program edit form ──
  function renderProgramEditForm(progId: number) {
    if (editingProgramId !== progId || !programEditData) return null;
    return (
      <div style={inlinePanelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-program)' }}>Edit Program</span>
          <button style={inlineBtnStyle('var(--input-bg)', 'var(--text-muted)')}
            onClick={() => { setEditingProgramId(null); setProgramEditData(null); }}>✕ Close</button>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Name</label>
            <input style={{ ...inlineInputStyle, width: '100%' }} value={programEditData.name}
              aria-label="Program name"
              onChange={e => setProgramEditData({ ...programEditData, name: e.target.value })} />
          </div>
          <div style={{ flex: '0 0 140px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Status</label>
            <select style={{ ...inlineInputStyle, width: '100%', cursor: 'pointer' }} value={programEditData.status}
              aria-label="Program status"
              onChange={e => setProgramEditData({ ...programEditData, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="sunset">Sunset</option>
            </select>
          </div>
          <div style={{ flex: '0 0 160px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Program Type</label>
            <select style={{ ...inlineInputStyle, width: '100%', cursor: 'pointer' }} value={programEditData.program_type}
              aria-label="Program type"
              onChange={e => setProgramEditData({ ...programEditData, program_type: e.target.value })}>
              {PROGRAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Description</label>
          <textarea style={{ ...inlineInputStyle, width: '100%', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
            value={programEditData.description}
            aria-label="Program description"
            onChange={e => setProgramEditData({ ...programEditData, description: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Owner</label>
            <input style={{ ...inlineInputStyle, width: '100%' }} value={programEditData.owner}
              placeholder="Owner name…"
              aria-label="Program owner"
              onChange={e => setProgramEditData({ ...programEditData, owner: e.target.value })} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Color</label>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
              {PRESET_COLORS.map(c => (
                <span key={c} onClick={() => setProgramEditData({ ...programEditData, color: c })}
                  style={{ width: '20px', height: '20px', borderRadius: '4px', background: c, cursor: 'pointer',
                    border: programEditData.color === c ? '2px solid var(--text-primary)' : '2px solid transparent' }} />
              ))}
              <input style={{ ...inlineInputStyle, width: '80px', marginLeft: '4px' }} value={programEditData.color}
                placeholder="#hex" aria-label="Program color hex code" onChange={e => setProgramEditData({ ...programEditData, color: e.target.value })} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button style={inlineBtnStyle('var(--button-primary-bg)', 'var(--text-on-primary)')} onClick={handleProgramEditSave}>Save</button>
          <button style={inlineBtnStyle('var(--input-bg)', 'var(--text-secondary)')}
            onClick={() => { setEditingProgramId(null); setProgramEditData(null); }}>Close</button>
          <button style={{ ...inlineBtnStyle('transparent', 'var(--accent-danger)'), marginLeft: 'auto' }}
            onClick={() => handleProgramDelete(progId)}>Delete Program</button>
        </div>
      </div>
    );
  }

  // ── Render inline project edit form ──
  function renderProjectEditForm(projId: number) {
    if (editingProjectId !== projId || !projectEditData) return null;
    const progGoalsForEdit = goals.filter(g => !projectEditData.program_id || g.program_id === Number(projectEditData.program_id) || !g.program_id);
    return (
      <div style={inlinePanelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-project)' }}>Edit Project</span>
          <button style={inlineBtnStyle('var(--input-bg)', 'var(--text-muted)')}
            onClick={() => { setEditingProjectId(null); setProjectEditData(null); }}>✕ Close</button>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Name</label>
            <input style={{ ...inlineInputStyle, width: '100%' }} value={projectEditData.name}
              aria-label="Project name"
              onChange={e => setProjectEditData({ ...projectEditData, name: e.target.value })} />
          </div>
          <div style={{ flex: '0 0 140px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Status</label>
            <select style={{ ...inlineInputStyle, width: '100%', cursor: 'pointer' }} value={projectEditData.status}
              aria-label="Project status"
              onChange={e => setProjectEditData({ ...projectEditData, status: e.target.value })}>
              <option value="planning">Planning</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="paused">Paused</option>
            </select>
          </div>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Description</label>
          <textarea style={{ ...inlineInputStyle, width: '100%', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
            value={projectEditData.description}
            aria-label="Project description"
            onChange={e => setProjectEditData({ ...projectEditData, description: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Program</label>
            <select style={{ ...inlineInputStyle, width: '100%', cursor: 'pointer' }} value={projectEditData.program_id}
              aria-label="Project program"
              onChange={e => setProjectEditData({ ...projectEditData, program_id: e.target.value ? parseInt(e.target.value, 10) : '' })}>
              <option value="">— None —</option>
              {programs.filter(p => p.status === 'active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Goal</label>
            <select style={{ ...inlineInputStyle, width: '100%', cursor: 'pointer' }} value={projectEditData.goal_id}
              aria-label="Project goal"
              onChange={e => setProjectEditData({ ...projectEditData, goal_id: e.target.value ? parseInt(e.target.value, 10) : '' })}>
              <option value="">— None —</option>
              {progGoalsForEdit.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Start Date</label>
            <input type="date" style={{ ...inlineInputStyle, width: '160px' }} value={projectEditData.start_date}
              aria-label="Project start date"
              onChange={e => setProjectEditData({ ...projectEditData, start_date: e.target.value })} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Target End Date</label>
            <input type="date" style={{ ...inlineInputStyle, width: '160px' }} value={projectEditData.target_end_date}
              aria-label="Project target end date"
              onChange={e => setProjectEditData({ ...projectEditData, target_end_date: e.target.value })} />
          </div>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Metrics</label>
          <textarea style={{ ...inlineInputStyle, width: '100%', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
            value={projectEditData.metrics}
            placeholder="Key metrics, KPIs, or success criteria…"
            aria-label="Project metrics"
            onChange={e => setProjectEditData({ ...projectEditData, metrics: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={inlineBtnStyle('var(--button-primary-bg)', 'var(--text-on-primary)')} onClick={handleProjectEditSave}>Save</button>
          <button style={inlineBtnStyle('var(--input-bg)', 'var(--text-secondary)')}
            onClick={() => { setEditingProjectId(null); setProjectEditData(null); }}>Close</button>
          {!projectEditData.goal_id && (
            <button style={inlineBtnStyle('var(--color-goal)', '#fff')}
              onClick={() => {
                const proj = projects.find(p => p.id === projId);
                if (proj) setPromoteToGoalProject({ id: proj.id, name: proj.name, description: projectEditData.description || null, program_id: proj.program_id });
              }}>Promote to Goal</button>
          )}
          <span style={{ flex: 1 }} />
          <button style={{ ...inlineBtnStyle('transparent', 'var(--accent-danger)'), fontSize: '11px' }}
            onClick={() => handleProjectDelete(projId)}>Delete Project</button>
        </div>
        {/* Project Updates & Tasks section */}
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--card-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Project Updates</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button style={inlineBtnStyle('var(--input-bg)', 'var(--color-entry)')}
                onClick={() => {
                  const proj = projects.find(p => p.id === projId);
                  const progId = proj ? resolveProjectProgram(proj) : undefined;
                  onNavigateToQuickCapture?.(undefined, progId ?? undefined, projId);
                }}>+ Add Project Update</button>
              <button style={inlineBtnStyle('var(--input-bg)', 'var(--color-task)')}
                onClick={() => {
                  const proj = projects.find(p => p.id === projId);
                  const progId = proj ? resolveProjectProgram(proj) : undefined;
                  onNavigateToQuickCapture?.(undefined, progId ?? undefined, projId, true);
                }}>+ Add Task</button>
              <button style={inlineBtnStyle('var(--input-bg)', 'var(--color-cadence)')}
                onClick={() => {
                  const proj = projects.find(p => p.id === projId);
                  const progId = proj ? resolveProjectProgram(proj) : undefined;
                  onNavigateToQuickCapture?.(undefined, progId ?? undefined, projId, false, true);
                }}>+ Add Cadence</button>
            </div>
          </div>
          {(entriesByProject[projId] ?? []).length > 0 || (tasksByProject[projId] ?? []).length > 0 || (cadenceByProject[projId] ?? []).length > 0 ? (
            <div>
              {(entriesByProject[projId] ?? []).slice(0, 10).map(entry => {
                const ti = TYPE_ICON[entry.entry_type] ?? DEFAULT_ICON;
                return (
                  <div key={entry.id}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '3px 0', cursor: 'pointer',
                      background: inlineEntryId === entry.id ? 'var(--input-bg)' : 'transparent',
                      borderRadius: '4px', fontSize: '12px',
                    }} onClick={() => loadInlineEntry(entry.id)}
                      tabIndex={0} role="button" aria-label={`Entry: ${entry.title}`}
                      onKeyDown={e => handleActivateKey(e, () => loadInlineEntry(entry.id))}>
                      <span style={{ color: ti.color }}>{ti.icon}</span>
                      <span style={{ color: 'var(--text-primary)', flex: 1 }}>{entry.title}</span>
                      <button
                        title={entry.is_pinned ? 'Unpin' : 'Pin'}
                        onClick={(e) => handleToggleEntryPin(entry.id, entry.is_pinned, e)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '12px', lineHeight: 1, color: entry.is_pinned ? 'var(--icon-star)' : 'var(--text-muted)' }}
                      >{entry.is_pinned ? '★' : '☆'}</button>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{entry.entry_date}</span>
                    </div>
                    {renderInlineEntryPanel(entry.id)}
                  </div>
                );
              })}
              {(tasksByProject[projId] ?? []).map(task => (
                <div key={`task-${task.id}`}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '3px 0', fontSize: '12px', cursor: 'pointer',
                    background: completedFlashIds.has(task.id) ? 'rgba(74, 222, 128, 0.15)' : inlineTaskId === task.id ? 'var(--input-bg)' : 'transparent',
                    borderRadius: '4px', transition: 'background 0.3s ease',
                  }} onClick={() => loadInlineTask(task.id)}
                    tabIndex={0} role="button" aria-label={`Task: ${task.name}`}
                    onKeyDown={e => handleActivateKey(e, () => loadInlineTask(task.id))}>
                    <button
                      onClick={(e) => handleQuickCompleteTask(task.id, task.due_date, e)}
                      disabled={completingTaskIds.has(task.id)}
                      title="Complete task"
                      style={{ background: 'none', border: '1.5px solid var(--btn-complete-bg)', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: '10px', color: 'var(--btn-complete-bg)', flexShrink: 0 }}
                    >{completedFlashIds.has(task.id) ? '✓' : completingTaskIds.has(task.id) ? '…' : ''}</button>
                    <span style={{ color: 'var(--text-primary)', flex: 1 }}>{task.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontStyle: task.due_date ? 'normal' : 'italic' }}>{task.due_date || 'No date'}</span>
                    <button onClick={e => { e.stopPropagation(); loadInlineTask(task.id); }} style={{
                      padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                      cursor: 'pointer', background: 'transparent', color: 'var(--color-task)',
                      border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
                    }}>Edit</button>
                  </div>
                  {renderInlineTaskPanel(task.id)}
                </div>
              ))}
              {(cadenceByProject[projId] ?? []).map(item => (
                <div key={`cadence-${item.id}`}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '3px 0', fontSize: '12px', cursor: 'pointer',
                    background: inlineCadenceId === item.id ? 'var(--input-bg)' : 'transparent',
                    borderRadius: '4px',
                  }} onClick={() => loadCadence(item.id)}
                    tabIndex={0} role="button" aria-label={`Cadence: ${item.name}`}
                    onKeyDown={e => handleActivateKey(e, () => loadCadence(item.id))}>
                    <span style={{ width: '16px', height: '16px', borderRadius: '50%', border: '1.5px solid var(--color-cadence)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'var(--color-cadence)', flexShrink: 0 }}>↻</span>
                    <span style={{ color: 'var(--text-primary)', flex: 1 }}>{item.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{describeSchedule(item)}</span>
                    <button onClick={e => { e.stopPropagation(); loadCadence(item.id); }} style={{
                      padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                      cursor: 'pointer', background: 'transparent', color: 'var(--color-cadence)',
                      border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
                    }}>Edit</button>
                  </div>
                  {renderCadencePanel(item.id)}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No entries yet</div>
          )}
        </div>
        {/* Stakeholders section */}
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--card-border)' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Stakeholders</span>
          {/* Current stakeholders */}
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {projectStakeholders.length === 0 && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No stakeholders linked</div>
            )}
            {projectStakeholders.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', background: 'var(--input-bg)', borderRadius: '6px', fontSize: '12px' }}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, flex: 1 }}>{s.name}</span>
                {s.email && <span style={{ color: 'var(--text-muted)' }}>{s.email}</span>}
                {s.role && <span style={{ color: 'var(--accent-secondary)' }}>{s.role}</span>}
                <button style={{ ...inlineBtnStyle('transparent', 'var(--accent-danger)'), padding: '2px 6px', fontSize: '10px' }}
                  onClick={() => handleUnlinkStakeholder(projId, s.id)}>Unlink</button>
              </div>
            ))}
          </div>
          {/* Search existing stakeholders */}
          <div style={{ marginTop: '8px', position: 'relative' }}>
            <input style={{ ...inlineInputStyle, width: '100%' }}
              value={stakeholderSearch}
              onChange={e => searchStakeholders(e.target.value)}
              placeholder="Search existing stakeholders…"
              aria-label="Search stakeholders" />
            {stakeholderResults.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)', maxHeight: '150px', overflowY: 'auto' }}>
                {stakeholderResults.map(s => (
                  <div key={s.id} style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '12px',
                    display: 'flex', gap: '8px', alignItems: 'center' }}
                    onClick={() => handleLinkStakeholder(projId, s.id)}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.name}</span>
                    {s.email && <span style={{ color: 'var(--text-muted)' }}>{s.email}</span>}
                    {s.role && <span style={{ color: 'var(--accent-secondary)' }}>{s.role}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Add new stakeholder */}
          <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>Name *</label>
              <input style={{ ...inlineInputStyle, width: '100%' }}
                value={newStakeholderName} onChange={e => setNewStakeholderName(e.target.value)}
                placeholder="Name" aria-label="New stakeholder name" />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>Email</label>
              <input style={{ ...inlineInputStyle, width: '100%' }}
                value={newStakeholderEmail} onChange={e => setNewStakeholderEmail(e.target.value)}
                placeholder="Email (optional)" aria-label="New stakeholder email" />
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>Role</label>
              <input style={{ ...inlineInputStyle, width: '100%' }}
                value={newStakeholderRole} onChange={e => setNewStakeholderRole(e.target.value)}
                placeholder="Role (optional)" aria-label="New stakeholder role" />
            </div>
            <button style={{ ...inlineBtnStyle('var(--button-primary-bg)', 'var(--text-on-primary)'), opacity: newStakeholderName.trim() ? 1 : 0.5 }}
              onClick={() => handleAddNewStakeholder(projId)}
              disabled={!newStakeholderName.trim()}>+ Add</button>
          </div>
        </div>
      </div>
    );
  }

  /** Keyboard handler for Enter/Space on interactive div elements */
  function handleActivateKey(e: React.KeyboardEvent, action: () => void) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  }

  /** Bulk complete all selected tasks */
  async function handleBulkComplete() {
    if (bulkCompleting || selectedTaskIds.size === 0) return;
    setBulkCompleting(true);
    setBulkError(null);
    const ids = [...selectedTaskIds];
    for (const taskId of ids) {
      try {
        const task = scheduledItems.find(s => s.id === taskId);
        const res = await fetch(`/api/scheduled-items/${taskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ due_date: task?.due_date ?? null, notes: null }),
        });
        if (!res.ok) {
          const taskName = task?.name ?? `ID ${taskId}`;
          setBulkError(`Failed to complete task: "${taskName}"`);
          setBulkCompleting(false);
          return;
        }
      } catch {
        const task = scheduledItems.find(s => s.id === taskId);
        const taskName = task?.name ?? `ID ${taskId}`;
        setBulkError(`Failed to complete task: "${taskName}"`);
        setBulkCompleting(false);
        return;
      }
    }
    setSelectedTaskIds(new Set());
    setBulkCompleting(false);
    await fetchAll();
  }

  const toggleProgram = (id: number) => {
    setExpandedPrograms(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleGoal = (id: number) => {
    setExpandedGoals(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleProject = (id: number) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Resolve goal → program mapping
  const goalProgramMap: Record<number, number | null> = {};
  goals.forEach(g => { goalProgramMap[g.id] = g.program_id; });

  // Resolve project → program (via goal chain or direct)
  function resolveProjectProgram(proj: Project): number | null {
    if (proj.program_id) return proj.program_id;
    if (proj.goal_id && goalProgramMap[proj.goal_id]) return goalProgramMap[proj.goal_id]!;
    return null;
  }

  // Goal status priority for sorting (on_track first, paused last)
  const GOAL_STATUS_PRIORITY: Record<string, number> = {
    on_track: 0, at_risk: 1, behind: 2, completed: 3, paused: 4,
  };

  // Group goals by program
  // Hide completed goals unless the toggle is on
  const goalsByProgram: Record<number, Goal[]> = {};
  const unassignedGoals: Goal[] = [];
  goals.filter(g => showCompleted || g.status !== 'completed').forEach(g => {
    if (g.program_id) {
      (goalsByProgram[g.program_id] ??= []).push(g);
    } else {
      unassignedGoals.push(g);
    }
  });

  // Sort goals by status priority, then alphabetically by title
  for (const key of Object.keys(goalsByProgram)) {
    goalsByProgram[Number(key)].sort((a, b) => {
      const pa = GOAL_STATUS_PRIORITY[a.status] ?? 99;
      const pb = GOAL_STATUS_PRIORITY[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.title.localeCompare(b.title);
    });
  }
  unassignedGoals.sort((a, b) => {
    const pa = GOAL_STATUS_PRIORITY[a.status] ?? 99;
    const pb = GOAL_STATUS_PRIORITY[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });

  // Group projects by goal AND track direct-to-program projects (no goal)
  // Hide completed projects unless the toggle is on
  const projectsByGoal: Record<number, Project[]> = {};
  const directProjectsByProgram: Record<number, Project[]> = {};
  const unassignedProjects: Project[] = [];
  projects.filter(p => showCompleted || p.status !== 'completed').forEach(p => {
    if (p.goal_id) {
      (projectsByGoal[p.goal_id] ??= []).push(p);
    } else {
      const progId = resolveProjectProgram(p);
      if (progId) {
        (directProjectsByProgram[progId] ??= []).push(p);
      } else {
        unassignedProjects.push(p);
      }
    }
  });

  // Sort all project lists alphabetically
  for (const key of Object.keys(projectsByGoal)) {
    projectsByGoal[Number(key)].sort((a, b) => a.name.localeCompare(b.name));
  }
  for (const key of Object.keys(directProjectsByProgram)) {
    directProjectsByProgram[Number(key)].sort((a, b) => a.name.localeCompare(b.name));
  }
  unassignedProjects.sort((a, b) => a.name.localeCompare(b.name));

  // Group entries by project
  const entriesByProject: Record<number, EntryBrief[]> = {};
  const directEntriesByProgram: Record<number, EntryBrief[]> = {};
  const unassignedEntries: EntryBrief[] = [];
  entries.forEach(e => {
    if (e.project_id) {
      (entriesByProject[e.project_id] ??= []).push(e);
    } else if (e.program_id) {
      (directEntriesByProgram[e.program_id] ??= []).push(e);
    } else {
      unassignedEntries.push(e);
    }
  });

  // Sort entries within each project by entry_date descending (newest first)
  for (const key of Object.keys(entriesByProject)) {
    entriesByProject[Number(key)].sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }

  // Cadence items by program and by project
  const cadenceByProgram: Record<number, ScheduledItem[]> = {};
  const cadenceByProject: Record<number, ScheduledItem[]> = {};
  scheduledItems.filter(s => s.item_class === 'cadence' && s.status === 'active').forEach(s => {
    if (s.project_id) {
      (cadenceByProject[s.project_id] ??= []).push(s);
    } else if (s.program_id) {
      (cadenceByProgram[s.program_id] ??= []).push(s);
    }
  });

  // Task items by program (active tasks with pending status)
  const tasksByProgram: Record<number, ScheduledItem[]> = {};
  const tasksByProject: Record<number, ScheduledItem[]> = {};
  const unassignedTasks: ScheduledItem[] = [];
  scheduledItems.filter(s => s.item_class === 'task' && s.status === 'active').forEach(s => {
    if (s.project_id) {
      (tasksByProject[s.project_id] ??= []).push(s);
    } else if (s.program_id) {
      (tasksByProgram[s.program_id] ??= []).push(s);
    } else {
      unassignedTasks.push(s);
    }
  });

  // Sort tasks within each project by due_date ascending, NULL due_dates last
  for (const key of Object.keys(tasksByProject)) {
    tasksByProject[Number(key)].sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      return 0;
    });
  }

  // Unassigned cadence items
  const unassignedCadence: ScheduledItem[] = [];
  scheduledItems.filter(s => s.item_class === 'cadence' && s.status === 'active' && !s.project_id && !s.program_id).forEach(s => {
    unassignedCadence.push(s);
  });

  // ── Compact project row helpers (Task 10.5) ──
  // State for per-project "+ Add" dropdown
  const [addDropdownProjectId, setAddDropdownProjectId] = useState<number | null>(null);
  const addDropdownRef = useRef<HTMLDivElement>(null);

  // Close add dropdown when clicking outside
  useEffect(() => {
    function handleClickOutsideAdd(e: MouseEvent) {
      if (addDropdownRef.current && !addDropdownRef.current.contains(e.target as Node)) {
        setAddDropdownProjectId(null);
      }
    }
    if (addDropdownProjectId !== null) {
      document.addEventListener('mousedown', handleClickOutsideAdd);
      return () => document.removeEventListener('mousedown', handleClickOutsideAdd);
    }
  }, [addDropdownProjectId]);

  /** Compute project health indicators */
  function getProjectIndicators(proj: Project) {
    const projEntries = entriesByProject[proj.id] ?? [];
    const projTasks = tasksByProject[proj.id] ?? [];
    const today = new Date().toISOString().slice(0, 10);

    // Overdue tasks: tasks with due_date < today
    const hasOverdueTasks = projTasks.some(t => t.due_date && t.due_date < today);

    // Last activity: most recent entry_date or "never"
    const lastActivityDate = projEntries.length > 0 ? projEntries[0].entry_date : null;

    // Stale: no activity in 14+ days — but NOT for completed or paused projects
    let isStale = false;
    if (proj.status !== 'completed' && proj.status !== 'paused') {
      if (lastActivityDate) {
        const lastDate = new Date(lastActivityDate);
        const diffDays = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        isStale = diffDays >= 14;
      } else {
        isStale = true; // No entries at all = stale (only for active/planning projects)
      }
    }

    // Recent entry titles (1-2 most recent)
    const recentTitles = projEntries.slice(0, 2).map(e => e.title);

    return { hasOverdueTasks, isStale, lastActivityDate, recentTitles, entryCount: projEntries.length };
  }

  /** Render a compact project row with indicators */
  function renderCompactProjectRow(proj: Project, progId: number | null) {
    const projExpanded = expandedProjects.has(proj.id);
    const projEntries = entriesByProject[proj.id] ?? [];
    const pCfg = STATUS_CONFIG[proj.status] ?? STATUS_CONFIG.active;
    const { hasOverdueTasks, isStale, lastActivityDate, recentTitles, entryCount } = getProjectIndicators(proj);

    return (
      <div key={proj.id} style={{ marginBottom: '6px' }}>
        {/* Compact project header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 0' }}
          onClick={() => toggleProject(proj.id)}
          tabIndex={0} role="button" aria-expanded={projExpanded} aria-label={`${proj.name} project`}
          onKeyDown={e => handleActivateKey(e, () => toggleProject(proj.id))}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{projExpanded ? '▼' : '▶'}</span>
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>{proj.name}</span>
          {/* Warning indicators */}
          {hasOverdueTasks && (
            <span style={{ fontSize: '10px', color: 'var(--status-behind, #e74c3c)', fontWeight: 600 }} title="Has overdue tasks">⚠</span>
          )}
          {isStale && (
            <span style={{ fontSize: '10px', color: 'var(--status-at-risk, #f39c12)', fontWeight: 600 }} title="No activity in 14+ days">⚠ Stale</span>
          )}
          <span style={{ fontSize: '10px', color: pCfg.color }}>{pCfg.label}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{entryCount} entries</span>
          {lastActivityDate && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Last: {lastActivityDate}</span>
          )}
          {/* Consolidated "+ Add" dropdown */}
          <div style={{ position: 'relative' }} ref={addDropdownProjectId === proj.id ? addDropdownRef : undefined}>
            <button onClick={e => { e.stopPropagation(); setAddDropdownProjectId(prev => prev === proj.id ? null : proj.id); }} style={{
              padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
              cursor: 'pointer', background: 'transparent', color: 'var(--accent-primary)',
              border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
            }}>+ Add</button>
            {addDropdownProjectId === proj.id && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 100,
                background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: '120px', padding: '4px 0',
              }}>
                <button onClick={e => { e.stopPropagation(); setAddDropdownProjectId(null); onNavigateToQuickCapture?.(undefined, progId ?? undefined, proj.id); }} style={{
                  display: 'block', width: '100%', padding: '6px 12px', fontSize: '11px', fontWeight: 500,
                  cursor: 'pointer', background: 'transparent', color: 'var(--color-entry)', border: 'none', textAlign: 'left',
                }}>Update</button>
                <button onClick={e => { e.stopPropagation(); setAddDropdownProjectId(null); onNavigateToQuickCapture?.(undefined, progId ?? undefined, proj.id, true); }} style={{
                  display: 'block', width: '100%', padding: '6px 12px', fontSize: '11px', fontWeight: 500,
                  cursor: 'pointer', background: 'transparent', color: 'var(--color-task)', border: 'none', textAlign: 'left',
                }}>Task</button>
                <button onClick={e => { e.stopPropagation(); setAddDropdownProjectId(null); onNavigateToQuickCapture?.(undefined, progId ?? undefined, proj.id, false, true); }} style={{
                  display: 'block', width: '100%', padding: '6px 12px', fontSize: '11px', fontWeight: 500,
                  cursor: 'pointer', background: 'transparent', color: 'var(--color-cadence)', border: 'none', textAlign: 'left',
                }}>Cadence</button>
              </div>
            )}
          </div>
          {projEntries.length > 0 && (
            <button onClick={e => { e.stopPropagation(); onNavigateToTab?.('Timeline', undefined, { projectId: proj.id }); }} style={{
              padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
              cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
            }}>View in Timeline</button>
          )}
          <button onClick={e => { e.stopPropagation(); loadProjectForEdit(proj.id); }} style={{
            padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
            cursor: 'pointer', background: 'transparent', color: 'var(--color-project)',
            border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
          }}>Edit</button>
        </div>

        {/* One-line preview of recent entries (when collapsed) */}
        {!projExpanded && recentTitles.length > 0 && (
          <div style={{ paddingLeft: '20px', fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
            {recentTitles.join(' · ')}
          </div>
        )}

        {projExpanded && renderProjectEditForm(proj.id)}

        {projExpanded && (projEntries.length > 0 || (tasksByProject[proj.id] ?? []).length > 0 || (cadenceByProject[proj.id] ?? []).length > 0) && (
          <div style={{ paddingLeft: '20px' }}>
            {projEntries.slice(0, 10).map(entry => {
              const ti = TYPE_ICON[entry.entry_type] ?? DEFAULT_ICON;
              return (
                <div key={entry.id}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '3px 0', cursor: 'pointer',
                    background: inlineEntryId === entry.id ? 'var(--input-bg)' : 'transparent',
                    borderRadius: '4px',
                  }} onClick={() => loadInlineEntry(entry.id)}
                    tabIndex={0} role="button" aria-label={`Entry: ${entry.title}`}
                    onKeyDown={e => handleActivateKey(e, () => loadInlineEntry(entry.id))}>
                    <span style={{ color: ti.color, fontSize: '12px' }}>{ti.icon}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-primary)', flex: 1 }}>{entry.title}</span>
                    <button
                      title={entry.is_pinned ? 'Unpin' : 'Pin'}
                      onClick={(e) => handleToggleEntryPin(entry.id, entry.is_pinned, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '12px', lineHeight: 1, color: entry.is_pinned ? 'var(--icon-star)' : 'var(--text-muted)' }}
                    >{entry.is_pinned ? '★' : '☆'}</button>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{entry.entry_date}</span>
                  </div>
                  {renderInlineEntryPanel(entry.id)}
                </div>
              );
            })}
            {(tasksByProject[proj.id] ?? []).map(task => (
              <div key={`task-${task.id}`}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '3px 0', fontSize: '12px', cursor: 'pointer',
                  background: completedFlashIds.has(task.id) ? 'rgba(74, 222, 128, 0.15)' : inlineTaskId === task.id ? 'var(--input-bg)' : 'transparent',
                  borderRadius: '4px', transition: 'background 0.3s ease',
                }} onClick={() => loadInlineTask(task.id)}
                  tabIndex={0} role="button" aria-label={`Task: ${task.name}`}
                  onKeyDown={e => handleActivateKey(e, () => loadInlineTask(task.id))}>
                  <button
                    onClick={(e) => handleQuickCompleteTask(task.id, task.due_date, e)}
                    disabled={completingTaskIds.has(task.id)}
                    title="Complete task"
                    style={{ background: 'none', border: '1.5px solid var(--btn-complete-bg)', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: '10px', color: 'var(--btn-complete-bg)', flexShrink: 0 }}
                  >{completedFlashIds.has(task.id) ? '✓' : completingTaskIds.has(task.id) ? '…' : ''}</button>
                  <span style={{ color: 'var(--text-primary)', flex: 1 }}>{task.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontStyle: task.due_date ? 'normal' : 'italic' }}>{task.due_date || 'No date'}</span>
                  <button onClick={e => { e.stopPropagation(); loadInlineTask(task.id); }} style={{
                    padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                    cursor: 'pointer', background: 'transparent', color: 'var(--color-task)',
                    border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
                  }}>Edit</button>
                </div>
                {renderInlineTaskPanel(task.id)}
              </div>
            ))}
            {(cadenceByProject[proj.id] ?? []).map(item => (
              <div key={`cadence-${item.id}`}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '3px 0', fontSize: '12px', cursor: 'pointer',
                  background: inlineCadenceId === item.id ? 'var(--input-bg)' : 'transparent',
                  borderRadius: '4px',
                }} onClick={() => loadCadence(item.id)}
                  tabIndex={0} role="button" aria-label={`Cadence: ${item.name}`}
                  onKeyDown={e => handleActivateKey(e, () => loadCadence(item.id))}>
                  <span style={{ width: '16px', height: '16px', borderRadius: '50%', border: '1.5px solid var(--color-cadence)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'var(--color-cadence)', flexShrink: 0 }}>↻</span>
                  <span style={{ color: 'var(--text-primary)', flex: 1 }}>{item.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{describeSchedule(item)}</span>
                  <button onClick={e => { e.stopPropagation(); loadCadence(item.id); }} style={{
                    padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                    cursor: 'pointer', background: 'transparent', color: 'var(--color-cadence)',
                    border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
                  }}>Edit</button>
                </div>
                {renderCadencePanel(item.id)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /** Compute last activity date for a program (across all its projects) */
  function getProgramLastActivity(progId: number): string | null {
    let latest: string | null = null;
    // Check direct entries for this program
    const directEntries = directEntriesByProgram[progId] ?? [];
    if (directEntries.length > 0 && directEntries[0]?.entry_date) {
      latest = directEntries[0].entry_date;
    }
    // Check entries in program's projects
    const progProjects = [...(directProjectsByProgram[progId] ?? [])];
    // Also include projects under goals
    const progGoals = goalsByProgram[progId] ?? [];
    for (const g of progGoals) {
      const goalProjs = projectsByGoal[g.id] ?? [];
      progProjects.push(...goalProjs);
    }
    for (const p of progProjects) {
      const pEntries = entriesByProject[p.id] ?? [];
      if (pEntries.length > 0 && pEntries[0]?.entry_date) {
        if (!latest || pEntries[0].entry_date > latest) {
          latest = pEntries[0].entry_date;
        }
      }
    }
    return latest;
  }

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* ── Bulk Task Completion Action Bar (Task 11.1) ── */}
      {selectedTaskIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px',
          marginBottom: '12px', borderRadius: '8px',
          background: 'var(--accent-primary)', color: 'var(--text-on-primary)',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>
            {selectedTaskIds.size} task{selectedTaskIds.size > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleBulkComplete}
            disabled={bulkCompleting}
            style={{
              padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
              cursor: bulkCompleting ? 'not-allowed' : 'pointer',
              background: 'var(--text-on-primary)', color: 'var(--accent-primary)', border: 'none',
              opacity: bulkCompleting ? 0.6 : 1,
            }}
          >
            {bulkCompleting ? 'Completing…' : 'Complete Selected'}
          </button>
          <button
            onClick={() => { setSelectedTaskIds(new Set()); setBulkError(null); }}
            style={{
              padding: '6px 10px', borderRadius: '6px', fontSize: '12px',
              cursor: 'pointer', background: 'transparent', color: 'var(--text-on-primary)',
              border: '1px solid rgba(255,255,255,0.5)',
            }}
          >
            Clear
          </button>
          {bulkError && (
            <span style={{ fontSize: '12px', color: 'var(--accent-danger)', marginLeft: 'auto' }}>{bulkError}</span>
          )}
        </div>
      )}

      {/* ── Create Buttons & Filters ── */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Consolidated "+ New" dropdown */}
        <div ref={newDropdownRef} style={{ position: 'relative' }}>
          <button onClick={() => setShowNewDropdown(p => !p)} style={{
            padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer', background: 'var(--button-primary-bg)',
            color: 'var(--text-on-primary)', border: 'none',
          }}>+ New</button>
          {showNewDropdown && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: '4px', zIndex: 100,
              background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              minWidth: '140px', overflow: 'hidden',
            }}>
              <button onClick={() => { setShowNewDropdown(false); setShowNewProgram(true); setShowNewProject(false); setShowNewGoal(false); }} style={{
                display: 'block', width: '100%', padding: '10px 16px', fontSize: '13px',
                cursor: 'pointer', background: 'transparent', color: 'var(--text-primary)',
                border: 'none', textAlign: 'left',
              }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--input-bg)')}
                 onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                Program
              </button>
              <button onClick={() => { setShowNewDropdown(false); setShowNewProject(true); setShowNewProgram(false); setShowNewGoal(false); }} style={{
                display: 'block', width: '100%', padding: '10px 16px', fontSize: '13px',
                cursor: 'pointer', background: 'transparent', color: 'var(--text-primary)',
                border: 'none', textAlign: 'left',
              }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--input-bg)')}
                 onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                Project
              </button>
              <button onClick={() => { setShowNewDropdown(false); setShowNewGoal(true); setShowNewProgram(false); setShowNewProject(false); }} style={{
                display: 'block', width: '100%', padding: '10px 16px', fontSize: '13px',
                cursor: 'pointer', background: 'transparent', color: 'var(--text-primary)',
                border: 'none', textAlign: 'left',
              }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--input-bg)')}
                 onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                Goal
              </button>
            </div>
          )}
        </div>

        {/* Search box */}
        <div style={{ position: 'relative', flex: '0 1 240px' }}>
          <input
            type="text"
            placeholder="Search programs, goals, projects, tasks…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search programs, goals, projects, tasks"
            style={{
              width: '100%', padding: '8px 12px 8px 32px', borderRadius: '8px',
              background: 'var(--input-bg)', border: '1px solid var(--input-border)',
              color: 'var(--text-primary)', fontSize: '13px', outline: 'none',
            }}
          />
          <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '13px', color: 'var(--text-muted)', pointerEvents: 'none' }}>🔍</span>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{
              position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: '14px', color: 'var(--text-muted)', padding: '2px 4px',
            }}>×</button>
          )}
        </div>

        <div style={{ marginLeft: 'auto' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
            <span
              role="switch" aria-checked={showCompleted} aria-label="Show completed projects"
              onClick={() => setShowCompleted(v => !v)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowCompleted(v => !v); } }}
              tabIndex={0}
              style={{
                display: 'inline-block', width: '32px', height: '18px', borderRadius: '9px',
                background: showCompleted ? 'var(--status-completed)' : 'var(--input-border)',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}>
              <span style={{
                position: 'absolute', top: '2px', left: showCompleted ? '16px' : '2px',
                width: '14px', height: '14px', borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }} />
            </span>
            Show Completed
          </label>
        </div>

        <button className="refresh-btn" onClick={fetchAll} title="Refresh data">
          <span className="refresh-icon">↻</span> Refresh
        </button>
      </div>

      {/* ── Inline New Program Form ── */}
      {showNewProgram && (
        <div style={{ ...cardStyle, marginBottom: '16px', borderLeft: '3px solid var(--accent-primary)' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Name *</label>
              <input style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
                value={newProgramName} onChange={e => setNewProgramName(e.target.value)}
                placeholder="Program name…" aria-label="New program name" autoFocus />
            </div>
            <div style={{ flex: '0 0 160px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Program Type</label>
              <select style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}
                value={newProgramType} onChange={e => setNewProgramType(e.target.value)} aria-label="New program type">
                {['Primary', 'Strategic', 'Operational', 'Carrier', 'Support'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 0 140px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Status</label>
              <select style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}
                value={newProgramStatus} onChange={e => setNewProgramStatus(e.target.value)} aria-label="New program status">
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="sunset">Sunset</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Description</label>
            <textarea style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
              value={newProgramDescription} onChange={e => setNewProgramDescription(e.target.value)}
              placeholder="Brief description…" aria-label="New program description" />
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Owner</label>
              <input style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                value={newProgramOwner} onChange={e => setNewProgramOwner(e.target.value)}
                placeholder="Owner name…" aria-label="New program owner" />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Color</label>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                {PRESET_COLORS.map(c => (
                  <span key={c} onClick={() => setNewProgramColor(c)}
                    style={{ width: '24px', height: '24px', borderRadius: '4px', background: c, cursor: 'pointer',
                      border: newProgramColor === c ? '2px solid var(--text-primary)' : '2px solid transparent' }} />
                ))}
                <input style={{ padding: '6px 10px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', width: '80px', marginLeft: '4px' }}
                  value={newProgramColor} onChange={e => setNewProgramColor(e.target.value)} placeholder="#hex" aria-label="New program color hex code" />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => {
              if (!newProgramName.trim()) return;
              const body: Record<string, unknown> = { name: newProgramName.trim(), program_type: newProgramType, status: newProgramStatus };
              if (newProgramDescription.trim()) body.description = newProgramDescription.trim();
              if (newProgramColor.trim()) body.color = newProgramColor.trim();
              if (newProgramOwner.trim()) body.owner = newProgramOwner.trim();
              fetch('/api/programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                .then(r => r.json())
                .then((created) => {
                  setNewProgramName(''); setNewProgramDescription(''); setNewProgramType('Primary');
                  setNewProgramStatus('active'); setNewProgramColor(''); setNewProgramOwner('');
                  setShowNewProgram(false);
                  // Auto-expand the newly created program
                  if (created?.id) setExpandedPrograms(prev => new Set(prev).add(created.id));
                  fetchAll();
                });
            }} style={{
              padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
              cursor: 'pointer', background: 'var(--button-primary-bg)', color: 'var(--text-on-primary)', border: 'none',
              opacity: newProgramName.trim() ? 1 : 0.5,
            }}>Create</button>
            <button onClick={() => setShowNewProgram(false)} style={{
              padding: '8px 16px', borderRadius: '6px', fontSize: '13px',
              cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--card-border)',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Inline New Project Form ── */}
      {showNewProject && (
        <div style={{ ...cardStyle, marginBottom: '16px', borderLeft: '3px solid var(--accent-secondary)' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Name *</label>
              <input style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
                value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
                placeholder="Project name…" aria-label="New project name" autoFocus />
            </div>
            <div style={{ flex: '0 0 140px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Status</label>
              <select style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}
                value={newProjectStatus} onChange={e => setNewProjectStatus(e.target.value)} aria-label="New project status">
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Description</label>
            <textarea style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
              value={newProjectDescription} onChange={e => setNewProjectDescription(e.target.value)}
              placeholder="Brief description…" aria-label="New project description" />
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Program</label>
              <select style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}
                value={newProjectProgramId} onChange={e => { setNewProjectProgramId(e.target.value ? parseInt(e.target.value, 10) : ''); setNewProjectGoalId(''); }} aria-label="New project program">
                <option value="">— No Program —</option>
                {programs.filter(p => p.status === 'active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Goal</label>
              <select style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}
                value={newProjectGoalId} onChange={e => setNewProjectGoalId(e.target.value ? parseInt(e.target.value, 10) : '')} aria-label="New project goal">
                <option value="">— No Goal —</option>
                {goals.filter(g => !newProjectProgramId || g.program_id === Number(newProjectProgramId) || !g.program_id).map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Start Date</label>
              <input type="date" style={{ padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', width: '160px' }}
                value={newProjectStartDate} onChange={e => setNewProjectStartDate(e.target.value)} aria-label="New project start date" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Target End Date</label>
              <input type="date" style={{ padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', width: '160px' }}
                value={newProjectTargetEndDate} onChange={e => setNewProjectTargetEndDate(e.target.value)} aria-label="New project target end date" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => {
              if (!newProjectName.trim()) return;
              const body: Record<string, unknown> = { name: newProjectName.trim(), status: newProjectStatus };
              if (newProjectDescription.trim()) body.description = newProjectDescription.trim();
              if (newProjectProgramId) body.program_id = newProjectProgramId;
              if (newProjectGoalId) body.goal_id = newProjectGoalId;
              if (newProjectStartDate) body.start_date = newProjectStartDate;
              if (newProjectTargetEndDate) body.target_end_date = newProjectTargetEndDate;
              fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(() => {
                setNewProjectName(''); setNewProjectProgramId(''); setNewProjectDescription('');
                setNewProjectStatus('active'); setNewProjectGoalId('');
                setNewProjectStartDate(''); setNewProjectTargetEndDate('');
                setShowNewProject(false); fetchAll();
              });
            }} style={{
              padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
              cursor: 'pointer', background: 'var(--button-primary-bg)', color: 'var(--text-on-primary)', border: 'none',
              opacity: newProjectName.trim() ? 1 : 0.5,
            }}>Create</button>
            <button onClick={() => setShowNewProject(false)} style={{
              padding: '8px 16px', borderRadius: '6px', fontSize: '13px',
              cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--card-border)',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Inline New Goal Form ── */}
      {showNewGoal && (
        <div style={{ ...cardStyle, marginBottom: '16px', borderLeft: '3px solid var(--color-goal, var(--accent-primary))' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Title *</label>
              <input style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
                value={newGoalTitle} onChange={e => setNewGoalTitle(e.target.value)}
                placeholder="Goal title…" aria-label="New goal title" autoFocus />
            </div>
            <div style={{ flex: '0 0 140px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Status</label>
              <select style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}
                value={newGoalStatus} onChange={e => setNewGoalStatus(e.target.value)} aria-label="New goal status">
                <option value="on_track">On Track</option>
                <option value="at_risk">At Risk</option>
                <option value="behind">Behind</option>
                <option value="completed">Completed</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Description</label>
            <textarea style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
              value={newGoalDescription} onChange={e => setNewGoalDescription(e.target.value)}
              placeholder="Brief description…" aria-label="New goal description" />
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Program</label>
              <select style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}
                value={newGoalProgramId} onChange={e => setNewGoalProgramId(e.target.value ? parseInt(e.target.value, 10) : '')} aria-label="New goal program">
                <option value="">— No Program —</option>
                {programs.filter(p => p.status === 'active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Target Date</label>
              <input type="date" style={{ padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', width: '160px' }}
                value={newGoalTargetDate} onChange={e => setNewGoalTargetDate(e.target.value)} aria-label="New goal target date" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => {
              if (!newGoalTitle.trim()) return;
              const body: Record<string, unknown> = { title: newGoalTitle.trim(), status: newGoalStatus };
              if (newGoalDescription.trim()) body.description = newGoalDescription.trim();
              if (newGoalProgramId) body.program_id = newGoalProgramId;
              if (newGoalTargetDate) body.target_date = newGoalTargetDate;
              fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(() => {
                setNewGoalTitle(''); setNewGoalDescription(''); setNewGoalStatus('on_track');
                setNewGoalProgramId(''); setNewGoalTargetDate('');
                setShowNewGoal(false); fetchAll();
              });
            }} style={{
              padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
              cursor: 'pointer', background: 'var(--button-primary-bg)', color: 'var(--text-on-primary)', border: 'none',
              opacity: newGoalTitle.trim() ? 1 : 0.5,
            }}>Create</button>
            <button onClick={() => setShowNewGoal(false)} style={{
              padding: '8px 16px', borderRadius: '6px', fontSize: '13px',
              cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--card-border)',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Program Cards ── */}
      {[...programs].filter(p => showCompleted || p.status !== 'sunset').filter(p => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        // Show program if its name or description matches
        if (p.name.toLowerCase().includes(q)) return true;
        if (p.description && p.description.toLowerCase().includes(q)) return true;
        // Show program if any of its goals match
        const progGoals = goalsByProgram[p.id] ?? [];
        if (progGoals.some(g => g.title.toLowerCase().includes(q) || (g.description && g.description.toLowerCase().includes(q)))) return true;
        // Show program if any of its projects match (check project name + entries from separate array)
        const directProjs = directProjectsByProgram[p.id] ?? [];
        if (directProjs.some(pr => pr.name.toLowerCase().includes(q) || entries.some(e => e.project_id === pr.id && e.title.toLowerCase().includes(q)))) return true;
        // Check projects under goals
        for (const g of progGoals) {
          const goalProjs = projectsByGoal[g.id] ?? [];
          if (goalProjs.some(pr => pr.name.toLowerCase().includes(q) || entries.some(e => e.project_id === pr.id && e.title.toLowerCase().includes(q)))) return true;
        }
        // Check tasks under this program
        if (scheduledItems.some(si => si.program_id === p.id && si.name.toLowerCase().includes(q))) return true;
        return false;
      }).sort((a, b) => a.name.localeCompare(b.name)).map(prog => {
        const isExpanded = expandedPrograms.has(prog.id);
        const progGoals = goalsByProgram[prog.id] ?? [];
        const atRisk = progGoals.filter(g => g.status === 'at_risk').length;
        const cadence = cadenceByProgram[prog.id] ?? [];
        const cfg = STATUS_CONFIG[prog.status] ?? STATUS_CONFIG.active;
        const programLastActivity = getProgramLastActivity(prog.id);

        return (
          <div key={prog.id} style={{ ...cardStyle, borderLeft: `3px solid ${prog.color || 'var(--accent-primary)'}` }}>
            {/* Program Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => toggleProgram(prog.id)}
              tabIndex={0} role="button" aria-expanded={isExpanded} aria-label={`${prog.name} program`}
              onKeyDown={e => handleActivateKey(e, () => toggleProgram(prog.id))}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{isExpanded ? '▼' : '▶'}</span>
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{prog.name}</span>
              <span style={chipStyle(cfg.color)}>{cfg.label}</span>
              {atRisk > 0 && <span style={chipStyle('var(--status-at-risk)')}>{atRisk} at risk</span>}
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {prog.metrics.active_goals}G · {prog.metrics.active_projects}P · {prog.metrics.total_entries}E
              </span>
              {!isExpanded && programLastActivity && (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Last: {programLastActivity}</span>
              )}
              {prog.metrics.scheduled_completion_rate > 0 && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {Math.round(prog.metrics.scheduled_completion_rate * 100)}% cadence
                </span>
              )}
              {/* Task 7.11: Quick Update trigger */}
              <button onClick={e => { e.stopPropagation(); onNavigateToQuickCapture?.(undefined, prog.id); }} style={{
                padding: '3px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 600,
                cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--accent-primary)',
                border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
              }}>+ Quick Update</button>
              <button onClick={e => { e.stopPropagation(); setExpandedPrograms(prev => new Set(prev).add(prog.id)); loadProgramForEdit(prog.id); }} style={{
                padding: '3px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 600,
                cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--color-program)',
                border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
              }}>Edit Program</button>
            </div>

            {isExpanded && (
              <div style={{ marginTop: '12px', paddingLeft: '20px' }}>
                {renderProgramEditForm(prog.id)}
                {/* Goals */}
                {progGoals.filter(goal => {
                  if (!searchQuery.trim()) return true;
                  const q = searchQuery.toLowerCase();
                  if (goal.title.toLowerCase().includes(q)) return true;
                  if (goal.description && goal.description.toLowerCase().includes(q)) return true;
                  // Show goal if any of its projects match
                  const goalProjects = projectsByGoal[goal.id] ?? [];
                  return goalProjects.some(p => p.name.toLowerCase().includes(q) || entries.some(e => e.project_id === p.id && e.title.toLowerCase().includes(q)));
                }).map(goal => {
                  const goalExpanded = expandedGoals.has(goal.id);
                  const gCfg = STATUS_CONFIG[goal.status] ?? STATUS_CONFIG.on_track;
                  const goalProjects = projectsByGoal[goal.id] ?? [];

                  return (
                    <div key={goal.id} style={{ marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '6px 0' }}
                        onClick={() => toggleGoal(goal.id)}
                        tabIndex={0} role="button" aria-expanded={goalExpanded} aria-label={`${goal.title} goal`}
                        onKeyDown={e => handleActivateKey(e, () => toggleGoal(goal.id))}>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{goalExpanded ? '▼' : '▶'}</span>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: gCfg.color, flexShrink: 0 }} />
                        <span style={{ fontSize: '10px', color: gCfg.color }}>{gCfg.label}</span>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{goal.title}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{goalProjects.length} projects</span>
                        {goalExpanded && (
                          <button onClick={e => { e.stopPropagation(); loadGoalForEdit(goal.id); }} style={{
                            padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                            cursor: 'pointer', background: 'transparent', color: 'var(--color-goal)',
                            border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
                          }}>Edit Goal</button>
                        )}
                      </div>

                      {goalExpanded && (
                        <div style={{ paddingLeft: '24px' }}>
                          {/* SMART fields */}
                          {(() => {
                            const smartFields: { label: string; value: string | null }[] = [
                              { label: 'Specific', value: goal.specific },
                              { label: 'Measurable', value: goal.measurable },
                              { label: 'Achievable', value: goal.achievable },
                              { label: 'Relevant', value: goal.relevant },
                              { label: 'Time-bound', value: goal.time_bound },
                            ];
                            const visible = smartFields.filter(f => f.value && f.value.trim());
                            if (visible.length === 0) return null;
                            return (
                              <div style={{ marginBottom: '8px' }}>
                                {visible.map(f => (
                                  <div key={f.label} style={{ display: 'flex', gap: '6px', padding: '2px 0' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', minWidth: '80px', flexShrink: 0 }}>{f.label}:</span>
                                    <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{f.value}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          {renderGoalEditForm(goal.id)}
                          {goalProjects.filter(proj => {
                            if (!searchQuery.trim()) return true;
                            const q = searchQuery.toLowerCase();
                            return proj.name.toLowerCase().includes(q) || entries.some(e => e.project_id === proj.id && e.title.toLowerCase().includes(q));
                          }).map(proj => renderCompactProjectRow(proj, resolveProjectProgram(proj)))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Direct Projects (no goal, but assigned to this program) */}
                {(() => {
                  const directProjs = (directProjectsByProgram[prog.id] ?? []).filter(proj => {
                    if (!searchQuery.trim()) return true;
                    const q = searchQuery.toLowerCase();
                    return proj.name.toLowerCase().includes(q) || entries.some(e => e.project_id === proj.id && e.title.toLowerCase().includes(q));
                  });
                  if (directProjs.length === 0) return null;
                  return (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--card-border)' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                      Projects
                    </div>
                    {directProjs.map(proj => renderCompactProjectRow(proj, prog.id))}
                  </div>
                  );
                })()}

                {/* Direct Entries — entries assigned to this program but no project */}
                {(directEntriesByProgram[prog.id] ?? []).length > 0 && (
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--card-border)' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Recent Entries
                    </h3>
                    {(directEntriesByProgram[prog.id] ?? []).slice(0, 10).map(entry => {
                      const ti = TYPE_ICON[entry.entry_type] ?? DEFAULT_ICON;
                      return (
                        <div key={entry.id}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '3px 0', cursor: 'pointer',
                            background: inlineEntryId === entry.id ? 'var(--input-bg)' : 'transparent',
                            borderRadius: '4px',
                          }} onClick={() => loadInlineEntry(entry.id)}
                            tabIndex={0} role="button" aria-label={`Entry: ${entry.title}`}
                            onKeyDown={e => handleActivateKey(e, () => loadInlineEntry(entry.id))}>
                            <span style={{ color: ti.color, fontSize: '12px' }}>{ti.icon}</span>
                            <span style={{ fontSize: '12px', color: 'var(--text-primary)', flex: 1 }}>{entry.title}</span>
                            <button
                              title={entry.is_pinned ? 'Unpin' : 'Pin'}
                              onClick={(e) => handleToggleEntryPin(entry.id, entry.is_pinned, e)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '12px', lineHeight: 1, color: entry.is_pinned ? 'var(--icon-star)' : 'var(--text-muted)' }}
                            >{entry.is_pinned ? '★' : '☆'}</button>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{entry.entry_date}</span>
                          </div>
                          {renderInlineEntryPanel(entry.id)}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Tasks Section — active tasks for this program */}
                {(tasksByProgram[prog.id] ?? []).length > 0 && (
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--card-border)' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Tasks
                    </h3>
                    {(tasksByProgram[prog.id] ?? []).map(item => (
                      <div key={item.id}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '4px 0', fontSize: '12px', cursor: 'pointer',
                          background: completedFlashIds.has(item.id) ? 'rgba(74, 222, 128, 0.15)' : inlineTaskId === item.id ? 'var(--input-bg)' : 'transparent',
                          borderRadius: '4px',
                          transition: 'background 0.3s ease',
                        }} onClick={() => loadInlineTask(item.id)}
                          tabIndex={0} role="button" aria-label={`Task: ${item.name}`}
                          onKeyDown={e => handleActivateKey(e, () => loadInlineTask(item.id))}>
                          <button
                            onClick={(e) => handleQuickCompleteTask(item.id, item.due_date, e)}
                            disabled={completingTaskIds.has(item.id)}
                            title="Complete task"
                            style={{ background: 'none', border: '1.5px solid var(--btn-complete-bg)', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: '10px', color: 'var(--btn-complete-bg)', flexShrink: 0 }}
                          >{completedFlashIds.has(item.id) ? '✓' : completingTaskIds.has(item.id) ? '…' : ''}</button>
                          <span style={{ color: 'var(--text-primary)', flex: 1 }}>{item.name}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontStyle: item.due_date ? 'normal' : 'italic' }}>{item.due_date || 'No date'}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                            {item.mode === 'one_time' ? 'one-time' : item.recurrence_type ?? item.mode}
                          </span>
                          <button onClick={e => { e.stopPropagation(); loadInlineTask(item.id); }} style={{
                            padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                            cursor: 'pointer', background: 'transparent', color: 'var(--color-task)',
                            border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
                          }}>Edit</button>
                        </div>
                        {renderInlineTaskPanel(item.id)}
                      </div>
                    ))}
                  </div>
                )}

                {/* Cadence Section (Task 7.9) */}
                {cadence.length > 0 && (
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--card-border)' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Cadence
                    </h3>
                    {cadence.map(item => (
                      <div key={item.id}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '4px 0', fontSize: '12px', cursor: 'pointer',
                          background: inlineCadenceId === item.id ? 'var(--input-bg)' : 'transparent',
                          borderRadius: '4px',
                        }} onClick={() => loadCadence(item.id)}
                          tabIndex={0} role="button" aria-label={`Cadence: ${item.name}`}
                          onKeyDown={e => handleActivateKey(e, () => loadCadence(item.id))}>
                          <span style={{ width: '16px', height: '16px', borderRadius: '50%', border: '1.5px solid var(--color-cadence)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'var(--color-cadence)', flexShrink: 0 }}>↻</span>
                          <span style={{ color: 'var(--text-primary)', flex: 1 }}>{item.name}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                            {describeSchedule(item)}
                          </span>
                          <button onClick={e => { e.stopPropagation(); loadCadence(item.id); }} style={{
                            padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                            cursor: 'pointer', background: 'transparent', color: 'var(--color-cadence)',
                            border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
                          }}>Edit</button>
                        </div>
                        {renderCadencePanel(item.id)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Independent / Standalone Section ── */}
      {(() => {
        const q = searchQuery.toLowerCase();
        const filteredUnassignedGoals = searchQuery.trim()
          ? unassignedGoals.filter(g => g.title.toLowerCase().includes(q) || (g.description && g.description.toLowerCase().includes(q)))
          : unassignedGoals;
        const filteredUnassignedProjects = searchQuery.trim()
          ? unassignedProjects.filter(p => p.name.toLowerCase().includes(q) || entries.some(e => e.project_id === p.id && e.title.toLowerCase().includes(q)))
          : unassignedProjects;
        const filteredUnassignedTasks = searchQuery.trim()
          ? unassignedTasks.filter(t => t.name.toLowerCase().includes(q))
          : unassignedTasks;
        const filteredUnassignedCadence = searchQuery.trim()
          ? unassignedCadence.filter(c => c.name.toLowerCase().includes(q))
          : unassignedCadence;
        const showSection = !searchQuery.trim()
          ? (unassignedGoals.length > 0 || unassignedProjects.length > 0 || unassignedEntries.length > 0 || unassignedTasks.length > 0 || unassignedCadence.length > 0)
          : (filteredUnassignedGoals.length > 0 || filteredUnassignedProjects.length > 0 || filteredUnassignedTasks.length > 0 || filteredUnassignedCadence.length > 0);
        if (!showSection) return null;
        return (
        <div style={{ ...cardStyle, opacity: 0.8 }}>
          <h2 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 600, color: 'var(--text-muted)' }}>Not Linked to a Program</h2>
          {filteredUnassignedGoals.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Independent Goals</div>
              {filteredUnassignedGoals.map(g => {
                const gCfg = STATUS_CONFIG[g.status] ?? STATUS_CONFIG.on_track;
                return (
                  <div key={g.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: gCfg.color }} />
                      <span style={{ fontSize: '10px', color: gCfg.color }}>{gCfg.label}</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>{g.title}</span>
                      <button
                        onClick={() => loadGoalForEdit(g.id)}
                        style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', background: 'transparent', color: 'var(--color-goal)', border: '1px solid var(--color-goal)' }}
                        aria-label={`Edit goal ${g.title}`}
                      >Edit Goal</button>
                    </div>
                    {renderGoalEditForm(g.id)}
                  </div>
                );
              })}
            </div>
          )}
          {filteredUnassignedProjects.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Standalone Projects</div>
              {filteredUnassignedProjects.map(p => renderCompactProjectRow(p, null))}
            </div>
          )}
          {unassignedEntries.length > 0 && !searchQuery.trim() && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                General Activity ({unassignedEntries.length})
              </div>
              {unassignedEntries.slice(0, 10).map(e => {
                const ti = TYPE_ICON[e.entry_type] ?? DEFAULT_ICON;
                return (
                  <div key={e.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0', cursor: 'pointer',
                      background: inlineEntryId === e.id ? 'var(--input-bg)' : 'transparent', borderRadius: '4px',
                    }} onClick={() => loadInlineEntry(e.id)}
                      tabIndex={0} role="button" aria-label={`Entry: ${e.title}`}
                      onKeyDown={ev => handleActivateKey(ev, () => loadInlineEntry(e.id))}>
                      <span style={{ color: ti.color, fontSize: '11px' }}>{ti.icon}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-primary)', flex: 1 }}>{e.title}</span>
                      <button
                        title={e.is_pinned ? 'Unpin' : 'Pin'}
                        onClick={(ev) => handleToggleEntryPin(e.id, e.is_pinned, ev)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '12px', lineHeight: 1, color: e.is_pinned ? 'var(--icon-star)' : 'var(--text-muted)' }}
                      >{e.is_pinned ? '★' : '☆'}</button>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{e.entry_date}</span>
                    </div>
                    {renderInlineEntryPanel(e.id)}
                  </div>
                );
              })}
            </div>
          )}
          {unassignedTasks.length > 0 && !searchQuery.trim() && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Independent Tasks</div>
              {unassignedTasks.map(task => (
                <div key={`task-${task.id}`}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '3px 0', fontSize: '12px', cursor: 'pointer',
                    background: completedFlashIds.has(task.id) ? 'rgba(74, 222, 128, 0.15)' : inlineTaskId === task.id ? 'var(--input-bg)' : 'transparent',
                    borderRadius: '4px', transition: 'background 0.3s ease',
                  }} onClick={() => loadInlineTask(task.id)}
                    tabIndex={0} role="button" aria-label={`Task: ${task.name}`}
                    onKeyDown={e => handleActivateKey(e, () => loadInlineTask(task.id))}>
                    <button
                      onClick={(e) => handleQuickCompleteTask(task.id, task.due_date, e)}
                      disabled={completingTaskIds.has(task.id)}
                      title="Complete task"
                      style={{ background: 'none', border: '1.5px solid var(--btn-complete-bg)', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: '10px', color: 'var(--btn-complete-bg)', flexShrink: 0 }}
                    >{completedFlashIds.has(task.id) ? '✓' : completingTaskIds.has(task.id) ? '…' : ''}</button>
                    <span style={{ color: 'var(--text-primary)', flex: 1 }}>{task.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontStyle: task.due_date ? 'normal' : 'italic' }}>{task.due_date || 'No date'}</span>
                    <button onClick={e => { e.stopPropagation(); loadInlineTask(task.id); }} style={{
                      padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                      cursor: 'pointer', background: 'transparent', color: 'var(--color-task)',
                      border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
                    }}>Edit</button>
                  </div>
                  {renderInlineTaskPanel(task.id)}
                </div>
              ))}
            </div>
          )}
          {unassignedCadence.length > 0 && !searchQuery.trim() && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Cadence</div>
              {unassignedCadence.map(item => (
                <div key={`cadence-${item.id}`}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '3px 0', fontSize: '12px', cursor: 'pointer',
                    background: inlineCadenceId === item.id ? 'var(--input-bg)' : 'transparent',
                    borderRadius: '4px',
                  }} onClick={() => loadCadence(item.id)}
                    tabIndex={0} role="button" aria-label={`Cadence: ${item.name}`}
                    onKeyDown={e => handleActivateKey(e, () => loadCadence(item.id))}>
                    <span style={{ width: '16px', height: '16px', borderRadius: '50%', border: '1.5px solid var(--color-cadence)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'var(--color-cadence)', flexShrink: 0 }}>↻</span>
                    <span style={{ color: 'var(--text-primary)', flex: 1 }}>{item.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{describeSchedule(item)}</span>
                    <button onClick={e => { e.stopPropagation(); loadCadence(item.id); }} style={{
                      padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                      cursor: 'pointer', background: 'transparent', color: 'var(--color-cadence)',
                      border: '1px solid var(--card-border)', whiteSpace: 'nowrap',
                    }}>Edit</button>
                  </div>
                  {renderCadencePanel(item.id)}
                </div>
              ))}
            </div>
          )}
        </div>
        );
      })()}

      {/* Promote to Goal modal (Task 20.10) */}
      {promoteToGoalProject && (
        <PromoteToGoal
          project={promoteToGoalProject}
          onClose={() => setPromoteToGoalProject(null)}
          onCompleted={() => { setPromoteToGoalProject(null); fetchAll(); }}
        />
      )}
    </div>
  );
}

