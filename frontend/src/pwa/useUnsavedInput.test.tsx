import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { describe, expect, it } from "vitest";
import { createUpdateSafety, type UpdateSafety } from "./updateSafety";
import { useUnsavedInput } from "./useUnsavedInput";

/**
 * M06-T02 Increment 4b-ii — `useUnsavedInput`: the owner's change handler
 * registers synchronously (within the input event itself, before React
 * commits), every edit of an active draft is a new revision, a layout effect
 * reconciles committed state, and unmount — including StrictMode's simulated
 * one — leaves no orphaned registration.
 */

function Field({ safety, initial = "" }: { safety: UpdateSafety; initial?: string }) {
  const [value, setValue] = useState(initial);
  const markEdited = useUnsavedInput("trip-name", value.trim() !== "", safety);
  return (
    <>
      <label>
        Name
        <input
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            markEdited(event.target.value.trim() !== "");
          }}
        />
      </label>
      <button type="button" onClick={() => setValue("")}>
        Clear
      </button>
    </>
  );
}

const input = () => screen.getByRole("textbox", { name: "Name" });
const categories = (s: UpdateSafety) => s.getSnapshot().protectedCategories;
const revision = (s: UpdateSafety) => s.getSnapshot().protectedRevision;

/** Observes the registry from a listener that runs during the input event's own dispatch, after React's handler but before React commits. */
function observeDuringInputEvent(s: UpdateSafety) {
  const seen: number[] = [];
  const listener = () => seen.push(categories(s).length);
  // React handles onChange from both `input` and `change` events; listen to both.
  document.addEventListener("input", listener);
  document.addEventListener("change", listener);
  return {
    seen,
    stop: () => {
      document.removeEventListener("input", listener);
      document.removeEventListener("change", listener);
    },
  };
}

describe("useUnsavedInput", () => {
  it("is inactive while the field is untouched or empty", () => {
    const s = createUpdateSafety();
    render(<Field safety={s} />);
    expect(categories(s)).toEqual([]);
    expect(revision(s)).toBe(0);
  });

  it("the first input registers within the input event itself (the synchronous boundary)", () => {
    const s = createUpdateSafety();
    render(<Field safety={s} />);
    const observer = observeDuringInputEvent(s);
    fireEvent.change(input(), { target: { value: "W" } });
    observer.stop();
    expect(observer.seen).toEqual([1]);
    expect(categories(s)).toEqual(["trip-name"]);
  });

  it("each further edit of the active draft is a new revision; an earlier revision is no longer current", () => {
    const s = createUpdateSafety();
    render(<Field safety={s} />);
    fireEvent.change(input(), { target: { value: "W" } });
    const shown = revision(s);
    fireEvent.change(input(), { target: { value: "We" } });
    expect(revision(s)).toBeGreaterThan(shown);
    const second = revision(s);
    fireEvent.change(input(), { target: { value: "Wee" } }); // a value replaced by another
    expect(revision(s)).toBeGreaterThan(second);
    expect(categories(s)).toEqual(["trip-name"]); // still one registration
  });

  it("clearing the field releases the registration (handler and committed-state paths)", () => {
    const s = createUpdateSafety();
    render(<Field safety={s} />);
    fireEvent.change(input(), { target: { value: "W" } });
    fireEvent.change(input(), { target: { value: "  " } });
    expect(categories(s)).toEqual([]);
    fireEvent.change(input(), { target: { value: "W" } });
    // A state change that does not pass through the handler is reconciled by the layout effect.
    act(() => screen.getByRole("button", { name: "Clear" }).click());
    expect(categories(s)).toEqual([]);
  });

  it("an existing value is registered on mount; unmount leaves no orphan", () => {
    const s = createUpdateSafety();
    const view = render(<Field safety={s} initial="Weekend" />);
    expect(categories(s)).toEqual(["trip-name"]);
    view.unmount();
    expect(categories(s)).toEqual([]);
  });

  it("an unrelated rerender changes nothing", () => {
    const s = createUpdateSafety();
    const view = render(<Field safety={s} initial="Weekend" />);
    const before = s.getSnapshot();
    view.rerender(<Field safety={s} initial="Weekend" />);
    expect(s.getSnapshot()).toBe(before);
  });

  it("StrictMode: the simulated unmount releases and the remount re-registers exactly one registration", () => {
    const s = createUpdateSafety();
    const view = render(
      <StrictMode>
        <Field safety={s} initial="Weekend" />
      </StrictMode>,
    );
    expect(categories(s)).toEqual(["trip-name"]);
    fireEvent.change(input(), { target: { value: "Weekends" } });
    expect(categories(s)).toEqual(["trip-name"]);
    view.unmount();
    expect(categories(s)).toEqual([]);
  });

  it("several owners register independently", () => {
    const s = createUpdateSafety();
    render(
      <>
        <Field safety={s} initial="A" />
        <Field safety={s} initial="B" />
      </>,
    );
    expect(categories(s)).toEqual(["trip-name", "trip-name"]);
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "" } });
    expect(categories(s)).toEqual(["trip-name"]);
  });
});
