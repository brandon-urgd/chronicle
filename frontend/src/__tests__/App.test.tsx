/// <reference types="vitest" />
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import App from '../App'

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockImplementation((url: string) => {
    if (url === '/api/settings/setup-status') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ setup_completed: true }) });
    }
    if (url === '/api/settings') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ settings: { user_name: 'Test User' } }) });
    }
    if (url === '/api/dashboard') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          entries_this_week: 0, entries_this_month: 0, entries_this_quarter: 0,
          active_projects: 0, goals_on_track: 0, goals_at_risk: 0,
          days_since_last_entry: null, weekly_highlight: null,
          recent_entries: [], gap_dates: [], operational_rhythm_count: 0,
          open_todos: [], open_todos_count: 0, program_activity: [],
          due_today: null, insights: [],
        }),
      });
    }
    if (url === '/api/scheduled-items/due') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ today: [], overdue: [], completed_today: 0, pending_today: 0, skipped_today: 0 }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('App', () => {
  it('renders CHRONICLE title in sidebar', async () => {
    render(<App />)
    await waitFor(() => { expect(screen.getByText('CHRONICLE')).toBeInTheDocument() })
  })

  it('renders all sidebar nav items', async () => {
    render(<App />)
    const labels = ['Dashboard', 'Portfolio', 'Timeline', 'Reports', 'Settings']
    await waitFor(() => { labels.forEach(l => expect(screen.getByText(l)).toBeInTheDocument()) })
  })

  it('renders Quick Capture button in sidebar', async () => {
    render(<App />)
    await waitFor(() => { expect(screen.getByText('Capture Entry')).toBeInTheDocument() })
  })

  it('shows welcome message with user name on Today view', async () => {
    render(<App />)
    await waitFor(() => { expect(screen.getByText('Welcome, Test User')).toBeInTheDocument() })
  })

  it('shows welcome screen when setup_completed is false', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/settings/setup-status') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ setup_completed: false }) });
      }
      if (url === '/api/version') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ app_version: '1.1' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    render(<App />)
    await waitFor(() => { expect(screen.getByTestId('welcome-screen')).toBeInTheDocument() })
  })

  it('opens Quick Capture modal on Ctrl+K', async () => {
    render(<App />)
    await waitFor(() => { expect(screen.getByText('CHRONICLE')).toBeInTheDocument() })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => { expect(screen.getByRole('dialog', { name: /capture entry/i })).toBeInTheDocument() })
  })

  it('closes Quick Capture modal on second Ctrl+K', async () => {
    render(<App />)
    await waitFor(() => { expect(screen.getByText('CHRONICLE')).toBeInTheDocument() })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => { expect(screen.getByRole('dialog', { name: /capture entry/i })).toBeInTheDocument() })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: /capture entry/i })).not.toBeInTheDocument() })
  })

  it('opens Quick Capture modal on Meta+K (macOS)', async () => {
    render(<App />)
    await waitFor(() => { expect(screen.getByText('CHRONICLE')).toBeInTheDocument() })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    await waitFor(() => { expect(screen.getByRole('dialog', { name: /capture entry/i })).toBeInTheDocument() })
  })

  it('does not open Quick Capture when Ctrl+K is pressed inside an INPUT', async () => {
    render(<App />)
    await waitFor(() => { expect(screen.getByText('CHRONICLE')).toBeInTheDocument() })
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'k', ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: /capture entry/i })).not.toBeInTheDocument()
    document.body.removeChild(input)
  })
})
