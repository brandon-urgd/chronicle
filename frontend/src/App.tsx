import { useState, useEffect, useCallback } from 'react';
import WelcomeScreen from './views/WelcomeScreen';
import DashboardView from './views/DashboardView';
import PortfolioView from './views/PortfolioView';
import CaptureSheet from './components/CaptureSheet';
import TimelineView from './views/TimelineView';
import DistributionView from './views/DistributionView';
import ReportsView from './views/ReportsView';
import SettingsView from './views/SettingsView';
import GuideView from './views/GuideView';
import AboutModal from './components/AboutModal';
import RecoveryScreen from './components/RecoveryScreen';
import { patchAppState } from './utils/appState';

const primaryNav = [
  { key: 'Dashboard', label: 'Dashboard', icon: '🏠' },
  { key: 'Portfolio', label: 'Portfolio', icon: '📁' },
  { key: 'Timeline', label: 'Timeline', icon: '📅' },
  { key: 'Distribution', label: 'Distribution', icon: '📊' },
  { key: 'Reports', label: 'Reports', icon: '📄' },
];

const utilityNav = [
  { key: 'Settings', label: 'Settings', icon: '⚙️' },
  { key: 'Guide', label: 'Guide', icon: '📖' },
];

function App() {
  const [activeTab, setActiveTab] = useState<string>('Dashboard');
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [quickCapturePrefillDate, setQuickCapturePrefillDate] = useState<string | undefined>();
  const [quickCapturePrefillProgramId, setQuickCapturePrefillProgramId] = useState<number | undefined>();
  const [quickCapturePrefillProjectId, setQuickCapturePrefillProjectId] = useState<number | undefined>();
  const [quickCapturePrefillAsTask, setQuickCapturePrefillAsTask] = useState(false);
  const [quickCapturePrefillAsCadence, setQuickCapturePrefillAsCadence] = useState(false);
  const [userName, setUserName] = useState('');
  const [focusId, setFocusId] = useState<number | null>(null);
  const [focusProjectId, setFocusProjectId] = useState<number | null>(null);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('chronicle-theme') as 'dark' | 'light') || 'light';
  });

  /* Apply theme to document */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('chronicle-theme', theme);
  }, [theme]);

  /* Persist active tab to localStorage (R6.1) */
  useEffect(() => {
    patchAppState({ activeTab });
  }, [activeTab]);

  const [backendReady, setBackendReady] = useState(false);
  const [backendLost, setBackendLost] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');

  /* Poll backend health until it responds — gates all other API calls */
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 50; // 50 × 400ms = 20 seconds max wait
    async function poll() {
      while (!cancelled && attempt < maxAttempts) {
        try {
          const res = await fetch('/api/health');
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'recovery') {
              // v3.0: DB init failed — show recovery screen
              if (!cancelled) {
                setRecoveryMode(true);
                setRecoveryError(data.error || 'Unknown database error');
                setBackendReady(true);
              }
              return;
            }
            if (!cancelled) setBackendReady(true);
            return;
          }
        } catch { /* backend not up yet */ }
        attempt++;
        await new Promise(r => setTimeout(r, 400));
      }
      // After 20s, give up and let the setup check proceed (will likely fail gracefully)
      if (!cancelled) setBackendReady(true);
    }
    poll();
    return () => { cancelled = true; };
  }, []);

  /* Ongoing health monitor — detect backend crash mid-session */
  useEffect(() => {
    if (!backendReady || !setupComplete) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          if (backendLost) setBackendLost(false);
        } else {
          setBackendLost(true);
        }
      } catch {
        setBackendLost(true);
      }
    }, 5000); // check every 5 seconds
    return () => { cancelled = true; clearInterval(interval); };
  }, [backendReady, setupComplete, backendLost]);

  /* Fetch setup status + user name — only after backend is ready */
  useEffect(() => {
    if (!backendReady) return;
    const controller = new AbortController();
    (async () => {
      try {
        const statusRes = await fetch('/api/settings/setup-status', { signal: controller.signal });
        const statusData = await statusRes.json();
        setSetupComplete(statusData.setup_completed ?? false);

        if (statusData.setup_completed) {
          const settingsRes = await fetch('/api/settings', { signal: controller.signal });
          if (settingsRes.ok) {
            const settingsData = await settingsRes.json();
            setUserName(settingsData.settings?.user_name ?? '');
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setSetupComplete(false);
      }
    })();
    return () => controller.abort();
  }, [backendReady]);

  /* Cmd/Ctrl+K keyboard shortcut to toggle Quick Capture */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        setShowQuickCapture(prev => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSetupComplete = useCallback(() => {
    setSetupComplete(true);
    setActiveTab('Dashboard');
    /* Re-fetch user name after setup */
    fetch('/api/settings').then(r => r.json()).then(d => setUserName(d.settings?.user_name ?? '')).catch(() => {});
  }, []);

  const handleNavigateToQuickCapture = useCallback((prefillDate?: string, prefillProgramId?: number, prefillProjectId?: number, prefillAsTask?: boolean, prefillAsCadence?: boolean) => {
    setQuickCapturePrefillDate(prefillDate);
    setQuickCapturePrefillProgramId(prefillProgramId);
    setQuickCapturePrefillProjectId(prefillProjectId);
    setQuickCapturePrefillAsTask(prefillAsTask ?? false);
    setQuickCapturePrefillAsCadence(prefillAsCadence ?? false);
    setShowQuickCapture(true);
  }, []);

  const handleNavigateToTab = useCallback((tab: string, targetId?: number, context?: { projectId?: number; date?: string }) => {
    setFocusId(targetId ?? null);
    setFocusProjectId(context?.projectId ?? null);
    setFocusDate(context?.date ?? null);
    setActiveTab(tab);
  }, []);

  // Clear focus state when navigating away from Timeline (deep-link fix)
  useEffect(() => {
    if (activeTab !== 'Timeline') {
      setFocusId(null);
      setFocusProjectId(null);
      setFocusDate(null);
    }
  }, [activeTab]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  // v3.0: Recovery mode — show recovery screen if DB init failed
  if (recoveryMode) {
    return (
      <RecoveryScreen
        error={recoveryError}
        onRetry={() => window.location.reload()}
        onStartFresh={() => window.location.reload()}
        onRestore={() => window.location.reload()}
      />
    );
  }

  if (setupComplete === null) {
    return (
      <>
        <style>{`
          @keyframes chronicle-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
          .chronicle-skeleton {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            gap: 20px;
          }
          .chronicle-skeleton-logo {
            display: flex;
            align-items: center;
            gap: 10px;
            animation: chronicle-pulse 2s ease-in-out infinite;
          }
          .chronicle-skeleton-mark {
            width: 40px;
            height: 40px;
            border-radius: 8px;
            background: var(--accent-primary, #6366f1);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            font-weight: 800;
            color: var(--text-on-primary, #fff);
          }
          .chronicle-skeleton-wordmark {
            font-size: 28px;
            font-weight: 800;
            letter-spacing: 3px;
            color: var(--text-primary);
          }
          .chronicle-skeleton-status {
            color: var(--text-muted);
            font-size: 13px;
            margin: 0;
            transition: opacity 0.3s ease;
          }
        `}</style>
        <div className="chronicle-skeleton">
          <div className="chronicle-skeleton-logo">
            <div className="chronicle-skeleton-mark">C</div>
            <span className="chronicle-skeleton-wordmark">CHRONICLE</span>
          </div>
          <p className="chronicle-skeleton-status">
            {backendReady ? 'Loading your data\u2026' : 'Starting up\u2026'}
          </p>
        </div>
      </>
    );
  }

  function renderView() {
    switch (activeTab) {
      case 'Dashboard':
        return <DashboardView onNavigateToQuickCapture={handleNavigateToQuickCapture} onNavigateToTab={handleNavigateToTab} />;
      case 'Portfolio':
        return <PortfolioView onNavigateToQuickCapture={handleNavigateToQuickCapture} onNavigateToTab={handleNavigateToTab} />;
      case 'Timeline':
        return <TimelineView focusEntryId={focusId} focusProjectId={focusProjectId} focusDate={focusDate} onFocusConsumed={() => { setFocusId(null); setFocusProjectId(null); setFocusDate(null); }} onNavigateToTab={handleNavigateToTab} />;
      case 'Distribution':
        return <DistributionView />;
      case 'Reports':
        return <ReportsView />;
      case 'Settings':
        return <SettingsView />;
      case 'Guide':
        return <GuideView />;
      default:
        return null;
    }
  }

  /* Page title for header */
  const allNav = [...primaryNav, ...utilityNav];
  const pageTitle = allNav.find(n => n.key === activeTab)?.label ?? activeTab;

  if (!setupComplete) {
    return (
      <WelcomeScreen
        onStartFresh={handleSetupComplete}
        onRestoreComplete={handleSetupComplete}
      />
    );
  }

  return (
    <>
      {/* Custom title bar — replaces native decorations */}
      <div className="custom-titlebar" data-tauri-drag-region>
        <span className="titlebar-title" data-tauri-drag-region>CHRONICLE</span>
        <div className="titlebar-controls">
          <button className="titlebar-btn" onClick={async () => { const { appWindow } = await import('@tauri-apps/api/window'); appWindow.minimize(); }} aria-label="Minimize">─</button>
          <button className="titlebar-btn" onClick={async () => { const { appWindow } = await import('@tauri-apps/api/window'); appWindow.toggleMaximize(); }} aria-label="Maximize">□</button>
          <button className="titlebar-btn titlebar-close" onClick={async () => { const { appWindow } = await import('@tauri-apps/api/window'); appWindow.close(); }} aria-label="Close">✕</button>
        </div>
      </div>
      <div className="app-layout">
      {/* Backend crash recovery overlay */}
      {backendLost && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px',
          background: 'var(--modal-overlay)',
          backdropFilter: 'blur(var(--modal-blur))',
          WebkitBackdropFilter: 'blur(var(--modal-blur))',
        }} role="alert" aria-live="assertive">
          <div style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '2px', color: 'var(--text-primary)' }}>CHRONICLE</div>
          <p style={{ color: 'var(--accent-warning)', fontSize: '14px', fontWeight: 600, margin: 0 }}>Connection lost</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>Reconnecting to backend…</p>
        </div>
      )}
      <nav className="sidebar" role="navigation" aria-label="Main navigation">
        <button className="sidebar-brand" onClick={() => setActiveTab('Dashboard')} style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left' }} aria-label="Go to Dashboard view">
          <span className="sidebar-logo">C</span>
          <span className="sidebar-title">CHRONICLE</span>
        </button>
        <div className="sidebar-nav">
          <div className="sidebar-group-label">Navigate</div>
          {primaryNav.map((item) => (
            <button
              key={item.key}
              className={`sidebar-btn${activeTab === item.key ? ' active' : ''}`}
              onClick={() => { setActiveTab(item.key); setFocusId(null); }}
              aria-current={activeTab === item.key ? 'page' : undefined}
              title={item.label}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">{item.label}</span>
            </button>
          ))}
          <div className="sidebar-group-label">Utility</div>
          {utilityNav.map((item) => (
            <button
              key={item.key}
              className={`sidebar-btn${activeTab === item.key ? ' active' : ''}`}
              onClick={() => { setActiveTab(item.key); setFocusId(null); }}
              aria-current={activeTab === item.key ? 'page' : undefined}
              title={item.label}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">{item.label}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button
            className="sidebar-btn sidebar-quick-capture-btn"
            onClick={() => setShowQuickCapture(true)}
            aria-label="Capture Entry"
            title="Capture Entry"
          >
            <span className="sidebar-icon">＋</span>
            <span className="sidebar-label">Capture Entry</span>
          </button>
          <button
            className="sidebar-btn"
            onClick={() => setShowAbout(true)}
            title="About Chronicle"
            aria-label="About Chronicle"
          >
            <span className="sidebar-icon">ⓘ</span>
            <span className="sidebar-label">About</span>
          </button>
          <button
            className="sidebar-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <span className="sidebar-icon">{theme === 'dark' ? '☀' : '☾'}</span>
            <span className="sidebar-label">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </div>
      </nav>

      <main className="main-content" role="main" aria-label="Page content">
        <div className="main-header">
          <div>
            <h1 className="main-header-title">
              {activeTab === 'Dashboard' && userName ? `Welcome, ${userName}` : pageTitle}
            </h1>
            {activeTab === 'Dashboard' && (
              <p className="main-header-subtitle">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            )}
          </div>
        </div>
        <div className="main-body" key={`${activeTab}-${refreshKey}`}>
          {renderView()}
        </div>
      </main>

      {/* Quick Capture floating modal */}
      {showQuickCapture && (
        <CaptureSheet
          prefillDate={quickCapturePrefillDate}
          onClose={() => { setShowQuickCapture(false); setQuickCapturePrefillDate(undefined); setQuickCapturePrefillProgramId(undefined); setQuickCapturePrefillProjectId(undefined); setQuickCapturePrefillAsTask(false); setQuickCapturePrefillAsCadence(false); }}
          prefillProgramId={quickCapturePrefillProgramId}
          prefillProjectId={quickCapturePrefillProjectId}
          prefillAsTask={quickCapturePrefillAsTask}
          prefillAsCadence={quickCapturePrefillAsCadence}
          onSaved={() => setRefreshKey(k => k + 1)}
        />
      )}

      {/* About modal */}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
    </>
  );
}

export default App;
