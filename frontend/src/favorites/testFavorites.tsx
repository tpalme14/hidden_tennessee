import type { ReactNode } from "react";
import { vi } from "vitest";
import {
  FavoritesContext,
  type FavoriteStatus,
  type FavoritesContextValue,
} from "./favoritesContext";

/**
 * Test-only favorites context (M03-T06 Increment 4) for components that render
 * favorite controls but are not themselves under test for favorites behaviour
 * (existing discovery tests). Every landmark reports `status`; the mutations
 * are spies that send nothing.
 */
export function fakeFavorites(status: FavoriteStatus = "unsaved"): FavoritesContextValue {
  return {
    membership: { status: "complete" },
    statusOf: vi.fn(() => status),
    isPending: vi.fn(() => false),
    save: vi.fn(() => Promise.resolve({ kind: "busy" as const })),
    remove: vi.fn(() => Promise.resolve({ kind: "busy" as const })),
    retry: vi.fn(),
    refresh: vi.fn(),
  };
}

export function WithFakeFavorites({
  children,
  value = fakeFavorites(),
}: {
  children: ReactNode;
  value?: FavoritesContextValue;
}) {
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}
