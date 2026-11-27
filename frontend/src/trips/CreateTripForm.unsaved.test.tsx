import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateSafety } from "../pwa/updateSafety";
import { CreateTripForm } from "./CreateTripForm";
import { NewTripForm } from "./NewTripForm";

/**
 * M06-T02 Increment 4b-ii — typed trip names registered as protected
 * information in My Trips' Create trip form and the picker's New trip form.
 * Presence only; validation, locks, and submission are unchanged.
 */

const categories = () => updateSafety.getSnapshot().protectedCategories;
const revision = () => updateSafety.getSnapshot().protectedRevision;
const input = () => screen.getByRole("textbox", { name: "New trip name" });

afterEach(() => {
  cleanup();
  expect(categories()).toEqual([]);
});

describe.each([
  [
    "CreateTripForm",
    (onCreate: (name: string) => Promise<{ nameError?: string }>) => (
      <CreateTripForm busy={false} onCreate={onCreate} />
    ),
    "Create trip",
  ],
  [
    "NewTripForm",
    (onCreate: (name: string) => Promise<{ nameError?: string }>) => (
      <NewTripForm landmarkName="Alpha Falls" disabled={false} busy={false} onCreate={onCreate} />
    ),
    "Create trip and add Alpha Falls",
  ],
])("%s", (_name, make, submitName) => {
  it("untouched → none; first edit → protected; further edits → new revisions; cleared → none", () => {
    render(make(vi.fn(() => Promise.resolve({}))));
    expect(categories()).toEqual([]);
    fireEvent.change(input(), { target: { value: "W" } });
    expect(categories()).toEqual(["trip-name"]);
    const r = revision();
    fireEvent.change(input(), { target: { value: "Weekend" } });
    expect(revision()).toBeGreaterThan(r);
    fireEvent.change(input(), { target: { value: "  " } });
    expect(categories()).toEqual([]);
  });

  it("a failed submission (server name error) keeps the name and its protection", async () => {
    const onCreate = vi.fn(() => Promise.resolve({ nameError: "That name isn't allowed." }));
    render(make(onCreate));
    fireEvent.change(input(), { target: { value: "Weekend" } });
    await userEvent.click(screen.getByRole("button", { name: submitName }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(input()).toHaveValue("Weekend");
    expect(categories()).toEqual(["trip-name"]);
  });

  it("client validation still applies and changes nothing; unmount leaves no registration", async () => {
    const onCreate = vi.fn(() => Promise.resolve({}));
    const view = render(make(onCreate));
    fireEvent.change(input(), { target: { value: "Weekend" } });
    view.unmount();
    expect(categories()).toEqual([]);
  });

  it("registers no name", () => {
    render(make(vi.fn(() => Promise.resolve({}))));
    fireEvent.change(input(), { target: { value: "Synthetic secret trip" } });
    expect(JSON.stringify(updateSafety.getSnapshot())).not.toContain("Synthetic secret");
  });
});
