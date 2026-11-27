import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { controllerHarness, FakeWorker, skipWaitingSent } from "./serviceWorker.fakes";
import {
  CATEGORY_LABELS,
  REFUSED_TEXT,
  STALE_TEXT,
  UPDATE_MESSAGES,
  UpdateNotice,
} from "./UpdateNotice";

/**
 * M06-T02 Increment 4b-iii — the update controls with the REAL lifecycle
 * controller and REAL update-safety store (browser primitives faked). The
 * notice's own checks are explanations; the controller's synchronous checks
 * are what make the actions safe, and these tests exercise both together.
 */

function renderNotice(waiting: FakeWorker | null = new FakeWorker("w")) {
  const t = controllerHarness({ waiting });
  render(
    <>
      <UpdateNotice controller={t.sw} safety={t.safety} />
      <main id="main-content" tabIndex={-1}>
        content
      </main>
    </>,
  );
  return t;
}

const liveRegions = () => document.querySelectorAll("[aria-live], [role=status], [role=alert]");
const confirmation = () => document.querySelector("[data-update-confirmation]");

describe("Update now", () => {
  it("with nothing pending or protected: dispatches once and reports the update starting", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(skipWaitingSent(w)).toBe(1);
    expect(t.safety.getSnapshot().gateHeld).toBe(true);
    expect(liveRegions()).toHaveLength(1);
    expect(liveRegions()[0]).toHaveTextContent(UPDATE_MESSAGES.activating!);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("works by keyboard", async () => {
    const w = new FakeWorker("w");
    renderNotice(w);
    screen.getByRole("button", { name: "Update now" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(skipWaitingSent(w)).toBe(1);
  });

  it("while a change is being sent: explained, refused, and NOT activated when it finishes", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    let end = () => {};
    act(() => {
      end = t.safety.beginMutationRequest()!;
    });
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(liveRegions()).toHaveLength(1);
    expect(liveRegions()[0]).toHaveTextContent(REFUSED_TEXT.update);
    expect(screen.getByRole("button", { name: "Update now" })).toHaveFocus();
    expect(skipWaitingSent(w)).toBe(0);
    act(() => end());
    expect(skipWaitingSent(w)).toBe(0);
    expect(t.sw.getState().update).toBe("waiting");
  });

  it("while an operation hold is active: refused", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    let release = () => {};
    act(() => {
      const hold = t.safety.acquireHold()!;
      release = () => hold.release();
    });
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(liveRegions()[0]).toHaveTextContent(REFUSED_TEXT.update);
    act(() => release());
    expect(skipWaitingSent(w)).toBe(0);
  });
});

describe("protected-information confirmation", () => {
  it("lists categories only (never values), distinguishes server data, and moves focus to it", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    act(() => {
      t.safety.protect("review-draft");
      t.safety.protect("share-link");
    });
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(skipWaitingSent(w)).toBe(0);
    const box = confirmation()!;
    expect(box).toHaveTextContent("Information held only on this page will be lost:");
    expect(box).toHaveTextContent(CATEGORY_LABELS["review-draft"]);
    expect(box).toHaveTextContent(CATEGORY_LABELS["share-link"]);
    expect(box).toHaveTextContent("Anything already saved on the server is not affected.");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(box.querySelector("p")).toHaveFocus();
    expect(box).not.toHaveAttribute("aria-live");
    expect(liveRegions()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Update now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Keep working" })).toBeInTheDocument();
  });

  it("Keep working closes it, sends nothing, and returns focus to Update now", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    act(() => void t.safety.protect("trip-name"));
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep working" }));
    expect(confirmation()).toBeNull();
    expect(screen.getByRole("button", { name: "Update now" })).toHaveFocus();
    expect(skipWaitingSent(w)).toBe(0);
  });

  it("Update anyway dispatches with the confirmed worker and revision", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    act(() => void t.safety.protect("trip-name"));
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    await userEvent.click(screen.getByRole("button", { name: "Update anyway" }));
    expect(skipWaitingSent(w)).toBe(1);
    expect(t.sw.getState().update).toBe("activating");
  });

  it("an edit while confirming (same category) makes it stale: refreshed, refocused, confirmed again", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    let touch = () => {};
    act(() => {
      const p = t.safety.protect("review-edit");
      touch = () => p.touch();
    });
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(confirmation()).not.toHaveTextContent(STALE_TEXT);
    screen.getByRole("button", { name: "Keep working" }).focus();
    act(() => touch());
    expect(confirmation()).toHaveTextContent(STALE_TEXT);
    expect(confirmation()!.querySelector("p")).toHaveFocus();
    expect(skipWaitingSent(w)).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Update anyway" }));
    expect(skipWaitingSent(w)).toBe(1);
  });

  it("a newly protected category while confirming is added to the refreshed list", async () => {
    const t = renderNotice();
    act(() => void t.safety.protect("sign-in"));
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    act(() => void t.safety.protect("registration"));
    expect(confirmation()).toHaveTextContent(CATEGORY_LABELS.registration);
    expect(confirmation()).toHaveTextContent(STALE_TEXT);
  });

  it("nothing left to lose while confirming: it closes (nothing sent) and focus returns to Update now", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    let release = () => {};
    act(() => {
      const p = t.safety.protect("new-password");
      release = () => p.release();
    });
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    act(() => release());
    expect(confirmation()).toBeNull();
    expect(screen.getByRole("button", { name: "Update now" })).toHaveFocus();
    expect(skipWaitingSent(w)).toBe(0);
  });

  it("a replaced waiting worker invalidates the confirmation", async () => {
    const w1 = new FakeWorker("w1");
    const t = renderNotice(w1);
    act(() => void t.safety.protect("trip-name"));
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    const w2 = new FakeWorker("w2");
    act(() => {
      t.registration.waiting = w2;
      w1.become("redundant");
    });
    expect(confirmation()).toBeNull();
    expect(skipWaitingSent(w1) + skipWaitingSent(w2)).toBe(0);
  });

  it("a request started while confirming: Update anyway is refused by the controller", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    act(() => void t.safety.protect("trip-name"));
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    let end = () => {};
    act(() => {
      end = t.safety.beginMutationRequest()!;
    });
    await userEvent.click(screen.getByRole("button", { name: "Update anyway" }));
    expect(skipWaitingSent(w)).toBe(0);
    expect(liveRegions()[0]).toHaveTextContent(REFUSED_TEXT.update);
    expect(screen.getByRole("button", { name: "Update now" })).toHaveFocus();
    act(() => end());
    expect(skipWaitingSent(w)).toBe(0);
  });
});

describe("Reload after an observed activation", () => {
  function activatedElsewhere() {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    act(() => w.become("activated"));
    expect(liveRegions()[0]).toHaveTextContent(UPDATE_MESSAGES["activated-elsewhere"]!);
    return t;
  }

  it("reloads only when chosen", async () => {
    const t = activatedElsewhere();
    expect(t.reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it("is refused while changes are being saved, and never reloads when they finish", async () => {
    const t = activatedElsewhere();
    let end = () => {};
    act(() => {
      end = t.safety.beginMutationRequest()!;
    });
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(liveRegions()[0]).toHaveTextContent(REFUSED_TEXT.reload);
    act(() => end());
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("asks first when information would be lost, with action-specific wording", async () => {
    const t = activatedElsewhere();
    act(() => void t.safety.protect("unfinished-trip-add"));
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(confirmation()).toHaveTextContent("Reloading this page loses information");
    expect(confirmation()).toHaveTextContent(CATEGORY_LABELS["unfinished-trip-add"]);
    expect(t.reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reload anyway" }));
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it("Keep working returns focus to Reload", async () => {
    const t = activatedElsewhere();
    act(() => void t.safety.protect("trip-rename"));
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep working" }));
    expect(screen.getByRole("button", { name: "Reload" })).toHaveFocus();
    expect(t.reload).not.toHaveBeenCalled();
  });
});

describe("Later", () => {
  it("postpones this worker only, sends nothing, and moves focus to the main content", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(t.sw.getState().update).toBe("postponed");
    expect(screen.getByRole("main")).toHaveFocus();
    expect(skipWaitingSent(w)).toBe(0);
    act(() => {
      t.options.onNeedRefresh?.();
    });
    expect(screen.queryByRole("button", { name: "Update now" })).toBeNull();
  });
});

describe("Q3 (Increment 5) — the refusal explanation describes the refused control", () => {
  const allIdsUnique = () => {
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    return new Set(ids).size === ids.length;
  };

  it("Update now: described by the visible refusal inside the one live region; cleared when the work ends; nothing activates", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    const updateNow = () => screen.getByRole("button", { name: "Update now" });
    expect(updateNow()).not.toHaveAttribute("aria-describedby");
    let end = () => {};
    act(() => {
      end = t.safety.beginMutationRequest()!;
    });
    await userEvent.click(updateNow());

    const describedBy = updateNow().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const explanation = document.getElementById(describedBy!)!;
    expect(explanation).toHaveTextContent(REFUSED_TEXT.update);
    expect(explanation).toBeVisible();
    expect(liveRegions()).toHaveLength(1);
    expect(liveRegions()[0]).toContainElement(explanation); // no second region or copy
    expect(screen.getAllByText(REFUSED_TEXT.update)).toHaveLength(1);
    expect(updateNow()).toHaveAccessibleDescription(REFUSED_TEXT.update);
    expect(updateNow()).toHaveAccessibleName("Update now");
    expect(updateNow()).toHaveFocus();
    expect(allIdsUnique()).toBe(true);

    act(() => end()); // the work finishes
    expect(updateNow()).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(REFUSED_TEXT.update)).toBeNull();
    expect(document.getElementById(describedBy!)).toBeNull();
    expect(liveRegions()[0]).toHaveTextContent(UPDATE_MESSAGES.waiting!);
    expect(skipWaitingSent(w)).toBe(0); // never activated by itself
    expect(t.sw.getState().update).toBe("waiting");

    await userEvent.click(updateNow()); // explicit acceptance still required
    expect(skipWaitingSent(w)).toBe(1);
  });

  it("an operation hold is described the same way", async () => {
    const t = renderNotice();
    let release = () => {};
    act(() => {
      const hold = t.safety.acquireHold()!;
      release = () => hold.release();
    });
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(screen.getByRole("button", { name: "Update now" })).toHaveAccessibleDescription(
      REFUSED_TEXT.update,
    );
    act(() => release());
    expect(screen.getByRole("button", { name: "Update now" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("Reload: described by its own refusal; cleared when the work ends; no reload by itself", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    act(() => w.become("activated"));
    let end = () => {};
    act(() => {
      end = t.safety.beginMutationRequest()!;
    });
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    const reload = screen.getByRole("button", { name: "Reload" });
    expect(reload).toHaveAccessibleDescription(REFUSED_TEXT.reload);
    expect(reload).toHaveFocus();
    expect(liveRegions()).toHaveLength(1);
    act(() => end());
    expect(screen.getByRole("button", { name: "Reload" })).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(REFUSED_TEXT.reload)).toBeNull();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("confirmation and stale-revision behavior are unchanged (no description involved)", async () => {
    const w = new FakeWorker("w");
    const t = renderNotice(w);
    act(() => void t.safety.protect("trip-name"));
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(confirmation()).toHaveTextContent(CATEGORY_LABELS["trip-name"]);
    await userEvent.click(screen.getByRole("button", { name: "Keep working" }));
    expect(screen.getByRole("button", { name: "Update now" })).not.toHaveAttribute(
      "aria-describedby",
    );
    expect(skipWaitingSent(w)).toBe(0);
  });
});
