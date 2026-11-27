import { useSyncExternalStore } from "react";
import { useAccountSecurity } from "../auth/accountSecurity";
import type { SnapshotOperations, SnapshotViewState } from "./snapshots";

/**
 * DR-3, rendered side (M06-T03 Increment 3e): the ONLY way components read
 * saved-copy content. They render from the authorized view store, which is
 * published synchronously inside the shared security lock after the final
 * checks and cleared synchronously on any block, notice, sign-out, or loss of
 * eligibility. Components never keep snapshot content in their own state and
 * never render an operation's return value.
 */
export function useSnapshotView(): { view: SnapshotViewState; ops: SnapshotOperations } {
  const { snapshots } = useAccountSecurity();
  const view = useSyncExternalStore(
    snapshots.view.subscribe,
    snapshots.view.getSnapshot,
    snapshots.view.getSnapshot,
  );
  return { view, ops: snapshots };
}
