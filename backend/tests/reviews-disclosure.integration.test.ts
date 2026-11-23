import { randomUUID } from "node:crypto";
import express, { Router, type Express, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { auth } from "../src/auth/auth.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { prisma } from "../src/db/prisma.js";
import { createPublicReviewsRouter } from "../src/reviews/public-router.js";
import { createReviewsRateLimiter } from "../src/reviews/rate-limit.js";
import { createReviewsRouter } from "../src/reviews/router.js";
import * as reviewsService from "../src/reviews/service.js";
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  anonymous,
  createSignedInUser,
  sessionCookieFrom,
  type RequestBuilder,
  type TestUser,
} from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M04-T04 Increment 3 — authorization and information-disclosure regression
 * (spec v1.1 sections 3, 6, 7; ADR-012 decisions 2-5, 7, 8; ADR-013 visibility
 * matrix; spec section 9 tests #1, #6, #9, #11, #13, #15). Verification only:
 * every expectation records the behaviour of the UNCHANGED application.
 *
 * A table-driven matrix crosses the five review endpoints with four callers
 * (anonymous, owner, other user, the owner's EXPIRED session), five landmark
 * states (PUBLIC, retired, SENSITIVE, UNREVIEWED, missing), and three review
 * targets (the caller's own, another user's, a nonexistent ID). Responses are
 * compared on SECURITY-RELEVANT properties (status, exact body bytes, and a
 * fixed set of headers) — never on dynamic headers such as Date.
 *
 * Application logs (every console method, which the sanitized logger writes
 * to) are captured for the whole file and checked for review text, emails,
 * user and review IDs, landmark metadata, and internal detail.
 */

const UNAUTHENTICATED = '{"error":{"code":"UNAUTHENTICATED","message":"Authentication required."}}';
const NOT_FOUND = '{"error":{"code":"NOT_FOUND","message":"Resource not found."}}';
const INVALID_ORIGIN_CODE = "INVALID_ORIGIN";
const NO_STORE = "private, no-store";
const REVIEW_KEYS = ["author_label", "body", "created_at", "id", "rating", "updated_at"];
const LIST_KEYS = ["aggregate", "has_more", "limit", "page", "reviews"];

/** Headers that matter for disclosure; dynamic ones (Date, ETag, Connection) are excluded. */
const SECURITY_HEADERS = [
  "cache-control",
  "content-type",
  "content-length",
  "set-cookie",
  "vary",
  "retry-after",
  "www-authenticate",
  "access-control-allow-origin",
];
const DYNAMIC_HEADERS = new Set(["date", "etag", "connection", "keep-alive"]);

interface Observed {
  status: number;
  body: string;
  headers: Record<string, string | undefined>;
  headerNames: string[];
}

function observe(response: request.Response): Observed {
  const headers: Record<string, string | undefined> = {};
  for (const name of SECURITY_HEADERS) {
    const value = response.headers[name] as string | string[] | undefined;
    headers[name] = Array.isArray(value) ? value.join("; ") : value;
  }
  return {
    status: response.status,
    body: response.text,
    headers,
    headerNames: Object.keys(response.headers)
      .filter((name) => !DYNAMIC_HEADERS.has(name))
      .sort(),
  };
}

type State = "PUBLIC" | "retired" | "SENSITIVE" | "UNREVIEWED" | "missing";
const STATES: State[] = ["PUBLIC", "retired", "SENSITIVE", "UNREVIEWED", "missing"];
const NON_VISIBLE: State[] = ["retired", "SENSITIVE", "UNREVIEWED", "missing"];

type CallerName = "anonymous" | "owner" | "other" | "expired";
const CALLERS: CallerName[] = ["anonymous", "owner", "other", "expired"];

interface World {
  state: State;
  landmarkId: string;
  owner: TestUser;
  other: TestUser;
  expiredCookie: string;
  /** Review IDs by author; null when the landmark is missing (no review can exist). */
  ownerReviewId: string | null;
  otherReviewId: string | null;
  ownerText: string;
  otherText: string;
  /** Strings that must never appear in any response or log line. */
  landmarkSecrets: string[];
}

let sequence = 0;

/** Signs the user in again and expires ONLY that new session; returns its cookie. */
async function expiredSessionCookie(app: Express, user: TestUser): Promise<string> {
  const signIn = await anonymous(app)
    .post("/api/auth/sign-in/email")
    .send({ email: user.email, password: TEST_PASSWORD });
  const cookie = sessionCookieFrom(signIn.headers["set-cookie"] as unknown as string[]);
  if (cookie === null) throw new Error("no session cookie");
  const token = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)).split(".")[0]!;
  const updated = await prisma.session.updateMany({
    where: { token },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  expect(updated.count).toBe(1);
  return cookie;
}

async function buildWorld(app: Express, state: State): Promise<World> {
  sequence += 1;
  const tag = randomUUID().slice(0, 8);
  const owner = await createSignedInUser(app, `owner-${state}`);
  const other = await createSignedInUser(app, `other-${state}`);
  const ownerText = `owner private words ${tag}`;
  const otherText = `other private words ${tag}`;
  const name = `Secret Hollow ${tag}`;
  const description = `restricted description ${tag}`;
  const sourceCode = `DIS${String(sequence % 1000).padStart(3, "0")}`;
  const latitude = 35.0 + (sequence % 1000) / 1e4 + 0.000137;
  const longitude = -85.0 - (sequence % 1000) / 1e4 - 0.000251;
  const landmarkSecrets = [name, description, sourceCode, String(latitude), String(longitude)];

  if (state === "missing") {
    return {
      state,
      landmarkId: randomUUID(),
      owner,
      other,
      expiredCookie: await expiredSessionCookie(app, owner),
      ownerReviewId: null,
      otherReviewId: null,
      ownerText,
      otherText,
      landmarkSecrets,
    };
  }

  const landmark = await prisma.landmark.create({
    data: {
      sourceCode,
      sourceFile: "TNSINKS",
      category: "SINK",
      displayName: name,
      latitude,
      longitude,
      sourceDescription: description,
      sensitivityStatus: "PUBLIC",
    },
  });
  const create = async (user: TestUser, body: string) => {
    const response = await caller(app, user.cookie)
      .post("/api/v1/reviews")
      .send({ landmark_id: landmark.id, rating: 4, body });
    expect(response.status).toBe(201);
    return response.body.id as string;
  };
  const ownerReviewId = await create(owner, ownerText);
  const otherReviewId = await create(other, otherText);
  // Reclassify or retire AFTER the reviews exist (the ADR-013 visibility matrix).
  if (state === "retired") {
    await prisma.landmark.update({ where: { id: landmark.id }, data: { isActive: false } });
  } else if (state === "SENSITIVE" || state === "UNREVIEWED") {
    await prisma.landmark.update({
      where: { id: landmark.id },
      data: { sensitivityStatus: state },
    });
  }
  return {
    state,
    landmarkId: landmark.id,
    owner,
    other,
    expiredCookie: await expiredSessionCookie(app, owner),
    ownerReviewId,
    otherReviewId,
    ownerText,
    otherText,
    landmarkSecrets,
  };
}

/** Requests with the trusted Origin and, optionally, a session cookie. */
function caller(app: Express, cookie?: string): RequestBuilder {
  const make = (method: "get" | "post" | "put" | "patch" | "delete") => (path: string) => {
    const pending = request(app)[method](path).set("Origin", TEST_ORIGIN);
    return cookie ? pending.set("Cookie", cookie) : pending;
  };
  return {
    get: make("get"),
    post: make("post"),
    put: make("put"),
    patch: make("patch"),
    delete: make("delete"),
  };
}

function as(app: Express, world: World, name: CallerName): RequestBuilder {
  switch (name) {
    case "anonymous":
      return caller(app);
    case "owner":
      return caller(app, world.owner.cookie);
    case "other":
      return caller(app, world.other.cookie);
    case "expired":
      return caller(app, world.expiredCookie);
  }
}

/** The caller's own review, another user's, and an unknown ID, from the caller's point of view. */
function targets(world: World, name: CallerName): { own: string | null; others: string | null } {
  if (name === "other") return { own: world.otherReviewId, others: world.ownerReviewId };
  // The expired session belongs to the owner.
  return { own: world.ownerReviewId, others: world.otherReviewId };
}

/** Review text the caller may legitimately receive from a PROTECTED route. */
function ownText(world: World, name: CallerName): string | null {
  if (name === "owner") return world.ownerText;
  if (name === "other") return world.otherText;
  return null;
}

/** Nothing about the landmark, the accounts, or internals; only permitted review text. */
function expectNoDisclosure(
  observed: Observed,
  world: World,
  label: string,
  permittedText: (string | null)[] = [],
) {
  const forbidden = [
    ...world.landmarkSecrets,
    world.owner.email,
    world.other.email,
    world.owner.userId,
    world.other.userId,
    ...[world.ownerText, world.otherText].filter((t) => !permittedText.includes(t)),
  ];
  for (const secret of forbidden) {
    expect(observed.body.includes(secret), `${label}: leaked ${secret.slice(0, 24)}`).toBe(false);
  }
  for (const pattern of [/prisma/i, /postgres/i, /landmarks_test/, /node_modules/, /\bat \S+ \(/]) {
    expect(observed.body, label).not.toMatch(pattern);
  }
  expectNoSessionIssued(observed, label);
}

/**
 * No session value is ever issued by a reviews route. The ONLY cookie allowed
 * is Better Auth clearing an EXPIRED session cookie the client itself sent
 * (empty value, Max-Age=0) — recorded behaviour, not a disclosure.
 */
function expectNoSessionIssued(observed: Observed, label: string) {
  const setCookie = observed.headers["set-cookie"];
  if (setCookie === undefined) return;
  for (const cookie of setCookie.split(/;\s*(?=better-auth\.)/)) {
    expect(cookie, `${label}: only a clearing cookie`).toMatch(
      /^better-auth\.[\w.]+=;\s*Max-Age=0/,
    );
  }
}

/** The expired caller's response without the clearing cookie described above. */
function withoutClearingCookie(observed: Observed): Observed {
  const headers = { ...observed.headers, "set-cookie": undefined };
  return {
    ...observed,
    headers,
    headerNames: observed.headerNames.filter((name) => name !== "set-cookie"),
  };
}

/** Two responses are indistinguishable on every security-relevant property. */
function expectSame(a: Observed, b: Observed, label: string) {
  expect(a, label).toEqual(b);
}

function expectProtected(observed: Observed, label: string) {
  expect(observed.headers["cache-control"], label).toBe(NO_STORE);
}

const listPath = (id: string) => `/api/v1/landmarks/${id}/reviews`;
const lookupPath = (id: string) => `/api/v1/reviews?landmark_id=${id}`;
const reviewPath = (id: string) => `/api/v1/reviews/${id}`;

// ---------------------------------------------------------------------------
// Log capture for the whole file.
// ---------------------------------------------------------------------------
const logLines: string[] = [];
function captureLogs() {
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logLines.push(
        args.map((a) => (typeof a === "string" ? a : (JSON.stringify(a) ?? String(a)))).join(" "),
      );
    });
  }
}
function expectCleanLogs(worlds: World[], label: string) {
  for (const line of logLines) {
    for (const world of worlds) {
      for (const secret of [
        ...world.landmarkSecrets,
        world.owner.email,
        world.other.email,
        world.owner.userId,
        world.other.userId,
        world.ownerText,
        world.otherText,
        ...[world.ownerReviewId, world.otherReviewId].filter((id): id is string => id !== null),
        world.owner.cookie.split("=")[1]!,
        world.expiredCookie.split("=")[1]!,
      ]) {
        expect(line.includes(secret), `${label}: log line leaked ${secret.slice(0, 24)}`).toBe(
          false,
        );
      }
    }
    expect(line, label).not.toMatch(/\bat \S+ \(|node_modules|SELECT\s/);
  }
}

describe("reviews authorization and disclosure matrix (integration, M04-T04 Increment 3)", () => {
  const app = createApp();

  beforeEach(() => {
    logLines.length = 0;
    captureLogs();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  it.each(STATES)(
    "%s landmark: every endpoint × caller × target follows the matrix and discloses nothing",
    async (state) => {
      const world = await buildWorld(app, state);
      const visible = state === "PUBLIC";
      const cells: string[] = [];
      const record = (label: string) => cells.push(label);

      // ---- 1. Public list: identical for every caller. -----------------------
      const lists = new Map<CallerName, Observed>();
      for (const name of CALLERS) {
        const observed = observe(await as(app, world, name).get(listPath(world.landmarkId)));
        const label = `${state} list as ${name}`;
        record(label);
        expectNoDisclosure(
          observed,
          world,
          label,
          visible ? [world.ownerText, world.otherText] : [],
        );
        expect(
          observed.headers["cache-control"],
          `${label}: public, no Cache-Control`,
        ).toBeUndefined();
        if (visible) {
          expect(observed.status, label).toBe(200);
          const body = JSON.parse(observed.body) as { reviews: Record<string, unknown>[] };
          expect(Object.keys(body).sort(), label).toEqual(LIST_KEYS);
          expect(body.reviews, label).toHaveLength(2);
          for (const review of body.reviews) {
            expect(Object.keys(review).sort(), label).toEqual(REVIEW_KEYS);
            expect(review.author_label, label).toBe("Community Member");
          }
        } else {
          expect(observed.status, label).toBe(404);
          expect(observed.body, label).toBe(NOT_FOUND);
        }
        lists.set(name, observed);
      }
      for (const name of CALLERS)
        expectSame(lists.get(name)!, lists.get("anonymous")!, `${state} list: ${name} = anonymous`);

      // ---- 2. Own-review lookup. ----------------------------------------------
      const lookups = new Map<CallerName, Observed>();
      for (const name of CALLERS) {
        const observed = observe(await as(app, world, name).get(lookupPath(world.landmarkId)));
        const label = `${state} lookup as ${name}`;
        record(label);
        expectProtected(observed, label);
        expectNoDisclosure(observed, world, label, [ownText(world, name)]);
        if (name === "anonymous" || name === "expired") {
          expect(observed.status, label).toBe(401);
          expect(observed.body, label).toBe(UNAUTHENTICATED);
        } else if (visible) {
          expect(observed.status, label).toBe(200);
          const body = JSON.parse(observed.body) as { review: Record<string, unknown> };
          expect(Object.keys(body), label).toEqual(["review"]); // the approved wrapper
          expect(Object.keys(body.review).sort(), label).toEqual(REVIEW_KEYS);
          expect(body.review.id, label).toBe(targets(world, name).own);
          expect(body.review.body, label).toBe(ownText(world, name));
        } else {
          expect(observed.status, label).toBe(404);
          expect(observed.body, label).toBe(NOT_FOUND);
        }
        lookups.set(name, observed);
      }
      expect(
        lookups.get("expired")!.headers["set-cookie"],
        `${state} expired clears its cookie`,
      ).toMatch(/^better-auth\.session_token=;\s*Max-Age=0/);
      expectSame(
        withoutClearingCookie(lookups.get("expired")!),
        lookups.get("anonymous")!,
        `${state} lookup: expired = anonymous (apart from clearing its own cookie)`,
      );
      if (!visible)
        expectSame(lookups.get("other")!, lookups.get("owner")!, `${state} lookup: other = owner`);

      // ---- 3. Create on this landmark (both users already reviewed it). -------
      for (const name of CALLERS) {
        const observed = observe(
          await as(app, world, name)
            .post("/api/v1/reviews")
            .send({ landmark_id: world.landmarkId, rating: 1, body: "second attempt" }),
        );
        const label = `${state} create as ${name}`;
        record(label);
        expectProtected(observed, label);
        expectNoDisclosure(observed, world, label);
        if (name === "anonymous" || name === "expired") {
          expect(observed.body, label).toBe(UNAUTHENTICATED);
        } else if (visible) {
          expect(observed.status, label).toBe(409);
          expect(JSON.parse(observed.body).error.code, label).toBe("REVIEW_ALREADY_EXISTS");
          expect(observed.body, `${label}: no review ID`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
        } else {
          // Not 409: an existing review on a hidden landmark is never revealed.
          expect(observed.status, label).toBe(404);
          expect(observed.body, label).toBe(NOT_FOUND);
        }
      }

      // ---- 4. Edit: own, another user's, and a nonexistent review. ------------
      for (const name of CALLERS) {
        const { own, others } = targets(world, name);
        const unknown = observe(
          await as(app, world, name).patch(reviewPath(randomUUID())).send({ rating: 4 }),
        );
        const label = `${state} edit as ${name}`;
        record(`${label} (nonexistent)`);
        expectProtected(unknown, `${label} nonexistent`);
        expect(unknown.body, label).toBe(
          name === "anonymous" || name === "expired" ? UNAUTHENTICATED : NOT_FOUND,
        );
        if (others !== null) {
          record(`${label} (another user's)`);
          const observed = observe(
            await as(app, world, name).patch(reviewPath(others)).send({ rating: 1, body: "x" }),
          );
          // Another user's review is indistinguishable from a nonexistent one.
          expectSame(observed, unknown, `${label}: another user's = nonexistent`);
        }
        if (own !== null) {
          record(`${label} (own)`);
          const observed = observe(
            await as(app, world, name).patch(reviewPath(own)).send({ rating: 4 }),
          );
          expectProtected(observed, `${label} own`);
          expectNoDisclosure(observed, world, `${label} own`, [ownText(world, name)]);
          if (name === "anonymous" || name === "expired") {
            expect(observed.body, label).toBe(UNAUTHENTICATED);
          } else if (visible) {
            expect(observed.status, label).toBe(200);
            expect(Object.keys(JSON.parse(observed.body)).sort(), label).toEqual(REVIEW_KEYS);
          } else {
            // Editing is prohibited while the landmark is hidden: the same 404.
            expectSame(observed, unknown, `${label}: own on a hidden landmark = nonexistent`);
          }
        }
      }

      // ---- 5. Delete: non-owners first, then each author (the documented exception). --
      for (const name of ["anonymous", "expired", "owner", "other"] as CallerName[]) {
        const { others } = targets(world, name);
        const unknown = observe(await as(app, world, name).delete(reviewPath(randomUUID())));
        const label = `${state} delete as ${name}`;
        record(`${label} (nonexistent)`);
        expectProtected(unknown, label);
        expectNoDisclosure(unknown, world, label);
        if (others !== null) {
          record(`${label} (another user's)`);
          const observed = observe(await as(app, world, name).delete(reviewPath(others)));
          expectSame(observed, unknown, `${label}: another user's = nonexistent`);
        }
        if (name === "anonymous" || name === "expired") {
          expect(unknown.body, label).toBe(UNAUTHENTICATED);
          const { own } = targets(world, name);
          if (own !== null) {
            record(`${label} (own, signed out)`);
            const observed = observe(await as(app, world, name).delete(reviewPath(own)));
            expectSame(observed, unknown, `${label}: own while signed out = 401`);
          }
        } else {
          expect(unknown.body, label).toBe(NOT_FOUND);
        }
      }
      // Both reviews survived every refused attempt above.
      if (world.ownerReviewId !== null) {
        expect(await prisma.review.count({ where: { landmarkId: world.landmarkId } })).toBe(2);
      }
      for (const name of ["owner", "other"] as CallerName[]) {
        const { own } = targets(world, name);
        if (own === null) continue;
        const label = `${state} delete own as ${name}`;
        record(label);
        const deleted = observe(await as(app, world, name).delete(reviewPath(own)));
        // Owners may delete on ANY landmark state, and learn nothing about the landmark.
        expect(deleted.status, label).toBe(200);
        expect(deleted.body, label).toBe('{"success":true}');
        expectProtected(deleted, label);
        expectNoDisclosure(deleted, world, label);
        const again = observe(await as(app, world, name).delete(reviewPath(own)));
        const unknown = observe(await as(app, world, name).delete(reviewPath(randomUUID())));
        expectSame(again, unknown, `${label}: a repeat = nonexistent`);
      }
      if (world.ownerReviewId !== null) {
        expect(await prisma.review.count({ where: { landmarkId: world.landmarkId } })).toBe(0);
      }

      expectCleanLogs([world], state);
      // The matrix size: list 4 + lookup 4 + create 4 + edit 12 + delete 10 +
      // author deletes 2 = 36 cells; a missing landmark has no reviews: 20.
      expect(cells).toHaveLength(state === "missing" ? 20 : 36);
    },
  );

  it("hidden landmarks are indistinguishable from each other and from a missing one, for every endpoint", async () => {
    const worlds: World[] = [];
    for (const state of STATES) worlds.push(await buildWorld(app, state)); // sequential: unique source codes
    const byState = new Map(worlds.map((w) => [w.state, w]));
    const responses = new Map<State, Observed[]>();
    for (const state of NON_VISIBLE) {
      const world = byState.get(state)!;
      const owner = as(app, world, "owner");
      responses.set(state, [
        observe(await anonymous(app).get(listPath(world.landmarkId))),
        observe(await owner.get(lookupPath(world.landmarkId))),
        observe(
          await owner.post("/api/v1/reviews").send({ landmark_id: world.landmarkId, rating: 2 }),
        ),
        observe(
          await owner.patch(reviewPath(world.ownerReviewId ?? randomUUID())).send({ rating: 2 }),
        ),
      ]);
    }
    const reference = responses.get("missing")!;
    for (const state of NON_VISIBLE) {
      responses.get(state)!.forEach((observed, i) => {
        expectSame(observed, reference[i]!, `${state} endpoint ${i} = missing landmark`);
        expect(observed.body).toBe(NOT_FOUND);
      });
    }
    expectCleanLogs(worlds, "hidden equivalence");
  });

  it("400 and 403: malformed input and untrusted origins are refused before any lookup, identically for existing and unknown resources", async () => {
    const world = await buildWorld(app, "PUBLIC");
    const owner = as(app, world, "owner");
    // 400 (the session is checked first on protected routes, so anonymous gets 401).
    const malformed: [string, () => Promise<request.Response>, number, string][] = [
      ["list path", () => anonymous(app).get(listPath("not-a-uuid")), 400, "INVALID_REQUEST"],
      [
        "list query",
        () => anonymous(app).get(`${listPath(world.landmarkId)}?limit=0`),
        400,
        "INVALID_QUERY",
      ],
      ["lookup query", () => owner.get(lookupPath("not-a-uuid")), 400, "INVALID_QUERY"],
      [
        "create body",
        () => owner.post("/api/v1/reviews").send({ landmark_id: "nope", rating: 3 }),
        400,
        "INVALID_REQUEST",
      ],
      [
        "edit path",
        () => owner.patch(reviewPath("nope")).send({ rating: 3 }),
        400,
        "INVALID_REQUEST",
      ],
      ["delete path", () => owner.delete(reviewPath("nope")), 400, "INVALID_REQUEST"],
      [
        "anonymous edit path",
        () => anonymous(app).patch(reviewPath("nope")).send({ rating: 3 }),
        401,
        "UNAUTHENTICATED",
      ],
    ];
    for (const [label, run, status, code] of malformed) {
      const observed = observe(await run());
      expect(observed.status, label).toBe(status);
      expect(JSON.parse(observed.body).error.code, label).toBe(code);
      expectNoDisclosure(observed, world, label);
      if (!label.startsWith("list")) expectProtected(observed, label);
    }

    // 403: a cookie-bearing mutation without trusted origin evidence, whatever the target.
    const untrusted = (origin: string | null) => {
      const set = (pending: request.Test) => {
        const withCookie = pending.set("Cookie", world.owner.cookie);
        return origin === null ? withCookie : withCookie.set("Origin", origin);
      };
      return {
        create: () =>
          set(request(app).post("/api/v1/reviews")).send({
            landmark_id: world.landmarkId,
            rating: 1,
          }),
        editOwn: () =>
          set(request(app).patch(reviewPath(world.ownerReviewId!))).send({ rating: 1 }),
        editUnknown: () => set(request(app).patch(reviewPath(randomUUID()))).send({ rating: 1 }),
        deleteOwn: () => set(request(app).delete(reviewPath(world.ownerReviewId!))),
        deleteUnknown: () => set(request(app).delete(reviewPath(randomUUID()))),
      };
    };
    for (const origin of ["https://evil.example", "null", null]) {
      const label = `origin ${origin ?? "(absent)"}`;
      const runs = untrusted(origin);
      const observed = [
        observe(await runs.create()),
        observe(await runs.editOwn()),
        observe(await runs.editUnknown()),
        observe(await runs.deleteOwn()),
        observe(await runs.deleteUnknown()),
      ];
      for (const o of observed) {
        expect(o.status, label).toBe(403);
        expect(JSON.parse(o.body).error.code, label).toBe(INVALID_ORIGIN_CODE);
        expectProtected(o, label);
        expectNoDisclosure(o, world, label);
      }
      expectSame(observed[1]!, observed[2]!, `${label}: edit own = edit unknown`);
      expectSame(observed[3]!, observed[4]!, `${label}: delete own = delete unknown`);
    }
    expect(await prisma.review.findUnique({ where: { id: world.ownerReviewId! } })).toMatchObject({
      rating: 4,
      body: world.ownerText,
    });
    expectCleanLogs([world], "400/403");
  });

  it("the public list is byte-identical for every caller and unchanged data, and never sets a cookie", async () => {
    const world = await buildWorld(app, "PUBLIC");
    const callers: [string, RequestBuilder][] = [
      ["anonymous", caller(app)],
      ["owner", as(app, world, "owner")],
      ["other", as(app, world, "other")],
      ["expired", as(app, world, "expired")],
      ["forged cookie", caller(app, "better-auth.session_token=forged.value")],
      ["no Origin", { ...caller(app), get: (p: string) => request(app).get(p) } as RequestBuilder],
    ];
    for (const query of ["", "?page=1&limit=1", "?page=2&limit=1", "?page=3&limit=1"]) {
      const seen = await Promise.all(
        callers.map(async ([, c]) => observe(await c.get(`${listPath(world.landmarkId)}${query}`))),
      );
      seen.forEach((o, i) => expectSame(o, seen[0]!, `list${query} as ${callers[i]![0]}`));
      expect(seen[0]!.status).toBe(200);
      expect(seen[0]!.headers["set-cookie"]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Failure paths: rate limits and server errors (fixture applications with an
// injected limiter or service; the real routers and protected mount).
// ---------------------------------------------------------------------------

function fixtureApp(deps: Parameters<typeof createReviewsRouter>[0], publicDeps = {}): Express {
  const app = express();
  mountBetterAuth(app, auth);
  app.use(express.json());
  const api = Router();
  api.use(createPublicReviewsRouter(publicDeps));
  mountProtected(api, "/reviews", createReviewsRouter(deps));
  app.use("/api/v1", requireTrustedOrigin, api);
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json(JSON.parse(NOT_FOUND));
  });
  return app;
}

describe("reviews disclosure on failure paths (M04-T04 Increment 3)", () => {
  const realApp = createApp();

  beforeEach(() => {
    logLines.length = 0;
    captureLogs();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  it("429 is no-store and identical for own, another user's, and unknown reviews (the limiter runs before ownership)", async () => {
    const world = await buildWorld(realApp, "PUBLIC");
    const limited = fixtureApp({
      limiter: createReviewsRateLimiter({ limits: { read: 1, mutation: 1 } }),
    });
    const owner = caller(limited, world.owner.cookie);
    expect((await owner.get(lookupPath(world.landmarkId))).status).toBe(200);
    expect((await owner.patch(reviewPath(world.ownerReviewId!)).send({ rating: 4 })).status).toBe(
      200,
    );

    const throttled = [
      observe(await owner.get(lookupPath(world.landmarkId))),
      observe(await owner.patch(reviewPath(world.ownerReviewId!)).send({ rating: 1 })),
      observe(await owner.patch(reviewPath(world.otherReviewId!)).send({ rating: 1 })),
      observe(await owner.patch(reviewPath(randomUUID())).send({ rating: 1 })),
      observe(await owner.delete(reviewPath(world.otherReviewId!))),
      observe(await owner.delete(reviewPath(randomUUID()))),
    ];
    for (const [i, o] of throttled.entries()) {
      const label = `throttled request ${i}`;
      expect(o.status, label).toBe(429);
      expect(JSON.parse(o.body).error.code, label).toBe("RATE_LIMITED");
      expectProtected(o, label);
      expect(Number(o.headers["retry-after"]), label).toBeGreaterThanOrEqual(1);
      expectNoDisclosure(o, world, label);
    }
    // Retry-After counts down in whole seconds, so compare the mutations without it.
    const withoutRetry = (o: Observed) => ({ ...o, headers: { ...o.headers, "retry-after": "-" } });
    for (const o of throttled.slice(2))
      expectSame(withoutRetry(o), withoutRetry(throttled[1]!), "429 mutations");
    expect(await prisma.review.count({ where: { landmarkId: world.landmarkId } })).toBe(2);
    expectCleanLogs([world], "429");
  });

  it("an unexpected failure is the fixed no-store 500; the log has only an event code and error class, never the data in the error", async () => {
    const world = await buildWorld(realApp, "PUBLIC");
    const leaky = `${world.owner.email} ${world.ownerText} ${world.ownerReviewId} ${world.landmarkSecrets[0]}`;
    const failing = {
      ...reviewsService,
      getOwnReview: async () => {
        throw new TypeError(leaky);
      },
      updateReview: async () => {
        throw new Error(leaky);
      },
      deleteReview: async () => {
        throw Object.assign(new Error(leaky), { status: 500 });
      },
      createReview: async () => {
        throw new RangeError(leaky);
      },
    };
    const app = fixtureApp({ service: failing });
    const owner = caller(app, world.owner.cookie);
    const responses = [
      observe(await owner.get(lookupPath(world.landmarkId))),
      observe(
        await owner.post("/api/v1/reviews").send({ landmark_id: world.landmarkId, rating: 2 }),
      ),
      observe(await owner.patch(reviewPath(world.ownerReviewId!)).send({ rating: 2 })),
      observe(await owner.delete(reviewPath(world.ownerReviewId!))),
    ];
    for (const [i, o] of responses.entries()) {
      const label = `failure ${i}`;
      expect(o.status, label).toBe(500);
      expect(o.body, label).toBe(
        '{"error":{"code":"INTERNAL_ERROR","message":"Something went wrong. Please try again."}}',
      );
      expectProtected(o, label);
      expectNoDisclosure(o, world, label);
      expectSame(o, responses[0]!, `${label} = failure 0`);
    }
    expect(logLines.length).toBe(4);
    for (const line of logLines) {
      expect(line).toMatch(/PROTECTED_ROUTE_FAILURE/);
      expect(line).toMatch(/TypeError|RangeError|Error/);
    }
    expectCleanLogs([world], "500 logs");
  });

  it("public-list failures reach Express's default handler (existing app-wide behaviour): details outside production, status text only in production", async () => {
    const world = await buildWorld(realApp, "PUBLIC");
    const leaky = `${world.owner.email} ${world.ownerText} ${world.landmarkSecrets[0]}`;
    const failingPublic = {
      service: {
        ...reviewsService,
        listPublicReviews: async () => {
          throw new Error(leaky);
        },
      },
    };
    const development = fixtureApp({}, failingPublic);
    const response = await caller(development).get(listPath(world.landmarkId));
    expect(response.status).toBe(500);
    expect(response.headers["content-type"]).toMatch(/^text\/html/);
    // Outside production, Express's page includes the error message and stack.
    expect(response.text).toContain(world.owner.email);

    const production = fixtureApp({}, failingPublic);
    production.set("env", "production");
    const prod = observe(await caller(production).get(listPath(world.landmarkId)));
    expect(prod.status).toBe(500);
    expect(prod.body).toContain("<pre>Internal Server Error</pre>");
    expectNoDisclosure(prod, world, "production public 500");
    // Express's default handler writes nothing to the log under NODE_ENV=test.
    expectCleanLogs([world], "public 500 logs");
  });
});
