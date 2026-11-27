import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AccountSecurityContext,
  createInertSnapshots,
  EXPLANATIONS,
  SITE_DATA_MESSAGE,
  type AccountSecurityContextValue,
  type DeleteAllOutcome,
} from "../auth/accountSecurity";
import type { DeletionProgress } from "../offline/cleanup";
import { OfflineDataPage } from "./OfflineDataPage";

/**
 * M06-T03 Increment 3c-2 — the "Offline data on this device" page with a
 * STUBBED account context: interface logic only (status, explanations, the
 * consent flows, progress, and truthful results). The operations themselves
 * are verified in accountSecurity.test.ts and in the real browser.
 */

function stubAccount(
  overrides: Partial<AccountSecurityContextValue> = {},
): AccountSecurityContextValue {
  return {
    restriction: null,
    offline: "none",
    lastSignOut: null,
    signOutRefusal: null,
    signIn: vi.fn(),
    finishSigningOut: vi.fn(() =>
      Promise.resolve({ server: "confirmed", intent: "resolved", cleanup: "not-run" } as const),
    ),
    storage: "clean",
    retryCleanup: vi.fn(() => Promise.resolve({ kind: "cleaned" } as const)),
    recoverStorage: vi.fn(() => Promise.resolve({ kind: "recovered" } as const)),
    deleteAllData: vi.fn(() =>
      Promise.resolve({ kind: "deleted", failureRecord: "none" } as const),
    ),
    snapshots: createInertSnapshots(),
    ...overrides,
  };
}

function renderPage(account: AccountSecurityContextValue) {
  render(
    <AccountSecurityContext.Provider value={account}>
      <OfflineDataPage />
    </AccountSecurityContext.Provider>,
  );
  return account;
}

const statusRegion = () => screen.getAllByRole("status").at(-1)!;

describe("OfflineDataPage — status and explanations (AC-41)", () => {
  it("names the page and reports eligibility and storage status separately", () => {
    renderPage(stubAccount({ offline: "locked", storage: "failure-recorded" }));
    expect(screen.getByRole("heading", { name: "Offline data on this device" })).toBeVisible();
    expect(screen.getByText("Offline copies on this device are locked.")).toBeVisible();
    expect(screen.getByText(/An earlier attempt to remove offline copies failed/)).toBeVisible();
  });

  it.each([
    ["safety-lock", true],
    ["safety-lock-unreadable", true],
    ["state-unreadable", true],
    ["coordination-unavailable", false],
    ["sign-out-pending", false],
  ] as const)(
    "explains %s: what is unavailable, why, and what you can do",
    (restriction, siteData) => {
      renderPage(stubAccount({ restriction }));
      const explanation = EXPLANATIONS[restriction];
      expect(screen.getByText(explanation.unavailable)).toBeVisible();
      expect(screen.getByText(explanation.reason)).toBeVisible();
      for (const action of explanation.actions) expect(screen.getByText(action)).toBeVisible();
      expect(screen.queryByText(SITE_DATA_MESSAGE) !== null).toBe(siteData);
    },
  );

  it("explains unreadable offline data even without an authentication restriction", () => {
    renderPage(stubAccount({ storage: "unreadable" }));
    expect(screen.getByText(EXPLANATIONS["storage-unreadable"].reason)).toBeVisible();
  });

  it("the site-data text states all OFF-REC-3 points and never claims recovery or sign-out", () => {
    expect(SITE_DATA_MESSAGE).toMatch(/destructive/);
    expect(SITE_DATA_MESSAGE).toMatch(/every saved offline copy in this browser for every account/);
    expect(SITE_DATA_MESSAGE).toMatch(/does not sign you out on the server or confirm a sign-out/);
    expect(SITE_DATA_MESSAGE).toMatch(/not a verified recovery/);
    expect(SITE_DATA_MESSAGE).toMatch(/saved on the server are not affected/);
  });

  it("without coordination, offers no recovery action at all", () => {
    renderPage(stubAccount({ restriction: "coordination-unavailable", storage: "unknown" }));
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("OfflineDataPage — actions and consent", () => {
  it("Retry cleanup is offered only when cleanup is required and needs no consent", async () => {
    const user = userEvent.setup();
    const account = renderPage(stubAccount({ storage: "cleanup-required" }));
    await user.click(screen.getByRole("button", { name: "Retry cleanup" }));
    expect(account.retryCleanup).toHaveBeenCalledTimes(1);
    expect(statusRegion()).toHaveTextContent(
      "Offline copies from the earlier sign-in were removed.",
    );
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("Recover: consent is asked only when discard is required; Cancel removes nothing", async () => {
    const user = userEvent.setup();
    const recoverStorage = vi.fn(() =>
      Promise.resolve({ kind: "authorization-required" } as const),
    );
    renderPage(stubAccount({ storage: "failure-recorded", recoverStorage }));
    const recover = screen.getByRole("button", { name: "Recover offline storage" });
    await user.click(recover);
    const consent = await screen.findByRole("group", {
      name: "Remove saved offline copies to recover?",
    });
    expect(consent).toHaveFocus();
    expect(consent).toHaveTextContent(/You'll need to save them again/);
    expect(consent).toHaveTextContent(/saved on the server aren't affected/);
    await user.click(within(consent).getByRole("button", { name: "Cancel" }));
    expect(recoverStorage.mock.calls).toEqual([[false]]); // never authorized
    expect(statusRegion()).toHaveTextContent("Nothing was removed. Offline copies stay locked.");
    expect(recover).toHaveFocus();
  });

  it("Recover: only an explicit Remove and recover authorizes the discard", async () => {
    const user = userEvent.setup();
    const recoverStorage = vi
      .fn<AccountSecurityContextValue["recoverStorage"]>()
      .mockResolvedValueOnce({ kind: "authorization-required" })
      .mockResolvedValueOnce({ kind: "recovered" });
    renderPage(stubAccount({ storage: "failure-recorded", recoverStorage }));
    await user.click(screen.getByRole("button", { name: "Recover offline storage" }));
    await user.click(await screen.findByRole("button", { name: "Remove and recover" }));
    expect(recoverStorage.mock.calls).toEqual([[false], [true]]);
    expect(statusRegion()).toHaveTextContent("Offline storage was recovered.");
  });

  it("Delete all always asks first; Cancel deletes nothing", async () => {
    const user = userEvent.setup();
    const account = renderPage(stubAccount());
    const trigger = screen.getByRole("button", { name: "Delete all offline data on this device" });
    await user.click(trigger);
    const consent = screen.getByRole("group", { name: "Delete all offline data on this device?" });
    expect(consent).toHaveFocus();
    expect(consent).toHaveTextContent(/every saved offline copy on this device for every account/);
    expect(consent).toHaveTextContent(/doesn't delete landmarks, favorites, trips, or reviews/);
    await user.click(within(consent).getByRole("button", { name: "Cancel" }));
    expect(account.deleteAllData).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("a blocked deletion is shown as waiting, never as complete, until it finishes (AC-4)", async () => {
    const user = userEvent.setup();
    let report!: (progress: DeletionProgress) => void;
    let finish!: (outcome: DeleteAllOutcome) => void;
    const deleteAllData = vi.fn(
      (onProgress?: (progress: DeletionProgress) => void) =>
        new Promise<DeleteAllOutcome>((resolve) => {
          report = onProgress!;
          finish = resolve;
        }),
    );
    renderPage(stubAccount({ deleteAllData }));
    await user.click(
      screen.getByRole("button", { name: "Delete all offline data on this device" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete offline data" }));
    act(() => report("pending"));
    expect(statusRegion()).toHaveTextContent("Deleting offline data…");
    act(() => report("blocked"));
    expect(statusRegion()).toHaveTextContent(/Close the app's other tabs/);
    expect(screen.queryByText(/was deleted/)).toBeNull();
    await act(async () => finish({ kind: "deleted", failureRecord: "recovered" }));
    await waitFor(() =>
      expect(statusRegion()).toHaveTextContent(
        "All offline data on this device was deleted, and offline storage was recovered.",
      ),
    );
  });

  it.each([
    [
      { kind: "deleted", failureRecord: "retained", retainedReason: "intent-pending" } as const,
      /still locked\. Offline storage can't be recovered until the sign-out is finished/,
    ],
    [
      {
        kind: "deleted",
        failureRecord: "retained",
        retainedReason: "authorization-required",
      } as const,
      /New offline data was saved meanwhile/,
    ],
    [{ kind: "not-attempted" } as const, /Nothing was deleted/],
    [{ kind: "failed" } as const, /couldn't be deleted/],
  ])("reports a remaining restriction truthfully (%j)", async (outcome, text) => {
    const user = userEvent.setup();
    renderPage(stubAccount({ deleteAllData: vi.fn(() => Promise.resolve(outcome)) }));
    await user.click(
      screen.getByRole("button", { name: "Delete all offline data on this device" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete offline data" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("the deletion disclosure says a pending sign-out is unaffected (AC-34)", async () => {
    const user = userEvent.setup();
    renderPage(stubAccount({ restriction: "sign-out-pending" }));
    await user.click(
      screen.getByRole("button", { name: "Delete all offline data on this device" }),
    );
    expect(screen.getByRole("group")).toHaveTextContent(/Your pending sign-out isn't affected/);
  });

  it("Finish signing out is offered with the safety lock and never claims more than the server said", async () => {
    const user = userEvent.setup();
    const account = renderPage(stubAccount({ restriction: "safety-lock" }));
    await user.click(screen.getByRole("button", { name: "Finish signing out" }));
    expect(account.finishSigningOut).toHaveBeenCalledTimes(1);
    expect(statusRegion()).toHaveTextContent("The server confirmed the sign-out.");
  });

  it("works from the keyboard alone", async () => {
    const user = userEvent.setup();
    const account = renderPage(stubAccount({ storage: "cleanup-required" }));
    await user.tab();
    expect(screen.getByRole("button", { name: "Retry cleanup" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(account.retryCleanup).toHaveBeenCalledTimes(1);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("group", { name: "Delete all offline data on this device?" }),
    ).toHaveFocus();
  });
});
