import { useEffect, useState, useCallback, useRef } from 'react';
import EntryFormView from '../views/EntryFormView';
import { readAppState, patchAppState } from '../utils/appState';
import { isoWeekNumber, shiftWeek, shiftMonth, shiftQuarter, formatRangeLabel } from '../utils/dateUtils';
import { cardStyle as sharedCardStyle } from '../styles/sharedStyles';
import { useDirtyClose } from '../hooks/useDirtyClose';
import DiscardConfirmDialog from '../components/DiscardConfirmDialog';

/* ── Types ── */
interface Tag { id: number; name: string; created_at: string; }
interface LinkItem { id: number; parent_type: string; parent_id: number; url: string; label: string | null; created_at: string; }
interface ProgramBrief { id: number; name: string; status: string; color: string | null; }
interface EntryResponse {
  id: number; created_at: string; updated_at: string; entry_date: string;
  entry_type: string; title: string; description: string | null;
  project_id: number | null;
  project_name: string | null; program_id: number | null; program_name: string | null;
  scheduled_item_id: number | null; status: string; visibility: string;
  is_accomplishment: number; is_weekly_highlight: number;
  is_pinned?: number; outcome?: string | null;
  tags: Tag[]; links: LinkItem[];
}

/* ── Scheduled item instance types (R4) ── */
interface ScheduledItemInstance {
  id: number;
  scheduled_item_id: number;
  due_date: string;
  due_time: string | null;
  status: string;
  resolved_at: string | null;
  notes: string | null;
  skip_reason: string | null;
  entry_id: number | null;
}

interface ScheduledItemParent {
  id: number;
  name: string;
  mode: string;
  recurrence_type: string | null;
  program_id: number | null;
  program_name: string | null;
  project_id: number | null;
  project_name: string | null;
  item_class: string;
}

/* ── v4 Type icon config ── */
function typeIcon(entry: EntryResponse): { icon: string; color: string } {
  switch (entry.entry_type) {
    case 'decision': return { icon: '◆', color: 'var(--accent-warning)' };
    case 'milestone': return { icon: '★', color: 'var(--status-on-track)' };
    case 'action_item': return { icon: '☐', color: 'var(--accent-danger)' };
    default: return { icon: '—', color: 'var(--text-muted)' };
  }
}

/* ── v4 visible type mapping ── */
function visibleType(et: string): string {
  if (et === 'decision') return 'Decisions';
  if (et === 'milestone') return 'Milestones';
  if (et === 'action_item') return 'Tasks';
  return 'Notes';
}

/* ── Entry type border color (12.3) ── */
function entryTypeBorderColor(entryType: string): string | null {
  switch (entryType) {
    case 'decision': return 'var(--accent-warning)';   // amber
    case 'milestone': return 'var(--status-on-track)'; // green
    case 'action_item': return 'var(--color-task, #4a9eff)'; // blue
    default: return null; // no border for Notes
  }
}

/* ── Time range helpers ── */
function getWeekStart(): string {
  const d = new Date(); const day = d.getDay(); // 0=Sunday, 6=Saturday
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).toISOString().split('T')[0];
}
function getWeekEnd(): string {
  const d = new Date(); const day = d.getDay();
  const sun = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
  return sat.toISOString().split('T')[0];
}
function getMonthStart(): string { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]; }
function getMonthEnd(): string { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]; }
function getQuarterStart(): string {
  const d = new Date(); const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1).toISOString().split('T')[0];
}
function getQuarterEnd(): string {
  const d = new Date(); const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q + 3, 0).toISOString().split('T')[0];
}

function formatDayHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return `${label} · W${isoWeekNumber(d)}`;
}

/* ── Search term highlight helper (12.3) ── */
function highlightSearchTerm(text: string, searchTerm: string): React.ReactNode {
  if (!searchTerm.trim()) return text;
  const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} style={{ background: 'var(--accent-primary)', color: 'var(--text-on-primary)', borderRadius: '2px', padding: '0 2px' }}>{part}</mark>
      : part
  );
}

/* ── Styles ── */
const card: React.CSSProperties = { ...sharedCardStyle, padding: '16px', marginBottom: '12px' };
const inp: React.CSSProperties = { padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: '4px', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 500 };
const filterPill = (active: boolean): React.CSSProperties => ({
  padding: '5px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
  border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--card-border)'}`,
  color: active ? 'var(--text-on-primary)' : 'var(--text-secondary)',
  background: active ? 'var(--accent-primary)' : 'transparent',
});
const densityBtn = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer',
  color: active ? 'var(--text-on-primary)' : 'var(--text-muted)',
  background: active ? 'var(--accent-primary)' : 'var(--input-bg)',
  border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--input-border)'}`,
});

const TIME_RANGES = [
  { label: 'This Week', getStart: getWeekStart, getEnd: getWeekEnd },
  { label: 'This Month', getStart: getMonthStart, getEnd: getMonthEnd },
  { label: 'This Quarter', getStart: getQuarterStart, getEnd: getQuarterEnd },
  { label: 'All', getStart: () => '', getEnd: () => '' },
  { label: 'Custom', getStart: () => '', getEnd: () => '' },
];

const TYPE_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Decisions', value: 'decision' },
  { label: 'Milestones', value: 'milestone' },
  { label: 'Tasks', value: 'action_item' },
  { label: 'Notes', value: 'notes' },
];

interface TimelineViewProps { focusEntryId?: number | null; focusProjectId?: number | null; focusDate?: string | null; onFocusConsumed?: () => void; onNavigateToTab?: (tab: string, targetId?: number, context?: { projectId?: number; date?: string }) => void; }

/* ── Sort order localStorage key ── */
const SORT_ORDER_KEY = 'chronicle-timeline-sort-order';

function readSortOrder(): 'newest' | 'oldest' {
  try {
    const v = localStorage.getItem(SORT_ORDER_KEY);
    if (v === 'oldest') return 'oldest';
  } catch { /* ignore */ }
  return 'newest';
}

function writeSortOrder(order: 'newest' | 'oldest') {
  try { localStorage.setItem(SORT_ORDER_KEY, order); } catch { /* ignore */ }
}

/* ── Component ── */
export default function TimelineView({ focusEntryId, focusProjectId, focusDate, onFocusConsumed, onNavigateToTab: _onNavigateToTab }: TimelineViewProps) {
  const appState = readAppState();

  /* ── State: time range ── */
  const [timeRangeIdx, setTimeRangeIdx] = useState<number>(() => {
    if (focusProjectId) {
      const allIdx = TIME_RANGES.findIndex(r => r.label === 'All');
      return allIdx >= 0 ? allIdx : 0;
    }
    if (focusDate) {
      // If focusDate is outside the default "This Week" range, switch to "All"
      const defaultStart = TIME_RANGES[0].getStart();
      const defaultEnd = TIME_RANGES[0].getEnd();
      if (focusDate < defaultStart || focusDate > defaultEnd) {
        const allIdx = TIME_RANGES.findIndex(r => r.label === 'All');
        return allIdx >= 0 ? allIdx : 0;
      }
    }
    const saved = appState.timelineView?.timeRange;
    const idx = TIME_RANGES.findIndex(r => r.label === saved);
    return idx >= 0 ? idx : 0;
  });
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [rangeStart, setRangeStart] = useState(() => (focusProjectId || (focusDate && focusDate < TIME_RANGES[0].getStart())) ? '' : TIME_RANGES[0].getStart());
  const [rangeEnd, setRangeEnd] = useState(() => (focusProjectId || (focusDate && focusDate < TIME_RANGES[0].getStart())) ? '' : TIME_RANGES[0].getEnd());

  /* ── State: filters ── */
  const [programFilter, setProgramFilter] = useState<number | ''>(() => focusProjectId ? '' : (appState.timelineView?.programFilter ?? ''));
  const [projectFilter, setProjectFilter] = useState<number | ''>(focusProjectId ?? '');
  const [projectFilterName, setProjectFilterName] = useState<string>('');
  const [projectFocusGlow, setProjectFocusGlow] = useState(!!focusProjectId);
  const [typeFilter, setTypeFilter] = useState<string>(() => focusProjectId ? '' : (appState.timelineView?.typeFilter ?? ''));
  const [searchTerm, setSearchTerm] = useState('');
  const [density, setDensity] = useState<'compact' | 'normal'>('normal');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>(readSortOrder);
  const [showCadences, setShowCadences] = useState(true);

  /* ── State: data ── */
  const [entries, setEntries] = useState<EntryResponse[]>([]);
  const [cadenceInstances, setCadenceInstances] = useState<(ScheduledItemInstance & { parent?: ScheduledItemParent })[]>([]);
  const [programs, setPrograms] = useState<ProgramBrief[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── State: editing ── */
  const [editingEntry, setEditingEntry] = useState<EntryResponse | null>(null);
  const [editFormDirty, setEditFormDirty] = useState(false);

  /* ── State: scroll-to-top ── */
  const [showScrollTop, setShowScrollTop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ── State: deep-link handled ── */
  const deepLinkHandled = useRef(false);

  /* ── Close edit modal (Save path — bypasses dirty guard per Requirement 11.6) ── */
  const closeEditModal = useCallback(() => {
    setEditingEntry(null);
    setEditFormDirty(false);
  }, []);

  /* ── Dirty-close guard for the entry edit modal (Requirement 11) ── */
  const {
    handleBackdropClick: handleEditBackdropClick,
    handleExplicitClose: handleEditExplicitClose,
    shaking: editShaking,
    confirmOpen: editConfirmOpen,
    confirmDiscard: editConfirmDiscard,
    confirmCancel: editConfirmCancel,
  } = useDirtyClose({
    isDirty: useCallback(() => editFormDirty, [editFormDirty]),
    onClose: closeEditModal,
  });

  /* ── Focus trap for entry edit modal (15.1) ── */
  const editOverlayRef = useRef<HTMLDivElement>(null);

  // Escape key → explicit close (goes through the dirty-close guard).
  // Cannot use useFocusTrap here because the overlay is conditionally rendered
  // and the ref is null on initial mount (useFocusTrap has [] deps).
  useEffect(() => {
    if (!editingEntry) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleEditExplicitClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editingEntry, handleEditExplicitClose]);

  /* ── Handle focusProjectId from Portfolio navigation ── */
  useEffect(() => {
    if (focusProjectId) {
      setProjectFilter(focusProjectId);
      setProgramFilter('');
      setTypeFilter('');
      setSearchTerm('');
      setShowCadences(false);
      const allIdx = TIME_RANGES.findIndex(r => r.label === 'All');
      if (allIdx >= 0) setTimeRangeIdx(allIdx);
      setRangeStart('');
      setRangeEnd('');
      // Fetch project name for the banner
      fetch(`/api/projects/${focusProjectId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.name) setProjectFilterName(data.name); })
        .catch(() => {});
      // Trigger glow animation
      setProjectFocusGlow(true);
      setTimeout(() => setProjectFocusGlow(false), 2500);
    }
  }, [focusProjectId]);

  /* ── Persist time range selection ── */
  useEffect(() => {
    const label = TIME_RANGES[timeRangeIdx]?.label ?? 'This Week';
    patchAppState({ timelineView: { ...appState.timelineView, timeRange: label, typeFilter, programFilter } });
  }, [timeRangeIdx, typeFilter, programFilter]);

  /* ── Initialize range from selected time range ── */
  useEffect(() => {
    const tr = TIME_RANGES[timeRangeIdx];
    if (!tr) return;
    if (tr.label === 'Custom') {
      // keep custom dates
    } else if (tr.label === 'All') {
      setRangeStart('');
      setRangeEnd('');
    } else {
      setRangeStart(tr.getStart());
      setRangeEnd(tr.getEnd());
    }
  }, [timeRangeIdx]);

  /* ── Fetch entries ── */
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (rangeStart) params.set('date_start', rangeStart);
      if (rangeEnd) params.set('date_end', rangeEnd);
      if (typeFilter) {
        if (typeFilter === 'notes') {
          // "Notes" = everything except decision, milestone, action_item
          // We'll filter client-side
        } else {
          params.set('entry_type', typeFilter);
        }
      }
      if (programFilter) params.set('program_id', String(programFilter));
      if (projectFilter) params.set('project_id', String(projectFilter));
      if (searchTerm.trim()) params.set('search', searchTerm.trim());

      const res = await fetch(`/api/entries?${params.toString()}`);
      if (res.ok) {
        let data: EntryResponse[] = await res.json();
        // Client-side filter for "Notes" type
        if (typeFilter === 'notes') {
          data = data.filter(e => !['decision', 'milestone', 'action_item'].includes(e.entry_type));
        }
        setEntries(data);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [rangeStart, rangeEnd, typeFilter, programFilter, projectFilter, searchTerm]);

  /* ── Fetch cadence instances ── */
  const fetchCadenceInstances = useCallback(async () => {
    if (!showCadences) { setCadenceInstances([]); return; }
    try {
      const params = new URLSearchParams();
      if (rangeStart) params.set('due_date_start', rangeStart);
      if (rangeEnd) params.set('due_date_end', rangeEnd);
      // Don't filter by status — fetch all instances in range, filter client-side
      const res = await fetch(`/api/scheduled-items/instances?${params.toString()}`);
      if (res.ok) {
        const instances: ScheduledItemInstance[] = await res.json();
        // Fetch parent info for each unique scheduled_item_id
        const parentIds = [...new Set(instances.map(i => i.scheduled_item_id))];
        const parentMap: Record<number, ScheduledItemParent> = {};
        await Promise.all(parentIds.map(async (pid) => {
          try {
            const pRes = await fetch(`/api/scheduled-items/${pid}`);
            if (pRes.ok) {
              const pData = await pRes.json();
              parentMap[pid] = { id: pData.id, name: pData.name, mode: pData.mode, recurrence_type: pData.recurrence_type, program_id: pData.program_id, program_name: pData.program_name, project_id: pData.project_id, project_name: pData.project_name, item_class: pData.item_class };
            }
          } catch { /* ignore */ }
        }));
        // Only show cadence instances (recurring items) that have been resolved (not pending)
        // Exclude instances that have an entry_id — those already appear as entries in the main list
        const cadenceOnly = instances
          .filter(i => i.status !== 'pending' && !i.entry_id && parentMap[i.scheduled_item_id]?.mode === 'recurring')
          .map(i => ({ ...i, parent: parentMap[i.scheduled_item_id] }));
        // Filter by program if set
        const filtered = programFilter
          ? cadenceOnly.filter(i => i.parent?.program_id === programFilter)
          : cadenceOnly;
        setCadenceInstances(filtered);
      }
    } catch { /* ignore */ }
  }, [rangeStart, rangeEnd, showCadences, programFilter]);

  /* ── Fetch programs ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/programs');
        if (res.ok) {
          const data = await res.json();
          setPrograms(data.map((p: any) => ({ id: p.id, name: p.name, status: p.status, color: p.color })));
        }
      } catch { /* ignore */ }
    })();
  }, []);

  /* ── Trigger data fetch ── */
  useEffect(() => { fetchEntries(); }, [fetchEntries]);
  useEffect(() => { fetchCadenceInstances(); }, [fetchCadenceInstances]);

  // Pin/star toggle for entry cards (Task 14.3)
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

  /* ── Deep-link focus handling ── */
  useEffect(() => {
    if (deepLinkHandled.current) return;
    if (!focusEntryId && !focusDate) return;
    if (loading) return;
    // Wait for entries to render
    const timer = setTimeout(() => {
      if (focusEntryId) {
        const el = document.getElementById(`timeline-entry-${focusEntryId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.outline = '2px solid var(--accent-primary)';
          setTimeout(() => { el.style.outline = ''; }, 2000);
        }
      } else if (focusDate) {
        const el = document.getElementById(`timeline-date-${focusDate}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Call onFocusConsumed AFTER scroll completes
      setTimeout(() => {
        deepLinkHandled.current = true;
        onFocusConsumed?.();
      }, 500);
    }, 200);
    return () => clearTimeout(timer);
  }, [focusEntryId, focusDate, loading, onFocusConsumed]);

  /* ── Scroll-to-top listener ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      setShowScrollTop(el.scrollTop > window.innerHeight);
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  /* ── Shift arrows ── */
  const handleShift = (direction: number) => {
    const tr = TIME_RANGES[timeRangeIdx];
    if (!tr || tr.label === 'All' || tr.label === 'Custom') return;
    let newRange: [string, string];
    if (tr.label === 'This Week') newRange = shiftWeek(rangeStart, direction);
    else if (tr.label === 'This Month') newRange = shiftMonth(rangeStart, direction);
    else newRange = shiftQuarter(rangeStart, direction);
    setRangeStart(newRange[0]);
    setRangeEnd(newRange[1]);
  };

  /* ── Period label for tooltips ── */
  const periodLabel = (): string => {
    const tr = TIME_RANGES[timeRangeIdx];
    if (!tr) return 'period';
    if (tr.label === 'This Week') return 'week';
    if (tr.label === 'This Month') return 'month';
    if (tr.label === 'This Quarter') return 'quarter';
    return 'period';
  };

  /* ── Clear filters ── */
  const isFiltersNonDefault = timeRangeIdx !== 0 || programFilter !== '' || projectFilter !== '' || typeFilter !== '' || searchTerm.trim() !== '';
  const handleClearFilters = () => {
    setTimeRangeIdx(0);
    setProgramFilter('');
    setProjectFilter('');
    setProjectFilterName('');
    setTypeFilter('');
    setSearchTerm('');
    setRangeStart(getWeekStart());
    setRangeEnd(getWeekEnd());
    onFocusConsumed?.();
  };

  /* ── Sort entries ── */
  const sortedEntries = [...entries].sort((a, b) => {
    const cmp = a.entry_date.localeCompare(b.entry_date);
    return sortOrder === 'newest' ? -cmp : cmp;
  });

  /* ── Group entries by date ── */
  const groupedByDate: Record<string, EntryResponse[]> = {};
  for (const e of sortedEntries) {
    if (!groupedByDate[e.entry_date]) groupedByDate[e.entry_date] = [];
    groupedByDate[e.entry_date].push(e);
  }
  const dateKeys = Object.keys(groupedByDate).sort((a, b) => {
    const cmp = a.localeCompare(b);
    return sortOrder === 'newest' ? -cmp : cmp;
  });

  /* ── Merge cadence instances into date groups for display ── */
  const cadenceByDate: Record<string, (ScheduledItemInstance & { parent?: ScheduledItemParent })[]> = {};
  if (showCadences) {
    for (const ci of cadenceInstances) {
      if (!cadenceByDate[ci.due_date]) cadenceByDate[ci.due_date] = [];
      cadenceByDate[ci.due_date].push(ci);
    }
  }
  // Merge cadence dates into dateKeys
  const allDates = new Set([...dateKeys, ...Object.keys(cadenceByDate)]);
  const allDateKeys = [...allDates].sort((a, b) => {
    const cmp = a.localeCompare(b);
    return sortOrder === 'newest' ? -cmp : cmp;
  });

  /* ── Handle sort toggle ── */
  const handleSortToggle = () => {
    const next = sortOrder === 'newest' ? 'oldest' : 'newest';
    setSortOrder(next);
    writeSortOrder(next);
  };

  /* ── Scroll to top ── */
  const scrollToTop = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* ── Handle entry save from edit form ── */
  const handleEntrySaved = () => {
    closeEditModal();
    fetchEntries();
  };

  /* ── Render ── */
  return (
    <div ref={containerRef} style={{ position: 'relative', height: '100%', overflowY: 'auto', padding: '0 4px', maxWidth: '1100px' }}>
      {/* ── Project Focus Banner ── */}
      {projectFilter && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', marginBottom: '12px',
          background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--accent-primary)',
          animation: projectFocusGlow ? 'projectGlow 1.5s ease-in-out' : undefined,
        }}>
          <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>
            Showing entries for: <span style={{ color: 'var(--accent-primary)' }}>{projectFilterName || `Project #${projectFilter}`}</span>
          </span>
          <button
            onClick={() => { setProjectFilter(''); setProjectFilterName(''); onFocusConsumed?.(); }}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--card-border)', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', color: 'var(--text-muted)' }}
          >Clear filter</button>
        </div>
      )}
      {/* ── Filter Bar Row 1: Time Range + Shift Arrows + Date Label ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {TIME_RANGES.map((tr, idx) => (
          <button
            key={tr.label}
            style={filterPill(timeRangeIdx === idx)}
            onClick={() => {
              setTimeRangeIdx(idx);
              if (tr.label === 'Custom') {
                setCustomStart(rangeStart);
                setCustomEnd(rangeEnd);
              }
            }}
          >
            {tr.label}
          </button>
        ))}

        {/* Shift arrows (not shown for All or Custom) */}
        {TIME_RANGES[timeRangeIdx]?.label !== 'All' && TIME_RANGES[timeRangeIdx]?.label !== 'Custom' && (
          <>
            <button
              style={{ ...filterPill(false), padding: '5px 10px' }}
              onClick={() => handleShift(-1)}
              title={`Previous ${periodLabel()}`}
              aria-label={`Previous ${periodLabel()}`}
            >
              ←
            </button>
            <button
              style={{ ...filterPill(false), padding: '5px 10px' }}
              onClick={() => handleShift(1)}
              title={`Next ${periodLabel()}`}
              aria-label={`Next ${periodLabel()}`}
            >
              →
            </button>
          </>
        )}

        {/* Date range label */}
        {rangeStart && rangeEnd && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '4px' }}>
            {formatRangeLabel(rangeStart, rangeEnd)}
          </span>
        )}
        {TIME_RANGES[timeRangeIdx]?.label === 'All' && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '4px' }}>All time</span>
        )}
      </div>

      {/* Custom date inputs */}
      {TIME_RANGES[timeRangeIdx]?.label === 'Custom' && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
          <label style={lbl}>From</label>
          <input type="date" style={{ ...inp, width: '140px' }} value={customStart} onChange={e => { setCustomStart(e.target.value); setRangeStart(e.target.value); }} />
          <label style={lbl}>To</label>
          <input type="date" style={{ ...inp, width: '140px' }} value={customEnd} onChange={e => { setCustomEnd(e.target.value); setRangeEnd(e.target.value); }} />
        </div>
      )}

      {/* ── Filter Bar Row 2: Program + Type + Search + Density + Sort + Cadence toggle ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {/* Program filter */}
        <select
          style={{ ...inp, width: '150px' }}
          value={programFilter}
          onChange={e => setProgramFilter(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">All Programs</option>
          {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Type filter */}
        <select
          style={{ ...inp, width: '120px' }}
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          {TYPE_FILTERS.map(tf => <option key={tf.label} value={tf.value}>{tf.label}</option>)}
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Search entries…"
          style={{ ...inp, width: '180px' }}
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />

        {/* Density toggle */}
        <div style={{ display: 'flex', gap: '2px' }}>
          <button style={densityBtn(density === 'compact')} onClick={() => setDensity('compact')}>Compact</button>
          <button style={densityBtn(density === 'normal')} onClick={() => setDensity('normal')}>Normal</button>
        </div>

        {/* Sort toggle */}
        <button
          style={{ ...filterPill(false), fontSize: '11px', padding: '4px 10px' }}
          onClick={handleSortToggle}
          title={sortOrder === 'newest' ? 'Currently: Newest first' : 'Currently: Oldest first'}
        >
          {sortOrder === 'newest' ? '↓ Newest' : '↑ Oldest'}
        </button>

        {/* Cadence toggle */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}
          onClick={() => setShowCadences(v => !v)}>
          <span
            role="switch" aria-checked={showCadences} aria-label="Show cadences"
            style={{
              display: 'inline-block', width: '28px', height: '16px', borderRadius: '8px',
              background: showCadences ? 'var(--accent-primary)' : 'var(--input-border)',
              position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }}>
            <span style={{
              position: 'absolute', top: '2px', left: showCadences ? '14px' : '2px',
              width: '12px', height: '12px', borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }} />
          </span>
          Cadences
        </div>

        {/* Clear filters */}
        {isFiltersNonDefault && (
          <button
            onClick={handleClearFilters}
            style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Clear filters
          </button>
        )}

        <button className="refresh-btn" onClick={() => { fetchEntries(); fetchCadenceInstances(); }} title="Refresh data" style={{ marginLeft: 'auto' }}>
          <span className="refresh-icon">↻</span> Refresh
        </button>
      </div>

      {/* ── Loading state ── */}
      {loading && <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading entries…</p>}

      {/* ── Empty state ── */}
      {!loading && allDateKeys.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)' }}>
          <p>No entries found for the selected filters.</p>
        </div>
      )}

      {/* ── Entry list grouped by date ── */}
      {!loading && allDateKeys.map((dateKey, dateIdx) => {
        const dayEntries = groupedByDate[dateKey] || [];
        const dayCadences = cadenceByDate[dateKey] || [];
        const entryCount = dayEntries.length + dayCadences.length;
        return (
          <div key={dateKey} id={`timeline-date-${dateKey}`} style={{ background: dateIdx % 2 === 0 ? 'transparent' : 'var(--input-bg)', borderRadius: '6px', padding: '4px 6px', margin: '0 -6px' }}>
            {/* Date group separator (12.3) */}
            {dateIdx > 0 && (
              <hr style={{ border: 'none', borderTop: '1px solid var(--card-border)', margin: '20px 0 12px' }} />
            )}
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 8px', letterSpacing: '0.3px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{formatDayHeader(dateKey)}</span>
              {entryCount > 0 && (
                <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)', opacity: 0.8 }}>
                  · {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                </span>
              )}
            </h3>

            {/* Manual entries */}
            {dayEntries.map(entry => {
              const { icon, color } = typeIcon(entry);
              const borderColor = entryTypeBorderColor(entry.entry_type);
              const isCompact = density === 'compact';
              return (
                <div
                  key={entry.id}
                  id={`timeline-entry-${entry.id}`}
                  className="card"
                  style={{
                    padding: isCompact ? '10px 14px' : '16px',
                    marginBottom: isCompact ? '6px' : '12px',
                    borderLeft: borderColor ? `3px solid ${borderColor}` : undefined,
                    cursor: 'pointer',
                  }}
                  onClick={() => setEditingEntry(entry)}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ color, fontSize: '16px', lineHeight: '1.4' }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                          {highlightSearchTerm(entry.title, searchTerm)}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{visibleType(entry.entry_type)}</span>
                        {entry.program_name && (
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'var(--input-bg)', color: 'var(--text-muted)' }}>
                            {entry.program_name}
                          </span>
                        )}
                        {entry.project_name && (
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'var(--input-bg)', color: 'var(--text-muted)' }}>
                            {entry.project_name}
                          </span>
                        )}
                        {entry.scheduled_item_id && (
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>from: task</span>
                        )}
                        <button
                          title={entry.is_pinned ? 'Unpin' : 'Pin'}
                          onClick={(e) => handleToggleEntryPin(entry.id, entry.is_pinned, e)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', fontSize: '13px', lineHeight: 1, color: entry.is_pinned ? 'var(--icon-star)' : 'var(--text-muted)' }}
                        >{entry.is_pinned ? '★' : '☆'}</button>
                      </div>
                      {!isCompact && entry.description && (
                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                          {highlightSearchTerm(entry.description.slice(0, 200), searchTerm)}
                          {entry.description.length > 200 ? '…' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Cadence instances (12.4) */}
            {showCadences && dayCadences.map(ci => (
              <div
                key={`cadence-${ci.id}`}
                style={{
                  ...card,
                  padding: density === 'compact' ? '8px 14px' : '12px 16px',
                  marginBottom: density === 'compact' ? '6px' : '10px',
                  opacity: 0.6,
                  borderLeft: '3px solid var(--color-task, #4a9eff)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>↻</span>
                  <span style={{ fontWeight: 500, fontSize: '13px', color: 'var(--text-primary)' }}>
                    {ci.parent?.name ?? `Instance #${ci.id}`}
                  </span>
                  <span style={{
                    fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                    background: 'var(--input-bg)', color: 'var(--text-muted)', fontStyle: 'italic',
                  }}>
                    auto-logged
                  </span>
                  {ci.parent?.program_name && (
                    <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'var(--input-bg)', color: 'var(--text-muted)' }}>
                      {ci.parent.program_name}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {/* ── Scroll-to-top button (12.7) ── */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          style={{
            position: 'fixed', bottom: '32px', right: '32px', zIndex: 100,
            width: '40px', height: '40px', borderRadius: '50%',
            background: 'var(--accent-primary)', color: 'var(--text-on-primary)', border: 'none',
            fontSize: '18px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Scroll to top"
          aria-label="Scroll to top"
        >
          ↑
        </button>
      )}

      {/* ── Entry edit overlay ── */}
      {editingEntry && (
        <div
          ref={editOverlayRef}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'var(--modal-overlay)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={handleEditBackdropClick}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={editShaking ? 'modal-shake' : undefined}
            style={{ background: 'var(--card-bg)', borderRadius: '12px', width: '90%', maxWidth: '700px', maxHeight: '85vh', overflowY: 'auto', padding: '24px' }}
            onClick={e => e.stopPropagation()}
          >
            <EntryFormView
              editEntryId={editingEntry.id}
              onSaved={handleEntrySaved}
              onCancel={handleEditExplicitClose}
              onDirtyChange={setEditFormDirty}
            />
          </div>
          <DiscardConfirmDialog
            open={editConfirmOpen}
            onDiscard={editConfirmDiscard}
            onCancel={editConfirmCancel}
          />
        </div>
      )}
    </div>
  );
}
