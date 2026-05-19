import { useEffect, useRef, useState, useCallback } from 'react';
import { sectionStyle, formInputStyle as inputStyle, formLabelStyle as labelStyle, fieldStyle, btnPrimary, btnSecondary, btnDanger, chipStyle as sharedChipStyle, pillStyle as sharedPillStyle } from '../styles/sharedStyles';

/* ── Types ── */
interface Tag {
  id: number;
  name: string;
  created_at: string;
}

interface Link {
  id: number;
  parent_type: string;
  parent_id: number;
  url: string;
  label: string | null;
  created_at: string;
}

interface ProjectOption {
  id: number;
  name: string;
  goal_id: number | null;
}

interface ProgramBrief {
  id: number;
  name: string;
  status: string;
  color: string | null;
}

interface GoalBrief {
  id: number;
  program_id: number | null;
}

interface EntryResponse {
  id: number;
  created_at: string;
  updated_at: string;
  entry_date: string;
  entry_type: string;
  work_type: string;
  title: string;
  description: string | null;
  impact: string | null;
  metrics: string | null;
  project_id: number | null;
  project_name: string | null;
  program_id: number | null;
  status: string;
  visibility: string;
  is_accomplishment: number;
  is_lesson_learned: number;
  is_weekly_highlight: number;
  tags: Tag[];
  links: Link[];
}

interface EntryFormViewProps {
  editEntryId?: number | null;
  onSaved?: () => void;
  onCancel?: () => void;
  /**
   * Optional callback invoked whenever the form's dirty state changes.
   * "Dirty" means the user has edited at least one field since the form
   * was loaded (new entry: diff from empty defaults; edit: diff from the
   * entry fetched from the server).
   *
   * Used by callers (e.g. TimelineView's edit modal) to wire the shared
   * `useDirtyClose` guard without reaching into form internals. Requirement 11.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

/* ── Constants ── */
const ENTRY_TYPES = [
  'quick_capture', 'project_update', 'operational_rhythm', 'development',
  'recognition', 'decision', 'milestone', 'action_item',
] as const;

/** Simplified set for new entries (R7) — legacy types only shown when editing existing entries */
const NEW_ENTRY_TYPES: readonly string[] = [
  'quick_capture', 'project_update', 'decision', 'milestone', 'action_item',
];

const ENTRY_TYPE_CONFIG: Record<string, { emoji: string; label: string; color: string }> = {
  quick_capture:       { emoji: '', label: 'Quick Capture',       color: 'var(--accent-primary)' },
  project_update:      { emoji: '', label: 'Project Update',      color: 'var(--accent-secondary)' },
  operational_rhythm:  { emoji: '', label: 'Operational Rhythm',  color: 'var(--status-on-track)' },
  development:         { emoji: '', label: 'Development',         color: 'var(--text-secondary)' },
  recognition:         { emoji: '', label: 'Recognition',         color: 'var(--accent-warning)' },
  decision:            { emoji: '', label: 'Decision',            color: 'var(--accent-danger)' },
  milestone:           { emoji: '', label: 'Milestone',           color: 'var(--status-completed)' },
  action_item:         { emoji: '', label: 'Action Item',         color: 'var(--accent-danger)' },
};

const STATUS_OPTIONS = ['in_progress', 'completed', 'ongoing', 'paused'] as const;
const VISIBILITY_OPTIONS = ['personal', 'shareable'] as const;

/* ── Shared inline styles ── */

const chipStyle = (active: boolean, color?: string): React.CSSProperties => ({
  ...sharedChipStyle(color ?? 'var(--accent-primary)'),
  padding: '4px 10px',
  borderRadius: '8px',
  fontSize: '12px',
  cursor: 'pointer',
  color: active ? '#fff' : 'var(--text-secondary)',
  background: active ? (color ?? 'var(--accent-primary)') : 'var(--input-bg)',
  border: `1px solid ${active ? (color ?? 'var(--accent-primary)') : 'var(--input-border)'}`,
  transition: 'all 0.15s',
});

const pillStyle = (active: boolean, color?: string | null): React.CSSProperties => ({
  ...sharedPillStyle(active, color),
  gap: '4px',
  padding: '4px 12px',
  transition: 'all 0.15s ease',
});

const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: '8px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  color: active ? '#fff' : 'var(--text-secondary)',
  background: active ? 'var(--accent-primary)' : 'var(--input-bg)',
  border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--input-border)'}`,
  transition: 'all 0.15s',
});

/* ── Empty form state ── */
const today = () => new Date().toISOString().split('T')[0];

const emptyForm = () => ({
  entry_type: 'project_update' as string,
  work_type: 'project' as string,
  title: '',
  description: '',
  impact: '',
  metrics: '',
  project_id: '',
  status: 'completed' as string,
  visibility: 'shareable' as string,
  entry_date: today(),
  tag_ids: [] as number[],
});

/**
 * Serialize the user-editable fields into a stable string so the dirty check
 * reduces to a cheap string comparison against the baseline captured at
 * mount / after load / after a Save & New reset.
 *
 * Keeping this pure and module-scoped (Requirement 11.8 — isDirty predicate
 * must be side-effect free).
 */
function serializeDirtyFields(
  form: ReturnType<typeof emptyForm>,
  selectedProgramId: number | null,
  isPinned: number,
  outcome: string,
): string {
  // Sort tag_ids so ordering flips don't register as dirty.
  const sortedTagIds = [...form.tag_ids].sort((a, b) => a - b);
  return JSON.stringify({
    entry_type: form.entry_type,
    work_type: form.work_type,
    title: form.title,
    description: form.description,
    impact: form.impact,
    metrics: form.metrics,
    project_id: form.project_id,
    status: form.status,
    visibility: form.visibility,
    entry_date: form.entry_date,
    tag_ids: sortedTagIds,
    program_id: selectedProgramId,
    is_pinned: isPinned,
    outcome,
  });
}

export default function EntryFormView({ editEntryId, onSaved, onCancel, onDirtyChange }: EntryFormViewProps) {
  /* ── State ── */
  const [form, setForm] = useState(emptyForm());
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEdit, setIsEdit] = useState(false);

  /* ── Toggle flags (managed separately for edit mode) ── */
  const [isPinned, setIsPinned] = useState(0);
  const [outcome, setOutcome] = useState('');

  /* ── Links state ── */
  const [links, setLinks] = useState<Link[]>([]);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);

  /* ── Program state ── */
  const [programs, setPrograms] = useState<ProgramBrief[]>([]);
  const [allGoals, setAllGoals] = useState<GoalBrief[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);

  /* ── Track whether user has manually changed entry type ── */
  const [entryTypeManuallySet, setEntryTypeManuallySet] = useState(false);

  /* ── Progressive disclosure: secondary section collapsed by default for new, expanded for edit ── */
  const [showSecondary, setShowSecondary] = useState(false);

  /* ── Dirty-state baseline (Requirement 11) ──
     Snapshot of the fields at the last "clean" moment (mount for new entry,
     after loadEntry for edit, after reset on Save & New). When the live
     form diverges from this snapshot, the form is dirty and we notify the
     parent via onDirtyChange so it can route closes through useDirtyClose. */
  const baselineRef = useRef<string>(
    serializeDirtyFields(emptyForm(), null, 0, '')
  );
  const lastDirtyRef = useRef<boolean>(false);

  /* ── Fetch tags, projects, programs, goals on mount ── */
  useEffect(() => {
    (async () => {
      try {
        const [tagsRes, projRes, progRes, goalRes] = await Promise.all([
          fetch('/api/tags'),
          fetch('/api/projects'),
          fetch('/api/programs?status=active'),
          fetch('/api/goals'),
        ]);
        if (tagsRes.ok) setAllTags(await tagsRes.json());
        if (projRes.ok) {
          const data = await projRes.json();
          setProjects(
            data.map((p: { id: number; name: string; goal_id?: number | null }) => ({
              id: p.id, name: p.name, goal_id: p.goal_id ?? null,
            }))
          );
        }
        if (progRes.ok) {
          const data = await progRes.json();
          setPrograms(
            data.map((p: { id: number; name: string; status: string; color?: string | null }) => ({
              id: p.id, name: p.name, status: p.status, color: p.color ?? null,
            }))
          );
        }
        if (goalRes.ok) {
          const data = await goalRes.json();
          setAllGoals(
            data.map((g: { id: number; program_id?: number | null }) => ({
              id: g.id, program_id: g.program_id ?? null,
            }))
          );
        }
      } catch { /* ignore */ }
    })();
  }, []);

  /* ── Resolve program for a project (project → goal → program_id) ── */
  function resolveProgramForProject(projId: number): number | null {
    const proj = projects.find(p => p.id === projId);
    if (!proj?.goal_id) return null;
    const goal = allGoals.find(g => g.id === proj.goal_id);
    return goal?.program_id ?? null;
  }

  /* ── Title-based entry type inference (R14.4) ── */
  function inferEntryTypeFromTitle(title: string): string | null {
    const t = title.trimStart().toLowerCase();
    if (t.startsWith('decision:') || t.startsWith('decision -')) return 'decision';
    if (t.startsWith('milestone:') || t.startsWith('milestone -')) return 'milestone';
    if (t.startsWith('action:') || t.startsWith('todo:') || t.startsWith('to-do:')) return 'action_item';
    if (t.startsWith('update:') || t.startsWith('status:')) return 'project_update';
    // Legacy types — only infer when editing existing entries (R7)
    if (isEdit) {
      if (t.startsWith('lesson:') || t.startsWith('learned:')) return 'development';
      if (t.startsWith('recognition:') || t.startsWith('kudos:')) return 'recognition';
    }
    return null;
  }

  function handleTitleBlur() {
    if (entryTypeManuallySet) return;
    const inferred = inferEntryTypeFromTitle(form.title);
    if (inferred) {
      updateForm('entry_type', inferred);
    }
  }

  /* ── Filter projects by selected program ── */
  const filteredProjects = selectedProgramId
    ? projects.filter(p => {
        if (!p.goal_id) return true;
        const goal = allGoals.find(g => g.id === p.goal_id);
        return goal?.program_id === selectedProgramId || !goal?.program_id;
      })
    : projects;

  /* ── Handle program pill click ── */
  function handleProgramSelect(programId: number) {
    if (selectedProgramId === programId) {
      setSelectedProgramId(null);
    } else {
      setSelectedProgramId(programId);
      if (form.project_id) {
        const resolved = resolveProgramForProject(parseInt(form.project_id, 10));
        if (resolved && resolved !== programId) {
          updateForm('project_id', '');
        }
      }
    }
  }

  /* ── Handle project selection with auto-resolve ── */
  function handleProjectChange(newProjectId: string) {
    updateForm('project_id', newProjectId);
    if (newProjectId) {
      const resolved = resolveProgramForProject(parseInt(newProjectId, 10));
      if (resolved) {
        setSelectedProgramId(resolved);
      }
    }
  }

  /* ── Load entry for edit mode ── */
  const loadEntry = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/entries/${id}`);
      if (res.ok) {
        const entry: EntryResponse = await res.json();
        const loadedForm = {
          entry_type: entry.entry_type,
          work_type: entry.work_type,
          title: entry.title,
          description: entry.description ?? '',
          impact: entry.impact ?? '',
          metrics: entry.metrics ?? '',
          project_id: entry.project_id != null ? String(entry.project_id) : '',
          status: entry.status,
          visibility: entry.visibility,
          entry_date: entry.entry_date,
          tag_ids: entry.tags.map(t => t.id),
        };
        const loadedProgramId = entry.program_id ?? null;
        const loadedIsPinned = (entry as unknown as Record<string, number>).is_pinned ?? 0;
        const loadedOutcome = (entry as unknown as Record<string, string>).outcome ?? '';

        setForm(loadedForm);
        setSelectedProgramId(loadedProgramId);
        setIsPinned(loadedIsPinned);
        setOutcome(loadedOutcome);
        setLinks(entry.links ?? []);
        setIsEdit(true);
        setEntryTypeManuallySet(true); // Don't override entry type in edit mode
        setShowSecondary(true); // Expand secondary section for edit mode

        // Snap the dirty baseline to the server-loaded values. The next change
        // the user makes will flip the form into the dirty state.
        baselineRef.current = serializeDirtyFields(
          loadedForm,
          loadedProgramId,
          loadedIsPinned,
          loadedOutcome,
        );
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (editEntryId) {
      loadEntry(editEntryId);
    } else {
      const fresh = emptyForm();
      setForm(fresh);
      setSelectedProgramId(null);
      setIsPinned(0);
      setOutcome('');
      setLinks([]);
      setIsEdit(false);
      setEntryTypeManuallySet(false);
      setShowSecondary(false); // Collapse secondary section for new entries
      // Baseline = empty form. The next keystroke makes the form dirty.
      baselineRef.current = serializeDirtyFields(fresh, null, 0, '');
    }
  }, [editEntryId, loadEntry]);

  /* ── Emit dirty-state transitions to the parent (Requirement 11) ── */
  useEffect(() => {
    if (!onDirtyChange) return;
    const current = serializeDirtyFields(form, selectedProgramId, isPinned, outcome);
    const dirty = current !== baselineRef.current;
    if (dirty !== lastDirtyRef.current) {
      lastDirtyRef.current = dirty;
      onDirtyChange(dirty);
    }
  }, [form, selectedProgramId, isPinned, outcome, onDirtyChange]);

  /* ── Form helpers ── */
  function updateForm(key: string, value: string | number[]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function toggleTag(tagId: number) {
    setForm(prev => ({
      ...prev,
      tag_ids: prev.tag_ids.includes(tagId)
        ? prev.tag_ids.filter(id => id !== tagId)
        : [...prev.tag_ids, tagId],
    }));
  }

  const filteredTags = allTags.filter(
    t => t.name.toLowerCase().includes(tagSearch.toLowerCase()) && !form.tag_ids.includes(t.id)
  );

  /* ── Save entry ── */
  async function saveEntry(resetAfter: boolean) {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        entry_type: form.entry_type,
        work_type: form.work_type,
        title: form.title.trim(),
        description: form.description.trim() || '',
        impact: form.impact.trim() || '',
        metrics: form.metrics.trim() || '',
        project_id: form.project_id ? parseInt(form.project_id, 10) : null,
        program_id: selectedProgramId ?? null,
        status: form.status,
        visibility: form.visibility,
        entry_date: form.entry_date || today(),
        tag_ids: form.tag_ids,
      };

      if (!isEdit) {
        body.is_accomplishment = 0;
        body.is_pinned = isPinned;
        if (form.entry_type === 'decision') body.outcome = outcome.trim();
      } else {
        body.is_pinned = isPinned;
        if (form.entry_type === 'decision') body.outcome = outcome.trim();
      }

      const url = isEdit && editEntryId ? `/api/entries/${editEntryId}` : '/api/entries';
      const method = isEdit && editEntryId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        if (resetAfter) {
          const fresh = emptyForm();
          setForm(fresh);
          setSelectedProgramId(null);
          setIsPinned(0);
          setOutcome('');
          setLinks([]);
          setIsEdit(false);
          setEntryTypeManuallySet(false);
          setShowSecondary(false);
          setTagSearch('');
          // Re-snap baseline so Save & New leaves the form in a clean state.
          baselineRef.current = serializeDirtyFields(fresh, null, 0, '');
        }
        onSaved?.();
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  /* ── Pin toggle API call (edit mode) ── */
  async function togglePin() {
    if (!editEntryId) return;
    try {
      const res = await fetch(`/api/entries/${editEntryId}/pin`, { method: 'PATCH' });
      if (res.ok) setIsPinned(prev => (prev ? 0 : 1));
    } catch { /* ignore */ }
  }

  /* ── Link helpers ── */
  async function addLink() {
    if (!linkUrl.trim() || !editEntryId) return;
    setLinkSaving(true);
    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_type: 'entry', parent_id: editEntryId, url: linkUrl, label: linkLabel || null }),
      });
      if (res.ok) {
        setLinkUrl('');
        setLinkLabel('');
        loadEntry(editEntryId);
      }
    } catch { /* ignore */ }
    finally { setLinkSaving(false); }
  }

  async function deleteLink(linkId: number) {
    if (!editEntryId) return;
    if (!confirm('Remove this link?')) return;
    try {
      await fetch(`/api/links/${linkId}`, { method: 'DELETE' });
      loadEntry(editEntryId);
    } catch { /* ignore */ }
  }

  /* ── Render ── */
  return (
    <div style={{ maxWidth: '1000px' }}>
      <div style={sectionStyle}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary)' }}>
          {isEdit ? 'Edit Entry' : 'New Entry'}
        </h3>

        {/* ═══════════════════════════════════════════════════════════
            PRIMARY SECTION — Always visible
            Entry type, title, description, program, project, date, tags
            ═══════════════════════════════════════════════════════════ */}

        {/* ── Entry Type Chips ── */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Entry Type</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {(isEdit ? ENTRY_TYPES : NEW_ENTRY_TYPES).map(type => {
              const cfg = ENTRY_TYPE_CONFIG[type];
              if (!cfg) return null;
              return (
                <span
                  key={type}
                  style={chipStyle(form.entry_type === type, cfg.color)}
                  onClick={() => { setEntryTypeManuallySet(true); updateForm('entry_type', type); }}
                >
                  {cfg.label}
                </span>
              );
            })}
          </div>
        </div>

        {/* ── Title ── */}
        <div style={fieldStyle}>
          <label htmlFor="entry-title" style={labelStyle}>Title *</label>
          <input
            id="entry-title"
            style={inputStyle}
            value={form.title}
            onChange={e => updateForm('title', e.target.value)}
            onBlur={handleTitleBlur}
            placeholder="Entry title"
          />
        </div>

        {/* ── Description ── */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Description</label>
          <textarea
            style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }}
            value={form.description}
            onChange={e => updateForm('description', e.target.value)}
            placeholder="Describe the work (supports markdown)…"
          />
        </div>

        {/* ── Program Selector Pills ── */}
        {programs.length > 0 && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Program</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {programs.map(prog => (
                <span
                  key={prog.id}
                  style={pillStyle(selectedProgramId === prog.id, prog.color)}
                  onClick={() => handleProgramSelect(prog.id)}
                >
                  {prog.name}
                  {selectedProgramId === prog.id && ' ×'}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Project, Date, Visibility row ── */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ ...fieldStyle, flex: 1, minWidth: '160px' }}>
            <label htmlFor="entry-project" style={labelStyle}>Project</label>
            <select
              id="entry-project"
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={form.project_id}
              onChange={e => handleProjectChange(e.target.value)}
            >
              <option value="">— None —</option>
              {filteredProjects.map(p => (
                <option key={p.id} value={String(p.id)}>{p.name}</option>
              ))}
            </select>
          </div>
          <div style={{ ...fieldStyle, flex: 1, minWidth: '150px' }}>
            <label htmlFor="entry-date" style={labelStyle}>Entry Date</label>
            <input
              id="entry-date"
              type="date"
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={form.entry_date}
              onChange={e => updateForm('entry_date', e.target.value)}
            />
          </div>
          <div style={{ ...fieldStyle, flex: 1, minWidth: '130px' }}>
            <label htmlFor="entry-visibility" style={labelStyle}>Visibility</label>
            <select
              id="entry-visibility"
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={form.visibility}
              onChange={e => updateForm('visibility', e.target.value)}
            >
              {VISIBILITY_OPTIONS.map(v => (
                <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Tag Autocomplete ── */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Tags</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: form.tag_ids.length > 0 ? '8px' : '0' }}>
            {form.tag_ids.map(id => {
              const tag = allTags.find(t => t.id === id);
              if (!tag) return null;
              return (
                <span key={id} style={chipStyle(true)} onClick={() => toggleTag(id)}>
                  {tag.name} ×
                </span>
              );
            })}
          </div>
          <div style={{ position: 'relative' }}>
            <input
              style={inputStyle}
              value={tagSearch}
              onChange={e => { setTagSearch(e.target.value); setShowTagDropdown(true); }}
              onFocus={() => setShowTagDropdown(true)}
              onBlur={() => setTimeout(() => setShowTagDropdown(false), 200)}
              placeholder="Search tags…"
              aria-label="Search tags"
            />
            {showTagDropdown && filteredTags.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                background: 'var(--bg-secondary)', border: '1px solid var(--card-border)',
                borderRadius: '8px', marginTop: '4px', maxHeight: '160px', overflowY: 'auto',
                boxShadow: 'var(--shadow-soft)',
              }}>
                {filteredTags.map(tag => (
                  <div
                    key={tag.id}
                    style={{
                      padding: '8px 12px', cursor: 'pointer', fontSize: '13px',
                      color: 'var(--text-primary)',
                    }}
                    onMouseDown={() => { toggleTag(tag.id); setTagSearch(''); }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--input-bg)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {tag.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            SECONDARY SECTION — Collapsible "Impact & Details"
            Collapsed by default for new entries, expanded for edit mode
            Impact, metrics, status, toggles
            ═══════════════════════════════════════════════════════════ */}
        <div style={{ marginTop: '4px', marginBottom: '14px' }}>
          <button
            type="button"
            onClick={() => setShowSecondary(prev => !prev)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              fontSize: '13px',
              fontWeight: 500,
              color: 'var(--accent-primary)',
            }}
          >
            <span style={{
              display: 'inline-block',
              transition: 'transform 0.2s',
              transform: showSecondary ? 'rotate(90deg)' : 'rotate(0deg)',
            }}>
              ▶
            </span>
            Impact &amp; Details
          </button>
        </div>

        {showSecondary && (
          <div>
            {/* ── Impact & Metrics row ── */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ ...fieldStyle, flex: 1, minWidth: '200px' }}>
                <label style={labelStyle}>Impact</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                  value={form.impact}
                  onChange={e => updateForm('impact', e.target.value)}
                  placeholder="What was the impact?"
                />
              </div>
              <div style={{ ...fieldStyle, flex: 1, minWidth: '200px' }}>
                <label style={labelStyle}>Metrics</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                  value={form.metrics}
                  onChange={e => updateForm('metrics', e.target.value)}
                  placeholder="Quantifiable metrics…"
                />
              </div>
            </div>

            {/* ── Status ── */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ ...fieldStyle, flex: 1, minWidth: '130px' }}>
                <label style={labelStyle}>Status</label>
                <select
                  style={{ ...inputStyle, cursor: 'pointer' }}
                  value={form.status}
                  onChange={e => updateForm('status', e.target.value)}
                >
                  {STATUS_OPTIONS.map(s => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Pin Toggle ── */}
            <div style={{ ...fieldStyle, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                style={toggleBtnStyle(!!isPinned)}
                onClick={isEdit ? togglePin : () => setIsPinned(prev => (prev ? 0 : 1))}
              >
                {isPinned ? '★ Pinned' : '☆ Pin Entry'}
              </button>
            </div>

            {/* ── Outcome (Decision entries only) ── */}
            {form.entry_type === 'decision' && (
              <div style={fieldStyle}>
                <label style={labelStyle}>Outcome / Follow-up</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                  value={outcome}
                  onChange={e => setOutcome(e.target.value)}
                  placeholder="What was the outcome or follow-up of this decision?"
                />
              </div>
            )}
          </div>
        )}

        {/* ── Action Buttons ── */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <button
            style={{ ...btnPrimary, opacity: saving || !form.title.trim() ? 0.6 : 1 }}
            onClick={() => saveEntry(false)}
            disabled={saving || !form.title.trim()}
          >
            {saving ? 'Saving…' : isEdit ? 'Update Entry' : 'Save'}
          </button>
          {!isEdit && (
            <button
              style={{ ...btnSecondary, opacity: saving || !form.title.trim() ? 0.6 : 1 }}
              onClick={() => saveEntry(true)}
              disabled={saving || !form.title.trim()}
            >
              Save &amp; New
            </button>
          )}
          {isEdit && onCancel && (
            <button
              style={btnSecondary}
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* ── Links Section (edit mode only) ── */}
      {isEdit && editEntryId && (
        <div style={sectionStyle}>
          <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--accent-primary)' }}>Links</h4>
          {links.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 8px' }}>No links.</p>
          )}
          {links.map(link => (
            <div key={link.id} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '6px 12px', background: 'var(--input-bg)', borderRadius: '8px', marginBottom: '4px',
            }}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, color: 'var(--accent-primary)', fontSize: '13px', textDecoration: 'none' }}
              >
                {link.label || link.url}
              </a>
              <button style={btnDanger} onClick={() => deleteLink(link.id)}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
            <input
              style={{ ...inputStyle, flex: 2, minWidth: '180px' }}
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              placeholder="URL"
              aria-label="Link URL"
            />
            <input
              style={{ ...inputStyle, flex: 1, minWidth: '120px' }}
              value={linkLabel}
              onChange={e => setLinkLabel(e.target.value)}
              placeholder="Label (optional)"
              aria-label="Link label"
            />
            <button
              style={{ ...btnPrimary, opacity: linkSaving ? 0.6 : 1 }}
              onClick={addLink}
              disabled={linkSaving}
            >
              {linkSaving ? '…' : 'Add Link'}
            </button>
          </div>
        </div>
      )}

      {/* ── Delete Entry (edit mode only) ── */}
      {isEdit && editEntryId && (
        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--card-border)' }}>
          <button
            style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--accent-danger)', color: '#fff' }}
            onClick={async () => {
              if (!confirm('Delete this entry? This cannot be undone.')) return;
              try {
                const res = await fetch(`/api/entries/${editEntryId}`, { method: 'DELETE' });
                if (res.ok || res.status === 204) {
                  onSaved?.();
                  onCancel?.();
                }
              } catch { /* ignore */ }
            }}
          >
            Delete Entry
          </button>
        </div>
      )}
    </div>
  );
}
