import { useState, useEffect } from 'react';
import { formInputStyle, formLabelStyle as labelStyle, fieldStyle, btnPrimary as sharedBtnPrimary, btnSecondary as sharedBtnSecondary, btnDanger } from '../styles/sharedStyles';

interface SetupWizardProps {
  onComplete: () => void;
}

/* ── Types ── */
interface ProgramDraft {
  name: string;
  program_type: string;
  description: string;
  color: string;
}

interface ScheduledItemDraft {
  name: string;
  recurrence_type: string;
  day_of_week: number;
  day_of_month: number;
  program_name: string; // matched to created programs by name
}

/* ── Constants ── */
const MONTHS = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' }, { value: 3, label: 'March' },
  { value: 4, label: 'April' }, { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' }, { value: 9, label: 'September' },
  { value: 10, label: 'October' }, { value: 11, label: 'November' }, { value: 12, label: 'December' },
];

const DEFAULT_PROGRAM_TYPES = ['Primary', 'Strategic', 'Operational', 'Carrier', 'Support'];
const RECURRENCE_OPTIONS = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual'];
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const STEP_PROFILE = 0;
const STEP_PROGRAMS = 1;
const STEP_SCHEDULED = 2;
const TOTAL_STEPS = 3;

/* ── Shared Styles ── */
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-primary, #ffffff)',
};

const panelStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--card-border)',
  borderRadius: '12px', boxShadow: 'var(--shadow-soft)',
  padding: '48px', width: '100%', maxWidth: '580px', margin: '0 24px',
  maxHeight: '90vh', overflowY: 'auto',
};

const inputStyle: React.CSSProperties = { ...formInputStyle };

const btnPrimary: React.CSSProperties = {
  ...sharedBtnPrimary, padding: '12px 24px', fontSize: '15px',
};

const btnSecondary: React.CSSProperties = {
  ...sharedBtnSecondary, padding: '12px 24px',
};

const btnSmall: React.CSSProperties = {
  padding: '6px 14px', background: 'var(--button-primary-bg)', color: '#fff',
  border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
};

const btnDangerSmall: React.CSSProperties = {
  ...btnDanger, padding: '4px 10px', fontSize: '12px',
};

const listItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
  padding: '10px 14px', background: 'var(--bg-secondary)',
  borderRadius: '8px', marginBottom: '8px',
};

const stepIndicatorStyle = (active: boolean): React.CSSProperties => ({
  width: '8px', height: '8px', borderRadius: '50%',
  background: active ? 'var(--button-primary-bg)' : 'var(--card-border)',
  transition: 'background 0.2s',
});

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(STEP_PROFILE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [programTypeOptions, setProgramTypeOptions] = useState<string[]>(DEFAULT_PROGRAM_TYPES);

  /* Fetch program types from settings on mount */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.settings?.program_types) {
            try {
              const parsed = JSON.parse(data.settings.program_types);
              if (Array.isArray(parsed) && parsed.length > 0) setProgramTypeOptions(parsed);
            } catch { /* ignore parse errors */ }
          }
        }
      } catch { /* ignore */ }
    })();
  }, []);

  /* ── Step 1: Profile ── */
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');
  const [userTitle, setUserTitle] = useState('');
  const [userOrg, setUserOrg] = useState('');
  const [managerName, setManagerName] = useState('');
  const [fyStartMonth, setFyStartMonth] = useState(10);

  /* ── Step 2: Programs ── */
  const [programs, setPrograms] = useState<ProgramDraft[]>([]);
  const [pgName, setPgName] = useState('');
  const [pgType, setPgType] = useState('');
  const [pgDesc, setPgDesc] = useState('');
  const [pgColor, setPgColor] = useState('');

  /* ── Step 3: Scheduled Items ── */
  const [scheduledItems, setScheduledItems] = useState<ScheduledItemDraft[]>([]);
  const [siName, setSiName] = useState('');
  const [siRecurrence, setSiRecurrence] = useState('weekly');
  const [siDayOfWeek, setSiDayOfWeek] = useState(1); // Default to Monday (index 1 in DAYS_OF_WEEK)
  const [siDayOfMonth, setSiDayOfMonth] = useState(1);
  const [siProgram, setSiProgram] = useState('');

  /* ── Helpers ── */
  /* Initialize pgType when programTypeOptions loads */
  useEffect(() => {
    if (programTypeOptions.length > 0 && !pgType) {
      setPgType(programTypeOptions[0]);
    }
  }, [programTypeOptions, pgType]);

  function resetProgramForm() { setPgName(''); setPgType(programTypeOptions[0] || 'Primary'); setPgDesc(''); setPgColor(''); }
  function resetScheduledForm() { setSiName(''); setSiRecurrence('weekly'); setSiDayOfWeek(1); setSiDayOfMonth(1); setSiProgram(''); }

  function addProgram() {
    if (!pgName.trim()) return;
    setPrograms(prev => [...prev, { name: pgName.trim(), program_type: pgType, description: pgDesc.trim(), color: pgColor.trim() }]);
    resetProgramForm();
  }

  function removeProgram(idx: number) {
    setPrograms(prev => prev.filter((_, i) => i !== idx));
  }

  function addScheduledItem() {
    if (!siName.trim()) return;
    setScheduledItems(prev => [...prev, {
      name: siName.trim(), recurrence_type: siRecurrence,
      day_of_week: siDayOfWeek, day_of_month: siDayOfMonth,
      program_name: siProgram,
    }]);
    resetScheduledForm();
  }

  function removeScheduledItem(idx: number) {
    setScheduledItems(prev => prev.filter((_, i) => i !== idx));
  }

  /* ── Navigation ── */
  function handleNext() {
    if (step === STEP_PROFILE) {
      if (!userName.trim()) { setError('Name is required'); return; }
      setError('');
      setStep(STEP_PROGRAMS);
    } else if (step === STEP_PROGRAMS) {
      setError('');
      setStep(STEP_SCHEDULED);
    } else if (step === STEP_SCHEDULED) {
      handleFinish();
    }
  }

  function handleSkip() {
    if (step === STEP_PROGRAMS) {
      setStep(STEP_SCHEDULED);
    } else if (step === STEP_SCHEDULED) {
      handleFinish();
    }
  }

  async function handleFinish() {
    setSaving(true);
    setError('');
    try {
      // 1. Save settings (profile)
      const settingsRes = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            user_name: userName.trim(),
            user_role: userRole.trim(),
            user_title: userTitle.trim(),
            user_org: userOrg.trim(),
            manager_name: managerName.trim(),
            fiscal_year_start_month: String(fyStartMonth),
            setup_completed: 'true',
          },
        }),
      });
      if (!settingsRes.ok) throw new Error('Failed to save settings');

      // 2. Create programs (collect id mapping by name)
      const programIdMap: Record<string, number> = {};
      for (const pg of programs) {
        const res = await fetch('/api/programs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: pg.name,
            program_type: pg.program_type,
            description: pg.description || null,
            color: pg.color || null,
          }),
        });
        if (res.ok) {
          const created = await res.json();
          programIdMap[pg.name] = created.id;
        }
      }

      // 3. Create scheduled items
      for (const si of scheduledItems) {
        const body: Record<string, unknown> = {
          name: si.name,
          mode: 'recurring',
          recurrence_type: si.recurrence_type,
          day_of_week: si.day_of_week + 1, // Convert 0-indexed to US Traditional (1=Sun, 7=Sat)
          day_of_month: si.day_of_month,
        };
        if (si.program_name && programIdMap[si.program_name]) {
          body.program_id = programIdMap[si.program_name];
        }
        await fetch('/api/scheduled-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      onComplete();
    } catch {
      setError('Failed to save. Is the backend running?');
    } finally {
      setSaving(false);
    }
  }

  /* ── Render ── */
  return (
    <div style={overlayStyle} data-testid="setup-wizard">
      <div style={panelStyle}>
        {/* Header */}
        <h2 style={{ margin: '0 0 4px', color: 'var(--text-primary)', letterSpacing: '1.5px', fontSize: '20px', fontWeight: 700 }}>
          CHRONICLE
        </h2>
        <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)', fontSize: '12px' }}>
          Professional Narrative System
        </p>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: '6px', margin: '0 0 24px' }}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div key={i} style={stepIndicatorStyle(i <= step)} />
          ))}
        </div>

        {/* ── Step 1: Profile ── */}
        {step === STEP_PROFILE && (
          <div>
            <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
              Configure your profile to get started. This information appears in your exports and reports.
            </p>
            <div style={fieldStyle}>
              <label style={labelStyle}>Name *</label>
              <input style={inputStyle} value={userName} onChange={e => setUserName(e.target.value)} placeholder="Your full name" />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Role</label>
              <input style={inputStyle} value={userRole} onChange={e => setUserRole(e.target.value)} placeholder="e.g. Program Manager" />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Title</label>
              <input style={inputStyle} value={userTitle} onChange={e => setUserTitle(e.target.value)} placeholder="e.g. Sr. Program Manager" />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Organization</label>
              <input style={inputStyle} value={userOrg} onChange={e => setUserOrg(e.target.value)} placeholder="e.g. ACO" />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Manager Name</label>
              <input style={inputStyle} value={managerName} onChange={e => setManagerName(e.target.value)} placeholder="Your manager's name" />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Review Period Start Month</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer', color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)' }}
                value={fyStartMonth}
                onChange={e => setFyStartMonth(Number(e.target.value))}
              >
                {MONTHS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* ── Step 2: Programs ── */}
        {step === STEP_PROGRAMS && (
          <div>
            <p style={{ margin: '0 0 6px', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600 }}>
              Programs <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '13px' }}>(optional)</span>
            </p>
            <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
              Programs group your goals, projects, and entries by operational domain. You can always create them later.
            </p>

            {/* Added programs list */}
            {programs.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                {programs.map((pg, idx) => (
                  <div key={idx} style={listItemStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {pg.color && <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: pg.color, flexShrink: 0 }} />}
                        <span style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}>{pg.name}</span>
                        <span style={{ padding: '1px 8px', borderRadius: '6px', fontSize: '11px', background: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                          {pg.program_type}
                        </span>
                      </div>
                      {pg.description && <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pg.description}</p>}
                    </div>
                    <button style={btnDangerSmall} onClick={() => removeProgram(idx)}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            {/* Add program form */}
            <div style={{ padding: '16px', background: 'var(--bg-secondary, rgba(255,255,255,0.03))', borderRadius: '8px', border: '1px solid var(--card-border)', marginBottom: '16px' }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Program Name</label>
                <input style={inputStyle} value={pgName} onChange={e => setPgName(e.target.value)} placeholder="e.g. 737 MAX Program" />
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ ...fieldStyle, flex: 1, minWidth: '130px' }}>
                  <label style={labelStyle}>Type</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={pgType} onChange={e => setPgType(e.target.value)}>
                    {programTypeOptions.map(t => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div style={{ ...fieldStyle, flex: 1, minWidth: '130px' }}>
                  <label style={labelStyle}>Color</label>
                  <input style={inputStyle} value={pgColor} onChange={e => setPgColor(e.target.value)} placeholder="#3b82f6" />
                </div>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Description</label>
                <input style={inputStyle} value={pgDesc} onChange={e => setPgDesc(e.target.value)} placeholder="Brief description (optional)" />
              </div>
              <button style={{ ...btnSmall, opacity: !pgName.trim() ? 0.5 : 1 }} onClick={addProgram} disabled={!pgName.trim()}>
                + Add Program
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Scheduled Items ── */}
        {step === STEP_SCHEDULED && (
          <div>
            <p style={{ margin: '0 0 6px', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600 }}>
              Scheduled Items <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '13px' }}>(optional)</span>
            </p>
            <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
              Define recurring items that show up on your dashboard. You can always create them later.
            </p>

            {/* Added scheduled items list */}
            {scheduledItems.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                {scheduledItems.map((si, idx) => (
                  <div key={idx} style={listItemStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}>{si.name}</span>
                        <span style={{ padding: '1px 8px', borderRadius: '6px', fontSize: '11px', background: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                          {si.recurrence_type}
                        </span>
                        {si.program_name && (
                          <span style={{ padding: '1px 8px', borderRadius: '6px', fontSize: '11px', background: 'var(--button-primary-bg)', color: '#fff' }}>
                            {si.program_name}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '12px' }}>
                        {['weekly', 'biweekly'].includes(si.recurrence_type) && `${DAYS_OF_WEEK[si.day_of_week] ?? ''}`}
                        {['monthly', 'quarterly', 'annual'].includes(si.recurrence_type) && `Day ${si.day_of_month}`}
                      </p>
                    </div>
                    <button style={btnDangerSmall} onClick={() => removeScheduledItem(idx)}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            {/* Add scheduled item form */}
            <div style={{ padding: '16px', background: 'var(--bg-secondary, rgba(255,255,255,0.03))', borderRadius: '8px', border: '1px solid var(--card-border)', marginBottom: '16px' }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Item Name</label>
                <input style={inputStyle} value={siName} onChange={e => setSiName(e.target.value)} placeholder="e.g. Weekly Program Update Meeting" />
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ ...fieldStyle, flex: 1, minWidth: '130px' }}>
                  <label style={labelStyle}>Recurrence</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={siRecurrence} onChange={e => setSiRecurrence(e.target.value)}>
                    {RECURRENCE_OPTIONS.map(r => (
                      <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                    ))}
                  </select>
                </div>
                {['weekly', 'biweekly'].includes(siRecurrence) && (
                  <div style={{ ...fieldStyle, flex: 1, minWidth: '130px' }}>
                    <label style={labelStyle}>Day of Week</label>
                    <select style={{ ...inputStyle, cursor: 'pointer' }} value={siDayOfWeek} onChange={e => setSiDayOfWeek(Number(e.target.value))}>
                      {DAYS_OF_WEEK.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                )}
                {['monthly', 'quarterly', 'annual'].includes(siRecurrence) && (
                  <div style={{ ...fieldStyle, flex: 1, minWidth: '130px' }}>
                    <label style={labelStyle}>Day of Month</label>
                    <select style={{ ...inputStyle, cursor: 'pointer' }} value={siDayOfMonth} onChange={e => setSiDayOfMonth(Number(e.target.value))}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {programs.length > 0 && (
                <div style={fieldStyle}>
                  <label style={labelStyle}>Program (optional)</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={siProgram} onChange={e => setSiProgram(e.target.value)}>
                    <option value="">None</option>
                    {programs.map((pg, i) => <option key={i} value={pg.name}>{pg.name}</option>)}
                  </select>
                </div>
              )}
              <button style={{ ...btnSmall, opacity: !siName.trim() ? 0.5 : 1 }} onClick={addScheduledItem} disabled={!siName.trim()}>
                + Add Scheduled Item
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && <p style={{ color: 'var(--accent-danger)', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}

        {/* Navigation buttons */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          {step === STEP_PROFILE && (
            <button style={{ ...btnPrimary, flex: 1, opacity: saving ? 0.6 : 1 }} onClick={handleNext} disabled={saving}>
              Next
            </button>
          )}
          {step === STEP_PROGRAMS && (
            <>
              <button style={btnSecondary} onClick={handleSkip}>Skip</button>
              <button style={{ ...btnPrimary, flex: 1 }} onClick={handleNext}>
                {programs.length > 0 ? `Next with ${programs.length} program${programs.length > 1 ? 's' : ''}` : 'Next'}
              </button>
            </>
          )}
          {step === STEP_SCHEDULED && (
            <>
              <button style={btnSecondary} onClick={handleSkip}>Skip</button>
              <button style={{ ...btnPrimary, flex: 1, opacity: saving ? 0.6 : 1 }} onClick={handleNext} disabled={saving}>
                {saving ? 'Saving…' : scheduledItems.length > 0 ? `Complete Setup (${scheduledItems.length} item${scheduledItems.length > 1 ? 's' : ''})` : 'Complete Setup'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
