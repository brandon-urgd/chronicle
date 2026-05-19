export interface ActivityPulseProps {
  data?: {
    entries_this_week: number;
    tasks_completed_this_week: number;
    time_since_last_entry: string;
  };
}

/**
 * ActivityPulse — a one-line summary widget inline with the Dashboard header.
 * Displays entries this week, tasks completed, and time since last entry.
 * Shows "No entries yet" when no entries exist.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
export default function ActivityPulse({ data }: ActivityPulseProps) {
  if (!data) return null;

  const { entries_this_week, tasks_completed_this_week, time_since_last_entry } = data;

  const hasNoEntries = entries_this_week === 0 && time_since_last_entry === 'No entries yet';

  if (hasNoEntries && tasks_completed_this_week === 0) {
    return (
      <div
        className="activity-pulse"
        style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginBottom: '8px',
          lineHeight: '1.4',
        }}
        aria-label="Activity pulse: No entries yet"
      >
        No entries yet
      </div>
    );
  }

  return (
    <div
      className="activity-pulse"
      style={{
        fontSize: '12px',
        color: 'var(--text-muted)',
        marginBottom: '8px',
        lineHeight: '1.4',
      }}
      aria-label={`Activity pulse: ${entries_this_week} entries this week, ${tasks_completed_this_week} tasks done, Last entry: ${time_since_last_entry}`}
    >
      <span>{entries_this_week} {entries_this_week === 1 ? 'entry' : 'entries'} this week</span>
      <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>
      <span>{tasks_completed_this_week} {tasks_completed_this_week === 1 ? 'task' : 'tasks'} done</span>
      <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>
      <span>Last entry: {time_since_last_entry}</span>
    </div>
  );
}
