import { createHash, createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router, type Express, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { auth } from "../src/auth/auth.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/db/prisma.js";
import { createTripsRateLimiter } from "../src/trips/rate-limit.js";
import { createTripsRouter } from "../src/trips/router.js";
import { createSharedTripsRouter } from "../src/trips/shared-router.js";
import { PUBLIC_ENDPOINT_ALLOWLIST } from "./helpers/public-api-routes.js";
import { anonymous, asUser, createTwoUsers, type TestUser } from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M05-T03 Increment 6 — consolidated security regression for the whole trips
 * API (spec v1.1 §§4, 5.4, 6.4, 7, 7.1–7.3, 9; ADR-012; ADR-014): matrix
 * sweeps over ALL ten owner endpoints and the public shared-trip endpoint
 * (authentication, origin, ownership, strict validation, headers), a
 * disclosure scan of every response body produced by a full lifecycle,
 * landmark-state and sharing-flag transitions on one trip, and a static scan
 * that no trips source file logs request data. The per-feature suites
 * (trips.integration, trips-sharing.integration, trips-stops.integration)
 * hold the detailed contract tests; this file proves the properties hold
 * uniformly across every route. Every test ends with the guarded
 * resetTestDatabase().
 */

const NO_STORE = "private, no-store";
const NOT_FOUND = JSON.stringify({ error: { code: "NOT_FOUND", message: "Resource not found." } });
const UNAUTHENTICATED = JSON.stringify({
  error: { code: "UNAUTHENTICATED", message: "Authentication required." },
});
const INVALID_ORIGIN = JSON.stringify({
  error: { code: "INVALID_ORIGIN", message: "Request origin not allowed." },
});
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const SHARE_URL = /\/shared\/trips\/([A-Za-z0-9_-]{43})$/;

type Method = "get" | "post" | "put" | "patch" | "delete";

let sequence = 0;
async function createLandmark(latitude?: number, longitude?: number): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `TSE${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNARCHES",
      category: "ARCH",
      displayName: `Security Arch ${sequence}`,
      latitude: latitude ?? 35.3 + (sequence % 40) / 100,
      longitude: longitude ?? -84.7 + (sequence % 40) / 100,
      sourceDescription: "restricted description",
      sourceAccessLabel: "restricted access",
      sourceUrl: "https://example.com/restricted",
      sensitivityStatus: "PUBLIC",
      isActive: true,
    },
  });
  return landmark.id;
}

interface Fixture {
  owner: TestUser;
  other: TestUser;
  tripId: string;
  stopIds: string[];
  landmarkIds: string[];
  freshLandmarkId: string;
  version: number;
}

/** A trip of `owner` with three stops, plus a second user. */
async function fixture(app: Express): Promise<Fixture> {
  const [owner, other] = await createTwoUsers(app);
  const created = await asUser(app, owner).post("/api/v1/trips").send({ name: "Guarded" });
  expect(created.status).toBe(201);
  const tripId = created.body.trip.id as string;
  const landmarkIds = [await createLandmark(), await createLandmark(), await createLandmark()];
  const stopIds: string[] = [];
  for (const landmarkId of landmarkIds) {
    const added = await asUser(app, owner)
      .post(`/api/v1/trips/${tripId}/stops`)
      .send({ landmark_id: landmarkId });
    expect(added.status).toBe(201);
    stopIds.push(added.body.stop.id);
  }
  return {
    owner,
    other,
    tripId,
    stopIds,
    landmarkIds,
    freshLandmarkId: await createLandmark(),
    version: 3,
  };
}

interface Endpoint {
  label: string;
  method: Method;
  path: (tripId: string, stopId: string) => string;
  body?: (f: Fixture) => object;
  /** Whether the request changes state (subject to the origin check). */
  write: boolean;
}

/** All ten owner endpoints, each with a VALID body for the fixture trip. */
const OWNER_ENDPOINTS: Endpoint[] = [
  { label: "list", method: "get", path: () => "/api/v1/trips", write: false },
  {
    label: "create",
    method: "post",
    path: () => "/api/v1/trips",
    body: () => ({ name: "New" }),
    write: true,
  },
  { label: "detail", method: "get", path: (t) => `/api/v1/trips/${t}`, write: false },
  {
    label: "rename",
    method: "patch",
    path: (t) => `/api/v1/trips/${t}`,
    body: (f) => ({ name: "Renamed", version: f.version }),
    write: true,
  },
  { label: "delete", method: "delete", path: (t) => `/api/v1/trips/${t}`, write: true },
  {
    label: "add stop",
    method: "post",
    path: (t) => `/api/v1/trips/${t}/stops`,
    body: (f) => ({ landmark_id: f.freshLandmarkId }),
    write: true,
  },
  {
    label: "remove stop",
    method: "delete",
    path: (t, s) => `/api/v1/trips/${t}/stops/${s}`,
    write: true,
  },
  {
    label: "reorder",
    method: "put",
    path: (t) => `/api/v1/trips/${t}/stops/order`,
    body: (f) => ({ stop_ids: [...f.stopIds].reverse(), version: f.version }),
    write: true,
  },
  {
    label: "enable sharing",
    method: "post",
    path: (t) => `/api/v1/trips/${t}/share`,
    write: true,
  },
  {
    label: "revoke sharing",
    method: "delete",
    path: (t) => `/api/v1/trips/${t}/share`,
    write: true,
  },
];

/** The fixture trip's full stored state, to prove a refused request changed nothing. */
async function snapshot(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { name: true, version: true, shareTokenHash: true, updatedAt: true },
  });
  const stops = await prisma.tripStop.findMany({
    where: { tripId },
    orderBy: { position: "asc" },
    select: { id: true, landmarkId: true, position: true },
  });
  return JSON.stringify({ trip, stops, trips: await prisma.trip.count() });
}

function send(
  app: Express,
  endpoint: Endpoint,
  f: Fixture,
  options: { cookie?: string; origin?: string | null; tripId?: string; stopId?: string } = {},
) {
  const url = endpoint.path(options.tripId ?? f.tripId, options.stopId ?? f.stopIds[0]!);
  let pending = request(app)[endpoint.method](url);
  if (options.origin !== null)
    pending = pending.set("Origin", options.origin ?? "http://localhost:3000");
  if (options.cookie) pending = pending.set("Cookie", options.cookie);
  return endpoint.body ? pending.send(endpoint.body(f)) : pending.send();
}

function forgedCookie(): string {
  const value = "ForgedTokenNotInTheDatabase0000";
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(value)
    .digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${value}.${signature}`)}`;
}

/** The real routers on a test-only app with the sharing setting chosen by the test. */
function appWithSharing(
  sharingEnabled: boolean,
  limits?: { read: number; mutation: number },
): Express {
  const app = express();
  mountBetterAuth(app, auth);
  app.use(express.json());
  const api = Router();
  api.use(createSharedTripsRouter({ sharingEnabled }));
  mountProtected(
    api,
    "/trips",
    createTripsRouter({
      sharingEnabled,
      ...(limits ? { limiter: createTripsRateLimiter({ limits }) } : {}),
    }),
  );
  app.use("/api/v1", requireTrustedOrigin, api);
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json(JSON.parse(NOT_FOUND));
  });
  return app;
}

describe("trips security regression (integration, M05-T03 Increment 6)", () => {
  const app = createApp();

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  it("authentication: all ten owner endpoints answer the identical 401 (no-store) to missing and forged sessions, before validation; nothing changes", async () => {
    const f = await fixture(app);
    const before = await snapshot(f.tripId);
    let count = 0;
    for (const endpoint of OWNER_ENDPOINTS) {
      for (const cookie of [undefined, forgedCookie()]) {
        for (const tripId of [f.tripId, "not-a-uuid"]) {
          const response = await send(app, endpoint, f, { cookie, tripId });
          expect(response.status, `${endpoint.label} ${tripId}`).toBe(401);
          expect(response.text).toBe(UNAUTHENTICATED);
          expect(response.headers["cache-control"]).toBe(NO_STORE);
          count += 1;
        }
      }
    }
    expect(count).toBe(40);
    expect(await snapshot(f.tripId)).toBe(before);
  });

  it("origin/CSRF: every owner write is 403 INVALID_ORIGIN with a missing, foreign, or null Origin — even with the owner's valid session; reads are unaffected", async () => {
    const f = await fixture(app);
    const before = await snapshot(f.tripId);
    const writes = OWNER_ENDPOINTS.filter((e) => e.write);
    expect(writes).toHaveLength(8);
    for (const endpoint of writes) {
      for (const origin of [null, "https://evil.example", "null", "http://localhost:3000.evil"]) {
        const response = await send(app, endpoint, f, { cookie: f.owner.cookie, origin });
        expect(response.status, `${endpoint.label} ${origin}`).toBe(403);
        expect(response.text).toBe(INVALID_ORIGIN);
        expect(response.headers["cache-control"]).toBe(NO_STORE);
      }
    }
    expect(await snapshot(f.tripId)).toBe(before);
    for (const endpoint of OWNER_ENDPOINTS.filter((e) => !e.write)) {
      const response = await send(app, endpoint, f, { cookie: f.owner.cookie, origin: null });
      expect(response.status, endpoint.label).toBe(200);
    }
  });

  it("ownership: every trip-scoped endpoint gives another user the same 404 as a missing trip or stop — body, length, and headers; nothing changes", async () => {
    const f = await fixture(app);
    const before = await snapshot(f.tripId);
    const scoped = OWNER_ENDPOINTS.filter((e) => e.path(f.tripId, "s") !== "/api/v1/trips");
    expect(scoped).toHaveLength(8);
    for (const endpoint of scoped) {
      const foreign = await send(app, endpoint, f, { cookie: f.other.cookie });
      const missing = await send(app, endpoint, f, { cookie: f.other.cookie, tripId: UNKNOWN_ID });
      for (const response of [foreign, missing]) {
        expect(response.status, endpoint.label).toBe(404);
        expect(response.text).toBe(NOT_FOUND);
        expect(response.headers["cache-control"]).toBe(NO_STORE);
      }
      expect(foreign.headers["content-length"]).toBe(missing.headers["content-length"]);
    }
    expect(await snapshot(f.tripId)).toBe(before);
    // The other user's own list and a probe by stop ID under their own trip reveal nothing either.
    const ownTrip = await asUser(app, f.other).post("/api/v1/trips").send({ name: "Mine" });
    const probe = await asUser(app, f.other).delete(
      `/api/v1/trips/${ownTrip.body.trip.id}/stops/${f.stopIds[0]}`,
    );
    expect(probe.text).toBe(NOT_FOUND);
    const list = await asUser(app, f.other).get("/api/v1/trips");
    expect(list.text).not.toContain(f.tripId);
    expect(list.text).not.toContain("Guarded");
  });

  it("strict validation: hostile path IDs are 400 on every trip-scoped endpoint and never reach the database; unknown fields and query parameters are 400; nothing echoes input", async () => {
    // ~80 requests from one user: the real routers on a test-only app whose fresh limiter
    // allows them all (the 60/120 limits themselves are tested in trips.integration).
    const app = appWithSharing(true, { read: 1_000, mutation: 1_000 });
    const f = await fixture(app);
    const before = await snapshot(f.tripId);
    const hostile = [
      "1 OR 1=1",
      "'; DROP TABLE trips; --",
      "..%2F..%2Fetc%2Fpasswd",
      `${f.tripId}x`,
      "%00",
      "x".repeat(300),
    ];
    const scoped = OWNER_ENDPOINTS.filter((e) => e.path(f.tripId, "s") !== "/api/v1/trips");
    for (const endpoint of scoped) {
      for (const id of hostile) {
        const response = await send(app, endpoint, f, {
          cookie: f.owner.cookie,
          tripId: encodeURIComponent(id),
        });
        expect(response.status, `${endpoint.label} ${id}`).toBe(400);
        expect(response.body.error.code).toBe("INVALID_REQUEST");
        expect(response.text).not.toContain("DROP");
        expect(response.text).not.toContain("passwd");
        expect(response.headers["cache-control"]).toBe(NO_STORE);
      }
      const query = await request(app)
        [endpoint.method](`${endpoint.path(f.tripId, f.stopIds[0]!)}?user_id=${f.other.userId}`)
        .set("Origin", "http://localhost:3000")
        .set("Cookie", f.owner.cookie)
        .send(endpoint.body ? endpoint.body(f) : undefined);
      expect(query.status, `${endpoint.label} query`).toBe(400);
      expect(query.body.error.code).toBe("INVALID_QUERY");
      expect(query.text).not.toContain(f.other.userId);
    }
    for (const endpoint of OWNER_ENDPOINTS.filter((e) => e.write)) {
      const pending = request(app)
        [endpoint.method](endpoint.path(f.tripId, f.stopIds[0]!))
        .set("Origin", "http://localhost:3000")
        .set("Cookie", f.owner.cookie);
      const response = await pending.send({
        ...(endpoint.body ? endpoint.body(f) : {}),
        user_id: f.other.userId,
      });
      expect(response.status, `${endpoint.label} identity field`).toBe(400);
      expect(response.body.error.code).toBe("INVALID_REQUEST");
      expect(response.text).not.toContain(f.other.userId);
    }
    expect(await snapshot(f.tripId)).toBe(before);
  });

  it("public surface: the shared-trip GET is the only public trips route; no write method is publicly reachable anywhere under /api/v1/trips or /api/v1/shared", async () => {
    const tripsEntries = PUBLIC_ENDPOINT_ALLOWLIST.filter(
      (e) => e.path.includes("trips") || e.path.includes("shared"),
    );
    expect(tripsEntries).toEqual([
      expect.objectContaining({
        kind: "application",
        methods: ["get"],
        path: "/api/v1/shared/trips/:shareToken",
      }),
    ]);
    const f = await fixture(app);
    const share = await asUser(app, f.owner).post(`/api/v1/trips/${f.tripId}/share`).send();
    const token = SHARE_URL.exec(share.body.share_url)![1]!;
    const before = await snapshot(f.tripId);
    for (const method of ["post", "put", "patch", "delete"] as const) {
      const response = await anonymous(app)[method](`/api/v1/shared/trips/${token}`).send({});
      expect(response.status, method).toBe(404);
      expect(response.text).toBe(NOT_FOUND);
    }
    for (const endpoint of OWNER_ENDPOINTS.filter((e) => e.write)) {
      const response = await send(app, endpoint, f);
      expect(response.status, endpoint.label).toBe(401);
    }
    expect(await snapshot(f.tripId)).toBe(before);
  });

  it("disclosure: across a full lifecycle, no response leaks identity or secrets; the public view carries only name, stops, and distance_summary", async () => {
    const f = await fixture(app);
    const bodies: { label: string; text: string; isPublic: boolean }[] = [];
    const record = (label: string, response: request.Response, isPublic = false) => {
      bodies.push({ label, text: response.text, isPublic });
      return response;
    };
    const as = asUser(app, f.owner);
    record("detail", await as.get(`/api/v1/trips/${f.tripId}`));
    record("list", await as.get("/api/v1/trips"));
    const share1 = await as.post(`/api/v1/trips/${f.tripId}/share`).send();
    const token1 = SHARE_URL.exec(share1.body.share_url)![1]!;
    record("public 1", await anonymous(app).get(`/api/v1/shared/trips/${token1}`), true);
    const share2 = await as.post(`/api/v1/trips/${f.tripId}/share`).send();
    const token2 = SHARE_URL.exec(share2.body.share_url)![1]!;
    record("public old", await anonymous(app).get(`/api/v1/shared/trips/${token1}`), true);
    record("public 2", await asUser(app, f.other).get(`/api/v1/shared/trips/${token2}`), true);
    const current = await prisma.trip.findUniqueOrThrow({ where: { id: f.tripId } });
    record(
      "reorder",
      await as
        .put(`/api/v1/trips/${f.tripId}/stops/order`)
        .send({ stop_ids: [...f.stopIds].reverse(), version: current.version }),
    );
    record("rename", await as.patch(`/api/v1/trips/${f.tripId}`).send({ name: "Still Guarded" }));
    record(
      "add",
      await as.post(`/api/v1/trips/${f.tripId}/stops`).send({ landmark_id: f.freshLandmarkId }),
    );
    record("detail shared", await as.get(`/api/v1/trips/${f.tripId}`));
    record("list shared", await as.get("/api/v1/trips"));
    record("public 3", await anonymous(app).get(`/api/v1/shared/trips/${token2}`), true);
    record("revoke", await as.delete(`/api/v1/trips/${f.tripId}/share`));
    record("public revoked", await anonymous(app).get(`/api/v1/shared/trips/${token2}`), true);

    const hashes = [sha256(token1), sha256(token2)];
    for (const { label, text, isPublic } of bodies) {
      for (const secret of [
        f.owner.userId,
        f.owner.email,
        f.other.userId,
        f.other.email,
        token1,
        token2,
        ...hashes,
        "share_token",
        "user_id",
        "restricted",
        "source_",
      ]) {
        expect(text, `${label}: ${secret}`).not.toContain(secret);
      }
      if (isPublic) {
        for (const forbidden of [
          f.tripId,
          "version",
          "created_at",
          "updated_at",
          "is_shared",
          "sharing_enabled",
          '"id":"' + f.tripId,
        ]) {
          expect(text, `${label}: ${forbidden}`).not.toContain(forbidden);
        }
        if (text.startsWith('{"trip"')) {
          expect(Object.keys(JSON.parse(text).trip)).toEqual(["name", "stops", "distance_summary"]);
        }
      }
    }
    // Only the two enable responses ever carried a raw token, each only inside share_url.
    expect(Object.keys(share1.body)).toEqual(["share_url"]);
    expect(Object.keys(share2.body)).toEqual(["share_url"]);
  });

  it("landmark-state transitions: owner and shared views redact identically after retirement and sensitivity changes, and restore on reactivation", async () => {
    const f = await fixture(app);
    const share = await asUser(app, f.owner).post(`/api/v1/trips/${f.tripId}/share`).send();
    const token = SHARE_URL.exec(share.body.share_url)![1]!;
    const middle = f.landmarkIds[1]!;
    const states: [
      string,
      { sensitivityStatus?: "PUBLIC" | "SENSITIVE" | "UNREVIEWED"; isActive?: boolean },
      boolean,
    ][] = [
      ["PUBLIC", {}, true],
      ["SENSITIVE", { sensitivityStatus: "SENSITIVE" }, false],
      ["UNREVIEWED", { sensitivityStatus: "UNREVIEWED" }, false],
      ["PUBLIC again", { sensitivityStatus: "PUBLIC" }, true],
      ["retired", { isActive: false }, false],
      ["retired SENSITIVE", { sensitivityStatus: "SENSITIVE" }, false],
      ["reactivated PUBLIC", { sensitivityStatus: "PUBLIC", isActive: true }, true],
    ];
    for (const [label, change, available] of states) {
      if (Object.keys(change).length > 0) {
        await prisma.landmark.update({ where: { id: middle }, data: change });
      }
      const owner = (await asUser(app, f.owner).get(`/api/v1/trips/${f.tripId}`)).body.trip;
      const shared = await anonymous(app).get(`/api/v1/shared/trips/${token}`);
      expect(shared.status, label).toBe(200);
      expect(shared.body.trip.stops, label).toEqual(owner.stops);
      expect(shared.body.trip.distance_summary, label).toEqual(owner.distance_summary);
      const stop = owner.stops[1];
      expect(stop.id, label).toBe(f.stopIds[1]);
      expect(stop.is_available, label).toBe(available);
      if (available) {
        expect(owner.distance_summary, label).toMatchObject({ measured_legs: 2, total_legs: 2 });
      } else {
        expect(stop, label).toEqual({
          id: f.stopIds[1],
          position: 1,
          is_available: false,
          distance_from_previous_miles: null,
          landmark: { id: middle, is_available: false },
        });
        expect(owner.stops[2].distance_from_previous_miles, label).toBeNull();
        expect(owner.distance_summary, label).toEqual({
          total_miles: null,
          measured_legs: 0,
          total_legs: 2,
        });
        const row = await prisma.landmark.findUniqueOrThrow({ where: { id: middle } });
        expect(shared.text, label).not.toContain(`"${row.displayName}"`);
        expect(shared.text, label).not.toContain(`"latitude":${row.latitude},`);
      }
    }
  });

  it("sharing transitions: enable → rotate → flag off → flag on → revoke → re-enable → delete, with the link valid exactly when expected", async () => {
    const on = appWithSharing(true);
    const off = appWithSharing(false);
    const f = await fixture(on);
    const read = async (target: Express, token: string) =>
      (await anonymous(target).get(`/api/v1/shared/trips/${token}`)).status;
    const enable = async (target: Express) =>
      asUser(target, f.owner).post(`/api/v1/trips/${f.tripId}/share`).send();
    const version = async () =>
      (await prisma.trip.findUniqueOrThrow({ where: { id: f.tripId } })).version;

    const first = SHARE_URL.exec((await enable(on)).body.share_url)![1]!;
    expect(await read(on, first)).toBe(200);
    const second = SHARE_URL.exec((await enable(on)).body.share_url)![1]!;
    expect([await read(on, first), await read(on, second)]).toEqual([404, 200]);
    expect(await version()).toBe(5);

    // Flag off: the link is hidden (not revoked); enabling is refused; the owner sees sharing_enabled false.
    expect(await read(off, second)).toBe(404);
    const refused = await enable(off);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("TRIP_SHARING_UNAVAILABLE");
    expect(await version()).toBe(5);
    const ownerOff = await asUser(off, f.owner).get(`/api/v1/trips/${f.tripId}`);
    expect(ownerOff.body.trip).toMatchObject({ is_shared: true, sharing_enabled: false });

    // Flag on again: the unrevoked link works again (documented behaviour).
    expect(await read(on, second)).toBe(200);

    // Revoke while off is allowed and is permanent.
    const revoke = await asUser(off, f.owner).delete(`/api/v1/trips/${f.tripId}/share`);
    expect(revoke.status).toBe(204);
    expect([await read(on, second), await read(off, second)]).toEqual([404, 404]);
    expect(await version()).toBe(6);

    const third = SHARE_URL.exec((await enable(on)).body.share_url)![1]!;
    expect(await read(on, third)).toBe(200);
    expect((await asUser(on, f.owner).delete(`/api/v1/trips/${f.tripId}`)).status).toBe(204);
    expect(await read(on, third)).toBe(404);
    expect(env.trips.sharingEnabled).toBe(true); // the test environment default; production defaults to off
  });

  it("no trips source file logs request data: the only log call is the shared router's event code plus error class name", () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/trips");
    const findings: string[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const match of source.matchAll(/\b(console\.\w+|safeAuthLog)\s*\(/g)) {
        findings.push(`${file}: ${match[1]}`);
      }
    }
    expect(findings).toEqual(["shared-router.ts: safeAuthLog"]);
    const shared = readFileSync(path.join(dir, "shared-router.ts"), "utf8");
    expect(shared).toMatch(
      /safeAuthLog\("error", SHARED_TRIP_FAILURE_EVENT, \{\s*code: err instanceof Error \? err\.name : typeof err,\s*\}\)/,
    );
  });
});
