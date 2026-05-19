import { useState, useEffect } from 'react';
import SetupWizard from './SetupWizard';
import RestoreFlow from '../components/RestoreFlow';

/* ── Props ── */
interface WelcomeScreenProps {
  onStartFresh: () => void;
  onRestoreComplete: () => void;
}

type WelcomeView = 'welcome' | 'setup' | 'restore';

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
  flex: 1, width: '100%', maxWidth: '640px',
  padding: '48px 24px',
};

const logoStyle: React.CSSProperties = {
  width: '56px', height: '56px', borderRadius: '14px',
  background: 'var(--button-primary-bg)', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '28px', fontWeight: 700, marginBottom: '16px',
  letterSpacing: '1px',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 4px', color: 'var(--text-primary)',
  letterSpacing: '2px', fontSize: '22px', fontWeight: 700,
};

const taglineStyle: React.CSSProperties = {
  margin: '0 0 40px', color: 'var(--text-secondary)',
  fontSize: '13px',
};

const cardsRowStyle: React.CSSProperties = {
  display: 'flex', gap: '20px', width: '100%',
};

const cardStyle: React.CSSProperties = {
  flex: 1, padding: '32px 24px',
  background: 'var(--card-bg)', border: '1px solid var(--card-border)',
  borderRadius: '12px', boxShadow: 'var(--shadow-soft)',
  cursor: 'pointer', textAlign: 'center',
  transition: 'border-color 0.2s, box-shadow 0.2s',
};

const cardTitleStyle: React.CSSProperties = {
  margin: '0 0 8px', color: 'var(--text-primary)',
  fontSize: '16px', fontWeight: 600,
};

const cardDescStyle: React.CSSProperties = {
  margin: 0, color: 'var(--text-muted)',
  fontSize: '13px', lineHeight: '1.5',
};

const footerStyle: React.CSSProperties = {
  padding: '16px 24px', color: 'var(--text-muted)',
  fontSize: '11px', textAlign: 'center',
};

export default function WelcomeScreen({ onStartFresh, onRestoreComplete }: WelcomeScreenProps) {
  const [view, setView] = useState<WelcomeView>('welcome');
  const [appVersion, setAppVersion] = useState<string>('');
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  /* Fetch app version on mount */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/version');
        if (res.ok) {
          const data = await res.json();
          setAppVersion(data.app_version ?? '');
        }
      } catch { /* ignore */ }
    })();
  }, []);

  /* ── Setup view: render SetupWizard ── */
  if (view === 'setup') {
    return <SetupWizard onComplete={onStartFresh} />;
  }

  /* ── Restore view: RestoreFlow component ── */
  if (view === 'restore') {
    return (
      <RestoreFlow
        mode="onboarding"
        onBack={() => setView('welcome')}
        onStartFresh={() => setView('setup')}
        onComplete={onRestoreComplete}
      />
    );
  }

  /* ── Welcome view: two cards ── */
  return (
    <div style={overlayStyle} data-testid="welcome-screen">
      <div style={containerStyle}>
        {/* Logo */}
        <div style={logoStyle} aria-hidden="true">C</div>

        {/* Title & tagline */}
        <h1 style={titleStyle}>CHRONICLE</h1>
        <p style={taglineStyle}>Professional Narrative System</p>

        {/* Cards */}
        <div style={cardsRowStyle}>
          <div
            role="button"
            tabIndex={0}
            style={{
              ...cardStyle,
              borderColor: hoveredCard === 'fresh'
                ? 'var(--button-primary-bg)' : 'var(--card-border)',
              boxShadow: hoveredCard === 'fresh'
                ? '0 0 0 1px var(--button-primary-bg)' : 'var(--shadow-soft)',
            }}
            data-testid="card-start-fresh"
            onMouseEnter={() => setHoveredCard('fresh')}
            onMouseLeave={() => setHoveredCard(null)}
            onFocus={() => setHoveredCard('fresh')}
            onBlur={() => setHoveredCard(null)}
            onClick={() => setView('setup')}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView('setup'); } }}
          >
            <p style={cardTitleStyle}>Start Fresh</p>
            <p style={cardDescStyle}>Set up your profile, programs, and scheduled items from scratch.</p>
          </div>

          <div
            role="button"
            tabIndex={0}
            style={{
              ...cardStyle,
              borderColor: hoveredCard === 'restore'
                ? 'var(--button-primary-bg)' : 'var(--card-border)',
              boxShadow: hoveredCard === 'restore'
                ? '0 0 0 1px var(--button-primary-bg)' : 'var(--shadow-soft)',
            }}
            data-testid="card-restore-backup"
            onMouseEnter={() => setHoveredCard('restore')}
            onMouseLeave={() => setHoveredCard(null)}
            onFocus={() => setHoveredCard('restore')}
            onBlur={() => setHoveredCard(null)}
            onClick={() => setView('restore')}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView('restore'); } }}
          >
            <p style={cardTitleStyle}>Restore Backup</p>
            <p style={cardDescStyle}>Import a previous Chronicle backup to pick up where you left off.</p>
          </div>
        </div>
      </div>

      {/* Footer with version */}
      <div style={footerStyle}>
        {appVersion ? `Chronicle v${appVersion}` : 'Chronicle'}
      </div>
    </div>
  );
}
