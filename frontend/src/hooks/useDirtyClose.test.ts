import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDirtyClose } from './useDirtyClose';

/**
 * Unit tests for the shared useDirtyClose hook.
 *
 * Covers the core state machine that every modal and inline panel
 * relies on for the Requirement 11 dirty-state close guard:
 *
 *   - Clean backdrop click            → onClose called, no shake
 *   - Dirty backdrop click            → shake flag toggles for 400ms, onClose NOT called
 *   - Clean explicit close (Esc / X)  → onClose called, no confirm dialog
 *   - Dirty explicit close (Esc / X)  → confirm dialog opens
 *   - Confirm → Discard               → onClose called, confirm closes
 *   - Confirm → Cancel                → confirm closes, onClose NOT called
 *   - Unmount with shake timer live   → no throws, timer cleared cleanly
 *
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**
 */
describe('Feature: chronicle-v2.5.1-patch, useDirtyClose hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('backdrop click — clean state', () => {
    it('calls onClose and never raises shaking', () => {
      const onClose = vi.fn();
      const isDirty = vi.fn().mockReturnValue(false);

      const { result } = renderHook(() => useDirtyClose({ isDirty, onClose }));

      expect(result.current.shaking).toBe(false);
      expect(result.current.confirmOpen).toBe(false);

      act(() => {
        result.current.handleBackdropClick();
      });

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(result.current.shaking).toBe(false);
      expect(result.current.confirmOpen).toBe(false);

      // Advancing time must not flip shaking retroactively.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(result.current.shaking).toBe(false);
    });
  });

  describe('backdrop click — dirty state', () => {
    it('flips shaking true immediately and false after 400ms; onClose NOT called', () => {
      const onClose = vi.fn();
      const isDirty = vi.fn().mockReturnValue(true);

      const { result } = renderHook(() => useDirtyClose({ isDirty, onClose }));

      act(() => {
        result.current.handleBackdropClick();
      });

      // Immediately after the click: shaking is on and onClose was not called.
      expect(result.current.shaking).toBe(true);
      expect(onClose).not.toHaveBeenCalled();

      // Just before the 400ms boundary: still shaking.
      act(() => {
        vi.advanceTimersByTime(399);
      });
      expect(result.current.shaking).toBe(true);

      // At 400ms: shake ends.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.shaking).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
      expect(result.current.confirmOpen).toBe(false);
    });

    it('re-clicking during an active shake restarts the 400ms window cleanly', () => {
      const onClose = vi.fn();
      const isDirty = vi.fn().mockReturnValue(true);

      const { result } = renderHook(() => useDirtyClose({ isDirty, onClose }));

      act(() => {
        result.current.handleBackdropClick();
      });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current.shaking).toBe(true);

      // Second click at 200ms in: should reset, not immediately clear the shake.
      act(() => {
        result.current.handleBackdropClick();
      });
      expect(result.current.shaking).toBe(true);

      // The original timer (if it had fired) would clear shaking here.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current.shaking).toBe(true);

      // 400ms after the SECOND click: shake finally clears.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current.shaking).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('explicit close — clean state', () => {
    it('calls onClose and leaves confirmOpen false', () => {
      const onClose = vi.fn();
      const isDirty = vi.fn().mockReturnValue(false);

      const { result } = renderHook(() => useDirtyClose({ isDirty, onClose }));

      act(() => {
        result.current.handleExplicitClose();
      });

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(result.current.confirmOpen).toBe(false);
      expect(result.current.shaking).toBe(false);
    });
  });

  describe('explicit close — dirty state', () => {
    it('opens the confirm dialog and does NOT call onClose', () => {
      const onClose = vi.fn();
      const isDirty = vi.fn().mockReturnValue(true);

      const { result } = renderHook(() => useDirtyClose({ isDirty, onClose }));

      act(() => {
        result.current.handleExplicitClose();
      });

      expect(result.current.confirmOpen).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
      expect(result.current.shaking).toBe(false);
    });

    it('confirmDiscard closes the surface and clears confirmOpen', () => {
      const onClose = vi.fn();
      const isDirty = vi.fn().mockReturnValue(true);

      const { result } = renderHook(() => useDirtyClose({ isDirty, onClose }));

      act(() => {
        result.current.handleExplicitClose();
      });
      expect(result.current.confirmOpen).toBe(true);

      act(() => {
        result.current.confirmDiscard();
      });

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(result.current.confirmOpen).toBe(false);
    });

    it('confirmCancel clears confirmOpen without calling onClose', () => {
      const onClose = vi.fn();
      const isDirty = vi.fn().mockReturnValue(true);

      const { result } = renderHook(() => useDirtyClose({ isDirty, onClose }));

      act(() => {
        result.current.handleExplicitClose();
      });
      expect(result.current.confirmOpen).toBe(true);

      act(() => {
        result.current.confirmCancel();
      });

      expect(result.current.confirmOpen).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('confirmMessage forwarding', () => {
    it('exposes the default "Discard changes?" prompt when none is provided', () => {
      const { result } = renderHook(() =>
        useDirtyClose({ isDirty: () => true, onClose: () => {} })
      );
      expect(result.current.confirmMessage).toBe('Discard changes?');
    });

    it('exposes a custom prompt when provided', () => {
      const { result } = renderHook(() =>
        useDirtyClose({
          isDirty: () => true,
          onClose: () => {},
          confirmMessage: 'Discard this draft?',
        })
      );
      expect(result.current.confirmMessage).toBe('Discard this draft?');
    });
  });

  describe('cleanup on unmount', () => {
    it('does not throw when unmounted while the 400ms shake timer is pending', () => {
      const onClose = vi.fn();
      const isDirty = vi.fn().mockReturnValue(true);

      const { result, unmount } = renderHook(() => useDirtyClose({ isDirty, onClose }));

      act(() => {
        result.current.handleBackdropClick();
      });
      expect(result.current.shaking).toBe(true);

      // Unmount mid-shake; must not throw and must not cause a deferred
      // setState-on-unmounted warning when the timer would have fired.
      expect(() => unmount()).not.toThrow();

      expect(() => {
        vi.advanceTimersByTime(1000);
        vi.runAllTimers();
      }).not.toThrow();

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
