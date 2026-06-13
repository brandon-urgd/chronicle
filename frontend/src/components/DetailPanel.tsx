import { useRef, useEffect, useCallback, type ReactNode } from 'react';

/* ── Types ── */
interface DetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}

/**
 * DetailPanel — Slide-in panel from the right edge.
 *
 * Layout model: This component renders inline within a flex parent.
 * When open, it occupies 420px (push layout — the sibling list compresses).
 * Below 768px viewport, it occupies full width.
 *
 * Close triggers: ESC key, click on backdrop (mobile), or X button.
 *
 * Requirements: 17.6, 17.7, 17.8, 17.18
 */
export default function DetailPanel({ isOpen, onClose, title, children, actions }: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /* ── ESC key handler ── */
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  /* ── Focus close button when panel opens ── */
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => closeRef.current?.focus());
    }
  }, [isOpen]);

  /* ── Click-outside handler ── */
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <>
      {/* Mobile backdrop (only visible below 768px when open) */}
      {isOpen && (
        <div
          className="detail-panel-backdrop"
          onClick={handleBackdropClick}
          aria-hidden="true"
        />
      )}

      {/* Panel container — always in DOM for CSS transition */}
      <div
        ref={panelRef}
        className={`detail-panel ${isOpen ? 'detail-panel--open' : ''}`}
        role="complementary"
        aria-label={title}
        aria-hidden={!isOpen}
      >
        {/* Header */}
        <div className="detail-panel__header">
          <h2 className="detail-panel__title">{title}</h2>
          <button
            ref={closeRef}
            className="detail-panel__close"
            onClick={onClose}
            aria-label="Close panel"
            tabIndex={isOpen ? 0 : -1}
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="detail-panel__body">
          {children}
        </div>

        {/* Optional action bar */}
        {actions && (
          <div className="detail-panel__actions">
            {actions}
          </div>
        )}
      </div>
    </>
  );
}
