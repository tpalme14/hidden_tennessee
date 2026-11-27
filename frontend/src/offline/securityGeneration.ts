/**
 * Tab-local security generation (M06-T03 Increment 3b-i; decision DR-3;
 * Specification 6 v1.1 OFF-LIFE-6, §12.6a).
 *
 * An operation takes a `snapshot()` before its asynchronous work and checks
 * `isCurrent(snapshot)` immediately before publishing a result (from 3b-iv,
 * inside the shared-lock callback, together with the synchronous view-store
 * publication). `block()` is synchronous: once it returns, no earlier snapshot
 * is current, and none becomes current again.
 *
 * Unblocking requires the token returned by the latest `block()`/`advance()`,
 * so a stale operation cannot clear a newer block.
 *
 * Scope: in-memory, THIS tab only. It is not durable authorization, makes no
 * cross-tab claim, and has no user interface. Nothing uses it in 3b-i.
 */

export interface GenerationSnapshot {
  readonly generation: number;
}

export interface SecurityGeneration {
  /** Synchronously blocks publication and advances the generation; returns the new generation. */
  block(): number;
  /** Advances the generation (invalidates earlier snapshots) without blocking. */
  advance(): number;
  snapshot(): GenerationSnapshot;
  isBlocked(): boolean;
  /** True only when not blocked and no block or advance happened since `snapshot`. */
  isCurrent(snapshot: GenerationSnapshot): boolean;
  /** Clears the block only if `generation` is still the current generation. */
  unblockFor(generation: number): boolean;
}

export function createSecurityGeneration(): SecurityGeneration {
  let generation = 0;
  let blocked = false;

  return {
    block() {
      blocked = true;
      generation += 1;
      return generation;
    },
    advance() {
      generation += 1;
      return generation;
    },
    snapshot() {
      return Object.freeze({ generation });
    },
    isBlocked: () => blocked,
    isCurrent(snapshot) {
      return !blocked && snapshot.generation === generation;
    },
    unblockFor(token) {
      if (token !== generation) return false;
      blocked = false;
      return true;
    },
  };
}
