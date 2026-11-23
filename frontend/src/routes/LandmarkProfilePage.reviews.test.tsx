import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LandmarkReviewsPage } from "../api/reviews";
import { WithFakeFavorites } from "../favorites/testFavorites";
import { WithAuth, authValue } from "../reviews/testAuth";
import type { LandmarkProfileStatus } from "./useLandmarkProfile";

vi.mock("./useLandmarkProfile", () => ({ useLandmarkProfile: vi.fn() }));
vi.mock("../map/LandmarkLocationMap", () => ({
  LandmarkLocationMap: () => <div data-testid="location-map" />,
}));
vi.mock("../api/reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/reviews")>()),
  listLandmarkReviews: vi.fn(),
}));

const { useLandmarkProfile } = await import("./useLandmarkProfile");
const { listLandmarkReviews } = await import("../api/reviews");
const { LandmarkProfilePage } = await import("./LandmarkProfilePage");
const profileHook = vi.mocked(useLandmarkProfile);
const list = vi.mocked(listLandmarkReviews);

/**
 * M04-T03 Increment 2 — the reviews section appears ONLY on full (active,
 * PUBLIC) profiles. Minimal (redacted), unavailable, loading, and error
 * profiles never mount it and never request reviews.
 */

const A = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const B = "4a3c9d2f-0b5e-4f70-9c8b-2d3e4f5a6b7c";

function full(id: string, name: string): LandmarkProfileStatus {
  return {
    kind: "full",
    profile: {
      id,
      display_name: name,
      category: "falls",
      latitude: 35.6,
      longitude: -83.5,
      source_description: null,
      source_access_label: null,
      source_url: null,
    },
  };
}

function reviewsPage(body: string): LandmarkReviewsPage {
  return {
    reviews: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        rating: 5,
        body,
        created_at: "2026-11-21T16:31:04.123Z",
        updated_at: "2026-11-21T16:31:04.123Z",
        author_label: "Community Member",
      },
    ],
    aggregate: { average_rating: 5, rating_count: 1 },
    page: 1,
    limit: 20,
    has_more: false,
  };
}

function renderAt(id: string) {
  return render(
    <WithAuth value={SIGNED_OUT}>
      <WithFakeFavorites>
        <MemoryRouter initialEntries={[`/landmarks/${id}`]}>
          <Routes>
            <Route path="/landmarks/:id" element={<LandmarkProfilePage />} />
          </Routes>
        </MemoryRouter>
      </WithFakeFavorites>
    </WithAuth>,
  );
}

/** Signed out: the reviews section shows only its sign-in prompt beside the public list (Increment 3). */
const SIGNED_OUT = authValue({ status: "anonymous" });

afterEach(() => {
  vi.clearAllMocks();
});

describe("LandmarkProfilePage — reviews visibility", () => {
  it("a full PUBLIC profile shows the reviews section and requests that landmark's reviews", async () => {
    profileHook.mockReturnValue([full(A, "Public Falls"), vi.fn()]);
    list.mockResolvedValue(reviewsPage("Great spot"));
    renderAt(A);
    expect(screen.getByRole("region", { name: "Reviews" })).toBeInTheDocument();
    expect(await screen.findByText("Great spot")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(A);
  });

  it.each([
    [
      "a minimal (redacted) profile",
      {
        kind: "minimal",
        profile: { id: A, display_name: "Sensitive Falls", category: "falls", redacted: true },
      },
    ],
    ["an unavailable profile", { kind: "unavailable" }],
    ["a loading profile", { kind: "loading" }],
    ["an error profile", { kind: "error", message: "Unable to load this landmark." }],
  ] as [string, LandmarkProfileStatus][])(
    "%s never renders or requests reviews",
    (_label, status) => {
      profileHook.mockReturnValue([status, vi.fn()]);
      renderAt(A);
      expect(screen.queryByRole("region", { name: "Reviews" })).not.toBeInTheDocument();
      expect(screen.queryByText(/reviews/i)).not.toBeInTheDocument();
      expect(list).not.toHaveBeenCalled();
    },
  );

  it("a full profile that becomes minimal removes the reviews section", async () => {
    profileHook.mockReturnValue([full(A, "Public Falls"), vi.fn()]);
    list.mockResolvedValue(reviewsPage("Visible before"));
    const view = renderAt(A);
    expect(await screen.findByText("Visible before")).toBeInTheDocument();

    profileHook.mockReturnValue([
      {
        kind: "minimal",
        profile: { id: A, display_name: "Public Falls", category: "falls", redacted: true },
      },
      vi.fn(),
    ]);
    view.rerender(
      <WithAuth value={SIGNED_OUT}>
        <WithFakeFavorites>
          <MemoryRouter initialEntries={[`/landmarks/${A}`]}>
            <Routes>
              <Route path="/landmarks/:id" element={<LandmarkProfilePage />} />
            </Routes>
          </MemoryRouter>
        </WithFakeFavorites>
      </WithAuth>,
    );
    expect(screen.queryByText("Visible before")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Reviews" })).not.toBeInTheDocument();
  });

  it("moving to another full profile never shows the previous landmark's reviews", async () => {
    profileHook.mockReturnValue([full(A, "First Falls"), vi.fn()]);
    list.mockResolvedValueOnce(reviewsPage("About the first"));
    const view = renderAt(A);
    expect(await screen.findByText("About the first")).toBeInTheDocument();

    let resolveB!: (page: LandmarkReviewsPage) => void;
    list.mockReturnValueOnce(new Promise((resolve) => (resolveB = resolve)));
    profileHook.mockReturnValue([full(B, "Second Falls"), vi.fn()]);
    view.rerender(
      <WithAuth value={SIGNED_OUT}>
        <WithFakeFavorites>
          <MemoryRouter initialEntries={[`/landmarks/${B}`]}>
            <Routes>
              <Route path="/landmarks/:id" element={<LandmarkProfilePage />} />
            </Routes>
          </MemoryRouter>
        </WithFakeFavorites>
      </WithAuth>,
    );
    expect(screen.queryByText("About the first")).not.toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(B);
    await act(async () => resolveB(reviewsPage("About the second")));
    expect(screen.getByText("About the second")).toBeInTheDocument();
  });

  it("places the reviews after the landmark's own content, under its heading level", async () => {
    profileHook.mockReturnValue([full(A, "Public Falls"), vi.fn()]);
    list.mockResolvedValue(reviewsPage("Ordered"));
    renderAt(A);
    const h2 = screen.getByRole("heading", { level: 2, name: "Public Falls" });
    const h3 = screen.getByRole("heading", { level: 3, name: "Reviews" });
    expect(h2.compareDocumentPosition(h3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await screen.findByText("Ordered");
  });
});
