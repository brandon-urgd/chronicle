/**
 * Smart Parse Engine — categorizes entries, projects, goals, and lessons
 * into structured export sections based on template type.
 *
 * Each section and item has an `enabled` flag for user toggling.
 */

/* ── Types ── */

export interface ExportItem {
  id: number;
  entityType: 'entry' | 'project' | 'goal' | 'lesson';
  title: string;
  description: string | null;
  metrics: string | null;
  impact: string | null;
  projectName: string | null;
  date: string | null;
  entryType: string | null;
  status: string | null;
  reviewNote: string | null;
  enabled: boolean;
}

export interface CadenceRow {
  name: string;
  completed: number;
  total: number;
  rate: number;
  skipped?: number;
  skipReasons?: string;
}

export interface ExportSection {
  id: string;
  heading: string;
  items: ExportItem[];
  enabled: boolean;
  order: number;
  /** Marks this section as a top-level program grouping header */
  isProgramSection?: boolean;
  /** Operational Cadence table rows for this program section */
  cadenceData?: CadenceRow[];
}

export interface ParsedExport {
  title: string;
  subtitle: string;
  dateRange: string;
  sections: ExportSection[];
  sessionNotes: string | null;
}

/* ── Input types (match API responses) ── */

interface EntryData {
  id: number; title: string; description: string | null; entry_type: string;
  work_type: string; entry_date: string; impact: string | null; metrics: string | null;
  project_id: number | null; project_name: string | null; status: string;
  visibility: string; is_accomplishment: number; is_lesson_learned: number;
  is_weekly_highlight: number;
}

interface ProjectData {
  id: number; name: string; description: string | null; status: string;
  goal_id: number | null; goal_title: string | null;
}

interface GoalData {
  id: number; title: string; description: string | null; status: string;
  specific: string | null; measurable: string | null;
  fiscal_year: number | null; quarter: number | null; target_date: string | null;
}

interface LessonData {
  id: number; title: string; context: string | null; lesson: string | null;
  application: string | null; date_range_label: string | null;
  source_project_name: string | null;
}

interface ReviewNoteData {
  parent_type: string | null; parent_id: number | null; note_text: string;
}

interface Settings {
  user_name?: string; user_role?: string; user_org?: string;
}

/* ── Helpers ── */

function findNote(notes: ReviewNoteData[], type: string, id: number): string | null {
  const n = notes.find(r => r.parent_type === type && r.parent_id === id);
  return n?.note_text ?? null;
}

function makeItem(
  id: number, entityType: ExportItem['entityType'], title: string,
  opts: Partial<Omit<ExportItem, 'id' | 'entityType' | 'title' | 'enabled'>> = {},
): ExportItem {
  return { id, entityType, title, description: null, metrics: null, impact: null,
    projectName: null, date: null, entryType: null, status: null, reviewNote: null,
    enabled: true, ...opts };
}

function trim(text: string | null, max = 200): string {
  if (!text) return '';
  if (text.length <= max) return text;
  const idx = text.indexOf('. ');
  if (idx > 0 && idx < max) return text.slice(0, idx + 1);
  return text.slice(0, max).trimEnd() + '…';
}

let sectionOrder = 0;
function section(id: string, heading: string, items: ExportItem[]): ExportSection {
  return { id, heading, items, enabled: items.length > 0, order: sectionOrder++ };
}

/* ── Main Parse Function ── */

export function smartParse(
  template: string,
  entries: EntryData[],
  projects: ProjectData[],
  goals: GoalData[],
  lessons: LessonData[],
  reviewNotes: ReviewNoteData[],
  settings: Settings,
  dateRange: [string, string],
  sessionNotes: string | null,
): ParsedExport {
  sectionOrder = 0;

  const userName = settings.user_name ?? '';
  const userRole = settings.user_role ?? '';
  const userOrg = settings.user_org ?? '';
  const subtitleParts = [userName, userRole, userOrg].filter(Boolean).join(', ');
  const dateRangeStr = `${dateRange[0]} — ${dateRange[1]}`;

  const shareable = entries.filter(e => e.visibility === 'shareable');
  const projMap: Record<number, string> = {};
  projects.forEach(p => { projMap[p.id] = p.name; });

  switch (template) {
    case 'leadership_update': return parseLeadershipUpdate(shareable, projects, lessons, reviewNotes, subtitleParts, dateRangeStr, sessionNotes, projMap);
    case 'self_review': return parseSelfReview(entries, projects, goals, lessons, reviewNotes, subtitleParts, dateRangeStr, sessionNotes, projMap);
    case 'weekly_summary': return parseWeeklySummary(entries, reviewNotes, subtitleParts, dateRangeStr, sessionNotes, projMap);
    case 'asana_status': return parseStatusUpdate(shareable, projects, goals, lessons, reviewNotes, subtitleParts, dateRangeStr, sessionNotes, projMap);
    default: return parseLeadershipUpdate(shareable, projects, lessons, reviewNotes, subtitleParts, dateRangeStr, sessionNotes, projMap);
  }
}

/* ── Leadership Update ── */
function parseLeadershipUpdate(
  entries: EntryData[], _projects: ProjectData[], lessons: LessonData[],
  notes: ReviewNoteData[], subtitle: string, dateRange: string, sessionNotes: string | null,
  projMap: Record<number, string>,
): ParsedExport {
  const opRhythm = entries.filter(e => e.work_type === 'operational_rhythm');
  const nonOp = entries.filter(e => e.work_type !== 'operational_rhythm');

  // Group by project
  const byProject: Record<string, EntryData[]> = {};
  nonOp.forEach(e => {
    const key = e.project_id ? projMap[e.project_id] ?? `Project ${e.project_id}` : 'Other Work';
    (byProject[key] ??= []).push(e);
  });

  const sections: ExportSection[] = [];
  for (const [projName, group] of Object.entries(byProject)) {
    const sorted = [...group].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    sections.push(section(`proj-${projName}`, projName, sorted.map(e =>
      makeItem(e.id, 'entry', e.title, { description: trim(e.description), metrics: e.metrics, impact: e.impact,
        projectName: e.project_name, date: e.entry_date, entryType: e.entry_type, status: e.status,
        reviewNote: findNote(notes, 'entry', e.id) })
    )));
  }

  if (opRhythm.length > 0) {
    sections.push(section('op-rhythm', 'Operational Rhythm', opRhythm.map(e =>
      makeItem(e.id, 'entry', e.title, { description: trim(e.description), date: e.entry_date,
        projectName: e.project_name, reviewNote: findNote(notes, 'entry', e.id) })
    )));
  }

  if (lessons.length > 0) {
    sections.push(section('lessons', 'Lessons Learned', lessons.map(l =>
      makeItem(l.id, 'lesson', l.title, { description: trim(l.context), reviewNote: findNote(notes, 'lesson', l.id) })
    )));
  }

  return { title: 'Performance Update', subtitle, dateRange, sections, sessionNotes };
}

/* ── Self-Review ── */
function parseSelfReview(
  entries: EntryData[], projects: ProjectData[], goals: GoalData[], lessons: LessonData[],
  notes: ReviewNoteData[], subtitle: string, dateRange: string, sessionNotes: string | null,
  _projMap: Record<number, string>,
): ParsedExport {
  const sections: ExportSection[] = [];
  const opRhythm = entries.filter(e => e.work_type === 'operational_rhythm');
  const nonOp = entries.filter(e => e.work_type !== 'operational_rhythm');
  const entriesByProject: Record<number, EntryData[]> = {};
  nonOp.forEach(e => { if (e.project_id) (entriesByProject[e.project_id] ??= []).push(e); });

  for (const goal of goals) {
    const goalProjects = projects.filter(p => p.goal_id === goal.id);
    const goalItems: ExportItem[] = [];

    goalItems.push(makeItem(goal.id, 'goal', goal.title, {
      description: goal.specific ? `Specific: ${trim(goal.specific, 150)}` : trim(goal.description),
      status: goal.status, date: goal.target_date, reviewNote: findNote(notes, 'goal', goal.id),
    }));

    for (const proj of goalProjects) {
      const projEntries = entriesByProject[proj.id] ?? [];
      for (const e of projEntries) {
        goalItems.push(makeItem(e.id, 'entry', e.title, {
          description: trim(e.description), metrics: e.metrics, impact: e.impact,
          projectName: proj.name, date: e.entry_date, entryType: e.entry_type, status: e.status,
          reviewNote: findNote(notes, 'entry', e.id),
        }));
      }
    }

    sections.push(section(`goal-${goal.id}`, goal.title, goalItems));
  }

  if (opRhythm.length > 0) {
    sections.push(section('op-rhythm', 'Operational Rhythm', opRhythm.map(e =>
      makeItem(e.id, 'entry', e.title, { description: trim(e.description), date: e.entry_date,
        projectName: e.project_name, reviewNote: findNote(notes, 'entry', e.id) })
    )));
  }

  if (lessons.length > 0) {
    sections.push(section('lessons', 'Lessons Learned', lessons.map(l =>
      makeItem(l.id, 'lesson', l.title, { description: trim(l.context), reviewNote: findNote(notes, 'lesson', l.id) })
    )));
  }

  return { title: 'Self-Review', subtitle, dateRange, sections, sessionNotes };
}

/* ── Weekly Summary ── */
function parseWeeklySummary(
  entries: EntryData[], notes: ReviewNoteData[], subtitle: string, dateRange: string,
  sessionNotes: string | null, _projMap: Record<number, string>,
): ParsedExport {
  const highlight = entries.find(e => e.is_weekly_highlight);
  const rest = entries.filter(e => !e.is_weekly_highlight);
  const completed = rest.filter(e => e.status === 'completed');
  const inProgress = rest.filter(e => e.status === 'in_progress');
  const captures = rest.filter(e => e.entry_type === 'quick_capture' && e.status !== 'completed' && e.status !== 'in_progress');

  const sections: ExportSection[] = [];
  if (highlight) {
    sections.push(section('highlight', 'Weekly Highlight', [
      makeItem(highlight.id, 'entry', highlight.title, { description: trim(highlight.description),
        metrics: highlight.metrics, impact: highlight.impact, projectName: highlight.project_name,
        date: highlight.entry_date, reviewNote: findNote(notes, 'entry', highlight.id) })
    ]));
  }
  if (completed.length > 0) sections.push(section('completed', 'Completed', completed.map(e =>
    makeItem(e.id, 'entry', e.title, { description: trim(e.description), metrics: e.metrics,
      projectName: e.project_name, date: e.entry_date, reviewNote: findNote(notes, 'entry', e.id) }))));
  if (inProgress.length > 0) sections.push(section('in-progress', 'In Progress', inProgress.map(e =>
    makeItem(e.id, 'entry', e.title, { description: trim(e.description), projectName: e.project_name,
      date: e.entry_date, reviewNote: findNote(notes, 'entry', e.id) }))));
  if (captures.length > 0) sections.push(section('captures', 'Notes', captures.map(e =>
    makeItem(e.id, 'entry', e.title, { description: trim(e.description), date: e.entry_date,
      reviewNote: findNote(notes, 'entry', e.id) }))));

  return { title: 'Weekly Summary', subtitle, dateRange, sections, sessionNotes };
}

/* ── Status Update (Asana format) ── */
function parseStatusUpdate(
  entries: EntryData[], _projects: ProjectData[], goals: GoalData[], _lessons: LessonData[],
  notes: ReviewNoteData[], subtitle: string, dateRange: string, sessionNotes: string | null,
  _projMap: Record<number, string>,
): ParsedExport {
  const completed = entries.filter(e => e.status === 'completed');
  const nonOpCompleted = completed.filter(e => e.work_type !== 'operational_rhythm').slice(0, 7);
  const opCompleted = completed.filter(e => e.work_type === 'operational_rhythm');
  const decisions = entries.filter(e => e.entry_type === 'decision');

  const atRiskGoals = goals.filter(g => g.status === 'at_risk' || g.status === 'behind').slice(0, 3);
  const blocked = entries.filter(e =>
    e.status === 'in_progress' || e.status === 'ongoing'
  ).filter(e => e.entry_type !== 'operational_rhythm').slice(0, 5);

  const actionItems = entries.filter(e => e.entry_type === 'action_item' && e.status !== 'completed');
  const inProgress = entries.filter(e => e.status === 'in_progress' && e.entry_type !== 'action_item');
  const nextSteps = [...actionItems, ...inProgress].slice(0, 7);

  // Summary
  const summaryParts: string[] = [];
  summaryParts.push(`${entries.length} entries logged this period`);
  for (const e of nonOpCompleted.slice(0, 3)) summaryParts.push(trim(e.title, 80));
  if (opCompleted.length > 0) summaryParts.push(`${opCompleted.length} operational rhythm items`);
  if (decisions.length > 0) summaryParts.push(`${decisions.length} decision(s) made`);

  const sections: ExportSection[] = [];

  // Summary section
  sections.push(section('summary', 'Summary', [makeItem(0, 'entry', summaryParts.join('. ') + '.', {})]));

  // What we've accomplished
  const accomplishedItems: ExportItem[] = nonOpCompleted.map(e =>
    makeItem(e.id, 'entry', e.title, { description: trim(e.description), metrics: e.metrics,
      projectName: e.project_name, reviewNote: findNote(notes, 'entry', e.id) }));
  if (opCompleted.length > 0) {
    const opHighlights = opCompleted.filter(e => e.description).slice(0, 3).map(e => e.title);
    const fallback = opHighlights.length > 0 ? opHighlights : opCompleted.slice(0, 2).map(e => e.title);
    accomplishedItems.push(makeItem(0, 'entry',
      `Operational Rhythm: ${opCompleted.length} items completed`,
      { description: `Highlights: ${fallback.join(', ')}` }));
  }
  sections.push(section('accomplished', "What we've accomplished", accomplishedItems));

  // What's Blocked
  const blockedItems: ExportItem[] = [
    ...atRiskGoals.map(g => makeItem(g.id, 'goal', g.title, { status: g.status, description: trim(g.description) })),
    ...blocked.map(e => makeItem(e.id, 'entry', e.title, { description: trim(e.description),
      projectName: e.project_name, reviewNote: findNote(notes, 'entry', e.id) })),
  ];
  if (blockedItems.length > 0) {
    sections.push(section('blocked', "What's Blocked", blockedItems));
  } else {
    sections.push(section('blocked', "What's Blocked", [makeItem(0, 'entry', 'Nothing blocked this period.', {})]));
  }

  // Next Steps
  if (nextSteps.length > 0) {
    sections.push(section('next-steps', 'Next Steps', nextSteps.map(e =>
      makeItem(e.id, 'entry', e.title, { description: trim(e.description, 150),
        projectName: e.project_name, reviewNote: findNote(notes, 'entry', e.id) }))));
  }

  return { title: 'Status Update', subtitle, dateRange, sections, sessionNotes };
}


/* ── v4 Batch Type Inference ── */

/**
 * Infer entry type from a title prefix (v4 simplified types).
 * "Decision:" → decision, "Milestone:" → milestone, default → quick_capture (Note)
 */
export function inferEntryTypeFromTitle(title: string): { entry_type: string; displayType: string } {
  const trimmed = title.trim();
  if (/^Decision:/i.test(trimmed)) return { entry_type: 'decision', displayType: 'Decision' };
  if (/^Milestone:/i.test(trimmed)) return { entry_type: 'milestone', displayType: 'Milestone' };
  return { entry_type: 'quick_capture', displayType: 'Note' };
}

/**
 * Parse batch text into individual entries with inferred types.
 * Each non-empty line becomes one entry.
 */
export function parseBatchText(text: string): { line: string; entry_type: string; displayType: string }[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(line => {
      const { entry_type, displayType } = inferEntryTypeFromTitle(line);
      return { line, entry_type, displayType };
    });
}

/**
 * Map any v3 entry_type to one of 4 visible v4 types.
 * decision → Decision, milestone → Milestone, action_item → Task, all others → Note
 */
export function mapEntryTypeToV4(entryType: string): string {
  switch (entryType) {
    case 'decision': return 'Decision';
    case 'milestone': return 'Milestone';
    case 'action_item': return 'Task';
    default: return 'Note';
  }
}
