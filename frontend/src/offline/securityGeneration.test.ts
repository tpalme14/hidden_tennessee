import { describe, expect, it } from "vitest";
import { createSecurityGeneration } from "./securityGeneration";

/** M06-T03 Increment 3b-i — the tab-local security generation (DR-3 primitive only). */

describe("security generation", () => {
  it("a fresh snapshot is current", () => {
    const generation = createSecurityGeneration();
    expect(generation.isCurrent(generation.snapshot())).toBe(true);
    expect(generation.isBlocked()).toBe(false);
  });

  it("block() is synchronous: an earlier snapshot is not current immediately after it returns", () => {
    const generation = createSecurityGeneration();
    const before = generation.snapshot();
    generation.block();
    expect(generation.isBlocked()).toBe(true);
    expect(generation.isCurrent(before)).toBe(false);
  });

  it("while blocked, even a snapshot taken after the block is not current", () => {
    const generation = createSecurityGeneration();
    generation.block();
    expect(generation.isCurrent(generation.snapshot())).toBe(false);
  });

  it("an earlier generation never authorizes a result after a newer block, even once unblocked", () => {
    const generation = createSecurityGeneration();
    const before = generation.snapshot();
    const token = generation.block();
    expect(generation.unblockFor(token)).toBe(true);
    expect(generation.isBlocked()).toBe(false);
    expect(generation.isCurrent(before)).toBe(false);
    expect(generation.isCurrent(generation.snapshot())).toBe(true);
  });

  it("advance() invalidates earlier snapshots without blocking", () => {
    const generation = createSecurityGeneration();
    const before = generation.snapshot();
    generation.advance();
    expect(generation.isBlocked()).toBe(false);
    expect(generation.isCurrent(before)).toBe(false);
  });

  it("a stale operation cannot clear a newer block", () => {
    const generation = createSecurityGeneration();
    const stale = generation.block();
    generation.block();
    expect(generation.unblockFor(stale)).toBe(false);
    expect(generation.isBlocked()).toBe(true);
  });

  it("an advance after a block also invalidates that block's token", () => {
    const generation = createSecurityGeneration();
    const token = generation.block();
    generation.advance();
    expect(generation.unblockFor(token)).toBe(false);
    expect(generation.isBlocked()).toBe(true);
  });

  it("snapshots are immutable and instances are independent", () => {
    const a = createSecurityGeneration();
    const b = createSecurityGeneration();
    const snapshot = a.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    a.block();
    expect(b.isBlocked()).toBe(false);
    expect(b.isCurrent(b.snapshot())).toBe(true);
  });
});
