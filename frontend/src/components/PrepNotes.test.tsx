import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PrepNotes from './PrepNotes';

describe('PrepNotes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when no notes are provided', () => {
    render(<PrepNotes />);
    expect(screen.getByText(/No notes yet/)).toBeInTheDocument();
    expect(screen.getByText('Prep Notes')).toBeInTheDocument();
  });

  it('renders notes ordered by created_at descending (newest first)', () => {
    const notes = [
      { id: 1, text: 'Older note', created_at: '2025-01-01T10:00:00', dismissed_at: null },
      { id: 2, text: 'Newer note', created_at: '2025-01-02T10:00:00', dismissed_at: null },
    ];
    render(<PrepNotes initialNotes={notes} />);

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Newer note');
    expect(items[1]).toHaveTextContent('Older note');
  });

  it('shows "+ Add note" button that expands inline input', () => {
    render(<PrepNotes initialNotes={[]} />);
    const addBtn = screen.getByRole('button', { name: 'Add note' });
    expect(addBtn).toBeInTheDocument();

    fireEvent.click(addBtn);
    expect(screen.getByLabelText('New note text')).toBeInTheDocument();
  });

  it('collapses input on Escape without saving', () => {
    render(<PrepNotes initialNotes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    const input = screen.getByLabelText('New note text');
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByLabelText('New note text')).not.toBeInTheDocument();
  });

  it('calls POST /api/notes on Enter and adds note to list', async () => {
    const newNote = { id: 3, text: 'My new note', created_at: '2025-01-03T10:00:00', dismissed_at: null };
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(newNote),
    });

    render(<PrepNotes initialNotes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    const input = screen.getByLabelText('New note text');
    fireEvent.change(input, { target: { value: 'My new note' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('My new note')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'My new note' }),
    });
  });

  it('calls PATCH /api/notes/{id}/dismiss when × is clicked', async () => {
    const notes = [
      { id: 5, text: 'Dismiss me', created_at: '2025-01-01T10:00:00', dismissed_at: null },
    ];
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true });

    render(<PrepNotes initialNotes={notes} />);
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss note: Dismiss me' });
    fireEvent.click(dismissBtn);

    await waitFor(() => {
      expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/notes/5/dismiss', { method: 'PATCH' });
  });

  it('shows error message when note creation fails', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 400 });

    render(<PrepNotes initialNotes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    const input = screen.getByLabelText('New note text');
    fireEvent.change(input, { target: { value: 'Fail note' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Failed to save note')).toBeInTheDocument();
    });
  });

  it('does not submit empty text', () => {
    global.fetch = vi.fn();
    render(<PrepNotes initialNotes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    const input = screen.getByLabelText('New note text');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('displays dismiss button (×) on each note', () => {
    const notes = [
      { id: 1, text: 'Note A', created_at: '2025-01-01T10:00:00', dismissed_at: null },
      { id: 2, text: 'Note B', created_at: '2025-01-02T10:00:00', dismissed_at: null },
    ];
    render(<PrepNotes initialNotes={notes} />);

    expect(screen.getByRole('button', { name: 'Dismiss note: Note A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss note: Note B' })).toBeInTheDocument();
  });
});
