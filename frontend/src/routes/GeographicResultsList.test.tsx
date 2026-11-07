import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { LandmarkMarker, MapMarkersStatus } from "../map/useMapMarkers";
import { GeographicResultsList } from "./GeographicResultsList";

function renderList(status: MapMarkersStatus, onRetry = vi.fn()) {
  return render(
    <MemoryRouter>
      <GeographicResultsList status={status} onRetry={onRetry} />
    </MemoryRouter>,
  );
}

const marker: LandmarkMarker = { id: "a", display_name: "Open Falls", category: "falls", latitude: 35.1, longitude: -85.1 };

describe("GeographicResultsList", () => {
  it("renders a stable, skip-link-focusable heading", () => {
    renderList({ kind: "success", markers: [], isTruncated: false });
    const heading = screen.getByRole("heading", { name: /landmarks on the map/i });
    expect(heading).toHaveAttribute("id", "geo-results-heading");
    expect(heading).toHaveAttribute("tabIndex", "-1");
  });

  it("shows a plain (non-live) loading indicator with no previous result", () => {
    renderList({ kind: "loading" });
    expect(screen.getByText(/^loading…/i)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the real error message and a working, plain (non-live) retry button", async () => {
    const onRetry = vi.fn();
    renderList({ kind: "error", message: "Server error." }, onRetry);

    expect(screen.getByText("Server error.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("never uses role=status or role=alert anywhere — DiscoveryPage already announces this same status live, above the map", () => {
    renderList({
      kind: "loading",
      previous: { markers: [marker], isTruncated: true },
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an empty state for a successful, zero-marker result", () => {
    renderList({ kind: "success", markers: [], isTruncated: false });
    expect(screen.getByText(/no publicly viewable landmarks are currently shown on the map/i)).toBeInTheDocument();
  });

  it("renders each marker's name, category, and profile link, with fromDiscovery state", async () => {
    function LocationProbe() {
      const location = useLocation();
      const state = location.state as { fromDiscovery?: boolean } | null;
      return <div>fromDiscovery: {String(Boolean(state?.fromDiscovery))}</div>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<GeographicResultsList status={{ kind: "success", markers: [marker], isTruncated: false }} onRetry={vi.fn()} />}
          />
          <Route path="/landmarks/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const list = screen.getByRole("list");
    const link = within(list).getByRole("link", { name: "Open Falls" });
    expect(link).toHaveAttribute("href", "/landmarks/a");
    expect(within(list).getByText("Waterfall")).toBeInTheDocument();

    await userEvent.click(link);
    expect(await screen.findByText("fromDiscovery: true")).toBeInTheDocument();
  });

  it("shows straight-line distance only when present (proximity mode)", () => {
    renderList({
      kind: "success",
      markers: [{ ...marker, distance_miles: 3.456 }],
      isTruncated: false,
    });
    expect(screen.getByText(/3\.5 mi \(straight-line distance\)/i)).toBeInTheDocument();
  });

  it("shows no distance text in bbox mode (distance absent)", () => {
    renderList({ kind: "success", markers: [marker], isTruncated: false });
    expect(screen.queryByText(/straight-line/i)).not.toBeInTheDocument();
  });

  it("shows the truncation message only when is_truncated is true", () => {
    const { unmount } = renderList({ kind: "success", markers: [marker], isTruncated: false });
    expect(screen.queryByText(/more results exist/i)).not.toBeInTheDocument();
    unmount();

    renderList({ kind: "success", markers: [marker], isTruncated: true });
    expect(screen.getByText(/more results exist; zoom in or refine/i)).toBeInTheDocument();
  });

  it("shows retained previous markers, clearly labeled, while a subsequent request loads", () => {
    renderList({ kind: "loading", previous: { markers: [marker], isTruncated: false } });

    expect(screen.getByText(/updating…/i)).toBeInTheDocument();
    expect(screen.getByText(/previous search/i)).toHaveTextContent(/the update loads/i);
    expect(screen.getByRole("link", { name: "Open Falls" })).toBeInTheDocument();
  });

  it("shows retained previous markers, clearly labeled, alongside a real error", () => {
    renderList({ kind: "error", message: "Server error.", previous: { markers: [marker], isTruncated: false } });

    expect(screen.getByText("Server error.")).toBeInTheDocument();
    expect(screen.getByText(/previous search/i)).toHaveTextContent(/the update failed/i);
    expect(screen.getByRole("link", { name: "Open Falls" })).toBeInTheDocument();
  });

  it("shows no previous-results notice or list when nothing was ever successfully fetched", () => {
    renderList({ kind: "error", message: "Server error." });
    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows no previous-results notice when the retained previous result was itself empty", () => {
    renderList({ kind: "loading", previous: { markers: [], isTruncated: false } });
    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("a successful (even empty) response is never shown as previous — success is always authoritative", () => {
    renderList({ kind: "success", markers: [], isTruncated: false });
    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
  });

  it("has no pagination controls — geographic results are always a single page", () => {
    renderList({ kind: "success", markers: [marker], isTruncated: true });
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /previous/i })).not.toBeInTheDocument();
  });
});
