import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import {
  createTrip,
  getTrip,
  listTrips,
  type OwnerTrip,
  type TripListItem,
  type TripListPage,
} from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { TRIP_NAME_CASES } from "../trips/testdata/tripNameCorpus";
import { TRIP_NAME_MESSAGES } from "../trips/tripNameRule";
import { readCreatedTripNotice } from "../trips/tripNotice";
import { MyTripsPage, UNCERTAIN_CREATE_TEXT } from "./MyTripsPage";

/**
 * M05-T06 Increment 2 — My Trips with the REAL `useTripsList` hook and
 * creation logic (API module mocked, auth context supplied): session gating,
 * the list's exact content in server order, pagination and `?page=`, every
 * list state, stale-response and session isolation, and creation — client and
 * server validation, the synchronous guard, definite refusals, uncertain
 * outcomes with the page-1 check (refinement R4), and stale creation responses.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  listTrips: vi.fn(),
  createTrip: vi.fn(),
  getTrip: vi.fn(),
}));

const list = vi.mocked(listTrips);
const create = vi.mocked(createTrip);
const get = vi.mocked(getTrip);

const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TIME = "2026-11-23T16:00:00.000Z";
const RLO = String.fromCodePoint(0x202e);

function item(n: number, extra: Partial<TripListItem> = {}): TripListItem {
  return {
    id: uuid(n),
    name: `Trip ${n}`,
    stop_count: 2,
    updated_at: TIME,
    is_shared: false,
    ...extra,
  };
}

function pageOf(trips: TripListItem[], page = 1, hasMore = false): TripListPage {
  return { trips, page, limit: 20, has_more: hasMore };
}

function ownerTrip(id: string, name: string): OwnerTrip {
  return {
    id,
    name,
    version: 0,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops: [],
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
  };
}

let navigateTo: (to: string | number) => void = () => undefined;

function Probe() {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  navigateTo = (to) => {
    void (typeof to === "number" ? navigate(to) : navigate(to));
  };
  return (
    <div data-testid="location" data-nav={type}>
      {`${location.pathname}${location.search}`}
    </div>
  );
}

function TripStub() {
  const location = useLocation();
  const notice = readCreatedTripNotice(location.state);
  return <p data-testid="trip-stub">{notice === null ? "no notice" : JSON.stringify(notice)}</p>;
}

function Harness({ session, refresh }: { session: SessionState; refresh: () => Promise<void> }) {
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh,
    signOut: vi.fn(() => Promise.resolve()),
  };
  return (
    <AuthContext.Provider value={auth}>
      <Routes>
        <Route path="/trips" element={<MyTripsPage />} />
        <Route path="/trips/:tripId" element={<TripStub />} />
        <Route path="/sign-in" element={<p>Sign-in page</p>} />
        <Route path="/other" element={<p>Other page</p>} />
      </Routes>
      <Probe />
    </AuthContext.Provider>
  );
}

function renderPage(
  path = "/trips",
  session: SessionState = { status: "authenticated", user: TEST_USER },
) {
  const refresh = vi.fn(() => Promise.resolve());
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Harness session={session} refresh={refresh} />
    </MemoryRouter>,
  );
  return {
    refresh,
    view,
    setSession(next: SessionState) {
      view.rerender(
        <MemoryRouter initialEntries={[path]}>
          <Harness session={next} refresh={refresh} />
        </MemoryRouter>,
      );
    },
  };
}

const signedIn: SessionState = { status: "authenticated", user: TEST_USER };
const location = () => screen.getByTestId("location");
const status = () => screen.getByRole("status");
const nameInput = () => screen.getByLabelText("New trip name");
const submit = () => screen.getByRole("button", { name: "Create trip" });
const rows = () =>
  within(screen.getByRole("list", { name: "Your trips" })).getAllByRole("listitem");
const listCalls = () => list.mock.calls.map(([q]) => q);

async function typeName(value: string) {
  fireEvent.change(nameInput(), { target: { value } });
}

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  get.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session gating", () => {
  it("loading: says so, requests nothing, shows no form or list", () => {
    renderPage("/trips", { status: "loading" });
    expect(status()).toHaveTextContent("Checking whether you're signed in…");
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New trip name")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("unavailable: explains, requests nothing", () => {
    renderPage("/trips", { status: "unavailable", retry: () => Promise.resolve() });
    expect(screen.getByText(/couldn.t check whether you.re signed in/)).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New trip name")).toBeNull();
  });

  it("signed out: a sign-in link that returns to /trips, nothing requested", () => {
    renderPage("/trips", { status: "anonymous" });
    expect(screen.getByRole("link", { name: "Sign in to see your trips" })).toHaveAttribute(
      "href",
      "/sign-in?returnTo=%2Ftrips",
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("direct navigation signed in requests page 1 with limit 20 exactly once", async () => {
    list.mockResolvedValue(pageOf([item(1)]));
    renderPage("/trips");
    expect(await screen.findByRole("link", { name: "Trip 1" })).toBeInTheDocument();
    expect(listCalls()).toEqual([{ page: 1, limit: 20 }]);
    expect(screen.getByRole("heading", { level: 2, name: "My Trips" })).toBeInTheDocument();
  });
});

describe("list content", () => {
  it("keeps the server's order and shows name, stop count, date, and Shared exactly", async () => {
    list.mockResolvedValue(
      pageOf([
        item(3, { name: "Zeta Loop", stop_count: 0 }),
        item(1, { name: "Alpha Falls", stop_count: 1, is_shared: true }),
        item(2, { name: "Mid Arches", stop_count: 25, updated_at: "2026-01-05T09:30:00.000Z" }),
      ]),
    );
    renderPage();
    await screen.findByRole("list", { name: "Your trips" });
    const [first, second, third] = rows();
    expect(within(first!).getByRole("link")).toHaveTextContent("Zeta Loop");
    expect(within(second!).getByRole("link")).toHaveTextContent("Alpha Falls");
    expect(within(third!).getByRole("link")).toHaveTextContent("Mid Arches");
    expect(first).toHaveTextContent("0 stops");
    expect(second).toHaveTextContent("1 stop");
    expect(second).not.toHaveTextContent("1 stops");
    expect(third).toHaveTextContent("25 stops");
    expect(within(second!).getByText("Shared")).toBeInTheDocument();
    expect(within(first!).queryByText("Shared")).toBeNull();
    expect(within(third!).queryByText("Shared")).toBeNull();
    expect(third!.querySelector("time")).toHaveAttribute("dateTime", "2026-01-05T09:30:00.000Z");
    expect(third).toHaveTextContent(/Updated .*2026/);
  });

  it("links each row to the trip page by ID and fetches no trip details", async () => {
    list.mockResolvedValue(pageOf([item(7), item(8)]));
    renderPage();
    await screen.findByRole("link", { name: "Trip 7" });
    expect(screen.getByRole("link", { name: "Trip 7" })).toHaveAttribute(
      "href",
      `/trips/${uuid(7)}`,
    );
    expect(screen.getByRole("link", { name: "Trip 8" })).toHaveAttribute(
      "href",
      `/trips/${uuid(8)}`,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("renders names as plain, direction-isolated text", async () => {
    const hostile = `<img src=x onerror=alert(1)>${RLO}Falls`;
    list.mockResolvedValue(pageOf([item(1, { name: hostile })]));
    renderPage();
    const link = await screen.findByRole("link", { name: hostile });
    const bdi = link.querySelector("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi!.textContent).toBe(hostile);
    expect(document.querySelector("img")).toBeNull();
  });

  it("an empty first page explains there are no trips and offers the create form", async () => {
    list.mockResolvedValue(pageOf([]));
    renderPage();
    expect(await screen.findByText(/You don.t have any trips yet/)).toBeInTheDocument();
    expect(nameInput()).toBeInTheDocument();
    expect(submit()).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Trip list pages" })).toBeNull();
  });
});

describe("pagination", () => {
  it("follows has_more: Next only when the server says more exist (not the item count)", async () => {
    list.mockResolvedValueOnce(pageOf([item(1), item(2), item(3)], 1, true));
    renderPage();
    await screen.findByRole("link", { name: "Trip 1" });
    const pager = screen.getByRole("navigation", { name: "Trip list pages" });
    expect(within(pager).getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/trips?page=2",
    );
    expect(within(pager).queryByRole("link", { name: "Previous page" })).toBeNull();
    expect(pager).toHaveTextContent("Page 1");
  });

  it("a full page with has_more false has no pager at all", async () => {
    list.mockResolvedValueOnce(
      pageOf(
        Array.from({ length: 20 }, (_, i) => item(i + 1)),
        1,
        false,
      ),
    );
    renderPage();
    await screen.findByRole("link", { name: "Trip 20" });
    expect(screen.queryByRole("navigation", { name: "Trip list pages" })).toBeNull();
  });

  it("Next requests page 2, focuses the heading, and Back returns to a fresh page 1", async () => {
    list
      .mockResolvedValueOnce(pageOf([item(1)], 1, true))
      .mockResolvedValueOnce(pageOf([item(21)], 2, false))
      .mockResolvedValueOnce(pageOf([item(1)], 1, true));
    renderPage();
    await userEvent.click(await screen.findByRole("link", { name: "Next page" }));
    expect(await screen.findByRole("link", { name: "Trip 21" })).toBeInTheDocument();
    expect(location()).toHaveTextContent("/trips?page=2");
    expect(screen.getByRole("heading", { level: 2, name: "My Trips" })).toHaveFocus();
    const pager = screen.getByRole("navigation", { name: "Trip list pages" });
    expect(within(pager).getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/trips",
    );
    expect(within(pager).queryByRole("link", { name: "Next page" })).toBeNull();
    act(() => navigateTo(-1));
    expect(await screen.findByRole("link", { name: "Trip 1" })).toBeInTheDocument();
    expect(location()).toHaveTextContent(/^\/trips$/);
    expect(location()).toHaveAttribute("data-nav", "POP");
    expect(listCalls()).toEqual([
      { page: 1, limit: 20 },
      { page: 2, limit: 20 },
      { page: 1, limit: 20 },
    ]);
  });

  it.each([
    "?page=0",
    "?page=-1",
    "?page=abc",
    "?page=01",
    "?page=1.5",
    "?page=",
    "?page=1&page=2",
  ])("%s is replaced with page 1 (history replace) with a single request", async (search) => {
    list.mockResolvedValue(pageOf([item(1)]));
    renderPage(`/trips${search}`);
    await screen.findByRole("link", { name: "Trip 1" });
    expect(location()).toHaveTextContent(/^\/trips$/);
    expect(location()).toHaveAttribute("data-nav", "REPLACE");
    expect(listCalls()).toEqual([{ page: 1, limit: 20 }]);
  });

  it("a valid page past the end says so, links to page 1, and is not the empty-account message", async () => {
    list.mockResolvedValue(pageOf([], 5, false));
    renderPage("/trips?page=5");
    expect(await screen.findByText("There are no trips on this page.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the first page of your trips" }),
    ).toHaveAttribute("href", "/trips");
    expect(screen.queryByText(/You don.t have any trips yet/)).toBeNull();
    expect(listCalls()).toEqual([{ page: 5, limit: 20 }]);
  });

  it("a late response for an earlier page never replaces the current page", async () => {
    const page1 = deferred<TripListPage>();
    list.mockReturnValueOnce(page1.promise).mockResolvedValueOnce(pageOf([item(21)], 2, false));
    renderPage();
    act(() => navigateTo("/trips?page=2"));
    expect(await screen.findByRole("link", { name: "Trip 21" })).toBeInTheDocument();
    await act(async () => page1.resolve(pageOf([item(1)], 1, true)));
    expect(screen.getByRole("link", { name: "Trip 21" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Trip 1" })).toBeNull();
  });
});

describe("loading and failures", () => {
  it("shows Loading your trips… while the first page loads", async () => {
    const pending = deferred<TripListPage>();
    list.mockReturnValueOnce(pending.promise);
    renderPage();
    expect(status()).toHaveTextContent("Loading your trips…");
    expect(screen.queryByRole("list")).toBeNull();
    await act(async () => pending.resolve(pageOf([item(1)])));
    expect(status()).toHaveTextContent("");
  });

  it("a failed load is one alert with Try again, which re-requests explicitly", async () => {
    list
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "boom internal detail"))
      .mockResolvedValueOnce(pageOf([item(1)]));
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your trips. Please try again.");
    expect(alert).not.toHaveTextContent("boom internal detail");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(list).toHaveBeenCalledTimes(1);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Trip 1" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("rate limiting uses Retry-After", async () => {
    list.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "x", 12));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Please try again in 12 seconds.",
    );
  });

  it("a 401 shows the session message and re-checks the session", async () => {
    list.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "x"));
    const { refresh } = renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load your trips because your session may have ended.",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("session isolation", () => {
  it("a different user clears the previous user's trips at once and loads their own", async () => {
    const other = deferred<TripListPage>();
    list
      .mockResolvedValueOnce(pageOf([item(1, { name: "Alice trip" })]))
      .mockReturnValueOnce(other.promise);
    const { setSession } = renderPage();
    await screen.findByRole("link", { name: "Alice trip" });
    setSession({ status: "authenticated", user: OTHER_USER });
    expect(screen.queryByRole("link", { name: "Alice trip" })).toBeNull();
    expect(status()).toHaveTextContent("Loading your trips…");
    await act(async () => other.resolve(pageOf([item(2, { name: "Bob trip" })])));
    expect(screen.getByRole("link", { name: "Bob trip" })).toBeInTheDocument();
  });

  it("an unconfirmed session clears the list and fetches nothing; the same user re-verified loads fresh", async () => {
    list
      .mockResolvedValueOnce(pageOf([item(1, { name: "Old snapshot" })]))
      .mockResolvedValueOnce(pageOf([item(2, { name: "Fresh snapshot" })]));
    const { setSession } = renderPage();
    await screen.findByRole("link", { name: "Old snapshot" });
    setSession({ status: "loading" });
    expect(screen.queryByRole("link", { name: "Old snapshot" })).toBeNull();
    setSession({ status: "unavailable", retry: () => Promise.resolve() });
    expect(screen.queryByRole("list")).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
    setSession(signedIn);
    expect(await screen.findByRole("link", { name: "Fresh snapshot" })).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("a late response for the previous user is dropped", async () => {
    const first = deferred<TripListPage>();
    list
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(pageOf([item(2, { name: "Bob trip" })]));
    const { setSession } = renderPage();
    setSession({ status: "authenticated", user: OTHER_USER });
    await screen.findByRole("link", { name: "Bob trip" });
    await act(async () => first.resolve(pageOf([item(1, { name: "Alice trip" })])));
    expect(screen.queryByRole("link", { name: "Alice trip" })).toBeNull();
  });

  it("signing out clears the list and the typed name", async () => {
    list.mockResolvedValue(pageOf([item(1)]));
    const { setSession } = renderPage();
    await screen.findByRole("link", { name: "Trip 1" });
    await typeName("Draft name");
    setSession({ status: "anonymous" });
    expect(screen.queryByRole("link", { name: "Trip 1" })).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in to see your trips" })).toBeInTheDocument();
    setSession(signedIn);
    await screen.findByRole("link", { name: "Trip 1" });
    expect(nameInput()).toHaveValue("");
  });
});

describe("creation — validation", () => {
  // A single-line text field strips line feeds and carriage returns from its
  // value (HTML value sanitization, in browsers and jsdom alike), so the corpus
  // cases containing them cannot be typed; that stripping is asserted below.
  const rejected = TRIP_NAME_CASES.filter(
    (c) => c.expect.kind === "reject" && !/[\n\r]/.test(c.input),
  );

  it("the text field itself strips line breaks, so they never reach the request", async () => {
    list.mockResolvedValue(pageOf([]));
    renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await typeName("Line one\nLine two\r");
    expect(nameInput()).toHaveValue("Line oneLine two");
  });

  it.each(rejected.map((c) => [c.id, c] as const))(
    "corpus %s is refused on the client with the server's message, without a request",
    async (_id, testCase) => {
      list.mockResolvedValue(pageOf([]));
      renderPage();
      await screen.findByText(/You don.t have any trips yet/);
      await typeName(testCase.input);
      fireEvent.click(submit());
      const reason = testCase.expect.kind === "reject" ? testCase.expect.reason : "type";
      const error = await screen.findByText(TRIP_NAME_MESSAGES[reason]);
      expect(nameInput()).toHaveAttribute("aria-invalid", "true");
      expect(nameInput()).toHaveAttribute("aria-describedby", error.id);
      expect(nameInput()).toHaveFocus();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("an empty name is refused on the client", async () => {
    list.mockResolvedValue(pageOf([]));
    renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.click(submit());
    expect(screen.getByText(TRIP_NAME_MESSAGES.noVisible)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("the server's name error is shown on the field, the typed name is kept, and the input is focused", async () => {
    list.mockResolvedValue(pageOf([]));
    create.mockRejectedValueOnce(
      new ApiError(400, "INVALID_REQUEST", TRIP_NAME_MESSAGES.characters),
    );
    renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.type(nameInput(), "Newer Unicode");
    await userEvent.click(submit());
    expect(await screen.findByText(TRIP_NAME_MESSAGES.characters)).toBeInTheDocument();
    expect(nameInput()).toHaveValue("Newer Unicode");
    expect(nameInput()).toHaveFocus();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a 400 that is not a name message is a generic refusal (no server text shown)", async () => {
    list.mockResolvedValue(pageOf([]));
    create.mockRejectedValueOnce(
      new ApiError(400, "INVALID_REQUEST", "unsupported fields: user_id"),
    );
    renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.type(nameInput(), "Trip");
    await userEvent.click(submit());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The trip wasn't created. Please try again.");
    expect(alert).not.toHaveTextContent("unsupported");
  });
});

describe("creation — success", () => {
  it("sends the trimmed name, shows pending feedback, and navigates to the new trip with a scoped notice", async () => {
    list.mockResolvedValue(pageOf([]));
    const pending = deferred<OwnerTrip>();
    create.mockReturnValueOnce(pending.promise);
    renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.type(nameInput(), "  Smoky Falls  ");
    await userEvent.click(submit());
    expect(create).toHaveBeenCalledWith("Smoky Falls");
    expect(status()).toHaveTextContent("Creating trip…");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    await act(async () => pending.resolve(ownerTrip(uuid(42), "Smoky Falls")));
    const stub = await screen.findByTestId("trip-stub");
    expect(location()).toHaveTextContent(`/trips/${uuid(42)}`);
    expect(location()).toHaveAttribute("data-nav", "PUSH");
    expect(JSON.parse(stub.textContent!)).toEqual({
      kind: "trip-created",
      userId: TEST_USER.id,
      tripId: uuid(42),
      name: "Smoky Falls",
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("refuses a second submission before React re-renders (synchronous guard)", async () => {
    list.mockResolvedValue(pageOf([]));
    const pending = deferred<OwnerTrip>();
    create.mockReturnValue(pending.promise);
    renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await typeName("Twice");
    const form = nameInput().closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(create).toHaveBeenCalledTimes(1);
    await userEvent.click(submit());
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(ownerTrip(uuid(5), "Twice")));
    await screen.findByTestId("trip-stub");
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("creation — definite refusals", () => {
  it.each<[string, ApiError, string]>([
    [
      "429",
      new ApiError(429, "RATE_LIMITED", "x", 3),
      "The trip wasn't created. Too many requests. Please try again in 3 seconds.",
    ],
    [
      "403",
      new ApiError(403, "INVALID_ORIGIN", "x"),
      "The trip wasn't created. Reload the page and try again.",
    ],
    ["409", new ApiError(409, "SOMETHING", "x"), "The trip wasn't created. Please try again."],
  ])("%s: one alert, the typed name kept, no replay and no list check", async (_s, error, text) => {
    list.mockResolvedValue(pageOf([]));
    create.mockRejectedValueOnce(error);
    renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.type(nameInput(), "Kept name");
    await userEvent.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(nameInput()).toHaveValue("Kept name");
    expect(create).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(submit()).not.toHaveAttribute("aria-disabled");
  });

  it("401: says the trip wasn't created and re-checks the session", async () => {
    list.mockResolvedValue(pageOf([]));
    create.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "x"));
    const { refresh } = renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.type(nameInput(), "Trip");
    await userEvent.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The trip wasn't created because your session may have ended.",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("creation — uncertain outcome (R4)", () => {
  it.each<[string, Error]>([
    ["a network error", new ApiError(0, "NETWORK_ERROR", "x")],
    ["a 5xx", new ApiError(503, "SERVICE_UNAVAILABLE", "x")],
    ["an unreadable success", new ApiError(201, "INVALID_RESPONSE", "x")],
    ["a non-API error", new TypeError("x")],
  ])("%s on page 1: says it may exist, re-reads page 1, never replays", async (_label, error) => {
    const check = deferred<TripListPage>();
    list.mockResolvedValueOnce(pageOf([item(1)])).mockReturnValueOnce(check.promise);
    create.mockRejectedValueOnce(error);
    renderPage();
    await screen.findByRole("link", { name: "Trip 1" });
    await userEvent.type(nameInput(), "Maybe Trip");
    await userEvent.click(submit());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(UNCERTAIN_CREATE_TEXT);
    expect(alert).not.toHaveTextContent(/wasn.t created/);
    expect(listCalls()).toEqual([
      { page: 1, limit: 20 },
      { page: 1, limit: 20 },
    ]);
    // Until the check has finished, another submission is refused.
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(submit());
    expect(create).toHaveBeenCalledTimes(1);
    expect(nameInput()).toHaveValue("Maybe Trip");
    await act(async () => check.resolve(pageOf([item(2, { name: "Maybe Trip" }), item(1)])));
    // The same-named trip is listed, but it is never assumed to be the new one.
    expect(screen.getByRole("link", { name: "Maybe Trip" })).toBeInTheDocument();
    expect(location()).toHaveTextContent(/^\/trips$/);
    expect(screen.getByRole("alert")).toHaveTextContent(UNCERTAIN_CREATE_TEXT);
    expect(submit()).not.toHaveAttribute("aria-disabled");
    expect(create).toHaveBeenCalledTimes(1);
    // A further creation happens only on an explicit submission.
    create.mockResolvedValueOnce(ownerTrip(uuid(9), "Maybe Trip"));
    await userEvent.click(submit());
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("from a later page: goes to page 1 for the check", async () => {
    list
      .mockResolvedValueOnce(pageOf([item(41)], 3, false))
      .mockResolvedValueOnce(pageOf([item(1)], 1, true));
    create.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    renderPage("/trips?page=3");
    await screen.findByRole("link", { name: "Trip 41" });
    await userEvent.type(nameInput(), "Maybe Trip");
    await userEvent.click(submit());
    expect(await screen.findByRole("link", { name: "Trip 1" })).toBeInTheDocument();
    expect(location()).toHaveTextContent(/^\/trips$/);
    expect(listCalls()).toEqual([
      { page: 3, limit: 20 },
      { page: 1, limit: 20 },
    ]);
    expect(screen.getByRole("alert")).toHaveTextContent(UNCERTAIN_CREATE_TEXT);
    expect(submit()).not.toHaveAttribute("aria-disabled");
  });

  it("from a later page: the previous page's list does not end the check early", async () => {
    const check = deferred<TripListPage>();
    list.mockResolvedValueOnce(pageOf([item(41)], 3, false)).mockReturnValueOnce(check.promise);
    create.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    renderPage("/trips?page=3");
    await screen.findByRole("link", { name: "Trip 41" });
    await userEvent.type(nameInput(), "Maybe Trip");
    await userEvent.click(submit());
    await screen.findByRole("alert");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(submit());
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => check.resolve(pageOf([item(1)], 1, false)));
    expect(submit()).not.toHaveAttribute("aria-disabled");
  });

  it("a failed check keeps the uncertainty in one alert with Try again — never 'not created'", async () => {
    list
      .mockResolvedValueOnce(pageOf([item(1)]))
      .mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"))
      .mockResolvedValueOnce(pageOf([item(2), item(1)]));
    create.mockRejectedValueOnce(new ApiError(502, "BAD_GATEWAY", "x"));
    renderPage();
    await screen.findByRole("link", { name: "Trip 1" });
    await userEvent.type(nameInput(), "Maybe Trip");
    await userEvent.click(submit());
    const alert = await screen.findByText(/couldn.t be loaded to check/);
    const region = alert.closest("[role=alert]") as HTMLElement;
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(region).toHaveTextContent(/it may have been/);
    expect(region).not.toHaveTextContent(/wasn.t created/);
    expect(nameInput()).toHaveValue("Maybe Trip");
    await userEvent.click(within(region).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Trip 2" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(UNCERTAIN_CREATE_TEXT);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("creation — stale responses", () => {
  it("a success that arrives after the user changed neither navigates nor announces", async () => {
    list.mockResolvedValue(pageOf([]));
    const pending = deferred<OwnerTrip>();
    create.mockReturnValueOnce(pending.promise);
    const { setSession } = renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.type(nameInput(), "Alice trip");
    await userEvent.click(submit());
    setSession({ status: "authenticated", user: OTHER_USER });
    await act(async () => pending.resolve(ownerTrip(uuid(3), "Alice trip")));
    expect(location()).toHaveTextContent(/^\/trips$/);
    expect(screen.queryByTestId("trip-stub")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(status()).not.toHaveTextContent("Creating trip…");
  });

  it("a success after the same user was re-verified (a new session epoch) does not navigate", async () => {
    list.mockResolvedValue(pageOf([]));
    const pending = deferred<OwnerTrip>();
    create.mockReturnValueOnce(pending.promise);
    const { setSession } = renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.type(nameInput(), "Trip");
    await userEvent.click(submit());
    setSession({ status: "loading" });
    setSession(signedIn);
    await act(async () => pending.resolve(ownerTrip(uuid(3), "Trip")));
    expect(location()).toHaveTextContent(/^\/trips$/);
  });

  it("an uncertain outcome after a sign-out shows nothing and checks nothing", async () => {
    list.mockResolvedValue(pageOf([]));
    const pending = deferred<OwnerTrip>();
    create.mockReturnValueOnce(pending.promise);
    const { setSession } = renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.type(nameInput(), "Trip");
    await userEvent.click(submit());
    setSession({ status: "anonymous" });
    await act(async () => pending.reject(new ApiError(0, "NETWORK_ERROR", "x")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("a success after leaving the page does not navigate back to the trip", async () => {
    list.mockResolvedValue(pageOf([]));
    const pending = deferred<OwnerTrip>();
    create.mockReturnValueOnce(pending.promise);
    renderPage();
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.type(nameInput(), "Trip");
    await userEvent.click(submit());
    act(() => navigateTo("/other"));
    expect(screen.getByText("Other page")).toBeInTheDocument();
    await act(async () => pending.resolve(ownerTrip(uuid(3), "Trip")));
    expect(location()).toHaveTextContent("/other");
  });
});

describe("structure and announcements", () => {
  it("has one status region, a labelled form, and a labelled list", async () => {
    list.mockResolvedValue(pageOf([item(1)]));
    renderPage();
    await screen.findByRole("link", { name: "Trip 1" });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 3, name: "Your trips" })).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute("type", "text");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
