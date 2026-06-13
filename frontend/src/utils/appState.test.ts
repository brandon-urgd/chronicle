import { describe, it, expect, beforeEach } from 'vitest';
import { readAppState, writeAppState, patchAppState, AppPersistedState } from './appState';

const STORAGE_KEY = 'chronicle-app-state';

describe('appState — localStorage migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default state when localStorage is empty', () => {
    const state = readAppState();
    expect(state.activeTab).toBe('Dashboard');
    expect(state.portfolioView).toEqual({ expandedPrograms: [], expandedGoals: [], expandedProjects: [] });
  });

  it('maps activeTab "Today" → "Dashboard"', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeTab: 'Today' }));
    const state = readAppState();
    expect(state.activeTab).toBe('Dashboard');
  });

  it('maps activeTab "Work" → "Portfolio"', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeTab: 'Work' }));
    const state = readAppState();
    expect(state.activeTab).toBe('Portfolio');
  });

  it('preserves activeTab "Timeline" unchanged', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeTab: 'Timeline' }));
    const state = readAppState();
    expect(state.activeTab).toBe('Timeline');
  });

  it('migrates workView key to portfolioView', () => {
    const legacy = {
      activeTab: 'Work',
      workView: { expandedPrograms: [1, 2], expandedGoals: [3], expandedProjects: [4, 5] },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    const state = readAppState();
    expect(state.portfolioView).toEqual({ expandedPrograms: [1, 2], expandedGoals: [3], expandedProjects: [4, 5] });
  });

  it('prefers portfolioView over workView when both exist', () => {
    const data = {
      activeTab: 'Dashboard',
      portfolioView: { expandedPrograms: [10], expandedGoals: [], expandedProjects: [] },
      workView: { expandedPrograms: [99], expandedGoals: [], expandedProjects: [] },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    const state = readAppState();
    expect(state.portfolioView.expandedPrograms).toEqual([10]);
  });

  it('preserves expanded programs/goals/projects during upgrade', () => {
    const legacy = {
      activeTab: 'Today',
      workView: { expandedPrograms: [1, 2, 3], expandedGoals: [4, 5], expandedProjects: [6, 7, 8], showCompleted: true },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    const state = readAppState();
    expect(state.portfolioView.expandedPrograms).toEqual([1, 2, 3]);
    expect(state.portfolioView.expandedGoals).toEqual([4, 5]);
    expect(state.portfolioView.expandedProjects).toEqual([6, 7, 8]);
    expect(state.portfolioView.showCompleted).toBe(true);
  });

  it('writes corrected state back to localStorage after migration (one-time)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeTab: 'Today', workView: { expandedPrograms: [1], expandedGoals: [], expandedProjects: [] } }));
    readAppState();

    // Read raw localStorage — should now have the migrated values
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.activeTab).toBe('Dashboard');
    expect(raw.portfolioView).toEqual({ expandedPrograms: [1], expandedGoals: [], expandedProjects: [] });
    // workView key should NOT be in the written-back state
    expect(raw.workView).toBeUndefined();
  });

  it('does NOT write back to localStorage when no migration is needed', () => {
    const current: AppPersistedState = {
      activeTab: 'Dashboard',
      portfolioView: { expandedPrograms: [1], expandedGoals: [2], expandedProjects: [3] },
      timelineView: { timeRange: 'This Month', typeFilter: '', programFilter: '' },
      reportsView: { template: 'modular', scope: 'prev_week', activePresetId: null },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));

    // Spy on setItem to verify no extra write
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    readAppState();
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('returns defaults on corrupted JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{');
    const state = readAppState();
    expect(state.activeTab).toBe('Dashboard');
  });
});

describe('appState — writeAppState and patchAppState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writeAppState persists state to localStorage', () => {
    const state: AppPersistedState = {
      activeTab: 'Portfolio',
      portfolioView: { expandedPrograms: [1], expandedGoals: [], expandedProjects: [] },
      timelineView: { timeRange: 'This Week', typeFilter: '', programFilter: '' },
      reportsView: { template: 'modular', scope: 'prev_week', activePresetId: null },
    };
    writeAppState(state);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.activeTab).toBe('Portfolio');
  });

  it('patchAppState merges partial updates', () => {
    const state: AppPersistedState = {
      activeTab: 'Dashboard',
      portfolioView: { expandedPrograms: [], expandedGoals: [], expandedProjects: [] },
      timelineView: { timeRange: 'This Week', typeFilter: '', programFilter: '' },
      reportsView: { template: 'modular', scope: 'prev_week', activePresetId: null },
    };
    writeAppState(state);
    patchAppState({ activeTab: 'Timeline' });
    const result = readAppState();
    expect(result.activeTab).toBe('Timeline');
    // Other fields preserved
    expect(result.timelineView.timeRange).toBe('This Week');
  });
});
