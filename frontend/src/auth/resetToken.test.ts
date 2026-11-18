import { afterEach, describe, expect, it, vi } from "vitest";
import mainSource from "../main.tsx?raw";
import { captureResetToken, clearResetToken, getResetToken } from "./resetToken";

/** M03-T03 Increment 5 — reset-token capture, URL stripping, and memory-only retention. */

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWx";

function env(url: string, state: unknown = { idx: 3 }) {
  const parsed = new URL(url, "http://localhost:3000");
  const replaceState = vi.fn();
  return {
    location: { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash },
    history: { state, replaceState },
    replaceState,
  };
}

afterEach(() => {
  clearResetToken();
  vi.restoreAllMocks();
});

describe("captureResetToken", () => {
  it("keeps the token in memory and rewrites the history entry without it, preserving history state", () => {
    const e = env(`/reset-password?token=${TOKEN}`);
    captureResetToken(e);
    expect(getResetToken()).toBe(TOKEN);
    expect(e.replaceState).toHaveBeenCalledTimes(1);
    expect(e.replaceState).toHaveBeenCalledWith({ idx: 3 }, "", "/reset-password");
  });

  it("keeps other query parameters and the fragment, removing only the token", () => {
    const e = env(`/reset-password?a=1&token=${TOKEN}&b=two#section`);
    captureResetToken(e);
    expect(e.replaceState).toHaveBeenCalledWith(
      expect.anything(),
      "",
      "/reset-password?a=1&b=two#section",
    );
    expect(getResetToken()).toBe(TOKEN);
  });

  it("decodes a percent-encoded token", () => {
    captureResetToken(env("/reset-password?token=ab%2Bcd"));
    expect(getResetToken()).toBe("ab+cd");
  });

  it("strips every copy of a repeated token parameter, keeping the first value", () => {
    const e = env(`/reset-password?token=${TOKEN}&token=second`);
    captureResetToken(e);
    expect(e.replaceState).toHaveBeenCalledWith(expect.anything(), "", "/reset-password");
    expect(getResetToken()).toBe(TOKEN);
  });

  it.each([
    ["an empty token", "/reset-password?token="],
    ["an implausibly long token", `/reset-password?token=${"x".repeat(257)}`],
  ])("strips but discards %s", (_label, url) => {
    const e = env(url);
    captureResetToken(e);
    expect(e.replaceState).toHaveBeenCalledWith(expect.anything(), "", "/reset-password");
    expect(getResetToken()).toBeNull();
  });

  it.each([
    ["another page", `/sign-in?token=${TOKEN}`],
    ["a lookalike path", `/reset-password/extra?token=${TOKEN}`],
    ["the reset page without a token", "/reset-password?error=INVALID_TOKEN"],
  ])("leaves the URL alone on %s", (_label, url) => {
    const e = env(url);
    captureResetToken(e);
    expect(e.replaceState).not.toHaveBeenCalled();
    expect(getResetToken()).toBeNull();
  });

  it("a later call without a token keeps the captured one; clearResetToken forgets it", () => {
    captureResetToken(env(`/reset-password?token=${TOKEN}`));
    captureResetToken(env("/reset-password"));
    expect(getResetToken()).toBe(TOKEN);
    clearResetToken();
    expect(getResetToken()).toBeNull();
  });

  it("never touches browser storage or cookies, and logs nothing", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const cookie = vi.spyOn(document, "cookie", "set");
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    captureResetToken(env(`/reset-password?token=${TOKEN}`));
    getResetToken();
    expect(setItem).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("uses the real window.location and history by default", () => {
    window.history.pushState({ marker: 1 }, "", `/reset-password?keep=1&token=${TOKEN}`);
    captureResetToken();
    expect(window.location.pathname + window.location.search).toBe("/reset-password?keep=1");
    expect(window.history.state).toEqual({ marker: 1 });
    expect(getResetToken()).toBe(TOKEN);
    window.history.pushState(null, "", "/");
  });
});

describe("main.tsx ordering", () => {
  it("captures the token before React creates the root or renders anything", () => {
    const code = mainSource.replace(/\/\/.*$/gm, "");
    const capture = code.indexOf("captureResetToken();");
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(code.indexOf("createRoot("));
    expect(capture).toBeLessThan(code.indexOf(".render("));
    // It is the first statement after the imports.
    const firstStatement = code
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("import "));
    expect(firstStatement).toBe("captureResetToken();");
  });
});
