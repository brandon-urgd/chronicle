import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus within a container element while it is mounted.
 * - Tab from last element wraps to first
 * - Shift+Tab from first element wraps to last
 * - Escape calls onEscape callback
 * - On mount, focuses initialFocusRef (if provided) or the first focusable element
 * - On unmount, returns focus to the element that was focused before the trap activated
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  options: { onEscape?: () => void; initialFocusRef?: React.RefObject<HTMLElement | null> } = {},
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Save the element that had focus before the trap
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Set initial focus
    requestAnimationFrame(() => {
      if (options.initialFocusRef?.current) {
        options.initialFocusRef.current.focus();
      } else {
        const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        first?.focus();
      }
    });

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        options.onEscape?.();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusable = container!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // Return focus to the previously focused element
      previousFocusRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
