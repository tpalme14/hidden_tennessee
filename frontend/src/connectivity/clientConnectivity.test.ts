import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M06-T02 Increment 3a — the central API client as the source of
 * connectivity evidence. Each test loads a fresh client and store (module
 * reset) and controls `fetch` with deferred promises — no timing delays. The
 * client's own contracts (errors and bodies) are asserted unchanged alongside.
 */

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function load() {
  vi.resetModules();
  const client = await import("../api/client");
  const { connectivity } = await import("./connectivity");
  const health = await import("./useConnectivity");
  return { client, connectivity, health };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request-outcome classification", () => {
  it("a successful response is reachability evidence; the body is returned unchanged", async () => {
    const { client, connectivity } = await load();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    await expect(client.getJson("/api/v1/categories")).resolves.toEqual({ items: [] });
    expect(connectivity.getState().reachability).toBe("reachable");
  });

  it.each([401, 403, 404, 429])(
    "an HTTP %i is still reachability evidence and the ApiError is unchanged",
    async (status) => {
      const { client, connectivity } = await load();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(status, { error: { code: "X_CODE", message: "msg" } }),
      );
      await expect(client.getJson("/api/x")).rejects.toMatchObject({
        name: "ApiError",
        status,
        code: "X_CODE",
      });
      expect(connectivity.getState().reachability).toBe("reachable");
    },
  );

  it.each([500, 503])("an HTTP %i is a server problem, never unreachability", async (status) => {
    const { client, connectivity } = await load();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(status, { error: { code: "SERVICE_UNAVAILABLE", message: "down" } }),
    );
    await expect(client.getJson("/api/x")).rejects.toMatchObject({ status });
    expect(connectivity.getState().reachability).toBe("server-problem");
  });

  it("an unreadable body is a server problem, not a network failure (INVALID_RESPONSE unchanged)", async () => {
    const { client, connectivity } = await load();
    fetchMock.mockResolvedValueOnce(new Response("<html>not json</html>", { status: 200 }));
    await expect(client.getJson("/api/x")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 200,
    });
    expect(connectivity.getState().reachability).toBe("server-problem");
  });

  it("a failed fetch is unreachability (NETWORK_ERROR unchanged)", async () => {
    const { client, connectivity } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(client.getJson("/api/x")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
    expect(connectivity.getState().reachability).toBe("unreachable");
  });

  it("an intentionally aborted request is no evidence (the caller still gets NETWORK_ERROR, as before)", async () => {
    const { client, connectivity } = await load();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await client.getJson("/api/first");
    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));
    await expect(client.getJson("/api/x")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(connectivity.getState().reachability).toBe("reachable");
  });

  it("no-content requests report evidence the same way", async () => {
    const { client, connectivity } = await load();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.deleteNoContent("/api/v1/trips/x");
    expect(connectivity.getState().reachability).toBe("reachable");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(client.deleteNoContent("/api/v1/trips/x")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(connectivity.getState().reachability).toBe("unreachable");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(503, { error: { code: "SERVICE_UNAVAILABLE", message: "down" } }),
    );
    await expect(client.deleteNoContent("/api/v1/trips/x")).rejects.toMatchObject({ status: 503 });
    expect(connectivity.getState().reachability).toBe("server-problem");
  });

  it("makes exactly one fetch per call: no retries and no extra requests", async () => {
    const { client } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(client.getJson("/api/x")).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("concurrent requests (controlled completion order)", () => {
  it("an older failure completing after a newer success does not override it", async () => {
    const { client, connectivity } = await load();
    const older = deferred<Response>();
    const newer = deferred<Response>();
    fetchMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const a = client.getJson("/api/a").catch(() => undefined);
    const b = client.getJson("/api/b");
    newer.resolve(jsonResponse(200, {}));
    await b;
    older.reject(new TypeError("Failed to fetch"));
    await a;
    expect(connectivity.getState().reachability).toBe("reachable");
  });

  it("an older success completing after a newer failure does not override it", async () => {
    const { client, connectivity } = await load();
    const older = deferred<Response>();
    const newer = deferred<Response>();
    fetchMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const a = client.getJson("/api/a");
    const b = client.getJson("/api/b").catch(() => undefined);
    newer.reject(new TypeError("Failed to fetch"));
    await b;
    older.resolve(jsonResponse(200, {}));
    await a;
    expect(connectivity.getState().reachability).toBe("unreachable");
  });

  it("a newer request that has started but not finished changes nothing", async () => {
    const { client, connectivity } = await load();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    void client.getJson("/api/slow").catch(() => undefined);
    expect(connectivity.getState().reachability).toBe("unknown");
  });

  it("a newer cancelled request does not suppress an older request's later evidence", async () => {
    const { client, connectivity } = await load();
    const older = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(older.promise)
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const a = client.getJson("/api/a").catch(() => undefined);
    await client.getJson("/api/b").catch(() => undefined);
    older.reject(new TypeError("Failed to fetch"));
    await a;
    expect(connectivity.getState().reachability).toBe("unreachable");
  });

  it("a request started before an online-event reset cannot restore stale evidence", async () => {
    const { client, connectivity } = await load();
    const unsubscribe = connectivity.subscribe(() => {});
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await client.getJson("/api/fail").catch(() => undefined);
    const started = deferred<Response>();
    fetchMock.mockReturnValueOnce(started.promise);
    const before = client.getJson("/api/before").catch(() => undefined);
    window.dispatchEvent(new Event("online"));
    expect(connectivity.getState().reachability).toBe("unknown");
    started.reject(new TypeError("Failed to fetch"));
    await before;
    expect(connectivity.getState().reachability).toBe("unknown");
    unsubscribe();
  });

  it("an explicit health check follows the same ordering as ordinary requests", async () => {
    const { client, connectivity, health } = await load();
    const ordinary = deferred<Response>();
    const check = deferred<Response>();
    fetchMock.mockReturnValueOnce(ordinary.promise).mockReturnValueOnce(check.promise);
    const a = client.getJson("/api/a").catch(() => undefined);
    const outcome = health.checkServerHealth();
    check.resolve(jsonResponse(200, { status: "ok" }));
    await expect(outcome).resolves.toBe("healthy");
    ordinary.reject(new TypeError("Failed to fetch")); // older than the check
    await a;
    expect(connectivity.getState().reachability).toBe("reachable");
  });
});

describe("explicit health check classification", () => {
  it.each<[string, () => Response | Promise<never>, string, string]>([
    ["200 { status: ok }", () => jsonResponse(200, { status: "ok" }), "healthy", "reachable"],
    [
      "503 { status: unavailable }",
      () => jsonResponse(503, { status: "unavailable" }),
      "unhealthy",
      "server-problem",
    ],
    [
      "another HTTP error",
      () => jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } }),
      "unhealthy",
      "reachable",
    ],
    [
      "200 with an unexpected body",
      () => jsonResponse(200, { status: "weird" }),
      "unexpected",
      "reachable",
    ],
    [
      "an unreadable body",
      () => new Response("oops", { status: 200 }),
      "unexpected",
      "server-problem",
    ],
    [
      "a network failure",
      () => Promise.reject(new TypeError("Failed to fetch")),
      "unreachable",
      "unreachable",
    ],
  ])("%s → %s", async (_label, response, expected, reachability) => {
    const { connectivity, health } = await load();
    fetchMock.mockImplementationOnce(async () => response());
    await expect(health.checkServerHealth()).resolves.toBe(expected);
    expect(connectivity.getState().reachability).toBe(reachability);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/health");
  });
});
