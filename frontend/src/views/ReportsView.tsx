import { useEffect, useState, useRef } from 'react';
import { downloadPDF } from '../components/ExportPDF';
import ReportPreview, { generateReportHTML } from '../components/ReportPreview';
import { smartParse } from '../utils/smartParse';
import type { ParsedExport } from '../utils/smartParse';
import { readAppState, patchAppState } from '../utils/appState';
import { isoWeekNumber, fmtDate, getMonday, shiftWeek, shiftMonth, shiftQuarter } from '../utils/dateUtils';
import { sectionStyle, formInputStyle as inputStyle, formLabelStyle as labelStyle, btnPrimary, btnSecondary, scopeBtnStyle, pillStyle } from '../styles/sharedStyles';

/* ── Types ── */
interface ReportPreset {
  id: number; created_at: string; name: string; template_type: string;
  scope: string; program_id: number | null; sections: string; is_default: number;
}
interface ProgramBrief { id: number; name: string; status: string; }
interface SectionsConfig {
  executive_summary: boolean; program_sections: boolean; goals_with_smart: boolean;
  projects_with_status: boolean; key_entries: boolean; operational_cadence: boolean;
  decisions_log: boolean; other_work: boolean; lessons_learned: boolean;
  progress_log: boolean; risks_next_steps: boolean; open_tasks: boolean;
}

interface ReportDraft {
  id: number; title: string; content: string; status: string;
  preset_id: number | null; date_range_start: string | null;
  date_range_end: string | null; created_at: string; updated_at: string;
}

type TemplateType = 'asana' | 'modular';
type ScopeType = 'prev_week' | 'prev_month' | 'prev_quarter' | 'this_year' | 'custom';
const SCOPE_LABELS: Record<ScopeType, string> = {
  prev_week: 'Previous Week',
  prev_month: 'Previous Month',
  prev_quarter: 'Previous Quarter',
  this_year: 'This Year',
  custom: 'Custom',
};

const DEFAULT_SECTIONS: SectionsConfig = {
  executive_summary: true, program_sections: true, goals_with_smart: true,
  projects_with_status: true, key_entries: true, operational_cadence: true,
  decisions_log: false, other_work: true, lessons_learned: false,
  progress_log: false, risks_next_steps: false, open_tasks: false,
};
const SECTION_LABELS: Record<keyof SectionsConfig, string> = {
  executive_summary: 'Executive Summary', program_sections: 'Program Sections',
  goals_with_smart: 'Goals with SMART Context', projects_with_status: 'Projects with Status',
  key_entries: 'Key Entries / Accomplishments', operational_cadence: 'Operational Cadence Rates',
  decisions_log: 'Decisions Log', other_work: 'Other / Unassigned Work',
  lessons_learned: 'Lessons Learned', progress_log: 'Progress Log',
  risks_next_steps: 'Risks & Next Steps', open_tasks: 'Open Tasks',
};

/* ── Section groups for visual organization ── */
const SECTION_GROUPS: { label: string; keys: (keyof SectionsConfig)[] }[] = [
  { label: 'Overview', keys: ['executive_summary', 'risks_next_steps'] },
  { label: 'Programs & Goals', keys: ['program_sections', 'goals_with_smart'] },
  { label: 'Projects & Work', keys: ['projects_with_status', 'key_entries', 'other_work'] },
  { label: 'Operations', keys: ['operational_cadence', 'open_tasks'] },
  { label: 'Details', keys: ['decisions_log', 'lessons_learned', 'progress_log'] },
];

/* ── Date helpers ── */

function getPreviousWeek(): [string, string] {
  const now = new Date();
  const weekStart = getMonday(now); // getMonday now returns Sunday (week start)
  weekStart.setDate(weekStart.getDate() - 7);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  return [fmtDate(weekStart), fmtDate(weekEnd)];
}

function getPreviousMonth(): [string, string] {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return [fmtDate(first), fmtDate(last)];
}

function getPreviousQuarter(fyStartMonth: number): [string, string] {
  const now = new Date();
  const fyM = fyStartMonth - 1;
  // Determine which FY quarter we're in, then subtract one
  let currentQStart: Date | undefined;
  for (let i = 0; i < 4; i++) {
    const m = (fyM + i * 3) % 12;
    const y = now.getMonth() < fyM
      ? (m >= fyM ? now.getFullYear() - 1 : now.getFullYear())
      : (m >= fyM ? now.getFullYear() : now.getFullYear() + 1);
    const c = new Date(y, m, 1);
    const nQ = new Date(y, m + 3, 1);
    if (now >= c && now < nQ) { currentQStart = c; break; }
  }
  currentQStart ??= new Date(now.getFullYear(), now.getMonth(), 1);
  // Previous quarter = shift back 3 months
  const prevQStart = new Date(currentQStart.getFullYear(), currentQStart.getMonth() - 3, 1);
  const prevQEnd = new Date(prevQStart.getFullYear(), prevQStart.getMonth() + 3, 0);
  return [fmtDate(prevQStart), fmtDate(prevQEnd)];
}

function getThisYear(fyStartMonth: number): [string, string] {
  const now = new Date();
  const fyM = fyStartMonth - 1;
  const fyY = now.getMonth() >= fyM ? now.getFullYear() : now.getFullYear() - 1;
  return [fmtDate(new Date(fyY, fyM, 1)), fmtDate(now)];
}

function computeDateRange(scope: ScopeType, fyStartMonth: number): [string, string] {
  switch (scope) {
    case 'prev_week': return getPreviousWeek();
    case 'prev_month': return getPreviousMonth();
    case 'prev_quarter': return getPreviousQuarter(fyStartMonth);
    case 'this_year': return getThisYear(fyStartMonth);
    default: return [fmtDate(new Date()), fmtDate(new Date())];
  }
}

/* ── Shift helpers (navigation arrows) ── */

function shiftYear(start: string, direction: number, fyStartMonth: number): [string, string] {
  const d = new Date(start + 'T12:00:00');
  const fyM = fyStartMonth - 1;
  const newYear = d.getFullYear() + direction;
  const fyStart = new Date(newYear, fyM, 1);
  const now = new Date();
  // End is either today (if shifting to current FY) or end of FY
  const fyEnd = new Date(newYear + 1, fyM, 0);
  const end = fyEnd < now ? fyEnd : now;
  return [fmtDate(fyStart), fmtDate(end)];
}

/** ReportsView-specific range label that includes year info. */
function formatReportsRangeLabel(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const sMonth = s.toLocaleString('default', { month: 'short' });
  const eMonth = e.toLocaleString('default', { month: 'short' });
  let base: string;
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    base = `${sMonth} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
  } else if (s.getFullYear() === e.getFullYear()) {
    base = `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}, ${s.getFullYear()}`;
  } else {
    base = `${sMonth} ${s.getDate()}, ${s.getFullYear()} – ${eMonth} ${e.getDate()}, ${e.getFullYear()}`;
  }
  // If the range is exactly 6 days (a week), append the week number
  const diffDays = Math.round((e.getTime() - s.getTime()) / 86400000);
  if (diffDays === 6) return `${base} (W${isoWeekNumber(s)})`;
  return base;
}

export default function ReportsView() {
  /* Restore persisted state (R6.4) */
  const persisted = (() => { try { return readAppState().reportsView; } catch { return null; } })();

  const [template, setTemplate] = useState<TemplateType>((persisted?.template as TemplateType) || 'modular');
  const [scope, setScope] = useState<ScopeType>((persisted?.scope as ScopeType) || 'prev_week');
  const [scopeDateStart, setScopeDateStart] = useState('');
  const [scopeDateEnd, setScopeDateEnd] = useState('');
  const [scopeRangeLabel, setScopeRangeLabel] = useState('');
  const [sections, setSections] = useState<SectionsConfig>({ ...DEFAULT_SECTIONS });
  const [periodSummary, setPeriodSummary] = useState(false);
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [fyStartMonth, setFyStartMonth] = useState(10);
  const [presets, setPresets] = useState<ReportPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<number | null>(persisted?.activePresetId ?? null);
  const [savePresetName, setSavePresetName] = useState('');
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [programs, setPrograms] = useState<ProgramBrief[]>([]);
  const [previewMarkdown, setPreviewMarkdown] = useState('');
  const [structuredData, setStructuredData] = useState<ParsedExport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  /* ── Report Drafts state (Task 13.2) ── */
  const [drafts, setDrafts] = useState<ReportDraft[]>([]);
  const [editingDraft, setEditingDraft] = useState<ReportDraft | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftPreviewMode, setDraftPreviewMode] = useState(false);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);

  /* ── Ref to track if auto-generate has fired (Task 13.1) ── */
  const autoGeneratedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [sR, pR, prR, dR] = await Promise.all([
          fetch('/api/settings'), fetch('/api/report-presets'), fetch('/api/programs?status=active'),
          fetch('/api/report-drafts'),
        ]);
        if (sR.ok) { const d = await sR.json(); setFyStartMonth(parseInt(d.settings?.fiscal_year_start_month ?? '10', 10)); }
        if (pR.ok) setPresets(await pR.json());
        if (prR.ok) setPrograms(await prR.json());
        if (dR.ok) setDrafts(await dR.json());
      } catch { /* ignore */ }
    })();
  }, []);

  /* Persist reports config to localStorage (R6.4) */
  useEffect(() => {
    patchAppState({
      reportsView: { template, scope, activePresetId },
    });
  }, [template, scope, activePresetId]);

  /* ── Task 13.1: Auto-load default preset on mount ── */
  const [autoGenPending, setAutoGenPending] = useState(false);

  useEffect(() => {
    if (autoGeneratedRef.current || presets.length === 0) return;
    const defaultPreset = presets.find(p => p.is_default === 1);
    if (defaultPreset) {
      autoGeneratedRef.current = true;
      loadPreset(defaultPreset);
      setAutoGenPending(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets]);

  useEffect(() => {
    if (autoGenPending) {
      setAutoGenPending(false);
      generatePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenPending]);

  function loadPreset(preset: ReportPreset) {
    setActivePresetId(preset.id);
    setScope(preset.scope as ScopeType);
    setSelectedProgramId(preset.program_id);
    try { setSections({ ...DEFAULT_SECTIONS, ...JSON.parse(preset.sections) }); } catch { setSections({ ...DEFAULT_SECTIONS }); }
  }

  async function saveCustomPreset() {
    const name = savePresetName.trim();
    if (!name) return;
    try {
      const r = await fetch('/api/report-presets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, template_type: 'modular', scope, program_id: selectedProgramId, sections: JSON.stringify(sections), is_default: 0 }),
      });
      if (r.ok) { const c: ReportPreset = await r.json(); setPresets(p => [...p, c]); setActivePresetId(c.id); setSavePresetName(''); setShowSavePreset(false); }
    } catch { /* */ }
  }

  function toggleSection(key: keyof SectionsConfig) { setSections(p => ({ ...p, [key]: !p[key] })); setActivePresetId(null); }

  function handleScopeChange(newScope: ScopeType) {
    setScope(newScope);
    setScopeRangeLabel('');
    if (newScope !== 'custom') {
      const [s, e] = computeDateRange(newScope, fyStartMonth);
      setScopeDateStart(s);
      setScopeDateEnd(e);
    }
  }

  function handleShift(direction: number) {
    let newStart: string;
    let newEnd: string;
    if (scope === 'prev_week') {
      const base = scopeDateStart || computeDateRange('prev_week', fyStartMonth)[0];
      [newStart, newEnd] = shiftWeek(base, direction);
    } else if (scope === 'prev_month') {
      const base = scopeDateStart || computeDateRange('prev_month', fyStartMonth)[0];
      [newStart, newEnd] = shiftMonth(base, direction);
    } else if (scope === 'prev_quarter') {
      const base = scopeDateStart || computeDateRange('prev_quarter', fyStartMonth)[0];
      [newStart, newEnd] = shiftQuarter(base, direction);
    } else if (scope === 'this_year') {
      const base = scopeDateStart || computeDateRange('this_year', fyStartMonth)[0];
      [newStart, newEnd] = shiftYear(base, direction, fyStartMonth);
    } else {
      return;
    }
    setScopeDateStart(newStart);
    setScopeDateEnd(newEnd);
    setScopeRangeLabel(formatReportsRangeLabel(newStart, newEnd));
  }

  async function generatePreview() {
    setGenerating(true); setPreviewMarkdown(''); setStructuredData(null);
    try {
      let ds: string, de: string;
      if (scope === 'custom') { ds = customStart; de = customEnd; }
      else if (scopeDateStart && scopeDateEnd) { ds = scopeDateStart; de = scopeDateEnd; }
      else { [ds, de] = computeDateRange(scope, fyStartMonth); }

      // Fetch raw data for client-side structured parsing
      const params = new URLSearchParams({ date_start: ds, date_end: de });
      if (selectedProgramId) params.set('program_id', String(selectedProgramId));

      const [entriesRes, projectsRes, goalsRes, settingsRes] = await Promise.all([
        fetch(`/api/entries?${params.toString()}`),
        fetch('/api/projects'),
        fetch('/api/goals'),
        fetch('/api/settings'),
      ]);

      if (!entriesRes.ok || !projectsRes.ok || !goalsRes.ok || !settingsRes.ok) {
        setPreviewMarkdown('Error fetching report data.');
        return;
      }

      const entries = await entriesRes.json();
      const allProjects = await projectsRes.json();
      const goals = await goalsRes.json();
      const settingsData = await settingsRes.json();
      const settings = settingsData.settings ?? settingsData;

      // Filter projects to those with entries in range or active status
      const projectIdsInRange = new Set(entries.map((e: { project_id: number | null }) => e.project_id).filter(Boolean));
      const projects = allProjects.filter((p: { id: number; status: string }) =>
        projectIdsInRange.has(p.id) || p.status === 'active'
      );

      // Determine template type for smartParse
      const parseTemplate = template === 'asana' ? 'asana_status' : 'modular';

      // Run client-side structured parsing
      const parsed = smartParse(
        parseTemplate,
        entries,
        projects.map((p: { id: number; name: string; description?: string | null; status: string; goal_id?: number | null }) => ({
          id: p.id, name: p.name, description: p.description ?? null,
          status: p.status, goal_id: p.goal_id ?? null, goal_title: null,
        })),
        goals.map((g: { id: number; title: string; description?: string | null; status: string; specific?: string | null; measurable?: string | null; fiscal_year?: number | null; quarter?: number | null; target_date?: string | null }) => ({
          id: g.id, title: g.title, description: g.description ?? null,
          status: g.status, specific: g.specific ?? null, measurable: g.measurable ?? null,
          fiscal_year: g.fiscal_year ?? null, quarter: g.quarter ?? null, target_date: g.target_date ?? null,
        })),
        [], // lessons (not fetched separately — entries with is_lesson_learned cover this)
        [], // reviewNotes (not applicable for modular reports)
        { user_name: settings.user_name, user_role: settings.user_role, user_org: settings.user_org },
        [ds, de],
        null, // sessionNotes
      );

      // v3.0: Filter sections based on the sections config (Req 8)
      // Only include sections that are enabled in the modular report config
      if (template === 'modular' && sections && parsed.sections) {
        const sectionFlags = sections as unknown as Record<string, boolean>;
        parsed.sections = parsed.sections.filter(section => {
          // Default to enabled if not explicitly disabled
          return sectionFlags[section.id] !== false;
        });
      }

      setStructuredData(parsed);

      // Also fetch the markdown from the backend for Copy/Draft fallback
      const body: Record<string, unknown> = {
        template_type: template === 'asana' ? 'asana_status' : 'modular',
        date_range_start: ds, date_range_end: de,
        scope: periodSummary ? 'period_summary' : scope, program_id: selectedProgramId,
      };
      if (template === 'modular') body.sections = sections;
      const r = await fetch('/api/export/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) {
        const d = await r.json();
        setPreviewMarkdown(d.markdown ?? d.content ?? '');
      }
    } catch { setPreviewMarkdown('Failed to generate report.'); }
    finally { setGenerating(false); }
  }

  async function handleCopy() {
    if (structuredData) {
      try {
        const html = generateReportHTML(structuredData);
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([html.replace(/<[^>]+>/g, '')], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })]);
      } catch {
        navigator.clipboard.writeText(previewMarkdown);
      }
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadPDF() {
    if (structuredData) {
      fetch('/api/settings').then(r => r.json()).then(d => {
        downloadPDF(structuredData, d.settings?.user_name ?? '');
      }).catch(() => {});
    } else if (previewMarkdown) {
      // Fallback: wrap markdown in a basic structured format
      fetch('/api/settings').then(r => r.json()).then(d => {
        const userName = d.settings?.user_name ?? '';
        const parsed: ParsedExport = {
          title: `${userName} — Report`, subtitle: '', dateRange: '', sessionNotes: null,
          sections: [{ id: 'report', heading: 'Report', order: 0, enabled: true,
            items: [{ id: 0, entityType: 'entry' as const, title: previewMarkdown, description: null, date: null, projectName: null, metrics: null, impact: null, entryType: null, status: null, reviewNote: null, enabled: true }],
          }],
        };
        downloadPDF(parsed, userName);
      }).catch(() => {});
    }
  }

  /* ── Task 13.2: Report Drafts CRUD ── */

  async function fetchDrafts() {
    try {
      const r = await fetch('/api/report-drafts');
      if (r.ok) setDrafts(await r.json());
    } catch { /* ignore */ }
  }

  async function saveAsDraft() {
    if (!previewMarkdown && !structuredData) return;
    setDraftSaving(true);
    try {
      // Improved auto-naming: "Week {N} Summary — {preset name}"
      const weekNum = isoWeekNumber(new Date());
      const presetName = activePresetId ? presets.find(p => p.id === activePresetId)?.name : null;
      const title = presetName
        ? `Week ${weekNum} Summary — ${presetName}`
        : `Week ${weekNum} Summary — ${new Date().toLocaleDateString()}`;
      const content = previewMarkdown || '';
      const body: Record<string, unknown> = { title, content, status: 'draft' };
      if (activePresetId) body.preset_id = activePresetId;
      if (scopeDateStart) body.date_range_start = scopeDateStart;
      if (scopeDateEnd) body.date_range_end = scopeDateEnd;
      const r = await fetch('/api/report-drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) { await fetchDrafts(); }
    } catch { /* ignore */ }
    finally { setDraftSaving(false); }
  }

  function openDraftEditor(draft: ReportDraft) {
    setEditingDraft(draft);
    setEditContent(draft.content);
    setEditTitle(draft.title);
    setDraftPreviewMode(false);
  }

  /** Insert markdown syntax at cursor position in the draft textarea */
  function insertMarkdownSyntax(syntax: string, wrap?: boolean) {
    const textarea = draftTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = editContent.slice(start, end);
    let insertion: string;
    let cursorOffset: number;
    if (wrap && selected) {
      insertion = `${syntax}${selected}${syntax}`;
      cursorOffset = start + insertion.length;
    } else if (wrap) {
      insertion = `${syntax}${syntax}`;
      cursorOffset = start + syntax.length;
    } else {
      // Line-level syntax (heading, list, hr) — insert at line start or cursor
      const prefix = start > 0 && editContent[start - 1] !== '\n' ? '\n' : '';
      insertion = `${prefix}${syntax}`;
      cursorOffset = start + insertion.length;
    }
    const newContent = editContent.slice(0, start) + insertion + editContent.slice(end);
    setEditContent(newContent);
    // Restore focus and cursor position after React re-render
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursorOffset, cursorOffset);
    });
  }

  /** Simple markdown to HTML renderer for preview */
  function renderMarkdownPreview(md: string): string {
    return md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^## (.+)$/gm, '<h2 style="margin:12px 0 6px;font-size:16px;font-weight:600">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="margin:12px 0 6px;font-size:18px;font-weight:700">$1</h1>')
      .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--card-border);margin:12px 0"/>')
      .replace(/^\d+\.\s(.+)$/gm, '<li style="margin-left:20px;list-style:decimal">$1</li>')
      .replace(/^- (.+)$/gm, '<li style="margin-left:20px;list-style:disc">$1</li>')
      .replace(/\n/g, '<br/>');
  }

  async function saveDraftEdits() {
    if (!editingDraft) return;
    setDraftSaving(true);
    try {
      const r = await fetch(`/api/report-drafts/${editingDraft.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      });
      if (r.ok) {
        const updated = await r.json();
        setDrafts(prev => prev.map(d => d.id === updated.id ? updated : d));
        setEditingDraft(updated);
      }
    } catch { /* ignore */ }
    finally { setDraftSaving(false); }
  }

  async function updateDraftStatus(draftId: number, newStatus: string) {
    try {
      const r = await fetch(`/api/report-drafts/${draftId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (r.ok) {
        const updated = await r.json();
        setDrafts(prev => prev.map(d => d.id === updated.id ? updated : d));
        if (editingDraft?.id === draftId) setEditingDraft(updated);
      }
    } catch { /* ignore */ }
  }

  async function deleteDraft(draftId: number) {
    try {
      const r = await fetch(`/api/report-drafts/${draftId}`, { method: 'DELETE' });
      if (r.ok) {
        setDrafts(prev => prev.filter(d => d.id !== draftId));
        if (editingDraft?.id === draftId) setEditingDraft(null);
      }
    } catch { /* ignore */ }
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* ── Template Selector ── */}
          <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginRight: '4px' }}>Template:</span>
            <button style={scopeBtnStyle(template === 'asana')} onClick={() => setTemplate('asana')}>Status Update</button>
            <button style={scopeBtnStyle(template === 'modular')} onClick={() => setTemplate('modular')}>Modular Report</button>
          </div>

          {/* ── Preset Bar (Modular only) ── */}
          {template === 'modular' && (
            <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginRight: '4px' }}>Presets:</span>
              {presets.map(p => (
                <span key={p.id} style={pillStyle(activePresetId === p.id)} onClick={() => loadPreset(p)}>
                  {p.name}{p.is_default ? ' ★' : ''}
                </span>
              ))}
              {!showSavePreset ? (
                <span style={{ ...pillStyle(false), borderStyle: 'dashed' }} onClick={() => setShowSavePreset(true)}>+ Save</span>
              ) : (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input style={{ ...inputStyle, width: '140px', padding: '6px 10px', fontSize: '13px' }}
                    value={savePresetName} onChange={e => setSavePresetName(e.target.value)}
                    placeholder="Preset name…" onKeyDown={e => e.key === 'Enter' && saveCustomPreset()} autoFocus />
                  <button style={{ ...btnPrimary, padding: '6px 12px', fontSize: '12px' }} onClick={saveCustomPreset}>Save</button>
                  <button style={{ ...btnSecondary, padding: '6px 10px', fontSize: '12px' }} onClick={() => setShowSavePreset(false)}>×</button>
                </div>
              )}
            </div>
          )}

          {/* ── Config Panel ── */}
          <div style={sectionStyle}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary)' }}>Configuration</h3>

            {/* Scope */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Scope</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                {scope !== 'custom' && (
                  <>
                    <button
                      onClick={() => handleShift(-1)}
                      aria-label="Previous period"
                      style={{
                        ...scopeBtnStyle(false),
                        padding: '5px 8px',
                        fontSize: '14px',
                        lineHeight: 1,
                      }}
                    >←</button>
                    <button
                      onClick={() => handleShift(1)}
                      aria-label="Next period"
                      style={{
                        ...scopeBtnStyle(false),
                        padding: '5px 8px',
                        fontSize: '14px',
                        lineHeight: 1,
                      }}
                    >→</button>
                  </>
                )}
                {(Object.keys(SCOPE_LABELS) as ScopeType[]).map(s => (
                  <button key={s} style={scopeBtnStyle(scope === s)} onClick={() => handleScopeChange(s)}>
                    {SCOPE_LABELS[s]}
                  </button>
                ))}
                {scopeRangeLabel && scope !== 'custom' && (
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500, marginLeft: '4px' }}>{scopeRangeLabel}</span>
                )}
              </div>
            </div>

            {/* Custom date range */}
            {scope === 'custom' && (
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <label style={labelStyle}>Start Date</label>
                  <input type="date" style={{ ...inputStyle, cursor: 'pointer' }} value={customStart} onChange={e => setCustomStart(e.target.value)} />
                </div>
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <label style={labelStyle}>End Date</label>
                  <input type="date" style={{ ...inputStyle, cursor: 'pointer' }} value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
                </div>
              </div>
            )}

            {/* Program filter */}
            {programs.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Program Filter</label>
                <select style={{ ...inputStyle, width: '240px', cursor: 'pointer' }}
                  value={selectedProgramId ?? ''} onChange={e => setSelectedProgramId(e.target.value ? parseInt(e.target.value, 10) : null)}>
                  <option value="">All Programs</option>
                  {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}

            {/* Section toggles (Modular only) */}
            {template === 'modular' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Sections</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {SECTION_GROUPS.map(group => (
                    <div key={group.label}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{group.label}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px' }}>
                        {group.keys.map(key => (
                          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'var(--input-bg)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                            <input type="checkbox" checked={sections[key]} onChange={() => toggleSection(key)} style={{ accentColor: 'var(--accent-primary)' }} />
                            {SECTION_LABELS[key]}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Period Summary toggle */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={periodSummary} onChange={() => setPeriodSummary(p => !p)} style={{ accentColor: 'var(--accent-primary)' }} />
                Period Summary (trajectory data over time)
              </label>
            </div>

            {/* Generate button */}
            <button style={{ ...btnPrimary, opacity: generating ? 0.6 : 1 }} onClick={generatePreview} disabled={generating}>
              {generating ? 'Generating…' : 'Generate Preview'}
            </button>
          </div>

          {/* ── Preview Panel ── */}
          {structuredData && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)', flex: 1 }}>Preview</h3>
                <button style={{ ...btnSecondary, opacity: draftSaving ? 0.6 : 1 }} onClick={saveAsDraft} disabled={draftSaving}>
                  {draftSaving ? 'Saving…' : 'Save as Draft'}
                </button>
                <button style={btnSecondary} onClick={handleCopy}>{copied ? 'Copied!' : 'Copy'}</button>
                <button style={btnPrimary} onClick={handleDownloadPDF}>Download PDF</button>
              </div>
              <ReportPreview data={structuredData} />
              {structuredData.sections.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0', fontSize: '14px' }}>
                  No sections selected. Toggle on at least one section to generate a report.
                </p>
              )}
            </div>
          )}
          {!structuredData && previewMarkdown && !generating && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)', flex: 1 }}>Preview</h3>
                <button style={{ ...btnSecondary, opacity: draftSaving ? 0.6 : 1 }} onClick={saveAsDraft} disabled={draftSaving}>
                  {draftSaving ? 'Saving…' : 'Save as Draft'}
                </button>
                <button style={btnSecondary} onClick={handleCopy}>{copied ? 'Copied!' : 'Copy'}</button>
                <button style={btnPrimary} onClick={handleDownloadPDF}>Download PDF</button>
              </div>
              <div
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '8px', padding: '20px', fontSize: '13px', lineHeight: '1.8', color: 'var(--text-primary)', maxHeight: '60vh', overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
                dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(previewMarkdown) }}
              />
            </div>
          )}

          {/* ── Report Drafts Section (Task 13.2) ── */}
          <div style={sectionStyle}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary)' }}>Drafts</h3>
            {drafts.length === 0 && !editingDraft && (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>No drafts yet. Generate a report and save it as a draft.</p>
            )}
            {!editingDraft && drafts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {drafts.map(draft => (
                  <div key={draft.id} style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '10px 14px', background: 'var(--input-bg)', borderRadius: '8px',
                    cursor: 'pointer',
                  }} onClick={() => openDraftEditor(draft)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {draft.title}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Updated {new Date(draft.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '10px',
                      background: draft.status === 'ready' ? 'var(--accent-primary)' : draft.status === 'sent' ? 'var(--status-on-track)' : 'var(--bg-tertiary)',
                      color: draft.status === 'ready' ? 'var(--text-on-primary)' : draft.status === 'sent' ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                    }}>
                      {draft.status}
                    </span>
                    <select
                      style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer' }}
                      value={draft.status}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { e.stopPropagation(); updateDraftStatus(draft.id, e.target.value); }}
                    >
                      <option value="draft">draft</option>
                      <option value="ready">ready</option>
                      <option value="sent">sent</option>
                    </select>
                    <button
                      onClick={e => { e.stopPropagation(); deleteDraft(draft.id); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px', padding: '4px 8px', borderRadius: '4px' }}
                      title="Delete draft"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            {editingDraft && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button style={{ ...btnSecondary, padding: '6px 12px', fontSize: '12px' }} onClick={() => setEditingDraft(null)}>← Back</button>
                  <input
                    style={{ ...inputStyle, flex: 1, fontSize: '14px', fontWeight: 500 }}
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="Draft title…"
                  />
                  <select
                    style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer' }}
                    value={editingDraft.status}
                    onChange={e => updateDraftStatus(editingDraft.id, e.target.value)}
                  >
                    <option value="draft">draft</option>
                    <option value="ready">ready</option>
                    <option value="sent">sent</option>
                  </select>
                </div>
                {/* Markdown toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 8px', background: 'var(--input-bg)', borderRadius: '6px 6px 0 0', border: '1px solid var(--input-border)', borderBottom: 'none' }}>
                  <button type="button" title="Bold (**)" onClick={() => insertMarkdownSyntax('**', true)}
                    style={{ padding: '4px 8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', borderRadius: '4px', color: 'var(--text-primary)' }}>B</button>
                  <button type="button" title="Heading (##)" onClick={() => insertMarkdownSyntax('## ')}
                    style={{ padding: '4px 8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', borderRadius: '4px', color: 'var(--text-primary)' }}>H</button>
                  <button type="button" title="Bullet list (-)" onClick={() => insertMarkdownSyntax('- ')}
                    style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', borderRadius: '4px', color: 'var(--text-primary)' }}>•</button>
                  <button type="button" title="Numbered list (1.)" onClick={() => insertMarkdownSyntax('1. ')}
                    style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', borderRadius: '4px', color: 'var(--text-primary)' }}>1.</button>
                  <button type="button" title="Horizontal rule (---)" onClick={() => insertMarkdownSyntax('---')}
                    style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', borderRadius: '4px', color: 'var(--text-primary)' }}>―</button>
                  <div style={{ flex: 1 }} />
                  <button type="button" onClick={() => setDraftPreviewMode(!draftPreviewMode)}
                    style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', background: draftPreviewMode ? 'var(--accent-primary)' : 'transparent', color: draftPreviewMode ? 'var(--text-on-primary)' : 'var(--text-secondary)', border: '1px solid var(--card-border)', borderRadius: '4px' }}>
                    {draftPreviewMode ? 'Edit' : 'Preview'}
                  </button>
                </div>
                {draftPreviewMode ? (
                  <div
                    style={{ ...inputStyle, minHeight: '300px', fontFamily: 'inherit', fontSize: '13px', lineHeight: '1.6', overflow: 'auto', borderRadius: '0 0 6px 6px', borderTop: 'none' }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(editContent) }}
                  />
                ) : (
                  <textarea
                    ref={draftTextareaRef}
                    style={{ ...inputStyle, minHeight: '300px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.5', resize: 'vertical', borderRadius: '0 0 6px 6px', borderTop: 'none' }}
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    placeholder="Draft content (markdown)…"
                  />
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button style={{ ...btnPrimary, opacity: draftSaving ? 0.6 : 1 }} onClick={saveDraftEdits} disabled={draftSaving}>
                    {draftSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button style={btnSecondary} onClick={() => setEditingDraft(null)}>Cancel</button>
                  <div style={{ flex: 1 }} />
                  <button
                    style={{ ...btnSecondary, color: 'var(--accent-danger)', borderColor: 'var(--accent-danger)' }}
                    onClick={() => deleteDraft(editingDraft.id)}
                  >Delete Draft</button>
                </div>
              </div>
            )}
          </div>
    </div>
  );
}
