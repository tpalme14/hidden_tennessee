import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";

// The shell's account area checks the session (M03-T03 Increment 2); answer
// "signed out" so these routing tests never depend on a real request.
vi.mock("./api/auth", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  signOut: vi.fn(),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("App routing and layout", () => {
  it("renders the shell's semantic landmarks and skip link on the discovery route", async () => {
    renderAt("/");

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("heading", { name: /discover landmarks/i })).toBeInTheDocument();
    // The account navigation sits beside the primary navigation.
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("renders the landmark profile route directly, with no prior navigation", () => {
    renderAt("/landmarks/11111111-1111-1111-1111-111111111111");

    // The real fetch (unmocked here) hasn't resolved yet at assertion time, so
    // this is still the loading phase — see routes/LandmarkProfilePage.test.tsx
    // for full/minimal/unavailable/error content, which mocks the data hook.
    expect(screen.getByRole("heading", { name: /landmark profile/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    // The shell is still present on a direct non-home route.
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});
