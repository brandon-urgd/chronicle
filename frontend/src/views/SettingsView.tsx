import { useEffect, useState } from 'react';
import BackupIndicator from '../components/BackupIndicator';
import RestoreFlow from '../components/RestoreFlow';
import { sectionStyle, formInputStyle as inputStyle, formLabelStyle as labelStyle, fieldStyle, btnPrimary, btnSmall, headingStyle, sectionHeadingStyle } from '../styles/sharedStyles';

/* ── "What's New" localStorage key ── */
const WHATS_NEW_DISMISSED_KEY = 'chronicle-whats-new-v3-dismissed';

interface ReportPreset {
  id: number;
  name: string;
  template_type: string;
  scope: string;
  is_default: number;
}

interface Tag {
  id: number;
  name: string;
  created_at: string;
}

const MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const EXPORT_TEMPLATES = [
  { value: 'leadership_update', label: 'Leadership Update' },
  { value: 'self_review', label: 'Self-Review' },
  { value: 'weekly_summary', label: 'Weekly Summary' },
];

const VISIBILITY_OPTIONS = [
  { value: 'shareable', label: 'Shareable' },
  { value: 'personal', label: 'Personal' },
];

/* ── shared inline styles ── */

/* ── Program Types Editor (inline component) ── */
function ProgramTypesEditor({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  let types: string[] = [];
  try { types = JSON.parse(value); } catch { types = ['Primary', 'Strategic', 'Operational', 'Carrier', 'Support']; }

  const [newType, setNewType] = useState('');

  function addType() {
    const name = newType.trim();
    if (!name || types.includes(name)) return;
    const updated = [...types, name];
    onChange(JSON.stringify(updated));
    setNewType('');
  }

  function removeType(idx: number) {
    const updated = types.filter((_, i) => i !== idx);
    onChange(JSON.stringify(updated));
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const updated = [...types];
    [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
    onChange(JSON.stringify(updated));
  }

  function moveDown(idx: number) {
    if (idx >= types.length - 1) return;
    const updated = [...types];
    [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
    onChange(JSON.stringify(updated));
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
        {types.map((t, i) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'var(--input-bg)', borderRadius: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: '20px', textAlign: 'center' }}>{i + 1}</span>
            <span style={{ flex: 1, color: 'var(--text-primary)', fontSize: '14px' }}>{t}</span>
            {i === 0 && <span style={{ fontSize: '10px', color: 'var(--accent-primary)', fontWeight: 600 }}>DEFAULT</span>}
            <button style={{ ...btnSmall, fontSize: '11px', padding: '2px 6px' }} onClick={() => moveUp(i)} disabled={i === 0} aria-label={`Move ${t} up`}>↑</button>
            <button style={{ ...btnSmall, fontSize: '11px', padding: '2px 6px' }} onClick={() => moveDown(i)} disabled={i >= types.length - 1} aria-label={`Move ${t} down`}>↓</button>
            <button style={{ ...btnSmall, color: 'var(--accent-danger)', borderColor: 'var(--accent-danger)', fontSize: '11px', padding: '2px 6px' }} onClick={() => removeType(i)} aria-label={`Remove ${t}`}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          value={newType}
          onChange={e => setNewType(e.target.value)}
          placeholder="Add new type…"
          aria-label="New program type name"
          onKeyDown={e => e.key === 'Enter' && addType()}
        />
        <button style={{ ...btnPrimary, padding: '8px 16px', fontSize: '13px' }} onClick={addType}>Add</button>
      </div>
    </div>
  );
}


export default function SettingsView() {
  /* ── settings state ── */
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');

  /* ── tags state ── */
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [tagError, setTagError] = useState('');

  /* ── data management state ── */
  const [dataMsg, setDataMsg] = useState('');
  const [dataLoading, setDataLoading] = useState(false);
  const [showRestoreFlow, setShowRestoreFlow] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showResetTypeConfirm, setShowResetTypeConfirm] = useState(false);
  const [resetTypeInput, setResetTypeInput] = useState('');

  /* ── data location state ── */
  const [dataLocation, setDataLocation] = useState<{ data_directory: string; is_default: boolean } | null>(null);
  const [newDataDir, setNewDataDir] = useState('');
  const [dataLocMsg, setDataLocMsg] = useState('');

  /* ── report presets state ── */
  const [reportPresets, setReportPresets] = useState<ReportPreset[]>([]);

  /* ── What's New banner state ── */
  const [whatsNewDismissed, setWhatsNewDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(WHATS_NEW_DISMISSED_KEY) === 'true'; } catch { return false; }
  });

  /* ── load on mount ── */
  useEffect(() => {
    fetchSettings();
    fetchTags();
    fetchReportPresets();
    fetchDataLocation();
  }, []);

  async function fetchReportPresets() {
    try {
      const res = await fetch('/api/report-presets');
      if (res.ok) setReportPresets(await res.json());
    } catch { /* ignore */ }
  }

  async function fetchDataLocation() {
    try {
      const res = await fetch('/api/data-location');
      if (res.ok) {
        const data = await res.json();
        setDataLocation(data);
        setNewDataDir(data.data_directory);
      }
    } catch { /* ignore */ }
  }

  async function handleChangeDataLocation() {
    if (!newDataDir.trim()) return;
    setDataLocMsg('');
    try {
      const res = await fetch('/api/data-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_directory: newDataDir.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setDataLocMsg(data.message || 'Data location updated');
        fetchDataLocation();
      } else {
        setDataLocMsg(data.detail || 'Failed to change location');
      }
    } catch {
      setDataLocMsg('Failed to change data location');
    }
  }

  /* ── Data management helpers ── */

  function generateExportFilename(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `chronicle_backup_${date}_${time}.json`;
  }

  async function handleExportDatabase() {
    setDataLoading(true); setDataMsg('');
    try {
      const res = await fetch('/api/data/export', { method: 'POST' });
      if (!res.ok) { setDataMsg('Export failed'); return; }

      const tauri = window.__TAURI__;
      if (tauri?.dialog?.save && tauri?.fs?.writeBinaryFile && tauri?.path?.documentsDir) {
        try {
          const defaultDir = await tauri.path.documentsDir();
          const filePath = await tauri.dialog.save({
            defaultPath: `${defaultDir}${generateExportFilename()}`,
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });
          if (filePath) {
            const blob = await res.blob();
            const buffer = await blob.arrayBuffer();
            await tauri.fs.writeBinaryFile(filePath, new Uint8Array(buffer));
            setDataMsg('Export saved');
          } else {
            setDataMsg('Export cancelled');
          }
        } catch {
          // Tauri APIs failed — fall through to browser download
          await browserDownload(res);
        }
      } else {
        await browserDownload(res);
      }
    } catch { setDataMsg('Export failed'); }
    finally { setDataLoading(false); setTimeout(() => setDataMsg(''), 3000); }
  }

  async function browserDownload(res: Response) {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generateExportFilename();
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDataMsg('Export downloaded');
  }

  function handleRestoreComplete() {
    setShowRestoreFlow(false);
    setDataMsg('Import completed');
    setTimeout(() => setDataMsg(''), 4000);
    /* Refresh settings and tags after import */
    fetchSettings();
    fetchTags();
    fetchReportPresets();
  }

  async function handleResetApp() {
    setDataLoading(true); setDataMsg('');
    try {
      const res = await fetch('/api/data/reset', { method: 'POST' });
      if (res.ok) { setDataMsg('App reset — reloading…'); setTimeout(() => window.location.reload(), 500); }
      else { const err = await res.json().catch(() => ({})); setDataMsg(`Reset failed: ${(err as Record<string, string>).detail || 'Unknown error'}`); }
    } catch { setDataMsg('Reset failed'); }
    finally { setDataLoading(false); setShowResetTypeConfirm(false); setResetTypeInput(''); }
  }



  /* ── Quick Report default preset ── */
  async function setDefaultPreset(presetId: number) {
    try {
      // Clear existing defaults
      for (const p of reportPresets) {
        if (p.is_default && p.id !== presetId) {
          await fetch(`/api/report-presets/${p.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_default: 0 }),
          });
        }
      }
      await fetch(`/api/report-presets/${presetId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: 1 }),
      });
      fetchReportPresets();
    } catch { /* ignore */ }
  }

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings ?? {});
      }
    } catch { /* backend may be down */ }
  }

  async function fetchTags() {
    try {
      const res = await fetch('/api/tags');
      if (res.ok) setTags(await res.json());
    } catch { /* ignore */ }
  }

  /* ── settings helpers ── */
  function updateField(key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function saveSettings() {
    setSettingsSaving(true);
    setSettingsMsg('');
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      setSettingsMsg(res.ok ? 'Saved' : 'Error saving');
    } catch {
      setSettingsMsg('Failed to save');
    } finally {
      setSettingsSaving(false);
      setTimeout(() => setSettingsMsg(''), 2000);
    }
  }

  /* ── tag helpers ── */
  async function addTag() {
    const name = newTagName.trim();
    if (!name) return;
    setTagError('');
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.status === 409) { setTagError('Tag already exists'); return; }
      if (!res.ok) { setTagError('Error creating tag'); return; }
      setNewTagName('');
      fetchTags();
    } catch { setTagError('Failed to create tag'); }
  }

  async function renameTag(id: number) {
    const name = editingTagName.trim();
    if (!name) return;
    try {
      await fetch(`/api/tags/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setEditingTagId(null);
      fetchTags();
    } catch { /* ignore */ }
  }

  async function deleteTag(id: number) {
    if (!confirm('Delete this tag? This cannot be undone.')) return;
    try {
      await fetch(`/api/tags/${id}`, { method: 'DELETE' });
      fetchTags();
    } catch { /* ignore */ }
  }

  return (
    <div style={{ maxWidth: '800px' }}>
      {/* ── Refresh ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
        <button
          className="refresh-btn"
          onClick={() => { fetchSettings(); fetchTags(); fetchReportPresets(); }}
        >
          <span className="refresh-icon">↻</span> Refresh
        </button>
      </div>

      {/* ══════════════════════════════════════════
          What's New in v2.0.0 (dismissible banner)
         ══════════════════════════════════════════ */}
      {!whatsNewDismissed && (
        <div style={{ ...sectionStyle, borderColor: 'var(--accent-primary)', marginBottom: '24px', position: 'relative' }}>
          <button
            onClick={() => { setWhatsNewDismissed(true); try { localStorage.setItem(WHATS_NEW_DISMISSED_KEY, 'true'); } catch { /* ignore */ } }}
            style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}
            aria-label="Dismiss What's New banner"
          >
            ×
          </button>
          <h3 style={{ margin: '0 0 10px', fontSize: '16px', fontWeight: 600, color: 'var(--accent-primary)' }}>What's New in v3.1.0</h3>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.8' }}>
            <li><strong>Schema lean-out</strong> — streamlined to 14 tables, removed unused columns and dead features</li>
            <li><strong>Squid Ink design system</strong> — cool-toned light mode + Warm Charcoal dark mode with elevation tokens</li>
            <li><strong>Leaner entry types</strong> — 6 focused types: quick_capture, project_update, operational_rhythm, milestone, decision, recognition</li>
            <li><strong>MCP v3.1 signatures</strong> — cleaner tool parameters, no dead fields in responses</li>
            <li><strong>Report improvements</strong> — PDF export starts at the top, no "Other Work" heading when all entries are unassigned</li>
            <li><strong>Auto-hide scrollbars</strong> — modern minimal scroll treatment throughout</li>
            <li><strong>SMART fields collapsed</strong> — Portfolio goals show projects without SMART clutter by default</li>
          </ul>
        </div>
      )}

      {/* ══════════════════════════════════════════
          Profile
         ══════════════════════════════════════════ */}
      <h2 style={sectionHeadingStyle}>Profile</h2>

      {/* ── Identity ── */}
      <div style={sectionStyle}>
        <h3 style={headingStyle}>Identity</h3>
        {[
          { key: 'user_name', label: 'Name', placeholder: 'Your full name' },
          { key: 'user_role', label: 'Role', placeholder: 'e.g. Program Manager' },
          { key: 'user_title', label: 'Title', placeholder: 'e.g. Sr. Program Manager' },
          { key: 'user_org', label: 'Organization', placeholder: 'e.g. ACO' },
          { key: 'manager_name', label: 'Manager Name', placeholder: "Your manager's name" },
        ].map(f => (
          <div key={f.key} style={fieldStyle}>
            <label htmlFor={`settings-${f.key}`} style={labelStyle}>{f.label}</label>
            <input
              id={`settings-${f.key}`}
              style={inputStyle}
              value={settings[f.key] ?? ''}
              onChange={e => updateField(f.key, e.target.value)}
              placeholder={f.placeholder}
            />
          </div>
        ))}
      </div>

      {/* ── Review Period ── */}
      <div style={sectionStyle}>
        <h3 style={headingStyle}>Review Period</h3>
        <div style={fieldStyle}>
          <label htmlFor="settings-fiscal-year-start" style={labelStyle}>Review Period Start Month</label>
          <select
            id="settings-fiscal-year-start"
            style={{ ...inputStyle, cursor: 'pointer', color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)' }}
            value={settings.fiscal_year_start_month ?? '10'}
            onChange={e => updateField('fiscal_year_start_month', e.target.value)}
          >
            {MONTHS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Save Settings Button ── */}
      <div style={{ marginBottom: '28px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button style={{ ...btnPrimary, opacity: settingsSaving ? 0.6 : 1 }} onClick={saveSettings} disabled={settingsSaving}>
          {settingsSaving ? 'Saving…' : 'Save Settings'}
        </button>
        {settingsMsg && <span style={{ color: settingsMsg === 'Saved' ? 'var(--accent-secondary)' : 'var(--accent-danger)', fontSize: '13px' }}>{settingsMsg}</span>}
      </div>

      {/* ══════════════════════════════════════════
          Program Types
         ══════════════════════════════════════════ */}
      <h2 style={sectionHeadingStyle}>Program Types</h2>
      <div style={sectionStyle}>
        <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Define the types available when creating programs. The first type is the default for new programs. Drag to reorder (or edit the list directly).
        </p>
        <ProgramTypesEditor
          value={settings.program_types ?? '["Primary","Strategic","Operational","Carrier","Support"]'}
          onChange={(val) => updateField('program_types', val)}
        />
      </div>

      {/* ══════════════════════════════════════════
          Report Preferences
         ══════════════════════════════════════════ */}
      <h2 style={sectionHeadingStyle}>Report Preferences</h2>
      <div style={sectionStyle}>
        <div style={fieldStyle}>
          <label htmlFor="settings-default-template" style={labelStyle}>Default Template</label>
          <select
            id="settings-default-template"
            style={{ ...inputStyle, cursor: 'pointer', color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)' }}
            value={settings.default_export_template ?? 'leadership_update'}
            onChange={e => updateField('default_export_template', e.target.value)}
          >
            {EXPORT_TEMPLATES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div style={fieldStyle}>
          <label htmlFor="settings-default-visibility" style={labelStyle}>Default Visibility</label>
          <select
            id="settings-default-visibility"
            style={{ ...inputStyle, cursor: 'pointer', color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)' }}
            value={settings.default_export_visibility ?? 'shareable'}
            onChange={e => updateField('default_export_visibility', e.target.value)}
          >
            {VISIBILITY_OPTIONS.map(v => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
        <div style={fieldStyle}>
          <label htmlFor="settings-quick-report-preset" style={labelStyle}>Quick Report Default Preset</label>
          <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
            Choose which report preset the Quick Report button on the Today View uses.
          </p>
          <select
            id="settings-quick-report-preset"
            style={{ ...inputStyle, cursor: 'pointer', color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)' }}
            value={reportPresets.find(p => p.is_default)?.id ?? ''}
            onChange={e => { if (e.target.value) setDefaultPreset(parseInt(e.target.value, 10)); }}
          >
            <option value="">— Select default —</option>
            {reportPresets.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          Tag Manager
         ══════════════════════════════════════════ */}
      <h2 style={sectionHeadingStyle}>Tags</h2>
      <div style={sectionStyle}>
        {/* Add tag */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={newTagName}
            onChange={e => setNewTagName(e.target.value)}
            placeholder="New tag name"
            aria-label="New tag name"
            onKeyDown={e => e.key === 'Enter' && addTag()}
          />
          <button style={btnPrimary} onClick={addTag}>Add Tag</button>
        </div>
        {tagError && <p style={{ color: 'var(--accent-danger)', fontSize: '13px', margin: '-8px 0 12px' }}>{tagError}</p>}

        {/* Tag list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {tags.map(tag => (
            <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'var(--input-bg)', borderRadius: '8px' }}>
              {editingTagId === tag.id ? (
                <>
                  <input
                    style={{ ...inputStyle, flex: 1, padding: '6px 10px' }}
                    value={editingTagName}
                    onChange={e => setEditingTagName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && renameTag(tag.id)}
                    aria-label="Rename tag"
                    autoFocus
                  />
                  <button style={{ ...btnPrimary, padding: '4px 12px', fontSize: '12px' }} onClick={() => renameTag(tag.id)}>Save</button>
                  <button style={{ ...btnSmall, color: 'var(--text-muted)', borderColor: 'var(--text-muted)' }} onClick={() => setEditingTagId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, color: 'var(--text-primary)', fontSize: '14px' }}>{tag.name}</span>
                  <button
                    style={{ ...btnSmall, color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}
                    onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); }}
                    aria-label={`Rename tag ${tag.name}`}
                  >
                    Rename
                  </button>
                  <button style={{ ...btnSmall, color: 'var(--accent-danger)', borderColor: 'var(--accent-danger)' }} onClick={() => deleteTag(tag.id)} aria-label={`Delete tag ${tag.name}`}>Delete</button>
                </>
              )}
            </div>
          ))}
          {tags.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>No tags yet.</p>}
        </div>
      </div>



      {/* ══════════════════════════════════════════
          Data Management
         ══════════════════════════════════════════ */}
      <h2 style={sectionHeadingStyle}>Data Management</h2>

      {/* ── Data Location ── */}
      <div style={sectionStyle}>
        <h3 style={headingStyle}>Data Location</h3>
        <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Choose where Chronicle stores your database, attachments, and backups.
        </p>
        {dataLocation && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
              <input
                style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: '12px' }}
                value={newDataDir}
                onChange={e => setNewDataDir(e.target.value)}
                placeholder="Enter folder path..."
                aria-label="Data directory path"
              />
              <button
                style={{ ...btnPrimary, padding: '10px 16px', fontSize: '13px', whiteSpace: 'nowrap' as const }}
                onClick={handleChangeDataLocation}
                disabled={!(newDataDir || '').trim() || (dataLocation && (newDataDir || '').trim() === (dataLocation.data_directory || ''))}
              >
                Move Data
              </button>
            </div>
            {dataLocation.is_default && (
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)' }}>
                Using default location. Change this to store data on a cloud drive or external folder.
              </p>
            )}
            {!dataLocation.is_default && (
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--accent-primary)' }}>
                Custom location active.
              </p>
            )}
            {dataLocMsg && (
              <div style={{ padding: '8px 14px', borderRadius: '6px', fontSize: '13px', marginTop: '8px',
                background: dataLocMsg.includes('Failed') || dataLocMsg.includes('failed') ? 'rgba(220,38,38,0.1)' : 'rgba(63,125,88,0.1)',
                color: dataLocMsg.includes('Failed') || dataLocMsg.includes('failed') ? 'var(--accent-danger)' : 'var(--accent-secondary)' }}>
                {dataLocMsg}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Export / Import / Backup ── */}
      <div style={sectionStyle}>
        <h3 style={headingStyle}>Export & Import</h3>
        <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Export a full database backup, restore from a backup file, or reset the application.
        </p>
        <BackupIndicator />
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <button style={{ ...btnPrimary, opacity: dataLoading ? 0.5 : 1 }} onClick={handleExportDatabase} disabled={dataLoading}>Export Database</button>
          <button style={{ padding: '10px 20px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--card-border)', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', opacity: dataLoading ? 0.5 : 1 }}
            onClick={() => setShowRestoreFlow(true)} disabled={dataLoading}>Import Database</button>
        </div>
        {dataMsg && (
          <div style={{ padding: '8px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '12px',
            background: dataMsg.includes('failed') || dataMsg.includes('Failed') ? 'rgba(220,38,38,0.1)' : 'rgba(63,125,88,0.1)',
            color: dataMsg.includes('failed') || dataMsg.includes('Failed') ? 'var(--accent-danger)' : 'var(--accent-secondary)' }}>
            {dataMsg}
          </div>
        )}
      </div>

      {/* ── Reset ── */}
      <div style={{ ...sectionStyle, borderColor: 'var(--accent-danger)' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 600, color: 'var(--accent-danger)' }}>Reset Application</h3>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>
          Permanently erase all data and return to initial setup. This cannot be undone.
        </p>
        <button style={{ padding: '10px 20px', background: 'transparent', color: 'var(--accent-danger)', border: '1px solid var(--accent-danger)', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: dataLoading ? 0.5 : 1 }}
          onClick={() => setShowResetConfirm(true)} disabled={dataLoading}>Reset App</button>
      </div>

      {/* ── RestoreFlow for imports (settings mode) ── */}
      {showRestoreFlow && (
        <RestoreFlow
          mode="settings"
          onBack={() => setShowRestoreFlow(false)}
          onComplete={handleRestoreComplete}
        />
      )}

      {/* ── Reset Step 1 ── */}
      {showResetConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--modal-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowResetConfirm(false)} role="dialog" aria-modal="true" aria-label="Reset confirmation">
          <div style={{ ...sectionStyle, maxWidth: '440px', textAlign: 'center' as const }} onClick={e => e.stopPropagation()}>
            <p style={{ color: 'var(--accent-danger)', fontWeight: 600, marginBottom: '12px' }}>Reset Application</p>
            <p style={{ color: 'var(--text-primary)', marginBottom: '16px' }}>This will erase ALL data. Are you sure?</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button style={{ padding: '10px 20px', background: 'transparent', color: 'var(--accent-danger)', border: '1px solid var(--accent-danger)', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
                onClick={() => { setShowResetConfirm(false); setShowResetTypeConfirm(true); setResetTypeInput(''); }}>Yes, Continue</button>
              <button style={{ padding: '10px 20px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--card-border)', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' }}
                onClick={() => setShowResetConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset Step 2 ── */}
      {showResetTypeConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--modal-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => { setShowResetTypeConfirm(false); setResetTypeInput(''); }} role="dialog" aria-modal="true" aria-label="Final reset confirmation">
          <div style={{ ...sectionStyle, maxWidth: '440px', textAlign: 'center' as const }} onClick={e => e.stopPropagation()}>
            <p style={{ color: 'var(--accent-danger)', fontWeight: 600, marginBottom: '12px' }}>Final Confirmation</p>
            <p style={{ color: 'var(--text-primary)', marginBottom: '16px' }}>Type <strong>DELETE</strong> to permanently erase all data:</p>
            <input style={{ ...inputStyle, marginBottom: '16px', borderColor: 'var(--accent-danger)', color: 'var(--accent-danger)', textAlign: 'center' as const }}
              value={resetTypeInput} onChange={e => setResetTypeInput(e.target.value)} placeholder="Type DELETE" aria-label="Type DELETE to confirm reset" autoFocus />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button style={{ padding: '10px 20px', background: 'transparent', color: 'var(--accent-danger)', border: '1px solid var(--accent-danger)', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: resetTypeInput !== 'DELETE' ? 0.4 : 1 }}
                onClick={handleResetApp} disabled={resetTypeInput !== 'DELETE' || dataLoading}>
                {dataLoading ? 'Resetting…' : 'Permanently Delete Everything'}
              </button>
              <button style={{ padding: '10px 20px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--card-border)', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' }}
                onClick={() => { setShowResetTypeConfirm(false); setResetTypeInput(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
