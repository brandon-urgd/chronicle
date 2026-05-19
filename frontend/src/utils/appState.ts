/**
 * App state persistence utilities (R6).
 * Uses a single namespaced localStorage key: `chronicle-app-state`.
 * All reads/writes are wrapped in try/catch for graceful handling
 * of private browsing, quota exceeded, etc.
 */

const STORAGE_KEY = 'chronicle-app-state';

export interface AppPersistedState {
  activeTab: string;
  portfolioView: { expandedPrograms: number[]; expandedGoals: number[]; expandedProjects: number[]; showCompleted?: boolean };
  timelineView: { timeRange: string; typeFilter: string; programFilter: number | ''; sortOrder?: 'newest' | 'oldest' };
  reportsView: { template: string; scope: string; activePresetId: number | null };
}

const DEFAULT_STATE: AppPersistedState = {
  activeTab: 'Dashboard',
  portfolioView: { expandedPrograms: [], expandedGoals: [], expandedProjects: [] },
  timelineView: { timeRange: 'This Week', typeFilter: '', programFilter: '' },
  reportsView: { template: 'modular', scope: 'prev_week', activePresetId: null },
};

/** Read the full persisted state, returning defaults on any failure.
 * Includes one-time migration from v1.x keys:
 *  - activeTab "Today" → "Dashboard", "Work" → "Portfolio"
 *  - workView key → portfolioView
 * After migration, writes corrected state back to localStorage.
 */
export function readAppState(): AppPersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);

    // --- Migration: map legacy activeTab values ---
    let activeTab: string = parsed.activeTab ?? DEFAULT_STATE.activeTab;
    let migrated = false;
    if (activeTab === 'Today') {
      activeTab = 'Dashboard';
      migrated = true;
    } else if (activeTab === 'Work') {
      activeTab = 'Portfolio';
      migrated = true;
    }

    // --- Migration: workView → portfolioView (preserves expanded state) ---
    let portfolioView = parsed.portfolioView;
    if (!portfolioView && parsed.workView) {
      portfolioView = parsed.workView;
      migrated = true;
    }
    portfolioView = portfolioView ?? { ...DEFAULT_STATE.portfolioView };

    const state: AppPersistedState = {
      activeTab,
      portfolioView,
      timelineView: parsed.timelineView ?? { ...DEFAULT_STATE.timelineView },
      reportsView: parsed.reportsView ?? { ...DEFAULT_STATE.reportsView },
    };

    // --- One-time migration: write corrected state back to localStorage ---
    if (migrated) {
      writeAppState(state);
    }

    return state;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Write the full persisted state. Silently fails on error. */
export function writeAppState(state: AppPersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Silently fail — app continues without persistence
  }
}

/** Patch a subset of the persisted state (read-modify-write). */
export function patchAppState(patch: Partial<AppPersistedState>): void {
  try {
    const current = readAppState();
    writeAppState({ ...current, ...patch });
  } catch {
    // Silently fail
  }
}
