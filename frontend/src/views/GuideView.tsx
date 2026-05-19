import { useState, useEffect, useRef, useMemo } from 'react';
import { sectionStyle } from '../styles/sharedStyles';

/* ── Collapsible Section Component ── */
function Section({ title, id, defaultOpen = true, children, visible }: {
  title: string;
  id: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  visible: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-section-id={id} style={{ ...sectionStyle, marginBottom: '16px', display: visible ? undefined : 'none' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={`section-${id}`}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 0, color: 'var(--text-primary)', fontSize: '16px', fontWeight: 700,
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', transition: 'transform 0.2s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
      </button>
      {open && (
        <div id={`section-${id}`} style={{ marginTop: '14px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.7' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Term Definition Component ── */
function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <strong style={{ color: 'var(--text-primary)' }}>{name}</strong>
      <span style={{ margin: '0 6px' }}>—</span>
      <span>{children}</span>
    </div>
  );
}

/* ── Guide View ── */
export default function GuideView() {
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => [
    { id: 'getting-started', title: '1. Getting Started' },
    { id: 'concepts', title: '2. Concepts (Glossary)' },
    { id: 'indicators', title: '3. Indicators & Visual Language' },
    { id: 'pages', title: '4. Page Guide' },
    { id: 'shortcuts', title: '5. Keyboard Shortcuts' },
    { id: 'workflows', title: '6. Workflows' },
    { id: 'mcp-integration', title: '7. MCP Integration (Power Users)' },
  ], []);

  const query = search.toLowerCase().trim();

  // After render, check actual DOM text content to determine which sections match
  const [contentVisible, setContentVisible] = useState<Set<string>>(new Set(sections.map(s => s.id)));
  useEffect(() => {
    if (!query) {
      setContentVisible(new Set(sections.map(s => s.id)));
      return;
    }
    // Defer to next frame so DOM is rendered
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const visible = new Set<string>();
      sections.forEach(s => {
        const el = containerRef.current?.querySelector(`[data-section-id="${s.id}"]`);
        if (el) {
          const text = el.textContent?.toLowerCase() ?? '';
          const words = query.split(/\s+/).filter(w => w.length > 1);
          if (words.some(w => text.includes(w))) {
            visible.add(s.id);
          }
        }
      });
      setContentVisible(visible);
    });
  }, [query, sections]);

  const finalVisible = query ? contentVisible : new Set(sections.map(s => s.id));

  return (
    <div ref={containerRef} style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Search */}
      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search guide" id="guide-search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search guide"
          style={{
            width: '100%', padding: '10px 14px', background: 'var(--input-bg)',
            border: '1px solid var(--input-border)', borderRadius: '8px',
            color: 'var(--text-primary)', fontSize: '14px', outline: 'none',
          }}
        />
      </div>

      {finalVisible.size === 0 && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>
          No sections match "{search}"
        </p>
      )}

      {/* Section 1: Getting Started */}
      <Section title="1. Getting Started" id="getting-started" visible={finalVisible.has('getting-started')}>
        <p style={{ marginBottom: '14px' }}>
          Chronicle is your personal work journal and leadership reporting tool. It captures daily accomplishments, tracks goals and projects across programs, manages recurring operational rhythms, and generates polished reports — all in one place.
        </p>

        <h4 style={{ color: 'var(--text-primary)', margin: '16px 0 8px' }}>The Mental Model</h4>
        <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: '6px', fontFamily: 'monospace', fontSize: '13px', marginBottom: '14px' }}>
          Program → Goals → Projects → Entries
        </div>
        <p style={{ marginBottom: '14px' }}>
          Chronicle organizes work in a flexible hierarchy. Programs are the broadest grouping (e.g., "Network Expansion" or "Team Enablement"). A program may contain goals, and goals may contain projects — but none of these relationships are required. Goals, projects, and entries can also exist independently. As your work matures, you can promote tasks to projects, and projects to goals, building structure over time.
        </p>

        <h4 style={{ color: 'var(--text-primary)', margin: '16px 0 8px' }}>Your First Day</h4>
        <ol style={{ paddingLeft: '20px', margin: 0 }}>
          <li style={{ marginBottom: '6px' }}><strong>Capture an entry</strong> — Press <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>Ctrl+K</code> (or <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>Cmd+K</code> on Mac) to open Quick Capture and log your first work item.</li>
          <li style={{ marginBottom: '6px' }}><strong>Check your tasks</strong> — Visit the Dashboard to see today's tasks, upcoming items, and prep notes.</li>
          <li style={{ marginBottom: '6px' }}><strong>Generate a report</strong> — Go to Reports, select a template and date range, and generate a leadership-ready summary.</li>
        </ol>

        <h4 style={{ color: 'var(--text-primary)', margin: '16px 0 8px' }}>Navigation</h4>
        <p style={{ marginBottom: '0' }}>
          The sidebar on the left provides access to all pages: Dashboard, Portfolio, Timeline, Reports, Settings, and this Guide. The sidebar also has a <strong>Capture Entry</strong> button, a theme toggle (light/dark mode), and an About link showing version info.
        </p>
      </Section>

      {/* Section 2: Concepts */}
      <Section title="2. Concepts (Glossary)" id="concepts" visible={finalVisible.has('concepts')}>
        <Term name="Batch Mode">A toggle available in all three Quick Capture modes (Log, Task, Rhythm). Enter one item per line to create multiple entries, tasks, or cadences at once. All items share the same program, project, and date settings.</Term>
        <Term name="Cadence">A recurring scheduled item (e.g., a weekly standup or monthly review). Cadences auto-generate instances on their schedule. Frequencies: Every Day, Every Weekday, Weekly, Biweekly, Monthly, Quarterly. Edited from the Portfolio cadence section.</Term>
        <Term name="Entry">A daily work record — the atomic unit of Chronicle. Types include: quick capture, project update, operational rhythm, decision, milestone, development, action item, and recognition. Entries can be standalone or linked to a project.</Term>
        <Term name="Goal">A SMART objective with fiscal year/quarter tracking and status. Goals may belong to a program, or exist independently. Goals may contain projects. SMART fields: Specific, Measurable, Achievable, Relevant, Time-bound.</Term>
        <Term name="Instance">A single occurrence of a cadence on a specific date. When a cadence generates an instance for today, it appears in your Dashboard as a task to complete or skip.</Term>
        <Term name="Prep Note">A lightweight sticky note for 1:1 topics, follow-up reminders, or quick thoughts. Persists until dismissed. Click a note to edit it inline (Enter to save, Escape to cancel). Click the × button to dismiss.</Term>
        <Term name="Program">The broadest organizational unit (e.g., "Network Expansion", "Team Enablement"). Programs may contain goals and projects, but are optional — work can exist without one. Programs have a type (Primary, Strategic, Operational, etc.) and a color.</Term>
        <Term name="Project">A deliverable or initiative with a status lifecycle (planning → active → completed/paused). Projects may belong to a goal, a program, or stand alone.</Term>
        <Term name="Promote to Goal">An action that converts a project into a goal, pre-filling SMART fields from the project's name, description, and program. Available in the Portfolio view on project cards.</Term>
        <Term name="Promote to Project">An action that converts a task into a project, linking the original item. Available on standalone tasks (not cadences, not already linked to a project). Found in the task detail panel.</Term>
        <Term name="Report">A generated document summarizing entries within a date range. Templates: Status Update (narrative format) and Modular (structured sections you can toggle on/off). Can be exported as PDF, copied to clipboard, or saved as a draft.</Term>
        <Term name="Report Draft">A saved report in progress with a lifecycle: draft → ready → sent. Managed from the Reports page.</Term>
        <Term name="Report Preset">A saved configuration of template settings (sections, scope, program filter) that you can reuse. Created and managed in Settings or directly from the Reports page.</Term>
        <Term name="Show on Today">A toggle on cadences that controls whether their instances appear in the Dashboard's "Today's Tasks" section. When off, the cadence still runs but won't clutter your daily view.</Term>
        <Term name="Task">A one-time action item with an optional due date and time. Tasks can be standalone or linked to a project/program.</Term>
        <Term name="Visibility (Personal / Shareable)">A toggle on tasks and entries. "Shareable" items appear in generated reports. "Personal" items are excluded from reports but still visible in your Dashboard and Timeline. Toggle this in the task detail modal.</Term>
      </Section>

      {/* Section 3: Indicators */}
      <Section title="3. Indicators & Visual Language" id="indicators" visible={finalVisible.has('indicators')}>
        <h4 style={{ color: 'var(--text-primary)', margin: '0 0 10px' }}>Icons & Badges</h4>
        <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
          <Indicator symbol="●" color="var(--accent-warning)" label="Amber dot">Requires acknowledgment — this cadence won't auto-complete when past due; it stays overdue until you manually complete it.</Indicator>
          <Indicator symbol="○" color="var(--accent-success)" label="Green circle">Click to complete a task or cadence instance. Shows a checkmark (✓) briefly after completion.</Indicator>
          <Indicator symbol="↻" color="var(--accent-primary)" label="Purple circle with ↻">Cadence item (recurring). Distinguishes cadences from one-time tasks in the Dashboard.</Indicator>
          <Indicator symbol="⚠ Stale" color="var(--accent-warning)" label="Stale badge">No activity in 14+ days (only shown on active or planning projects). Projects with no entries at all are also marked stale.</Indicator>
          <Indicator symbol="⚠" color="var(--accent-danger)" label="Red warning badge">Project has overdue tasks.</Indicator>
          <Indicator symbol="CADENCE" color="var(--accent-primary)" label="Cadence badge">Shown in the task detail modal to indicate the item is a recurring cadence.</Indicator>
          <Indicator symbol="ACCOUNTABLE" color="var(--accent-warning)" label="Accountable badge">Shown in the task detail modal for cadences that require explicit completion (won't auto-complete).</Indicator>
        </div>

        <h4 style={{ color: 'var(--text-primary)', margin: '16px 0 10px' }}>Status Colors</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
          <ColorChip color="var(--accent-success)" label="on_track / completed" />
          <ColorChip color="var(--accent-warning)" label="at_risk" />
          <ColorChip color="var(--accent-danger)" label="behind" />
          <ColorChip color="var(--text-muted)" label="paused" />
        </div>

        <h4 style={{ color: 'var(--text-primary)', margin: '16px 0 10px' }}>Entry Type Borders (Timeline)</h4>
        <p style={{ marginBottom: '10px', fontSize: '13px' }}>Entries in the Timeline show a colored left border based on their type:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          <ColorChip color="var(--accent-warning)" label="Decision (amber)" />
          <ColorChip color="var(--accent-success)" label="Milestone (green)" />
          <ColorChip color="#4a9eff" label="Action Item (blue)" />
        </div>
        <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>Other entry types (notes, project updates, etc.) have no border.</p>
      </Section>

      {/* Section 4: Page Guide */}
      <Section title="4. Page Guide" id="pages" visible={finalVisible.has('pages')}>
        <Term name="Dashboard">Your daily command center. Sections: Activity Pulse (entries this week, tasks completed, time since last entry), Today's Tasks (click to open detail modal with edit/complete/skip/delete), Prep Notes (right column), Upcoming (next 7 days — toggle between "By Date" flat list and "By Program" grouped view), Work at a Glance (all active tasks), and Recent Activity (latest entries). Section collapse states persist across sessions.</Term>
        <Term name="Portfolio">Organize work by scope. Displays the Program → Goal → Project hierarchy with metrics (entry counts, goal status, completion rates). Edit cadences here — expand a project's cadence section to see the inline edit panel with frequency, day, time, accountable toggle, and "Show on Today" toggle. Also has "View in Timeline" and "Promote to Goal" actions on projects. Search queries the server for fast filtering.</Term>
        <Term name="Timeline">Chronological log of all entries. Filter by time range (previous week/month/quarter/year/custom), program, project, entry type, or free-text search. When navigating from Portfolio via "View in Timeline," a project filter banner appears showing which project's entries are displayed, with a "Clear filter" button. Supports compact/normal density and newest/oldest sort order. Click an entry to edit — the edit form includes a Delete button at the bottom.</Term>
        <Term name="Distribution">See where you spend your time. Shows percentage breakdown of entries by program (and drill-down into projects) over selectable time periods: This Week, This Month, This Quarter, or Custom date range. A stacked bar at the top gives a visual overview. The Trend section compares your current period to the equivalent previous period with ↑/↓/─ indicators. Useful for 1:1s, self-reviews, and capacity planning.</Term>
        <Term name="Reports">Generate leadership-ready reports. Choose a template (Status Update or Modular), select a date range scope, optionally filter by program, toggle individual sections (Modular only — toggled-off sections are excluded from both preview and PDF), then Generate. Preview the result, copy to clipboard, download as PDF, or save as a draft. Manage saved drafts and presets here.</Term>
        <Term name="Settings">Profile (name, fiscal year start month, theme), Tags (create/edit/delete tags for entries), Report Presets (saved report configurations), Data Location (choose where Chronicle stores its database — useful for cloud drives), Export & Import (full database backup/restore, app reset), and Repair Database (enter recovery mode if something goes wrong).</Term>
        <Term name="About">Accessed from the sidebar footer (ⓘ icon). Shows app version, architecture overview, tech stack, and key features summary.</Term>
      </Section>

      {/* Section 5: Keyboard Shortcuts */}
      <Section title="5. Keyboard Shortcuts" id="shortcuts" visible={finalVisible.has('shortcuts')}>
        <div style={{ display: 'grid', gap: '8px' }}>
          <ShortcutRow keys="Ctrl+K / Cmd+K" description="Open or close Quick Capture (toggle). Does not trigger when focused on an input field." />
          <ShortcutRow keys="Escape" description="Close any open modal, panel, or overlay (Quick Capture, task detail, About, edit panels)." />
          <ShortcutRow keys="Enter" description="Submit the current form (save entry in Quick Capture, save prep note, save inline edit)." />
          <ShortcutRow keys="Tab" description="In Quick Capture, moves focus from the title field to the program pill selector." />
          <ShortcutRow keys="Arrow keys" description="Navigate between program pills when the pill selector is focused." />
        </div>
      </Section>

      {/* Section 6: Workflows */}
      <Section title="6. Workflows" id="workflows" visible={finalVisible.has('workflows')}>
        <Workflow title="Log completed work (single entry)">
          Open Quick Capture (<code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>Ctrl+K</code>) → ensure Log mode is selected → type a title → optionally select a program and project → Save. This creates a task and immediately completes it, producing an entry in Timeline. Use "Save & New" to immediately start another.
        </Workflow>
        <Workflow title="Log multiple items at once (batch)">
          Open Quick Capture → select any mode (Log, Task, or Cadence) → click "Batch ↗" in the top-right corner → type one item per line → all items share the same program/project/date → Save All.
        </Workflow>
        <Workflow title="Create a one-time task">
          Open Quick Capture → switch to Task mode → type a name → optionally set a due date and time → optionally assign to a program/project → Create Task. The task appears on Dashboard and can be completed later.
        </Workflow>
        <Workflow title="Create a recurring cadence">
          Open Quick Capture → switch to Cadence mode → type a name → choose frequency (Every Day, Every Weekday, Weekly, Biweekly, Monthly, Quarterly) → set a start date → optionally check "Requires acknowledgment" → Create Cadence.
        </Workflow>
        <Workflow title="Complete a task from Dashboard">
          Dashboard → find the task in Today's Tasks → click the Complete button directly, or click the task row to open the detail modal → optionally add description/impact/metrics → click Complete. Completing a task creates a corresponding entry in Timeline.
        </Workflow>
        <Workflow title="Edit a cadence schedule">
          Portfolio → expand a project's Cadence section → click the cadence name → the inline edit panel opens with frequency, day of week/month, time, "Show on Today" toggle, and accountable toggle → make changes → Save.
        </Workflow>
        <Workflow title="Delete an entry from Timeline">
          Timeline → click an entry to open the edit form → scroll to the bottom → click "Delete Entry" (red button) → confirm in the dialog. The entry is permanently removed.
        </Workflow>
        <Workflow title="Set a task as Personal (exclude from reports)">
          Dashboard → click a task to open the detail modal → toggle the "Personal" switch (bottom-left of modal). When enabled, the completed entry won't appear in generated reports.
        </Workflow>
        <Workflow title="Check time distribution">
          Click "Distribution" in the sidebar → select a time period (This Week, This Month, This Quarter, or Custom) → view the stacked bar and program breakdown → click a program to drill down into projects → check the Trend section for changes vs. the previous period.
        </Workflow>
        <Workflow title="View a project's entries in Timeline">
          Portfolio → find the project card → click "View in Timeline." The Timeline page opens with a project filter banner showing only that project's entries across all time. Click "Clear filter" to return to the full timeline.
        </Workflow>
        <Workflow title="Generate a report">
          Reports → select template (Status Update or Modular) → choose a date range scope (Previous Week, Month, Quarter, Year, or Custom) → optionally filter by program → for Modular, toggle which sections to include (disabled sections are excluded from preview and PDF) → Generate → preview the result → Download PDF, Copy, or Save as Draft.
        </Workflow>
        <Workflow title="Back up your data">
          Settings → scroll to Data Management → Export & Import → click "Export Database." A JSON backup file downloads to your computer. To restore, click "Import Database" and select a backup file.
        </Workflow>
        <Workflow title="Repair a corrupted database">
          If Chronicle can't open the database, it automatically shows a Recovery screen with options: Restore from Backup, Start Fresh, or Try Again. You can also trigger this manually from Settings → Repair Database.
        </Workflow>
      </Section>

      {/* Section 7: MCP Integration */}
      <Section title="7. MCP Integration (Power Users)" id="mcp-integration" defaultOpen={false} visible={finalVisible.has('mcp-integration')}>
        <p style={{ marginBottom: '14px' }}>
          Chronicle stores all data in a local SQLite database (<code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>chronicle.db</code>). You can build a <strong>Model Context Protocol (MCP) server</strong> that gives any AI assistant (Kiro, Claude, Cursor, etc.) direct read/write access to your data — enabling automation, bulk operations, and custom workflows without touching the UI.
        </p>
        <p style={{ marginBottom: '14px' }}>
          This section gives you everything you need to hand to your AI assistant and say: <em>"Build me an MCP server for Chronicle."</em>
        </p>

        <h4 style={{ margin: '18px 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>What You're Building</h4>
        <p style={{ marginBottom: '14px' }}>
          A single Python file that connects to your Chronicle database and exposes tools (functions) that an AI can call. The AI sees tool names and descriptions, decides when to use them, and passes structured arguments. Your server executes the SQL and returns results.
        </p>

        <h4 style={{ margin: '18px 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>Prerequisites</h4>
        <div style={{ marginBottom: '14px', fontSize: '13px', lineHeight: '1.8' }}>
          • Python 3.10+ on PATH<br/>
          • <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>pip install mcp</code> — installs the FastMCP framework<br/>
          • Your Chronicle data directory path (find it in Settings → Data Location)
        </div>

        <h4 style={{ margin: '18px 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>Minimal MCP Server Template</h4>
        <p style={{ marginBottom: '8px', fontSize: '13px' }}>
          Copy this into a file (e.g., <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>my_chronicle_mcp.py</code>) and customize the tools:
        </p>
        <pre style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: '8px', fontSize: '12px', overflow: 'auto', marginBottom: '14px', border: '1px solid var(--card-border)' }}>{`import json, os, sqlite3
from mcp.server.fastmcp import FastMCP

DB_PATH = os.environ["CHRONICLE_DB_PATH"]
mcp = FastMCP("My Chronicle Tools")

def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c

@mcp.tool()
def list_entries(program_id: int = None, limit: int = 20) -> str:
    """List recent entries, optionally filtered by program."""
    conn = _conn()
    if program_id:
        rows = conn.execute(
            "SELECT id, title, entry_date, entry_type FROM entries "
            "WHERE program_id = ? ORDER BY entry_date DESC LIMIT ?",
            (program_id, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, title, entry_date, entry_type FROM entries "
            "ORDER BY entry_date DESC LIMIT ?", (limit,)
        ).fetchall()
    conn.close()
    return json.dumps([dict(r) for r in rows], indent=2)

@mcp.tool()
def create_and_complete_task(title: str, entry_date: str, program_id: int = None) -> str:
    """Create a task and immediately complete it, producing an entry.
    This is the v3.0 unified way to log work in Chronicle."""
    conn = _conn()
    now = entry_date
    # 1. Create the task
    cur = conn.execute(
        "INSERT INTO scheduled_items (name, item_class, mode, status, "
        "program_id, created_at, updated_at) VALUES (?, 'task', "
        "'one_time', 'completed', ?, ?, ?)",
        (title, program_id, now, now)
    )
    task_id = cur.lastrowid
    # 2. Create the entry linked to the task
    conn.execute(
        "INSERT INTO entries (title, entry_date, entry_type, work_type, "
        "status, visibility, program_id, scheduled_item_id) "
        "VALUES (?, ?, 'quick_capture', 'operational_rhythm', "
        "'completed', 'shareable', ?, ?)",
        (title, entry_date, program_id, task_id)
    )
    conn.commit()
    conn.close()
    return json.dumps({"status": "created", "title": title})

@mcp.tool()
def query(sql: str) -> str:
    """Run a read-only SELECT query against the Chronicle database."""
    if not sql.strip().upper().startswith("SELECT"):
        return json.dumps({"error": "Only SELECT allowed"})
    conn = _conn()
    rows = conn.execute(sql).fetchall()
    conn.close()
    return json.dumps([dict(r) for r in rows], indent=2)
`}</pre>

        <h4 style={{ margin: '18px 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>Registering with Your AI Tool</h4>
        <p style={{ marginBottom: '8px', fontSize: '13px' }}>
          Add this to your AI tool's MCP configuration (e.g., <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>.kiro/settings/mcp.json</code> for Kiro):
        </p>
        <pre style={{ background: 'var(--bg-secondary)', padding: '14px', borderRadius: '8px', fontSize: '12px', overflow: 'auto', marginBottom: '14px', border: '1px solid var(--card-border)' }}>{`{
  "mcpServers": {
    "chronicle": {
      "command": "python",
      "args": ["path/to/my_chronicle_mcp.py"],
      "env": {
        "CHRONICLE_DB_PATH": "path/to/chronicle.db"
      },
      "autoApprove": ["list_entries", "query"]
    }
  }
}`}</pre>

        <h4 style={{ margin: '18px 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>Chronicle Database Schema Reference</h4>
        <p style={{ marginBottom: '8px', fontSize: '13px' }}>
          These are the tables your tools can read from and write to. Changes appear in the app on next refresh.
        </p>
        <div style={{ marginBottom: '14px', fontSize: '12px', lineHeight: '2', fontFamily: 'monospace' }}>
          <strong>entries</strong> (id, title, description, entry_date, entry_type, work_type, status, visibility, program_id, project_id, is_accomplishment, is_weekly_highlight, is_pinned)<br/>
          <strong>programs</strong> (id, name, status, program_type, color, description)<br/>
          <strong>goals</strong> (id, title, description, status, fiscal_year, quarter, target_date, program_id, specific, measurable, achievable, relevant, time_bound)<br/>
          <strong>projects</strong> (id, name, description, status, start_date, target_end_date, goal_id, program_id)<br/>
          <strong>scheduled_items</strong> (id, name, description, mode[one_time|recurring], item_class[task|cadence], status, due_date, recurrence_type, day_of_week, day_of_month, time_of_day, program_id, project_id)<br/>
          <strong>scheduled_item_instances</strong> (id, scheduled_item_id, due_date, due_time, status[pending|completed|skipped], resolved_at, skip_reason)<br/>
          <strong>notes</strong> (id, text, created_at, dismissed_at)<br/>
          <strong>report_drafts</strong> (id, title, content, status[draft|ready|sent], preset_id, date_range_start, date_range_end)<br/>
          <strong>report_presets</strong> (id, name, template_type, sections, scope, is_default)<br/>
          <strong>tags</strong> (id, name) + <strong>entry_tags</strong> (entry_id, tag_id)<br/>
          <strong>stakeholders</strong> (id, name, email, role, notes) + <strong>project_stakeholders</strong> (project_id, stakeholder_id)<br/>
          <strong>goal_progress_log</strong> (id, goal_id, note, status_at_time, created_at)<br/>
          <strong>project_progress_log</strong> (id, project_id, note, status_at_time, created_at)<br/>
          <strong>settings</strong> (key, value) — app configuration key-value store
        </div>

        <h4 style={{ margin: '18px 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>Design Guidance for Your Tools</h4>
        <div style={{ marginBottom: '14px', fontSize: '13px', lineHeight: '1.8' }}>
          • <strong>Tool docstrings matter</strong> — the AI reads them to decide when to call your tool. Be specific about what it does and what it returns.<br/>
          • <strong>Return JSON strings</strong> — the AI parses them. Use <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>json.dumps()</code> for all return values.<br/>
          • <strong>Use typed parameters</strong> — <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>program_id: int</code> not <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>program_id</code>. The AI needs the schema.<br/>
          • <strong>Separate read and write tools</strong> — put read-only tools in <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>autoApprove</code> so the AI doesn't ask permission every time.<br/>
          • <strong>Always use parameterized queries</strong> — never interpolate user input into SQL strings.<br/>
          • <strong>The app doesn't need to be running</strong> — MCP connects directly to the SQLite file. Just don't write while the app is also writing (SQLite handles this with WAL mode, but be aware).<br/>
          • <strong>Test with the query tool first</strong> — before building a custom tool, use a raw <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>query</code> tool to explore the schema and verify your SQL works.
        </div>

        <h4 style={{ margin: '18px 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>Example Use Cases</h4>
        <div style={{ marginBottom: '14px', fontSize: '13px', lineHeight: '1.8' }}>
          • "Create entries for everything I did this week" — bulk entry creation from a conversation<br/>
          • "What did I work on last month for the Engineering program?" — filtered entry search<br/>
          • "Create a task for each action item from this meeting" — batch task creation<br/>
          • "Update all my goals to reflect Q2 progress" — bulk goal updates<br/>
          • "Generate a weekly summary from my entries" — custom reporting logic<br/>
          • "Mark all overdue tasks as completed" — bulk status changes
        </div>
      </Section>
    </div>
  );
}

/* ── Helper Components ── */

function Indicator({ symbol, color, label, children }: { symbol: string; color: string; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
      <span style={{ color, fontWeight: 700, minWidth: '90px', fontSize: '13px' }} aria-label={label}>{symbol}</span>
      <span>{children}</span>
    </div>
  );
}

function ColorChip({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '13px' }}>
      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span>{label}</span>
    </div>
  );
}

function ShortcutRow({ keys, description }: { keys: string; description: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <code style={{ background: 'var(--bg-secondary)', padding: '4px 10px', borderRadius: '4px', fontSize: '13px', fontWeight: 600, minWidth: '140px' }}>{keys}</code>
      <span>{description}</span>
    </div>
  );
}

function Workflow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <strong style={{ color: 'var(--text-primary)' }}>{title}</strong>
      <p style={{ margin: '4px 0 0', paddingLeft: '12px', borderLeft: '2px solid var(--card-border)' }}>{children}</p>
    </div>
  );
}
