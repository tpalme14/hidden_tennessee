import { useCallback, useLayoutEffect, useRef } from "react";
import {
  updateSafety,
  type ProtectedCategory,
  type Protection,
  type UpdateSafety,
} from "./updateSafety";

/**
 * Registers an owner's unsaved input with the update-safety registry
 * (M06-T02 Increment 4b-ii). The owner keeps its own state; only the PRESENCE
 * of unsaved input and a fixed category are registered — never a value.
 *
 * - `active` is the owner's committed answer to "is there unsaved input?"; a
 *   layout effect reconciles the registration with it after each commit (and
 *   releases it on unmount — StrictMode's simulated unmount releases and the
 *   remount re-registers).
 * - The returned `markEdited(nextActive)` is called SYNCHRONOUSLY from the
 *   owner's existing change handler with the answer for the new value: it
 *   activates, touches (a new revision for an edit of an active draft), or
 *   releases the registration in the input event itself, before React renders.
 *
 * A rerender that does not change `active` changes nothing.
 */
export function useUnsavedInput(
  category: ProtectedCategory,
  active: boolean,
  safety: UpdateSafety = updateSafety,
): (nextActive: boolean) => void {
  const protection = useRef<Protection | null>(null);

  const markEdited = useCallback(
    (nextActive: boolean) => {
      if (nextActive) {
        if (protection.current) protection.current.touch();
        else protection.current = safety.protect(category);
      } else if (protection.current) {
        protection.current.release();
        protection.current = null;
      }
    },
    [category, safety],
  );

  useLayoutEffect(() => {
    if (active && protection.current === null) protection.current = safety.protect(category);
    if (!active && protection.current !== null) {
      protection.current.release();
      protection.current = null;
    }
  }, [active, category, safety]);

  useLayoutEffect(() => {
    const owned = protection;
    return () => {
      owned.current?.release();
      owned.current = null;
    };
  }, [category, safety]);

  return markEdited;
}
