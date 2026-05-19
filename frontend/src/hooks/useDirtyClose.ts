import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useDirtyClose — Shared dirty-state close guard for modals and inline panels.
 *
 * Centralizes the behavior required by Requirement 11 of the v2.5.1 patch:
 *   - Backdrop / outside click on a CLEAN surface closes it immediately.
 *   - Backdrop / outside click on a DIRTY surface shakes briefly (400ms) and
 *     leaves the surface open.
 *   - Esc / explicit close (X) on a CLEAN surface closes immediately.
 *   - Esc / explicit close (X) on a DIRTY surface opens a confirm dialog.
 *   - Confirm → Discard closes; Confirm → Cancel keeps the surface open.
 *
 * The `isDirty` predicate is called on every invocation and must be pure
 * (no network requests, no state mutations).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.8
 */

export interface UseDirtyCloseOptions {
  /** Pure predicate that returns true when the surface has unsaved changes. */
  isDirty: () => boolean;
  /** Called when the surface should actually close (clean state or Discard). */
  onClose: () => void;
  /** Optional prompt text for the confirm dialog. Defaults to "Discard changes?". */
  confirmMessage?: string;
}

export interface UseDirtyCloseResult {
  /** Wire to backdrop / panel-outside click. Shakes on dirty; closes on clean. */
  handleBackdropClick: () => void;
  /** Wire to Esc and explicit close (X) buttons. Opens confirm on dirty; closes on clean. */
  handleExplicitClose: () => void;
  /** True for 400ms after a dirty backdrop click. Apply `.modal-shake` when true. */
  shaking: boolean;
  /** True when the discard-confirm dialog should render. */
  confirmOpen: boolean;
  /** Confirm → Discard. Closes the dialog and the underlying surface. */
  confirmDiscard: () => void;
  /** Confirm → Cancel. Closes the dialog; the surface stays open. */
  confirmCancel: () => void;
  /** The resolved confirm prompt text, useful for surfaces that forward it to the dialog. */
  confirmMessage: string;
}

const SHAKE_DURATION_MS = 400;
const DEFAULT_CONFIRM_MESSAGE = 'Discard changes?';

export function useDirtyClose(opts: UseDirtyCloseOptions): UseDirtyCloseResult {
  const { isDirty, onClose } = opts;
  const confirmMessage = opts.confirmMessage ?? DEFAULT_CONFIRM_MESSAGE;

  const [shaking, setShaking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Keep refs to the latest predicates so handlers stay stable across renders.
  const isDirtyRef = useRef(isDirty);
  const onCloseRef = useRef(onClose);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Cancelable shake timer.
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (shakeTimerRef.current !== null) {
        clearTimeout(shakeTimerRef.current);
        shakeTimerRef.current = null;
      }
    };
  }, []);

  const handleBackdropClick = useCallback(() => {
    if (!isDirtyRef.current()) {
      onCloseRef.current();
      return;
    }
    // Dirty: trigger the shake, do NOT close.
    if (shakeTimerRef.current !== null) {
      clearTimeout(shakeTimerRef.current);
    }
    setShaking(true);
    shakeTimerRef.current = setTimeout(() => {
      setShaking(false);
      shakeTimerRef.current = null;
    }, SHAKE_DURATION_MS);
  }, []);

  const handleExplicitClose = useCallback(() => {
    if (!isDirtyRef.current()) {
      onCloseRef.current();
      return;
    }
    setConfirmOpen(true);
  }, []);

  const confirmDiscard = useCallback(() => {
    setConfirmOpen(false);
    onCloseRef.current();
  }, []);

  const confirmCancel = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  return {
    handleBackdropClick,
    handleExplicitClose,
    shaking,
    confirmOpen,
    confirmDiscard,
    confirmCancel,
    confirmMessage,
  };
}
