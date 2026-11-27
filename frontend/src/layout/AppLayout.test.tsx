import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { TEST_USER } from "../auth/testFixtures";
import { AppLayout } from "./AppLayout";

/**
 * M03-T06 Increment 5 (K6) — the "My Favorites" link in the primary
 * navigation appears for a VERIFIED signed-in user only. M05-T06 Increment 2
 * adds "My Trips" after it under the same rule.
 */

function renderShell(session: SessionState, path = "/") {
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<p>Discovery content</p>} />
            <Route path="favorites" element={<p>Favorites content</p>} />
            <Route path="trips" element={<p>My Trips content</p>} />
            <Route path="trips/:tripId" element={<p>Trip content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const primaryNav = () => screen.getByRole("navigation", { name: "Primary" });

describe("AppLayout — notices (M06-T02 Increment 4a)", () => {
  it("places the update notice after the connectivity banner and before <main>, adding no live region and no control by default", () => {
    renderShell({ status: "anonymous" });
    const banner = document.querySelector("[data-connectivity-banner]")!;
    const notice = document.querySelector("[data-update-notice]")!;
    const main = screen.getByRole("main");
    expect(banner.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.querySelectorAll("[aria-live], button")).toHaveLength(0);
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(0);
  });
});

describe("AppLayout — installation affordance (M06-T02 Increment 4d)", () => {
  it("sits at the end of the header, after the account area, keeping the skip link, notices, and <main> in order", () => {
    renderShell({ status: "anonymous" });
    const header = screen.getByRole("banner");
    const install = document.querySelector("[data-install-affordance]")!;
    expect(header).toContainElement(install as HTMLElement);
    expect(header.lastElementChild).toBe(install);
    const account = within(header).getByRole("navigation", { name: "Account" });
    expect(
      account.compareDocumentPosition(install) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const banner = document.querySelector("[data-connectivity-banner]")!;
    expect(install.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("without a browser prompt it offers only collapsed guidance: no Install app button, no live region", () => {
    renderShell({ status: "anonymous" });
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
    expect(screen.getByText("Install this app").tagName).toBe("SUMMARY");
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(0);
  });
});

describe("AppLayout — My Favorites navigation", () => {
  it("signed in: Discover then My Favorites, linking to /favorites", async () => {
    renderShell({ status: "authenticated", user: TEST_USER });
    const links = within(primaryNav()).getAllByRole("link");
    // M06-T03 3e adds the offline library link for signed-in visitors.
    expect(links.map((l) => l.textContent)).toEqual([
      "Discover",
      "My Favorites",
      "My Trips",
      "Saved for offline",
    ]);
    expect(links[1]).toHaveAttribute("href", "/favorites");
    await userEvent.click(links[1]!);
    expect(screen.getByText("Favorites content")).toBeInTheDocument();
    expect(within(primaryNav()).getByRole("link", { name: "My Favorites" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it.each<[string, SessionState]>([
    ["loading", { status: "loading" }],
    ["anonymous", { status: "anonymous" }],
    ["unavailable", { status: "unavailable", retry: () => Promise.resolve() }],
  ])("%s: no My Favorites link", (_label, session) => {
    renderShell(session);
    expect(
      within(primaryNav())
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Discover"]);
  });
});

describe("AppLayout — My Trips navigation (M05-T06 Increment 2)", () => {
  it("signed in: My Trips follows My Favorites and links to /trips", async () => {
    renderShell({ status: "authenticated", user: TEST_USER });
    const link = within(primaryNav()).getByRole("link", { name: "My Trips" });
    expect(link).toHaveAttribute("href", "/trips");
    expect(link).not.toHaveAttribute("aria-current");
    await userEvent.click(link);
    expect(screen.getByText("My Trips content")).toBeInTheDocument();
    expect(within(primaryNav()).getByRole("link", { name: "My Trips" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("is current on /trips (direct navigation) but not on a trip page", () => {
    renderShell({ status: "authenticated", user: TEST_USER }, "/trips?page=2");
    expect(within(primaryNav()).getByRole("link", { name: "My Trips" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("is not current on a trip's own page", () => {
    renderShell(
      { status: "authenticated", user: TEST_USER },
      "/trips/0f8fad5b-d9cb-469f-a165-70867728950e",
    );
    expect(screen.getByText("Trip content")).toBeInTheDocument();
    expect(within(primaryNav()).getByRole("link", { name: "My Trips" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it.each<[string, SessionState]>([
    ["loading", { status: "loading" }],
    ["anonymous", { status: "anonymous" }],
    ["unavailable", { status: "unavailable", retry: () => Promise.resolve() }],
  ])("%s: no My Trips link", (_label, session) => {
    renderShell(session, "/trips");
    expect(within(primaryNav()).queryByRole("link", { name: "My Trips" })).toBeNull();
  });
});
