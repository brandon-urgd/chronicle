import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * DiscardConfirmDialog — Shared confirm dialog for the dirty-state close guard.
 *
 * Rendered on top of modals (z-index 1100, parent modals are at 1000) when the
 * user attempts to close a dirty surface via Esc or the explicit close (X).
 *
 * Behaviors:
 *   - Returns null when `open` is false (no DOM footprint when idle).
 *   - Focus-trapped via `useFocusTrap`; Esc → Cancel, Enter → Discard.
 *   - Two buttons: "Discard" (danger styling) and "Cancel" (secondary).
 *   - A visually distinct semi-opaque backdrop to separate it from parent modals.
 *
 * Requirements: 11.5, 11.7
 */

export interface DiscardConfirmDialogProps {
  /** When false the dialog renders nothing. */
  open: boolean;
  /** Prompt text. Defaults to "Discard changes?". */
  message?: string;
  /** Called when the user confirms discarding their changes. */
  onDiscard: () => void;
  /** Called when the user cancels (Esc, Cancel button, or outside click on the inner card). */
  onCancel: () => void;
}

const DEFAULT_MESSAGE = 'Discard changes?';

/**
 * Inner body — only mounts while the dialog is open. This ensures
 * `useFocusTrap` (which has `[]` deps) installs its listeners each time the
 * dialog opens and tears them down when it closes.
 */
function DiscardConfirmDialogBody({
  message,
  onDiscard,
  onCancel,
}: {
  message: string;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const discardButtonRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(containerRef, {
    onEscape: onCancel,
    initialFocusRef: discardButtonRef,
  });

  // Enter → Discard. Global listener is cheap since this only mounts while open.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        if (containerRef.current && containerRef.current.contains(document.activeElement)) {
          e.preventDefault();
          onDiscard();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDiscard]);

  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1100,
    background: 'rgba(0, 0, 0, 0.35)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '380px',
    width: '90%',
    boxShadow: 'var(--elevation-overlay)',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  };

  const messageStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--text-primary)',
    textAlign: 'center',
  };

  const buttonRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  };

  const cancelButtonStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    background: 'var(--button-secondary-bg)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--card-border)',
  };

  const discardButtonStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    background: 'var(--button-danger-bg)',
    color: '#fff',
    border: 'none',
  };

  return (
    <div
      style={backdropStyle}
      onClick={onCancel}
      role="presentation"
      data-testid="discard-confirm-backdrop"
    >
      <div
        ref={containerRef}
        style={cardStyle}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={message}
      >
        <p style={messageStyle}>{message}</p>
        <div style={buttonRowStyle}>
          <button
            type="button"
            onClick={onCancel}
            style={cancelButtonStyle}
            aria-label="Cancel"
          >
            Cancel
          </button>
          <button
            ref={discardButtonRef}
            type="button"
            onClick={onDiscard}
            style={discardButtonStyle}
            aria-label="Discard changes"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DiscardConfirmDialog({
  open,
  message,
  onDiscard,
  onCancel,
}: DiscardConfirmDialogProps) {
  if (!open) return null;
  return (
    <DiscardConfirmDialogBody
      message={message ?? DEFAULT_MESSAGE}
      onDiscard={onDiscard}
      onCancel={onCancel}
    />
  );
}
