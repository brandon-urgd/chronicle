# Chronicle MCP Server

Local MCP server that gives Kiro direct read/write access to the Chronicle database. No more throwaway Python scripts.

## Setup

Already configured in `repository/.kiro/settings/mcp.json`. Should auto-connect when you open the workspace in Kiro.

If it doesn't connect, check the MCP Server view in the Kiro feature panel or use the command palette: "MCP: Reconnect".

## Tools (18)

**Projects:** list_projects, get_project, create_project, update_project
**Goals:** list_goals, get_goal, create_goal, update_goal
**Entries:** create_and_complete_task, search_entries, update_entry
**Progress Logs:** add_goal_progress, add_project_progress, delete_progress_log
**Tasks:** create_task, update_task, list_tasks
**Programs:** list_programs
**Notes:** create_note, list_notes, dismiss_note
**Report Drafts:** create_report_draft, list_report_drafts, update_report_draft, delete_report_draft
**Raw Query:** query (read-only SELECT only)

## v3.0 Changes

- **Removed:** `create_entry` — entries are no longer created directly
- **Added:** `create_and_complete_task` — creates a task and immediately completes it, producing an entry in Timeline. This is the unified way to log completed work in Chronicle v3.0.

The unified model: **Tasks are the only input. Entries are the only output.** Every entry in Chronicle is created through task completion. `create_and_complete_task` handles both steps in one call.

## Auto-Approved (no confirmation needed)

All read operations are auto-approved: list_projects, get_project, list_goals, get_goal, list_programs, list_tasks, search_entries, list_notes, list_report_drafts, query.

Write operations (create, update, delete) will ask for confirmation.

## Environment

The server reads `CHRONICLE_DB_PATH` to find the database. Set in the MCP config:

```json
"env": {
    "CHRONICLE_DB_PATH": "C:\\Users\\bhillrog\\Desktop\\repository\\Chronicle Data\\chronicle.db"
}
```

## When to Update This Server

Only if the Chronicle database schema changes (new tables, renamed columns, new constraints). Normal data operations through Chronicle UI don't require any changes here.
