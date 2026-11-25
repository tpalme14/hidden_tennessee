import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { AuthProvider } from "../auth/AuthProvider";
import { TEST_SESSION } from "../auth/testFixtures";
import { FavoritesProvider } from "../favorites/FavoritesProvider";

/**
 * M05-T06 Increment 5a — the public page inside the REAL application shell
 * (`App`, `AuthProvider`, `FavoritesProvider`) with `fetch` stubbed and every
 * request recorded: it is reachable signed out, signed in, and while the
 * session check is pending or failing; it never redirects to sign-in; it
 * makes no owner-trip request; the shared read is the only request carrying
 * the token and is sent without credentials; and no sign-in link or other
 * request carries the token.
 */

const TOKEN = `${"S".repeat(21)}_${"t".repeat(21)}`;
const SHARED_PATH = `/shared/trips/${TOKEN}`;

const SHARED_BODY = {
  trip: {
    name: "Public Falls Trip",
    stops: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        position: 0,
        is_available: true,
        distance_from_previous_miles: null,
        landmark: {
          id: "11111111-1111-4111-8111-000000000001",
          display_name: "Example Falls",
          category: "falls",
          latitude: 35.6,
          longitude: -83.5,
        },
      },
    ],
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
  },
};

type SessionMode = "signed-out" | "signed-in" | "pending" | "failing";

interface Recorded {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function stubFetch(mode: SessionMode): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      const url = String(input);
      if (url.endsWith("/api/auth/get-session")) {
        if (mode === "pending") return new Promise(() => undefined);
        if (mode === "failing")
          return Promise.resolve(json(500, { error: { code: "X", message: "x" } }));
        return Promise.resolve(json(200, mode === "signed-in" ? TEST_SESSION : null));
      }
      if (url === `/api/v1/shared/trips/${TOKEN}`) return Promise.resolve(json(200, SHARED_BODY));
      if (url.startsWith("/api/v1/favorites")) {
        return Promise.resolve(json(200, { favorites: [], page: 1, limit: 100, has_more: false }));
      }
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", message: "x" } }));
    }),
  );
  return calls;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderApp() {
  render(
    <MemoryRouter initialEntries={[SHARED_PATH]}>
      <AuthProvider>
        <FavoritesProvider>
          <App />
          <LocationProbe />
        </FavoritesProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each<SessionMode>(["signed-out", "signed-in", "pending", "failing"])(
  "shared page with the session %s",
  (mode) => {
    it("shows the shared trip, never redirects, and keeps the token out of every other request and link", async () => {
      const calls = stubFetch(mode);
      renderApp();
      expect(
        await screen.findByRole("heading", { level: 2, name: "Public Falls Trip" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent(SHARED_PATH);
      expect(screen.queryByRole("heading", { name: /sign in/i })).toBeNull();

      const sharedCalls = calls.filter((c) => c.url.includes(TOKEN));
      expect(sharedCalls).toHaveLength(1);
      expect(sharedCalls[0]!.url).toBe(`/api/v1/shared/trips/${TOKEN}`);
      expect(sharedCalls[0]!.init.credentials).toBe("omit");
      expect(sharedCalls[0]!.init.headers).toEqual({ Accept: "application/json" });
      for (const call of calls) {
        expect(call.url).not.toMatch(/^\/api\/v1\/trips/);
        if (call !== sharedCalls[0]) {
          expect(JSON.stringify(call)).not.toContain(TOKEN);
        }
      }
      for (const link of screen.getAllByRole("link")) {
        expect(link.getAttribute("href") ?? "").not.toContain(TOKEN);
        expect(decodeURIComponent(link.getAttribute("href") ?? "")).not.toContain(TOKEN);
      }
      // No owner component is mounted.
      expect(
        screen.queryByRole("button", { name: /rename|delete trip|add to trip|share link/i }),
      ).toBeNull();
    });
  },
);

it("signed out, the account area's sign-in link carries no return path", async () => {
  stubFetch("signed-out");
  renderApp();
  await screen.findByRole("heading", { level: 2, name: "Public Falls Trip" });
  const account = await screen.findByRole("navigation", { name: "Account" });
  await waitFor(() =>
    expect(within(account).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    ),
  );
});
