import { createHmac } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import {
  TEST_ORIGIN,
  asUser,
  createSignedInUser,
  createTwoUsers,
  signOut,
  type TestUser,
} from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T05 Increment 4 — favorites security over real HTTP with two real
 * accounts (ADR-009, ADR-012 decision 10; spec §9.2 tests #3, #4, #6–#8,
 * #14): ownership isolation, identity spoofing, session handling, and
 * concurrency across users. Every test checks the HTTP response AND the
 * `favorites` rows in landmarks_test.
 *
 * Uses the real `createApp()` and the unchanged production limiter; each test
 * creates fresh users and stays far below 60 mutations per user.
 */

const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };

let sequence = 0;

async function createLandmark(name?: string): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `SNK${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNSINKS",
      category: "SINK",
      displayName: name ?? `Sink ${sequence}`,
      latitude: 35.9,
      longitude: -85.1,
      sensitivityStatus: "PUBLIC",
    },
  });
  return landmark.id;
}

const path = (landmarkId: string) => `/api/v1/favorites/${landmarkId}`;

async function rowsOf(userId: string) {
  return prisma.favorite.findMany({ where: { userId }, orderBy: { id: "asc" } });
}

async function listedIds(app: ReturnType<typeof createApp>, user: TestUser, query = "") {
  const response = await asUser(app, user).get(`/api/v1/favorites${query}`);
  expect(response.status).toBe(200);
  return (response.body.favorites as { landmark_id: string }[]).map((e) => e.landmark_id);
}

/** A validly signed session cookie value for an arbitrary token string. */
function signedCookieValue(token: string): string {
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(token)
    .digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

describe("favorites security (integration, M03-T05 Increment 4)", () => {
  const app = createApp();

  afterEach(async () => {
    await resetTestDatabase();
  });

  describe("two-user ownership and isolation (spec #6, #8)", () => {
    it("each user lists only their own favorites, on every page", async () => {
      const [a, b] = await createTwoUsers(app);
      const aOnly = [await createLandmark(), await createLandmark()];
      const bOnly = [await createLandmark(), await createLandmark(), await createLandmark()];
      const shared = await createLandmark();
      for (const id of [...aOnly, shared]) await asUser(app, a).put(path(id));
      for (const id of [...bOnly, shared]) await asUser(app, b).put(path(id));

      expect((await listedIds(app, a)).sort()).toEqual([...aOnly, shared].sort());
      expect((await listedIds(app, b)).sort()).toEqual([...bOnly, shared].sort());

      const seenByA: string[] = [];
      for (const page of ["1", "2", "3", "4", "50"]) {
        const response = await asUser(app, a).get(`/api/v1/favorites?page=${page}&limit=1`);
        expect(response.text).not.toContain(b.userId);
        for (const id of bOnly) expect(response.text).not.toContain(id);
        seenByA.push(
          ...(response.body.favorites as { landmark_id: string }[]).map((e) => e.landmark_id),
        );
      }
      expect(seenByA.sort()).toEqual([...aOnly, shared].sort());
    });

    it("both users may save the same landmark; A removing it leaves B's row unchanged", async () => {
      const [a, b] = await createTwoUsers(app);
      const shared = await createLandmark();
      expect((await asUser(app, a).put(path(shared))).status).toBe(201);
      expect((await asUser(app, b).put(path(shared))).status).toBe(201);
      const bBefore = await rowsOf(b.userId);

      expect((await asUser(app, a).delete(path(shared))).status).toBe(200);
      expect(await rowsOf(a.userId)).toEqual([]);
      expect(await rowsOf(b.userId)).toEqual(bBefore);
      expect(await listedIds(app, b)).toEqual([shared]);
    });

    it("A deleting a landmark only B saved: 200, indistinguishable from a never-saved landmark; B's row unchanged", async () => {
      const [a, b] = await createTwoUsers(app);
      const bSaved = await createLandmark();
      const nobodySaved = await createLandmark();
      await asUser(app, b).put(path(bSaved));
      const bBefore = await rowsOf(b.userId);

      const onB = await asUser(app, a).delete(path(bSaved));
      const onNobody = await asUser(app, a).delete(path(nobodySaved));
      expect(onB.status).toBe(200);
      expect(onNobody.status).toBe(200);
      expect(onB.body).toEqual({ success: true, landmark_id: bSaved });
      expect(Object.keys(onB.body)).toEqual(Object.keys(onNobody.body));
      expect(onB.headers["cache-control"]).toBe(onNobody.headers["cache-control"]);
      expect(await rowsOf(b.userId)).toEqual(bBefore);
    });

    it("repeated deletes by A never touch B's rows or expose B's data", async () => {
      const [a, b] = await createTwoUsers(app);
      const ids = [await createLandmark(), await createLandmark()];
      for (const id of ids) await asUser(app, b).put(path(id));
      const bBefore = await rowsOf(b.userId);
      for (let round = 0; round < 3; round += 1) {
        for (const id of ids) {
          const response = await asUser(app, a).delete(path(id));
          expect(response.status).toBe(200);
          expect(response.text).not.toContain(b.userId);
        }
      }
      expect(await rowsOf(b.userId)).toEqual(bBefore);
    });

    it("A adding a landmark B saved creates A's OWN row (201); B unaffected", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      await asUser(app, b).put(path(landmark));
      const bBefore = await rowsOf(b.userId);
      expect((await asUser(app, a).put(path(landmark))).status).toBe(201);
      expect((await rowsOf(a.userId)).map((r) => r.landmarkId)).toEqual([landmark]);
      expect(await rowsOf(b.userId)).toEqual(bBefore);
    });

    it("B's favorite row ID used as :landmarkId by A: PUT 404, DELETE 200, nothing changes", async () => {
      const [a, b] = await createTwoUsers(app);
      await asUser(app, b).put(path(await createLandmark()));
      const [bRow] = await rowsOf(b.userId);
      const put = await asUser(app, a).put(path(bRow!.id));
      const del = await asUser(app, a).delete(path(bRow!.id));
      expect(put.status).toBe(404);
      expect(del.status).toBe(200);
      expect(await rowsOf(b.userId)).toEqual([bRow]);
      expect(await rowsOf(a.userId)).toEqual([]);
    });
  });

  describe("identity spoofing (ADR-012 decisions 2 and 5)", () => {
    async function setup() {
      const [a, b] = await createTwoUsers(app);
      const bLandmark = await createLandmark("B private");
      await asUser(app, b).put(path(bLandmark));
      const target = await createLandmark();
      return { a, b, bLandmark, target, bBefore: await rowsOf(b.userId) };
    }

    it("identity in query parameters → 400 INVALID_QUERY on every endpoint; B untouched", async () => {
      const { a, b, target, bBefore } = await setup();
      for (const key of ["user_id", "userId"]) {
        const get = await asUser(app, a)
          .get("/api/v1/favorites")
          .query({ [key]: b.userId });
        expect(get.status).toBe(400);
        expect(get.body.error.code).toBe("INVALID_QUERY");
        for (const method of ["put", "delete"] as const) {
          const response = await asUser(app, a)
            [method](path(target))
            .query({ [key]: b.userId });
          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe("INVALID_QUERY");
        }
      }
      expect(await rowsOf(b.userId)).toEqual(bBefore);
      expect(await rowsOf(a.userId)).toEqual([]);
    });

    it("identity in the body → 400 INVALID_REQUEST; B untouched", async () => {
      const { a, b, target, bBefore } = await setup();
      for (const body of [{ user_id: b.userId }, { userId: b.userId }, { owner: b.userId }]) {
        for (const method of ["put", "delete"] as const) {
          const response = await asUser(app, a)[method](path(target)).send(body);
          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe("INVALID_REQUEST");
          expect(response.text).not.toContain(b.userId);
        }
      }
      expect(await rowsOf(b.userId)).toEqual(bBefore);
      expect(await rowsOf(a.userId)).toEqual([]);
    });

    it("identity headers are ignored: the request acts as A only", async () => {
      const { a, b, bLandmark, target, bBefore } = await setup();
      const spoof = { "X-User-Id": b.userId, "X-Forwarded-User": b.email, "X-Auth-User": b.userId };
      const get = await asUser(app, a).get("/api/v1/favorites").set(spoof);
      expect(get.status).toBe(200);
      expect(get.body.favorites).toEqual([]);
      expect(get.text).not.toContain(bLandmark);

      expect((await asUser(app, a).put(path(target)).set(spoof)).status).toBe(201);
      expect((await asUser(app, a).delete(path(bLandmark)).set(spoof)).status).toBe(200);
      expect((await rowsOf(a.userId)).map((r) => r.landmarkId)).toEqual([target]);
      expect(await rowsOf(b.userId)).toEqual(bBefore);
    });

    it("Authorization: Bearer with B's session value does not authenticate (no cookie → 401; with A's cookie → acts as A)", async () => {
      const { a, b, bLandmark, bBefore } = await setup();
      const bearer = `Bearer ${decodeURIComponent(b.cookie.slice(b.cookie.indexOf("=") + 1))}`;

      for (const [method, url] of [
        ["get", "/api/v1/favorites"],
        ["put", path(bLandmark)],
        ["delete", path(bLandmark)],
      ] as const) {
        const response = await request(app)
          [method](url)
          .set("Origin", TEST_ORIGIN)
          .set("Authorization", bearer);
        expect(response.status, method).toBe(401);
        expect(response.body).toEqual(UNAUTHENTICATED);
      }

      const withA = await asUser(app, a).get("/api/v1/favorites").set("Authorization", bearer);
      expect(withA.status).toBe(200);
      expect(withA.body.favorites).toEqual([]);
      expect(await rowsOf(b.userId)).toEqual(bBefore);
    });

    it("B's user ID as :landmarkId: PUT 404, DELETE 200; nothing changes", async () => {
      const { a, b, bBefore } = await setup();
      expect((await asUser(app, a).put(path(b.userId))).status).toBe(404);
      expect((await asUser(app, a).delete(path(b.userId))).status).toBe(200);
      expect(await rowsOf(b.userId)).toEqual(bBefore);
      expect(await rowsOf(a.userId)).toEqual([]);
    });

    it("G1: two session cookies (A's and B's) in one request, both orders — at most one identity, never combined", async () => {
      const [a, b] = await createTwoUsers(app);
      const aLandmark = await createLandmark("A private");
      const bLandmark = await createLandmark("B private");
      await asUser(app, a).put(path(aLandmark));
      await asUser(app, b).put(path(bLandmark));

      const observed: Record<string, string> = {};
      for (const [order, cookies] of [
        ["A;B", `${a.cookie}; ${b.cookie}`],
        ["B;A", `${b.cookie}; ${a.cookie}`],
      ] as const) {
        const send = (method: "get" | "put" | "delete", url: string) =>
          request(app)[method](url).set("Origin", TEST_ORIGIN).set("Cookie", cookies);

        // Which identity, if any, does the server resolve?
        const session = await send("get", "/api/auth/get-session");
        const sessionUser = (session.body as { user?: { id?: string } } | null)?.user?.id ?? null;

        const list = await send("get", "/api/v1/favorites");
        if (list.status === 401) {
          observed[order] = "rejected";
          expect(list.body).toEqual(UNAUTHENTICATED);
          expect((await send("put", path(await createLandmark()))).status).toBe(401);
          continue;
        }
        expect(list.status).toBe(200);
        const ids = (list.body.favorites as { landmark_id: string }[]).map((e) => e.landmark_id);
        // Exactly one user's favorites — never both, never a mix.
        expect([[aLandmark], [bLandmark]]).toContainEqual(ids);
        const actingAs = ids[0] === aLandmark ? a : b;
        const other = actingAs === a ? b : a;
        observed[order] = actingAs === a ? "A" : "B";
        // The session endpoint agrees with the favorites identity.
        expect(sessionUser).toBe(actingAs.userId);

        // A write lands on that same single identity only.
        const fresh = await createLandmark();
        expect((await send("put", path(fresh))).status).toBe(201);
        expect((await rowsOf(actingAs.userId)).map((r) => r.landmarkId)).toContain(fresh);
        expect((await rowsOf(other.userId)).map((r) => r.landmarkId)).not.toContain(fresh);
        expect((await send("delete", path(fresh))).status).toBe(200);
      }
      // Pinned observed behaviour (developer refinement 1: report, do not assume).
      expect(observed).toEqual(OBSERVED_MULTI_COOKIE_BEHAVIOUR);
      // Ownership intact afterwards.
      expect((await rowsOf(a.userId)).map((r) => r.landmarkId)).toEqual([aLandmark]);
      expect((await rowsOf(b.userId)).map((r) => r.landmarkId)).toEqual([bLandmark]);
    });
  });

  describe("sessions and sign-out (spec #3, #4, #14)", () => {
    it("A signing out: A's old cookie gets 401 everywhere; B's session and favorites are unaffected", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      await asUser(app, a).put(path(landmark));
      await asUser(app, b).put(path(landmark));
      await signOut(app, a);

      for (const [method, url] of [
        ["get", "/api/v1/favorites"],
        ["put", path(landmark)],
        ["delete", path(landmark)],
      ] as const) {
        const response = await asUser(app, a)[method](url);
        expect(response.status, method).toBe(401);
        expect(response.body).toEqual(UNAUTHENTICATED);
      }
      expect(await listedIds(app, b)).toEqual([landmark]);
      expect(await rowsOf(a.userId)).toHaveLength(1); // sign-out removes no data
    });

    it("favorites persist across sign-out and a new sign-in (same rows, same created_at)", async () => {
      const a = await createSignedInUser(app, "persist");
      const ids = [await createLandmark(), await createLandmark()];
      for (const id of ids) await asUser(app, a).put(path(id));
      const before = await rowsOf(a.userId);
      await signOut(app, a);

      const signIn = await request(app)
        .post("/api/auth/sign-in/email")
        .set("Origin", TEST_ORIGIN)
        .send({ email: a.email, password: "test-only-password-not-a-secret" });
      expect(signIn.status).toBe(200);
      const cookie = (signIn.headers["set-cookie"] as unknown as string[])
        .find((c) => c.startsWith("better-auth.session_token="))!
        .split(";")[0]!;
      const again: TestUser = { ...a, cookie };

      expect((await listedIds(app, again)).sort()).toEqual([...ids].sort());
      expect(await rowsOf(a.userId)).toEqual(before);
    });

    it("two sessions of one user share favorites; signing one out leaves the other working", async () => {
      const first = await createSignedInUser(app, "multi");
      const signIn = await request(app)
        .post("/api/auth/sign-in/email")
        .set("Origin", TEST_ORIGIN)
        .send({ email: first.email, password: "test-only-password-not-a-secret" });
      const second: TestUser = {
        ...first,
        cookie: (signIn.headers["set-cookie"] as unknown as string[])
          .find((c) => c.startsWith("better-auth.session_token="))!
          .split(";")[0]!,
      };
      expect(second.cookie).not.toBe(first.cookie);

      const landmark = await createLandmark();
      expect((await asUser(app, first).put(path(landmark))).status).toBe(201);
      expect((await asUser(app, second).put(path(landmark))).status).toBe(200);
      expect(await listedIds(app, second)).toEqual([landmark]);

      await signOut(app, first);
      expect((await asUser(app, first).get("/api/v1/favorites")).status).toBe(401);
      expect(await listedIds(app, second)).toEqual([landmark]);
    });

    it("a session expiring mid-sequence: 401 from then on, nothing changes; a new sign-in sees prior favorites", async () => {
      const a = await createSignedInUser(app, "expiring");
      const kept = await createLandmark();
      await asUser(app, a).put(path(kept));
      await prisma.session.updateMany({
        where: { userId: a.userId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      const late = await createLandmark();
      expect((await asUser(app, a).put(path(late))).status).toBe(401);
      expect((await asUser(app, a).delete(path(kept))).status).toBe(401);
      expect((await rowsOf(a.userId)).map((r) => r.landmarkId)).toEqual([kept]);

      const signIn = await request(app)
        .post("/api/auth/sign-in/email")
        .set("Origin", TEST_ORIGIN)
        .send({ email: a.email, password: "test-only-password-not-a-secret" });
      const cookie = (signIn.headers["set-cookie"] as unknown as string[])
        .find((c) => c.startsWith("better-auth.session_token="))!
        .split(";")[0]!;
      expect(await listedIds(app, { ...a, cookie })).toEqual([kept]);
    });

    it("a session revoked by deleting its row: 401; favorites are not cascaded", async () => {
      const a = await createSignedInUser(app, "revoked");
      const landmark = await createLandmark();
      await asUser(app, a).put(path(landmark));
      await prisma.session.deleteMany({ where: { userId: a.userId } });
      expect((await asUser(app, a).get("/api/v1/favorites")).status).toBe(401);
      expect(await rowsOf(a.userId)).toHaveLength(1);
    });

    it("a validly signed cookie for a token the database does not know → 401", async () => {
      const response = await request(app)
        .get("/api/v1/favorites")
        .set(
          "Cookie",
          `better-auth.session_token=${signedCookieValue("UnknownToken0000000000000000")}`,
        );
      expect(response.status).toBe(401);
      expect(response.body).toEqual(UNAUTHENTICATED);
    });
  });

  describe("concurrency across users (spec #7)", () => {
    it("A and B each send 10 parallel PUTs for one landmark: each gets exactly one 201; two rows", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      const responses = await Promise.all([
        ...Array.from({ length: 10 }, () =>
          asUser(app, a)
            .put(path(landmark))
            .then((r) => ({ who: "a", status: r.status })),
        ),
        ...Array.from({ length: 10 }, () =>
          asUser(app, b)
            .put(path(landmark))
            .then((r) => ({ who: "b", status: r.status })),
        ),
      ]);
      for (const who of ["a", "b"]) {
        const statuses = responses
          .filter((r) => r.who === who)
          .map((r) => r.status)
          .sort();
        expect(statuses, who).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
      }
      expect(await rowsOf(a.userId)).toHaveLength(1);
      expect(await rowsOf(b.userId)).toHaveLength(1);
    });

    it("A's DELETEs racing B's PUTs on one landmark: B ends with one row, A with none; no 5xx", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark();
      await asUser(app, a).put(path(landmark));
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          i % 2 === 0 ? asUser(app, a).delete(path(landmark)) : asUser(app, b).put(path(landmark)),
        ),
      );
      for (const r of responses) expect([200, 201]).toContain(r.status);
      expect(await rowsOf(a.userId)).toEqual([]);
      expect((await rowsOf(b.userId)).map((r) => r.landmarkId)).toEqual([landmark]);
    });

    it("lists taken during concurrent mutations by both users contain only the requester's favorites; final state correct", async () => {
      const [a, b] = await createTwoUsers(app);
      const aIds = Array.from({ length: 4 }, () => "");
      const bIds = Array.from({ length: 4 }, () => "");
      for (let i = 0; i < 4; i += 1) {
        aIds[i] = await createLandmark();
        bIds[i] = await createLandmark();
      }
      // Pre-state: A has aIds[0..1], B has bIds[0..1].
      for (const id of aIds.slice(0, 2)) await asUser(app, a).put(path(id));
      for (const id of bIds.slice(0, 2)) await asUser(app, b).put(path(id));

      type Op = { who: "a" | "b"; kind: "list" | "write"; promise: Promise<request.Response> };
      const ops: Op[] = [];
      const write = (who: "a" | "b", p: Promise<request.Response>) =>
        ops.push({ who, kind: "write", promise: p });
      const list = (who: "a" | "b") =>
        ops.push({
          who,
          kind: "list",
          promise: asUser(app, who === "a" ? a : b).get("/api/v1/favorites"),
        });

      write("a", asUser(app, a).put(path(aIds[2]!)));
      write("b", asUser(app, b).put(path(bIds[2]!)));
      list("a");
      list("b");
      write("a", asUser(app, a).delete(path(aIds[0]!)));
      write("b", asUser(app, b).delete(path(bIds[0]!)));
      list("a");
      list("b");
      write("a", asUser(app, a).put(path(aIds[3]!)));
      write("b", asUser(app, b).put(path(bIds[3]!)));
      list("a");
      list("b");

      const settled = await Promise.all(ops.map((o) => o.promise));
      settled.forEach((response, i) => {
        const op = ops[i]!;
        expect(response.status).toBeLessThan(500);
        if (op.kind !== "list") return;
        expect(response.status).toBe(200);
        const own = op.who === "a" ? aIds : bIds;
        const other = op.who === "a" ? b : a;
        // No particular intermediate snapshot is asserted — only ownership.
        for (const entry of response.body.favorites as { landmark_id: string }[]) {
          expect(own).toContain(entry.landmark_id);
        }
        expect(response.text).not.toContain(other.userId);
      });

      expect((await rowsOf(a.userId)).map((r) => r.landmarkId).sort()).toEqual(
        [aIds[1]!, aIds[2]!, aIds[3]!].sort(),
      );
      expect((await rowsOf(b.userId)).map((r) => r.landmarkId).sort()).toEqual(
        [bIds[1]!, bIds[2]!, bIds[3]!].sort(),
      );
    });
  });
});

/**
 * Observed G1 behaviour, pinned after the first run (Increment 4 report):
 * with two `better-auth.session_token` cookies, Better Auth 1.7.18 resolves
 * exactly ONE identity — the FIRST cookie in the header — consistently for
 * the session endpoint, favorites reads, and favorites writes. Never both,
 * never a mix; ownership is unaffected. A change here (e.g. a library
 * upgrade) fails this test and must be reviewed, not re-pinned blindly.
 */
const OBSERVED_MULTI_COOKIE_BEHAVIOUR: Record<string, string> = { "A;B": "A", "B;A": "B" };
