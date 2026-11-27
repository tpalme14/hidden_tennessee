import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M06-T02 Increment 4b-i — the API client's update-safety accounting. Each
 * test loads a fresh client, connectivity store, and update-safety module
 * (module reset) and controls `fetch` with deferred promises. A mutation is
 * counted from before connectivity accounting and `fetch` until its response
 * has been read and mapped, released exactly once on every path; while the
 * gate is held it is refused locally: no `fetch`, no connectivity evidence.
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function load() {
  vi.resetModules();
  const client = await import("./client");
  const { connectivity } = await import("../connectivity/connectivity");
  const { updateSafety } = await import("../pwa/updateSafety");
  return { client, connectivity, updateSafety };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const pending = (s: { getSnapshot(): { pendingRequests: number } }) =>
  s.getSnapshot().pendingRequests;

describe("mutation-request accounting", () => {
  it("is counted before fetch and connectivity accounting, and until the response body has been read", async () => {
    const { client, connectivity, updateSafety } = await load();
    const order: string[] = [];
    const begin = connectivity.beginRequest.bind(connectivity);
    vi.spyOn(connectivity, "beginRequest").mockImplementation(() => {
      order.push(`connectivity (pending ${pending(updateSafety)})`);
      return begin();
    });
    const body = deferred<unknown>();
    fetchMock.mockImplementation(() => {
      order.push(`fetch (pending ${pending(updateSafety)})`);
      return Promise.resolve({ ok: true, status: 200, json: () => body.promise } as Response);
    });
    const request = client.postJson("/api/v1/trips", { name: "x" });
    expect(pending(updateSafety)).toBe(1); // synchronously, at the call
    await Promise.resolve();
    expect(order).toEqual(["connectivity (pending 1)", "fetch (pending 1)"]);
    expect(pending(updateSafety)).toBe(1); // still parsing
    body.resolve({ trip: {} });
    await request;
    expect(pending(updateSafety)).toBe(0);
  });

  it.each<[string, (c: Awaited<ReturnType<typeof load>>["client"]) => Promise<unknown>]>([
    ["POST (postJson)", (c) => c.postJson("/api/x", {})],
    ["PUT (putJson)", (c) => c.putJson("/api/x")],
    ["PUT with body (putJsonBody)", (c) => c.putJsonBody("/api/x", {})],
    ["PATCH (patchJson)", (c) => c.patchJson("/api/x", {})],
    ["DELETE (deleteJson)", (c) => c.deleteJson("/api/x")],
  ])("counts %s", async (_label, send) => {
    const { client, updateSafety } = await load();
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const request = send(client);
    expect(pending(updateSafety)).toBe(1);
    response.resolve(json(200, {}));
    await request;
    expect(pending(updateSafety)).toBe(0);
  });

  it("counts a no-content DELETE until its 204 arrives", async () => {
    const { client, updateSafety } = await load();
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const request = client.deleteNoContent("/api/x");
    expect(pending(updateSafety)).toBe(1);
    response.resolve(new Response(null, { status: 204 }));
    await request;
    expect(pending(updateSafety)).toBe(0);
  });

  it("does not count GET requests (getJson, getPublicJson)", async () => {
    const { client, updateSafety } = await load();
    const a = deferred<Response>();
    const b = deferred<Response>();
    fetchMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const one = client.getJson("/api/x");
    const two = client.getPublicJson("/api/y");
    expect(pending(updateSafety)).toBe(0);
    a.resolve(json(200, {}));
    b.resolve(json(200, {}));
    await Promise.all([one, two]);
  });

  it.each<[string, () => unknown]>([
    ["an HTTP error", () => json(500, { error: { code: "INTERNAL_ERROR", message: "x" } })],
    ["a 4xx error", () => json(409, { error: { code: "CONFLICT", message: "x" } })],
    ["an invalid body", () => new Response("not json", { status: 200 })],
  ])("releases after %s", async (_label, make) => {
    const { client, updateSafety } = await load();
    fetchMock.mockResolvedValueOnce(make());
    await expect(client.postJson("/api/x", {})).rejects.toMatchObject({ name: "ApiError" });
    expect(pending(updateSafety)).toBe(0);
  });

  it("releases after a network failure and after an abort", async () => {
    const { client, updateSafety } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(client.postJson("/api/x", {})).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    await expect(client.deleteNoContent("/api/x")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(pending(updateSafety)).toBe(0);
  });

  it("releases after an unexpected exception inside the request path", async () => {
    const { client, connectivity, updateSafety } = await load();
    vi.spyOn(connectivity, "reportOutcome").mockImplementation(() => {
      throw new Error("unexpected");
    });
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await expect(client.patchJson("/api/x", {})).rejects.toThrow("unexpected");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(client.deleteNoContent("/api/x")).rejects.toThrow("unexpected");
    expect(pending(updateSafety)).toBe(0);
  });

  it("counts concurrent requests independently; settling one leaves the other counted", async () => {
    const { client, updateSafety } = await load();
    const a = deferred<Response>();
    const b = deferred<Response>();
    fetchMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const one = client.postJson("/api/a", {});
    const two = client.deleteJson("/api/b");
    expect(pending(updateSafety)).toBe(2);
    a.resolve(json(200, {}));
    await one;
    expect(pending(updateSafety)).toBe(1);
    expect(updateSafety.tryAcquireGate()).toEqual({ kind: "busy" });
    b.resolve(json(200, {}));
    await two;
    expect(pending(updateSafety)).toBe(0);
  });
});

describe("local refusal while the gate is held", () => {
  it("refuses every mutation with UPDATE_IN_PROGRESS: no fetch, no connectivity evidence, no leak", async () => {
    const { client, connectivity, updateSafety } = await load();
    const before = connectivity.getState();
    const beginRequest = vi.spyOn(connectivity, "beginRequest");
    const reportOutcome = vi.spyOn(connectivity, "reportOutcome");
    const result = updateSafety.tryAcquireGate();
    expect(result.kind).toBe("acquired");

    for (const send of [
      () => client.postJson("/api/x", {}),
      () => client.putJson("/api/x"),
      () => client.putJsonBody("/api/x", {}),
      () => client.patchJson("/api/x", {}),
      () => client.deleteJson("/api/x"),
      () => client.deleteNoContent("/api/x"),
    ]) {
      await expect(send()).rejects.toMatchObject({
        name: "ApiError",
        status: 0,
        code: client.UPDATE_IN_PROGRESS,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beginRequest).not.toHaveBeenCalled();
    expect(reportOutcome).not.toHaveBeenCalled();
    expect(connectivity.getState()).toEqual(before);
    expect(updateSafety.getSnapshot()).toEqual({
      pendingRequests: 0,
      operationHolds: 0,
      gateHeld: true,
      protectedCategories: [],
      protectedRevision: 0,
    });
  });

  it("GET requests still go through while the gate is held", async () => {
    const { client, updateSafety } = await load();
    updateSafety.tryAcquireGate();
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(client.getJson("/api/x")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a refused request is not queued or retried after the gate is released", async () => {
    const { client, updateSafety } = await load();
    const result = updateSafety.tryAcquireGate();
    if (result.kind !== "acquired") throw new Error("expected the gate");
    await expect(client.postJson("/api/x", {})).rejects.toMatchObject({ status: 0 });
    result.gate.release();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
