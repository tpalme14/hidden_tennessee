import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

describe("LoadingState", () => {
  it("announces loading via an accessible status role", () => {
    render(<LoadingState label="Loading categories…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading categories…");
  });

  it("defaults to a generic label", () => {
    render(<LoadingState />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});

describe("ErrorState", () => {
  it("announces the error message via an alert role", () => {
    render(<ErrorState message="Something went wrong." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  it("invokes onRetry when the retry button is activated", async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Failed." onRetry={onRetry} />);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("omits the retry button when onRetry isn't provided", () => {
    render(<ErrorState message="Failed." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders the provided message", () => {
    render(<EmptyState message="Nothing here yet." />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
});
