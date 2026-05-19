import { useEffect, useState, useCallback } from 'react';
import { cardStyle } from '../styles/sharedStyles';

/* ── Types ── */
interface ProjectDistribution {
  project_id: number | null;
  project_name: string;
  entry_count: number;
}

interface ProgramDistribution {
  program_id: number;
  program_name: string;
  color: string | null;
  entry_count: number;
  percentage: number;
  projects: ProjectDistribution[];
}

interface ProgramDelta {
  program_id: number;
  program_name: string;
  current_pct: number;
  previous_pct: number;
  direction: string;
}

interface ComparisonData {
  previous_period: string;
  deltas: ProgramDelta[];
}

interface TimeDistributionResponse {
  period: string;
  start_date: string;
  end_date: string;
  total_entries: number;
  programs: ProgramDistribution[];
  unassigned: { entry_count: number; percentage: number };
  comparison: ComparisonData | null;
}

type Period = 'week' | 'month' | 'quarter' | 'custom';

/* ── Styles ── */
const segmentedStyle: React.CSSProperties = {
  display: 'inline-flex', borderRadius: '8px', overflow: 'hidden',
  border: '1px solid var(--card-border)', marginBottom: '16px',
};
const segBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px', fontSize: '13px', fontWeight: active ? 600 : 400,
  background: active ? 'var(--accent-primary)' : 'var(--input-bg)',
  color: active ? '#fff' : 'var(--text-secondary)',
  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
});
const barContainerStyle: React.CSSProperties = {
  height: '12px', background: 'var(--input-bg)', borderRadius: '6px',
  overflow: 'hidden', flex: 1,
};

/* ── Component ── */
export default function DistributionView() {
  const [period, setPeriod] = useState<Period>(() => {
    try {
      return (localStorage.getItem('chronicle-dist-period') as Period) ?? 'month';
    } catch { return 'month'; }
  });
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [data, setData] = useState<TimeDistributionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPrograms, setExpandedPrograms] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem('chronicle-dist-expanded');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [expandedUnassigned, setExpandedUnassigned] = useState(() => {
    try { return localStorage.getItem('chronicle-dist-unassigned') === 'true'; } catch { return false; }
  });

  const fetchData = useCallback(async (p: Period, start?: string, end?: string) => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/time-distribution?period=${p}`;
      if (p === 'custom' && start && end) {
        url += `&start=${start}&end=${end}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        setData(await res.json());
      } else {
        setError('Failed to load distribution data');
      }
    } catch {
      setError('Network error — could not load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (period === 'custom') {
      if (customStart && customEnd && customEnd >= customStart) {
        fetchData(period, customStart, customEnd);
      }
    } else {
      fetchData(period);
    }
  }, [period, customStart, customEnd, fetchData]);

  function handlePeriodChange(p: Period) {
    setPeriod(p);
    try { localStorage.setItem('chronicle-dist-period', p); } catch { /* ignore */ }
  }

  function toggleProgram(id: number) {
    setExpandedPrograms(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('chronicle-dist-expanded', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  const customValid = !customStart || !customEnd || customEnd >= customStart;

  return (
    <div style={{ maxWidth: '900px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
        Time Distribution
      </h1>

      {/* Period Selector */}
      <div style={segmentedStyle}>
        {(['week', 'month', 'quarter', 'custom'] as Period[]).map(p => (
          <button key={p} style={segBtnStyle(period === p)} onClick={() => handlePeriodChange(p)}>
            {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : p === 'quarter' ? 'This Quarter' : 'Custom'}
          </button>
        ))}
      </div>

      {/* Custom Date Range */}
      {period === 'custom' && (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--card-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '13px' }}
            aria-label="Start date" />
          <span style={{ color: 'var(--text-muted)' }}>to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--card-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '13px' }}
            aria-label="End date" />
          {!customValid && (
            <span style={{ fontSize: '12px', color: 'var(--accent-danger)' }}>End date must be on or after start date</span>
          )}
        </div>
      )}

      {/* Loading / Error / Empty States */}
      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      {error && (
        <div style={{ ...cardStyle, borderLeft: '3px solid var(--accent-danger)' }}>
          <p style={{ color: 'var(--accent-danger)', margin: 0 }}>{error}</p>
          <button onClick={() => fetchData(period, customStart, customEnd)}
            style={{ marginTop: '8px', padding: '6px 12px', borderRadius: '6px', border: 'none', background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer', fontSize: '12px' }}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && data.total_entries === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: '40px' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>No entries in this period</p>
        </div>
      )}

      {/* Main Content */}
      {!loading && !error && data && data.total_entries > 0 && (
        <>
          {/* Summary */}
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            {data.start_date} — {data.end_date} · {data.total_entries} entries
          </p>

          {/* Stacked Bar */}
          <div style={{ ...cardStyle, marginBottom: '16px' }}>
            <div style={{ display: 'flex', height: '24px', borderRadius: '6px', overflow: 'hidden' }}>
              {data.programs.map(prog => (
                <div key={prog.program_id}
                  style={{ width: `${prog.percentage}%`, background: prog.color || 'var(--accent-primary)', transition: 'width 0.3s' }}
                  title={`${prog.program_name}: ${prog.percentage}%`} />
              ))}
              {data.unassigned.entry_count > 0 && (
                <div style={{ width: `${data.unassigned.percentage}%`, background: 'var(--text-muted)', transition: 'width 0.3s' }}
                  title={`Unassigned: ${data.unassigned.percentage}%`} />
              )}
            </div>
          </div>

          {/* Program Breakdown */}
          <div style={{ ...cardStyle, marginBottom: '16px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 12px', color: 'var(--text-primary)' }}>Program Breakdown</h2>
            {[...data.programs].sort((a, b) => a.program_name.localeCompare(b.program_name)).map(prog => (
              <div key={prog.program_id} style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
                  onClick={() => toggleProgram(prog.program_id)}
                  role="button" tabIndex={0} aria-expanded={expandedPrograms.has(prog.program_id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleProgram(prog.program_id); } }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', width: '12px' }}>
                    {expandedPrograms.has(prog.program_id) ? '▼' : '▶'}
                  </span>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500, minWidth: '140px' }}>
                    {prog.program_name}
                  </span>
                  <div style={barContainerStyle}>
                    <div style={{ width: `${prog.percentage}%`, height: '100%', background: prog.color || 'var(--accent-primary)', borderRadius: '6px', transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '60px', textAlign: 'right' }}>
                    {prog.percentage}% ({prog.entry_count})
                  </span>
                </div>
                {/* Project Drill-Down */}
                {expandedPrograms.has(prog.program_id) && prog.projects.length > 0 && (
                  <div style={{ marginLeft: '32px', marginTop: '6px' }}>
                    {[...prog.projects].sort((a, b) => a.project_name.localeCompare(b.project_name)).map((project, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', minWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {project.project_name}
                        </span>
                        <div style={{ ...barContainerStyle, height: '6px' }}>
                          <div style={{ width: `${data.total_entries > 0 ? (project.entry_count / data.total_entries) * 100 : 0}%`, height: '100%', background: prog.color || 'var(--accent-primary)', borderRadius: '3px', opacity: 0.7 }} />
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '30px', textAlign: 'right' }}>
                          {project.entry_count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {/* Unassigned — expandable, always at bottom */}
            {data.unassigned.entry_count > 0 && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--card-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
                  onClick={() => setExpandedUnassigned(v => { const next = !v; try { localStorage.setItem('chronicle-dist-unassigned', String(next)); } catch {} return next; })}
                  role="button" tabIndex={0} aria-expanded={expandedUnassigned}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', width: '12px' }}>
                    {expandedUnassigned ? '▼' : '▶'}
                  </span>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)', minWidth: '140px' }}>Unassigned</span>
                  <div style={barContainerStyle}>
                    <div style={{ width: `${data.unassigned.percentage}%`, height: '100%', background: 'var(--text-muted)', borderRadius: '6px', opacity: 0.5 }} />
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '60px', textAlign: 'right' }}>
                    {data.unassigned.percentage}% ({data.unassigned.entry_count})
                  </span>
                </div>
                {expandedUnassigned && (
                  <div style={{ marginLeft: '32px', marginTop: '6px' }}>
                    {(data.unassigned as any).projects && (data.unassigned as any).projects.length > 0
                      ? (data.unassigned as any).projects.map((project: any, i: number) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', minWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {project.project_name}
                            </span>
                            <div style={{ ...barContainerStyle, height: '6px' }}>
                              <div style={{ width: `${data.total_entries > 0 ? (project.entry_count / data.total_entries) * 100 : 0}%`, height: '100%', background: 'var(--text-muted)', borderRadius: '3px', opacity: 0.5 }} />
                            </div>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '30px', textAlign: 'right' }}>
                              {project.entry_count}
                            </span>
                          </div>
                        ))
                      : <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No entries in this period</p>
                    }
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Trend Comparison */}
          {data.comparison && data.comparison.deltas.length > 0 && (
            <div style={{ ...cardStyle }}>
              <h2 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 12px', color: 'var(--text-primary)' }}>
                Trend vs. Previous Period
              </h2>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 10px' }}>
                Compared to {data.comparison.previous_period}
              </p>
              {data.comparison.deltas.map(delta => (
                <div key={delta.program_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', minWidth: '140px' }}>{delta.program_name}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', minWidth: '45px' }}>{delta.current_pct}%</span>
                  <span style={{
                    fontSize: '12px', fontWeight: 600, minWidth: '20px',
                    color: delta.direction === 'up' ? 'var(--accent-secondary)' : delta.direction === 'down' ? 'var(--accent-danger)' : 'var(--text-muted)',
                  }}>
                    {delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '─'}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    from {delta.previous_pct}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
