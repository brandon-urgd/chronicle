import { useState } from 'react';

interface ProgramActivity {
  program_id: number; name: string; status: string; program_type: string;
  entry_count: number; goal_health: { on_track: number; at_risk: number; behind: number };
  due_today_count: number;
}

interface DashboardData {
  entries_this_week: number;
  entries_this_month: number;
  entries_this_quarter: number;
  program_activity: ProgramActivity[];
  goals_on_track: number;
  goals_at_risk: number;
  recent_entries: { entry_type: string }[];
}

interface WeekInReviewProps {
  data: DashboardData;
  onNavigateToTab?: (tab: string, targetId?: number) => void;
}

const DISMISS_KEY = 'chronicle-week-review-dismissed';

function getWeekKey(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  return monday.toISOString().split('T')[0];
}

function isNewWeek(): boolean {
  return new Date().getDay() === 1; // Monday
}

function isDismissedThisWeek(): boolean {
  const val = localStorage.getItem(DISMISS_KEY);
  return val === getWeekKey();
}

export default function WeekInReview({ data, onNavigateToTab }: WeekInReviewProps) {
  const [dismissed, setDismissed] = useState(isDismissedThisWeek());

  if (dismissed || !isNewWeek()) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, getWeekKey());
    setDismissed(true);
  };

  const totalEntries = data.entries_this_week ?? 0;
  const programs = data.program_activity ?? [];
  const decisions = (data.recent_entries ?? []).filter(e => e.entry_type === 'decision').length;
  const milestones = (data.recent_entries ?? []).filter(e => e.entry_type === 'milestone').length;

  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--card-border)',
      borderRadius: '8px', boxShadow: 'var(--shadow-soft)', padding: '16px',
      marginBottom: '16px', borderLeft: '3px solid var(--accent-primary)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Week in Review
        </h3>
        <button onClick={dismiss} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', fontSize: '14px', padding: '2px 6px',
        }}>×</button>
      </div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-primary)' }}>{totalEntries}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Entries</div>
        </div>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-primary)' }}>{programs.length}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Programs</div>
        </div>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-primary)' }}>{decisions}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Decisions</div>
        </div>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-primary)' }}>{milestones}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Milestones</div>
        </div>
      </div>
      <button onClick={() => onNavigateToTab?.('Reports')} style={{
        padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
        cursor: 'pointer', background: 'var(--button-primary-bg)', color: '#fff', border: 'none',
      }}>Generate Report →</button>
    </div>
  );
}
