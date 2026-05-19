import { useState, useRef, useEffect, useCallback } from 'react';

/* ── Types ── */
interface RestoreFlowProps {
  mode: 'onboarding' | 'settings';
  onBack: () => void;
  onStartFresh?: () => void;
  onComplete: () => void;
}

type RestoreStep = 'file-select' | 'validating' | 'preview' | 'importing' | 'success' | 'error';

type ErrorCategory = 'invalid-json' | 'not-chronicle' | 'schema-mismatch' | 'import-failure';

interface ValidationSummary {
  entries_count: number;
  entries_date_range: [string, string] | [];
  programs: string[];
  programs_count: number;
  goals_count: number;
  projects_count: number;
  scheduled_items_count: number;
  scheduled_instances_count: number;
  lessons_count: number;
  tags_count: number;
  tags: string[];
  attachments_count: number;
  report_presets_count: number;
  user_name: string | null;
  user_role: string | null;
  backup_version: string | null;
  schema_version: number | null;
  backup_date: string | null;
  tables_found: number;
  tables_expected: number;
}

interface DataValidateResponse {
  valid: boolean;
  summary: ValidationSummary | null;
  warnings: string[];
  errors: string[];
}

interface RestoreState {
  step: RestoreStep;
  selectedFile: File | null;
  validationResult: DataValidateResponse | null;
  importError: string | null;
  restoredEntryCount: number;
  restoredUserName: string;
  errorCategory: ErrorCategory | null;
}

/* ── Styles ── */
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000,
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-primary, #ffffff)',
};

const containerStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  flex: 1, width: '100%', maxWidth: '600px',
  padding: '48px 24px',
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 8px', color: 'var(--text-primary)',
  fontSize: '20px', fontWeight: 700, textAlign: 'center',
};

const subTextStyle: React.CSSProperties = {
  margin: '0 0 24px', color: 'var(--text-secondary)',
  fontSize: '13px', textAlign: 'center',
};

const cardStyle: React.CSSProperties = {
  width: '100%', padding: '24px',
  background: 'var(--card-bg)', border: '1px solid var(--card-border)',
  borderRadius: '12px', boxShadow: 'var(--shadow-soft)',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 20px', background: 'var(--button-primary-bg)',
  color: '#fff', border: 'none', borderRadius: '8px',
  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 20px', background: 'transparent',
  color: 'var(--text-secondary)', border: '1px solid var(--card-border)',
  borderRadius: '8px', fontSize: '14px', cursor: 'pointer',
};

const linkStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--accent-secondary)',
  fontSize: '13px', cursor: 'pointer', textDecoration: 'underline',
  padding: 0,
};

const warningBoxStyle: React.CSSProperties = {
  padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
  background: 'rgba(180, 83, 9, 0.1)', color: 'var(--accent-warning)',
  border: '1px solid rgba(180, 83, 9, 0.2)', marginBottom: '12px',
};

const errorBoxStyle: React.CSSProperties = {
  padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
  background: 'rgba(220, 38, 38, 0.1)', color: 'var(--accent-danger)',
  border: '1px solid rgba(220, 38, 38, 0.2)', marginBottom: '12px',
};

const successBoxStyle: React.CSSProperties = {
  padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
  background: 'rgba(63, 125, 88, 0.1)', color: 'var(--accent-secondary)',
  border: '1px solid rgba(63, 125, 88, 0.2)', marginBottom: '12px',
};

const spinnerStyle: React.CSSProperties = {
  width: '32px', height: '32px', border: '3px solid var(--card-border)',
  borderTopColor: 'var(--button-primary-bg)', borderRadius: '50%',
  animation: 'restore-spin 0.8s linear infinite',
};

const summaryRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '6px 0', borderBottom: '1px solid var(--card-border)',
  fontSize: '13px',
};

const summaryLabelStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
};

const summaryValueStyle: React.CSSProperties = {
  color: 'var(--text-primary)', fontWeight: 600,
};

/* ── Spinner keyframes injector ── */
let spinnerInjected = false;
function ensureSpinnerKeyframes() {
  if (spinnerInjected) return;
  const style = document.createElement('style');
  style.textContent = `@keyframes restore-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
  spinnerInjected = true;
}

/* ── Helper: classify validation errors ── */
function classifyError(errors: string[]): ErrorCategory {
  const joined = errors.join(' ').toLowerCase();
  if (joined.includes('invalid json') || joined.includes('json decode') || joined.includes('could not parse') || joined.includes('expecting value')) {
    return 'invalid-json';
  }
  if (joined.includes('schema version') || joined.includes('newer version') || joined.includes('version mismatch')) {
    return 'schema-mismatch';
  }
  return 'not-chronicle';
}


/* ══════════════════════════════════════════════════
   RestoreFlow Component
   ══════════════════════════════════════════════════ */
export default function RestoreFlow({ mode, onBack, onStartFresh, onComplete }: RestoreFlowProps) {
  const [state, setState] = useState<RestoreState>({
    step: 'file-select',
    selectedFile: null,
    validationResult: null,
    importError: null,
    restoredEntryCount: 0,
    restoredUserName: '',
    errorCategory: null,
  });

  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoRedirectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    ensureSpinnerKeyframes();
  }, []);

  /* Cleanup auto-redirect on unmount */
  useEffect(() => {
    return () => {
      if (autoRedirectRef.current) clearTimeout(autoRedirectRef.current);
    };
  }, []);

  /* ── File selection handlers ── */
  const handleFileSelected = useCallback(async (file: File) => {
    setFileError(null);

    if (!file.name.toLowerCase().endsWith('.json')) {
      setFileError('Only .json files are accepted. Please select a Chronicle backup file.');
      return;
    }

    setState(prev => ({ ...prev, step: 'validating', selectedFile: file }));

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/data/validate', { method: 'POST', body: formData });
      const data: DataValidateResponse = await res.json();

      if (data.valid) {
        setState(prev => ({
          ...prev,
          step: 'preview',
          validationResult: data,
        }));
      } else {
        const category = classifyError(data.errors);
        setState(prev => ({
          ...prev,
          step: 'error',
          validationResult: data,
          errorCategory: category,
        }));
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        step: 'error',
        errorCategory: 'invalid-json',
        validationResult: { valid: false, summary: null, warnings: [], errors: ['Failed to validate file. The server may be unavailable.'] },
      }));
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  }, [handleFileSelected]);

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
    /* Reset input so same file can be re-selected */
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFileSelected]);

  /* ── Import handler ── */
  const handleImport = useCallback(async () => {
    if (!state.selectedFile) return;

    setState(prev => ({ ...prev, step: 'importing' }));
    const importStart = Date.now();

    try {
      const formData = new FormData();
      formData.append('file', state.selectedFile);
      const res = await fetch('/api/data/import', { method: 'POST', body: formData });

      /* Enforce minimum 500ms display time */
      const elapsed = Date.now() - importStart;
      if (elapsed < 500) {
        await new Promise(resolve => setTimeout(resolve, 500 - elapsed));
      }

      if (res.ok) {
        const entryCount = state.validationResult?.summary?.entries_count ?? 0;
        const userName = state.validationResult?.summary?.user_name ?? '';
        setState(prev => ({
          ...prev,
          step: 'success',
          restoredEntryCount: entryCount,
          restoredUserName: userName,
        }));

        /* Auto-redirect after 3 seconds */
        autoRedirectRef.current = setTimeout(() => {
          onComplete();
        }, 3000);
      } else {
        const errData = await res.json().catch(() => ({ detail: 'Unknown error' }));
        setState(prev => ({
          ...prev,
          step: 'error',
          errorCategory: 'import-failure',
          importError: (errData as Record<string, string>).detail || 'Import failed',
        }));
      }
    } catch (err) {
      /* Enforce minimum 500ms display time even on error */
      const elapsed = Date.now() - importStart;
      if (elapsed < 500) {
        await new Promise(resolve => setTimeout(resolve, 500 - elapsed));
      }
      setState(prev => ({
        ...prev,
        step: 'error',
        errorCategory: 'import-failure',
        importError: 'Network error during import. Please try again.',
      }));
    }
  }, [state.selectedFile, state.validationResult, onComplete]);

  /* ── Navigation helpers ── */
  const goToFileSelect = useCallback(() => {
    setState({
      step: 'file-select', selectedFile: null, validationResult: null,
      importError: null, restoredEntryCount: 0, restoredUserName: '', errorCategory: null,
    });
    setFileError(null);
    setCopySuccess(false);
  }, []);

  const handleExportFirst = useCallback(async () => {
    try {
      const res = await fetch('/api/data/export', { method: 'POST' });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('content-disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'chronicle_backup.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }, []);

  const handleCopyError = useCallback(async () => {
    const errorText = state.importError || state.validationResult?.errors?.join('\n') || 'Unknown error';
    try {
      await navigator.clipboard.writeText(errorText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch { /* clipboard not available */ }
  }, [state.importError, state.validationResult]);

  /* ── Render steps ── */

  /* --- FILE SELECT --- */
  if (state.step === 'file-select') {
    const dropZoneStyle: React.CSSProperties = {
      width: '100%', padding: '48px 24px',
      border: `2px dashed ${dragOver ? 'var(--button-primary-bg)' : 'var(--card-border)'}`,
      borderRadius: '12px', textAlign: 'center', cursor: 'pointer',
      background: dragOver ? 'rgba(47, 58, 74, 0.05)' : 'transparent',
      transition: 'border-color 0.2s, background 0.2s',
    };

    return (
      <div style={overlayStyle} data-testid="restore-flow">
        <div style={containerStyle}>
          <h2 style={headingStyle}>Restore from Backup</h2>
          <p style={subTextStyle}>Select a Chronicle backup file to restore your data.</p>

          <div style={cardStyle}>
            <div
              style={dropZoneStyle}
              data-testid="drop-zone"
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleBrowseClick}
              role="button"
              tabIndex={0}
              aria-label="Drop a JSON backup file here or click to browse"
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBrowseClick(); } }}
            >
              <div style={{ fontSize: '32px', marginBottom: '12px', color: 'var(--text-muted)' }}>📁</div>
              <p style={{ margin: '0 0 4px', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600 }}>
                Drop your backup file here
              </p>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '12px' }}>
                or click to browse — .json files only
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleInputChange}
              data-testid="file-input"
            />

            {fileError && (
              <div style={{ ...errorBoxStyle, marginTop: '12px' }} data-testid="file-error">
                {fileError}
              </div>
            )}
          </div>

          {/* Navigation controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '20px', width: '100%', justifyContent: 'center' }}>
            <button style={btnSecondary} onClick={onBack} data-testid="back-btn">
              Back
            </button>
            {mode === 'onboarding' && onStartFresh && (
              <button style={linkStyle} onClick={onStartFresh} data-testid="start-fresh-link">
                Start fresh instead
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* --- VALIDATING --- */
  if (state.step === 'validating') {
    return (
      <div style={overlayStyle} data-testid="restore-validating">
        <div style={containerStyle}>
          <div style={spinnerStyle} data-testid="validation-spinner" />
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '16px' }}>
            Validating your backup…
          </p>
        </div>
      </div>
    );
  }

  /* --- PREVIEW --- */
  if (state.step === 'preview' && state.validationResult?.summary) {
    const s = state.validationResult.summary;
    const warnings = state.validationResult.warnings;
    const dateRange = s.entries_date_range.length === 2
      ? `${s.entries_date_range[0]} — ${s.entries_date_range[1]}`
      : 'N/A';

    return (
      <div style={overlayStyle} data-testid="restore-preview">
        <div style={{ ...containerStyle, justifyContent: 'flex-start', paddingTop: '32px', overflowY: 'auto' }}>
          <h2 style={headingStyle}>Backup Preview</h2>
          <p style={subTextStyle}>
            {s.backup_date ? `Backup from ${new Date(s.backup_date).toLocaleDateString()}` : 'Review your backup contents'}
          </p>

          <div style={{ ...cardStyle, marginBottom: '16px' }}>
            {/* User profile */}
            {(s.user_name || s.user_role) && (
              <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--card-border)' }}>
                <p style={{ margin: '0 0 2px', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600 }} data-testid="preview-user-name">
                  {s.user_name || 'Unknown User'}
                </p>
                {s.user_role && (
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '12px' }} data-testid="preview-user-role">
                    {s.user_role}
                  </p>
                )}
              </div>
            )}

            {/* Summary fields */}
            <div data-testid="preview-summary">
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Entries</span>
                <span style={summaryValueStyle} data-testid="preview-entries-count">{s.entries_count}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Date Range</span>
                <span style={summaryValueStyle} data-testid="preview-date-range">{dateRange}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Programs</span>
                <span style={summaryValueStyle} data-testid="preview-programs-count">{s.programs_count}</span>
              </div>
              {s.programs.length > 0 && (
                <div style={{ padding: '4px 0 6px', fontSize: '12px', color: 'var(--text-muted)' }} data-testid="preview-programs">
                  {s.programs.join(', ')}
                </div>
              )}
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Goals</span>
                <span style={summaryValueStyle} data-testid="preview-goals-count">{s.goals_count}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Projects</span>
                <span style={summaryValueStyle} data-testid="preview-projects-count">{s.projects_count}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Tags</span>
                <span style={summaryValueStyle} data-testid="preview-tags-count">{s.tags_count}</span>
              </div>
              {s.tags.length > 0 && (
                <div style={{ padding: '4px 0 6px', fontSize: '12px', color: 'var(--text-muted)' }} data-testid="preview-tags">
                  {s.tags.join(', ')}
                </div>
              )}
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Scheduled Items</span>
                <span style={summaryValueStyle} data-testid="preview-scheduled-count">{s.scheduled_items_count}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Lessons Learned</span>
                <span style={summaryValueStyle} data-testid="preview-lessons-count">{s.lessons_count}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Attachments</span>
                <span style={summaryValueStyle} data-testid="preview-attachments-count">{s.attachments_count}</span>
              </div>
              {s.backup_version && (
                <div style={{ ...summaryRowStyle, borderBottom: 'none' }}>
                  <span style={summaryLabelStyle}>Backup Version</span>
                  <span style={summaryValueStyle} data-testid="preview-backup-version">{s.backup_version}</span>
                </div>
              )}
            </div>
          </div>

          {/* Warnings from validation */}
          {warnings.length > 0 && (
            <div data-testid="preview-warnings">
              {warnings.map((w, i) => (
                <div key={i} style={warningBoxStyle} data-testid="preview-warning">
                  ⚠️ {w}
                </div>
              ))}
            </div>
          )}

          {/* Replace data warning */}
          <div style={warningBoxStyle} data-testid="replace-warning">
            ⚠️ This will replace all current data.
            {mode === 'settings' && ' Make sure you have exported your current data first.'}
          </div>

          {/* Settings mode: export first button */}
          {mode === 'settings' && (
            <button
              style={{ ...btnSecondary, marginBottom: '12px', width: '100%' }}
              onClick={handleExportFirst}
              data-testid="export-first-btn"
            >
              Export Current Data First
            </button>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
            <button style={{ ...btnSecondary, flex: 1 }} onClick={goToFileSelect} data-testid="cancel-btn">
              Cancel
            </button>
            <button style={{ ...btnPrimary, flex: 1 }} onClick={handleImport} data-testid="restore-btn">
              Restore This Backup
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* --- IMPORTING --- */
  if (state.step === 'importing') {
    return (
      <div style={overlayStyle} data-testid="restore-importing">
        <div style={containerStyle}>
          <div style={spinnerStyle} data-testid="import-spinner" />
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '16px' }}>
            Restoring your data…
          </p>
        </div>
      </div>
    );
  }

  /* --- SUCCESS --- */
  if (state.step === 'success') {
    return (
      <div style={overlayStyle} data-testid="restore-success">
        <div style={containerStyle}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
          <h2 style={headingStyle}>Restore Complete</h2>
          {state.restoredUserName && (
            <p style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '16px' }} data-testid="welcome-greeting">
              Welcome back, {state.restoredUserName}
            </p>
          )}
          <div style={successBoxStyle} data-testid="restored-count">
            {state.restoredEntryCount} {state.restoredEntryCount === 1 ? 'entry' : 'entries'} restored successfully.
          </div>
          <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: '12px' }}>
            Redirecting to Today view in a moment…
          </p>
          <button
            style={btnPrimary}
            onClick={() => {
              if (autoRedirectRef.current) clearTimeout(autoRedirectRef.current);
              onComplete();
            }}
            data-testid="go-to-today-btn"
          >
            Go to Today View
          </button>
        </div>
      </div>
    );
  }

  /* --- ERROR --- */
  if (state.step === 'error') {
    const category = state.errorCategory;
    const errors = state.validationResult?.errors ?? [];
    const importErr = state.importError;

    let title = 'Something went wrong';
    let message = '';

    switch (category) {
      case 'invalid-json':
        title = "This file couldn't be read";
        message = 'The file does not contain valid JSON. Please check the file and try again.';
        break;
      case 'not-chronicle':
        title = "This doesn't look like a Chronicle backup";
        message = 'The file is valid JSON but is missing required Chronicle data tables.';
        break;
      case 'schema-mismatch':
        title = 'This backup is from a newer version';
        message = 'The backup was created with a newer version of Chronicle. You may need to update the app, or try restoring anyway.';
        break;
      case 'import-failure':
        title = 'Something went wrong during restore';
        message = 'No data was overwritten — the database has been rolled back to its previous state.';
        break;
    }

    return (
      <div style={overlayStyle} data-testid="restore-error">
        <div style={containerStyle}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ ...headingStyle, color: 'var(--accent-danger)' }} data-testid="error-title">{title}</h2>
          <p style={subTextStyle}>{message}</p>

          {/* Show specific error messages */}
          {errors.length > 0 && (
            <div style={{ width: '100%', marginBottom: '16px' }} data-testid="error-messages">
              {errors.map((err, i) => (
                <div key={i} style={errorBoxStyle} data-testid="error-message">
                  {err}
                </div>
              ))}
            </div>
          )}

          {/* Import error detail */}
          {importErr && (
            <div style={{ ...errorBoxStyle, width: '100%' }} data-testid="import-error-detail">
              {importErr}
            </div>
          )}

          {/* Action buttons based on category */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', alignItems: 'center' }}>
            {/* Try Another File — all categories */}
            <button
              style={{ ...btnSecondary, width: '100%' }}
              onClick={goToFileSelect}
              data-testid="try-another-btn"
            >
              Try Another File
            </button>

            {/* Schema mismatch: Restore Anyway */}
            {category === 'schema-mismatch' && (
              <button
                style={{ ...btnPrimary, width: '100%', background: 'var(--accent-warning)' }}
                onClick={handleImport}
                data-testid="restore-anyway-btn"
              >
                Restore Anyway
              </button>
            )}

            {/* Import failure: Try Again */}
            {category === 'import-failure' && (
              <button
                style={{ ...btnPrimary, width: '100%' }}
                onClick={handleImport}
                data-testid="try-again-btn"
              >
                Try Again
              </button>
            )}

            {/* Import failure: Copy Error Details */}
            {category === 'import-failure' && (
              <button
                style={{ ...btnSecondary, width: '100%' }}
                onClick={handleCopyError}
                data-testid="copy-error-btn"
              >
                {copySuccess ? 'Copied!' : 'Copy Error Details'}
              </button>
            )}

            {/* Start Fresh — all categories (onboarding mode or settings) */}
            {mode === 'onboarding' && onStartFresh && (
              <button
                style={linkStyle}
                onClick={onStartFresh}
                data-testid="error-start-fresh"
              >
                Start Fresh Instead
              </button>
            )}
            {mode === 'settings' && (
              <button
                style={linkStyle}
                onClick={onBack}
                data-testid="error-go-back"
              >
                Go Back to Settings
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* Fallback — should not reach here */
  return null;
}
