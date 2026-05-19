import { useState, useRef, useEffect } from 'react';
import { cardStyle } from '../styles/sharedStyles';

export interface PrepNote {
  id: number;
  text: string;
  created_at: string;
  dismissed_at: string | null;
}

export interface PrepNotesProps {
  initialNotes?: PrepNote[];
  onNotesChange?: () => void;
}

/**
 * PrepNotes — lightweight scratchpad for 1:1 topics, follow-up reminders,
 * and communication prompts. Displayed in the right column of Tier 2.
 *
 * - "+ Add note" button expands inline text input (Enter to save, Escape to cancel)
 * - "×" dismiss button on each note (PATCH /api/notes/{id}/dismiss)
 * - Notes ordered by created_at descending (newest first)
 * - Internal scroll within panel (max-height with overflow-y: auto handled by parent .dashboard-panel)
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
export default function PrepNotes({ initialNotes, onNotesChange }: PrepNotesProps) {
  const [notes, setNotes] = useState<PrepNote[]>(initialNotes ?? []);
  const [isAdding, setIsAdding] = useState(false);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyDismiss, setBusyDismiss] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  // Sync with parent-provided notes when they change
  useEffect(() => {
    if (initialNotes) {
      setNotes(initialNotes);
    }
  }, [initialNotes]);

  // Auto-focus input when adding
  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  // Auto-focus edit input
  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  const handleEditSave = async (noteId: number) => {
    const trimmed = editText.trim();
    if (!trimmed) { setEditingId(null); return; }
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.ok) {
        setNotes(prev => prev.map(n => n.id === noteId ? { ...n, text: trimmed } : n));
        onNotesChange?.();
      }
    } catch { /* ignore */ }
    setEditingId(null);
  };

  const handleAddNote = async () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;

    setError(null);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.ok) {
        const newNote: PrepNote = await res.json();
        // Insert at the beginning (newest first)
        setNotes(prev => [newNote, ...prev]);
        setInputText('');
        setIsAdding(false);
        onNotesChange?.();
      } else {
        setError('Failed to save note');
      }
    } catch {
      setError('Failed to save note');
    }
  };

  const handleDismiss = async (noteId: number) => {
    if (busyDismiss.has(noteId)) return;
    setBusyDismiss(prev => new Set(prev).add(noteId));
    setError(null);

    try {
      const res = await fetch(`/api/notes/${noteId}/dismiss`, { method: 'PATCH' });
      if (res.ok) {
        setNotes(prev => prev.filter(n => n.id !== noteId));
        onNotesChange?.();
      } else {
        setError('Failed to dismiss note');
      }
    } catch {
      setError('Failed to dismiss note');
    } finally {
      setBusyDismiss(prev => {
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddNote();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setInputText('');
      setIsAdding(false);
    }
  };

  // Sort notes by created_at descending (newest first)
  const sortedNotes = [...notes].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div style={{ ...cardStyle }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Prep Notes
        </h3>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            style={{
              padding: '3px 10px',
              borderRadius: '5px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              border: '1px solid var(--input-border)',
              background: 'transparent',
              color: 'var(--accent-primary)',
            }}
            aria-label="Add note"
          >
            + Add note
          </button>
        )}
      </div>

      {/* Inline text input for adding a note */}
      {isAdding && (
        <div style={{ marginBottom: '10px' }}>
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a note… (Enter to save, Esc to cancel)"
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            aria-label="New note text"
          />
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{ fontSize: '12px', color: 'var(--accent-danger)', marginBottom: '8px' }}>
          {error}
        </div>
      )}

      {/* Notes list */}
      {sortedNotes.length === 0 && !isAdding && (
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
          No notes yet. Use &quot;+ Add note&quot; to capture reminders.
        </p>
      )}

      {sortedNotes.length > 0 && (
        <div role="list" aria-label="Prep notes list">
          {sortedNotes.map(note => (
            <div
              key={note.id}
              role="listitem"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '8px 10px',
                background: 'var(--input-bg)',
                borderRadius: '6px',
                marginBottom: '4px',
                cursor: editingId === note.id ? 'default' : 'pointer',
              }}
              onClick={() => { if (editingId !== note.id) { setEditingId(note.id); setEditText(note.text); } }}
            >
              {editingId === note.id ? (
                <input
                  ref={editRef}
                  type="text"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); handleEditSave(note.id); }
                    else if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                  }}
                  onBlur={() => handleEditSave(note.id)}
                  style={{
                    flex: 1, padding: '4px 8px', background: 'var(--bg-primary)',
                    border: '1px solid var(--accent-primary)', borderRadius: '4px',
                    color: 'var(--text-primary)', fontSize: '13px', outline: 'none',
                  }}
                  aria-label="Edit note text"
                />
              ) : (
                <span style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                  {note.text}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleDismiss(note.id); }}
                disabled={busyDismiss.has(note.id)}
                style={{
                  flexShrink: 0,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  lineHeight: 1,
                }}
                aria-label={`Dismiss note: ${note.text}`}
                title="Dismiss note"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
