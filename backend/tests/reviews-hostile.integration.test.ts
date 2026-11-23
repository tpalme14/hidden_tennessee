import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import type { Express } from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { MAX_BODY_CODE_POINTS, MESSAGES } from "../src/reviews/request-schema.js";
import {
  TEST_ORIGIN,
  anonymous,
  asUser,
  createSignedInUser,
  type TestUser,
} from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M04-T04 Increment 1 — hostile input and request/response size
 * (spec v1.1 §§4.1, 6, 8; ADR-013 decision 8; M04-T02 decision R8; M04-T04
 * decisions D1–D2). Verification only: every expectation below records the
 * behaviour of the UNCHANGED application.
 *
 * Two layers are told apart throughout:
 *  - the JSON parser (`express.json()`, app-wide, 100 kB = 102,400 bytes,
 *    `strict`), which runs before any route. Its refusals (400 syntax, 413
 *    size, 415 charset/encoding) and Express's own URL-decoding failure reach
 *    Express's DEFAULT error handler, which answers HTML — an existing,
 *    app-wide follow-up recorded in M04-T02, not a reviews defect. Outside
 *    production that HTML includes the stack trace; in production it does
 *    not (both pinned below).
 *  - the reviews request schema (`src/reviews/request-schema.ts`), which
 *    answers the JSON envelope with one of its FIXED messages.
 *
 * Runs on `landmarks_test` only (the integration setup's guard) and resets it
 * after each test. The real application is used, including its real reviews
 * rate limiter (20 mutations per user per minute, counted BEFORE
 * validation), so the corpus spreads its requests over fresh accounts.
 */

const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Resource not found." } };
const PARSER_LIMIT_BYTES = 100 * 1024; // express.json() default "100kb" (bytes.parse)
const MARKER = "ZQX7"; // in every hostile input; must never be reflected in an error

/** Every message an error response from these routes may carry. */
const FIXED_MESSAGES = new Set<string>([
  ...Object.values(MESSAGES),
  NOT_FOUND.error.message,
  "Authentication required.",
]);

/** Fragments that would indicate internal detail in a JSON error response. */
const LEAK_PATTERNS = [
  /prisma/i,
  /postgres/i,
  /landmarks_test/,
  /node_modules/,
  /\bat \S+ \(/, // a stack frame
  /\bSELECT\b/i,
  /@example\./, // a test account address
];

let sequence = 0;
async function createLandmark(): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `HOS${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNSINKS",
      category: "SINK",
      displayName: `Hostile Test Sink ${sequence}`,
      latitude: 35.9,
      longitude: -85.3,
      sensitivityStatus: "PUBLIC",
    },
  });
  return landmark.id;
}

const reviewPath = (id: string) => `/api/v1/reviews/${id}`;
const listPath = (landmarkId: string) => `/api/v1/landmarks/${landmarkId}/reviews`;

async function createVia(app: Express, user: TestUser, landmarkId: string, body = "seed") {
  const response = await asUser(app, user)
    .post("/api/v1/reviews")
    .send({ landmark_id: landmarkId, rating: 3, body });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

const rowsOf = (userId: string) => prisma.review.findMany({ where: { userId } });

/** A review JSON document padded with insignificant whitespace to exactly `bytes` bytes. */
function padTo(json: string, bytes: number): string {
  const size = Buffer.byteLength(json, "utf8");
  if (size > bytes) throw new Error("payload is already larger than the target size");
  return `${json.slice(0, -1)}${" ".repeat(bytes - size)}}`;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

/**
 * Sends a request over a real socket, optionally with `Transfer-Encoding:
 * chunked` (no Content-Length) — something supertest cannot do.
 */
function rawRequest(
  port: number,
  options: {
    method: string;
    path: string;
    body?: Buffer;
    headers?: Record<string, string>;
    chunked?: boolean;
    cookie?: string;
  },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Origin: TEST_ORIGIN, ...options.headers };
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.body && !options.chunked) headers["Content-Length"] = String(options.body.length);
    if (options.chunked) headers["Transfer-Encoding"] = "chunked";
    const req = http.request(
      { host: "127.0.0.1", port, method: options.method, path: options.path, headers },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (chunk: Buffer) => parts.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(parts).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (options.body) {
      if (options.chunked) {
        for (let i = 0; i < options.body.length; i += 8192) {
          req.write(options.body.subarray(i, i + 8192));
        }
      } else {
        req.write(options.body);
      }
    }
    req.end();
  });
}

/** A fixed-envelope JSON error with a fixed message, no reflected marker, no internal detail. */
function expectSafeError(
  response: { status: number; headers: Record<string, unknown>; text: string },
  label: string,
  code?: string,
) {
  expect(response.status, label).toBeGreaterThanOrEqual(400);
  expect(response.status, label).toBeLessThan(500);
  expect(String(response.headers["content-type"]), label).toMatch(/^application\/json/);
  const parsed = JSON.parse(response.text) as { error: { code: string; message: string } };
  expect(Object.keys(parsed), label).toEqual(["error"]);
  expect(Object.keys(parsed.error).sort(), label).toEqual(["code", "message"]);
  if (code !== undefined) expect(parsed.error.code, label).toBe(code);
  expect(FIXED_MESSAGES.has(parsed.error.message), `${label}: ${parsed.error.message}`).toBe(true);
  expect(response.text, label).not.toContain(MARKER);
  for (const pattern of LEAK_PATTERNS) expect(response.text, label).not.toMatch(pattern);
}

/**
 * Hands out signed-in users that each own one review on `landmarkId`, moving
 * to a fresh user before the real per-user mutation limit (20 per minute,
 * counted before validation) is reached.
 */
function mutationBudget(app: Express, landmarkId: string, perUser = 18) {
  let current: { user: TestUser; reviewId: string } | null = null;
  let used = 0;
  return async () => {
    if (current === null || used >= perUser) {
      const user = await createSignedInUser(app, "hostile");
      current = { user, reviewId: await createVia(app, user, landmarkId) };
      used = 1;
    }
    used += 1;
    return current;
  };
}

/** The spec §4.1 outcome for a submitted body (independent of the implementation). */
function expectedBodyOutcome(input: string): { ok: true; body: string | null } | { ok: false } {
  const wellFormed = (input as string & { isWellFormed(): boolean }).isWellFormed();
  if (input.includes("\u0000") || !wellFormed) return { ok: false };
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, body: null };
  if (Array.from(trimmed).length > MAX_BODY_CODE_POINTS) return { ok: false };
  return { ok: true, body: trimmed };
}

/** ~50 representative hostile inputs; each carries MARKER. */
const CORPUS: [string, string][] = [
  ["script tag", `<script>alert('${MARKER}')</script>`],
  ["img onerror", `<img src=x onerror="alert('${MARKER}')">`],
  ["svg onload", `<svg onload=alert(1)>${MARKER}`],
  ["iframe javascript:", `<iframe src="javascript:alert('${MARKER}')">`],
  ["javascript: URL", `javascript:alert('${MARKER}')`],
  ["data: URL", `data:text/html;base64,PHNjcmlwdD4=${MARKER}`],
  ["HTML entities", `&lt;script&gt;${MARKER}&#x3C;`],
  ["CSS expression", `<div style="background:url(javascript:${MARKER})">`],
  ["markdown link", `[click](javascript:alert('${MARKER}'))`],
  ["SQL tautology", `' OR '1'='1' -- ${MARKER}`],
  ["SQL drop", `'); DROP TABLE reviews; -- ${MARKER}`],
  ["SQL union", `1 UNION SELECT email FROM users -- ${MARKER}`],
  ["SQL comment", `/* ${MARKER} */ SELECT pg_sleep(5);`],
  ["NoSQL operator", `{"$gt": "", "${MARKER}": 1}`],
  ["JSON in string", `{"rating":5,"user_id":"${MARKER}"}`],
  ["template ${}", `\${7*7}${MARKER}`],
  ["template {{}}", `{{7*7}}${MARKER}{{constructor.constructor('x')()}}`],
  ["format string", `%s%s%n%x ${MARKER}`],
  ["path traversal", `../../../../etc/passwd${MARKER}`],
  ["Windows path", `..\\..\\windows\\win.ini ${MARKER}`],
  ["command injection", `; rm -rf / ; $(id) \`whoami\` ${MARKER}`],
  ["LDAP filter", `*)(uid=*))(|(uid=${MARKER}`],
  ["XML entity", `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${MARKER}`],
  ["SSI", `<!--#exec cmd="ls" -->${MARKER}`],
  ["CRLF header injection", `x\r\nSet-Cookie: admin=1\r\n\r\n${MARKER}`],
  ["log forging", `ok\nERROR 2026-11-22 forged entry ${MARKER}`],
  ["prototype words", `__proto__ constructor prototype ${MARKER}`],
  ["null words", `null undefined NaN Infinity ${MARKER}`],
  ["backslashes and quotes", `\\"\\\\'\`${MARKER}"'`],
  ["regex-heavy", `(a+)+$ ^(a|aa)+$ ${"a".repeat(64)}! ${MARKER}`],
  ["bidi override", `safe\u202Eevil\u202C ${MARKER}`],
  ["bidi isolates", `\u2066${MARKER}\u2069\u2067x\u2069`],
  ["zero-width wrapped", `\u200B${MARKER}\u200D\u2060`],
  ["BOM edges", `\uFEFF${MARKER}\uFEFF`],
  ["line/paragraph separators", `\u2028${MARKER}\u2029x`],
  ["combining marks", `${MARKER}${"\u0301".repeat(200)}`],
  ["emoji ZWJ", `${MARKER} \u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}`],
  ["astral plane", `\u{1D54F}\u{1F600}\u{10FFFD} ${MARKER}`],
  ["noncharacters", `\uFFFE\uFFFF\uFDD0 ${MARKER}`],
  ["private use", `\uE000\uF8FF ${MARKER}`],
  ["C0 controls", `\u0001\u0007\u001B[31m${MARKER}\u001F`],
  ["DEL and C1", `\u007F\u0085\u009B${MARKER}`],
  ["NUL", `a\u0000${MARKER}`],
  ["lone high surrogate", `${MARKER}\uD800`],
  ["lone low surrogate", `\uDC00${MARKER}`],
  ["whitespace-only", " \t\n\r\u00A0\u3000\uFEFF "],
  ["exactly 2,000 code points", `${MARKER}${"\u{1F600}".repeat(1996)}`],
  ["2,001 code points", `${MARKER}${"x".repeat(1997)}`],
  ["padded to trim", `   ${MARKER} padded   `],
  ["homoglyphs (Cyrillic а, Greek Α)", `\u0430dmin \u0391dmin ${MARKER}`],
];

describe("reviews hostile input and sizes (integration, M04-T04 Increment 1)", () => {
  const app = createApp();
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    await resetTestDatabase();
  });

  // ---------------------------------------------------------------------------
  describe("request parser boundaries (express.json(), 102,400 bytes)", () => {
    it("exactly 102,400 bytes is accepted by the parser and the review is created; 102,401 is 413 before the handler", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const json = JSON.stringify({ landmark_id: landmark, rating: 4, body: `edge ${MARKER}` });

      const atLimit = Buffer.from(padTo(json, PARSER_LIMIT_BYTES));
      expect(atLimit.length).toBe(102_400);
      const accepted = await rawRequest(port, {
        method: "POST",
        path: "/api/v1/reviews",
        body: atLimit,
        headers: { "Content-Type": "application/json" },
        cookie: user.cookie,
      });
      expect(accepted.status).toBe(201);
      expect(JSON.parse(accepted.text)).toMatchObject({ rating: 4, body: `edge ${MARKER}` });

      // A second user, so the 413 is not explained by the duplicate rule.
      const other = await createSignedInUser(app, "other");
      const overLimit = Buffer.from(padTo(json, PARSER_LIMIT_BYTES + 1));
      expect(overLimit.length).toBe(102_401);
      const refused = await rawRequest(port, {
        method: "POST",
        path: "/api/v1/reviews",
        body: overLimit,
        headers: { "Content-Type": "application/json" },
        cookie: other.cookie,
      });
      expect(refused.status).toBe(413);
      // Existing app-wide behaviour: Express's default HTML error page.
      expect(refused.headers["content-type"]).toMatch(/^text\/html/);
      expect(await rowsOf(user.userId)).toHaveLength(1);
      expect(await rowsOf(other.userId)).toHaveLength(0);
    });

    it("parser acceptance is separate from schema validation: 102,400 bytes with an over-long body is the reviews 400, not 413", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const skeleton = JSON.stringify({ landmark_id: landmark, rating: 4, body: "" });
      const body = "a".repeat(PARSER_LIMIT_BYTES - Buffer.byteLength(skeleton));
      const payload = Buffer.from(JSON.stringify({ landmark_id: landmark, rating: 4, body }));
      expect(payload.length).toBe(102_400);
      expect(body.length).toBeGreaterThan(MAX_BODY_CODE_POINTS);

      const response = await rawRequest(port, {
        method: "POST",
        path: "/api/v1/reviews",
        body: payload,
        headers: { "Content-Type": "application/json" },
        cookie: user.cookie,
      });
      expectSafeError(response, "over-long body at the parser limit", "INVALID_REQUEST");
      expect(JSON.parse(response.text).error.message).toBe(MESSAGES.bodyTooLong);
      expect(await rowsOf(user.userId)).toHaveLength(0);
    });

    it("chunked bodies without Content-Length follow the same limit: 102,400 accepted, 102,401 and 1 MB refused (413)", async () => {
      const landmark = await createLandmark();
      const json = JSON.stringify({ landmark_id: landmark, rating: 2 });
      const cases: [number, number][] = [
        [PARSER_LIMIT_BYTES, 201],
        [PARSER_LIMIT_BYTES + 1, 413],
        [1_000_000, 413],
      ];
      for (const [size, status] of cases) {
        const user = await createSignedInUser(app, `chunked-${size}`);
        const response = await rawRequest(port, {
          method: "POST",
          path: "/api/v1/reviews",
          body: Buffer.from(padTo(json, size)),
          headers: { "Content-Type": "application/json" },
          cookie: user.cookie,
          chunked: true,
        });
        expect(response.status, `chunked ${size}`).toBe(status);
        expect(await rowsOf(user.userId), `chunked ${size}`).toHaveLength(status === 201 ? 1 : 0);
      }
    });

    it("compressed bodies are limited by their DECOMPRESSED size (a 1 MB gzip bomb is 413); unsupported encodings are 415", async () => {
      const landmark = await createLandmark();
      const json = JSON.stringify({ landmark_id: landmark, rating: 5, body: `gz ${MARKER}` });

      const small = await createSignedInUser(app, "gzip-small");
      const accepted = await rawRequest(port, {
        method: "POST",
        path: "/api/v1/reviews",
        body: zlib.gzipSync(Buffer.from(json)),
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
        cookie: small.cookie,
      });
      expect(accepted.status).toBe(201);
      expect(JSON.parse(accepted.text).body).toBe(`gz ${MARKER}`);

      const bomb = zlib.gzipSync(Buffer.from(padTo(json, 1_000_000)));
      expect(bomb.length).toBeLessThan(PARSER_LIMIT_BYTES); // small on the wire
      const bomber = await createSignedInUser(app, "gzip-bomb");
      const refused = await rawRequest(port, {
        method: "POST",
        path: "/api/v1/reviews",
        body: bomb,
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
        cookie: bomber.cookie,
      });
      expect(refused.status).toBe(413);

      for (const encoding of ["br", "compress", "x-unknown"]) {
        const response = await rawRequest(port, {
          method: "POST",
          path: "/api/v1/reviews",
          body: Buffer.from(json),
          headers: { "Content-Type": "application/json", "Content-Encoding": encoding },
          cookie: bomber.cookie,
        });
        expect(response.status, encoding).toBe(415);
      }
      expect(await rowsOf(bomber.userId)).toHaveLength(0);
    });

    it("PATCH obeys the same limit: 102,401 bytes is 413 and the review is unchanged", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const id = await createVia(app, user, landmark, "original");
      const response = await rawRequest(port, {
        method: "PATCH",
        path: reviewPath(id),
        body: Buffer.from(padTo(JSON.stringify({ rating: 1 }), PARSER_LIMIT_BYTES + 1)),
        headers: { "Content-Type": "application/json" },
        cookie: user.cookie,
      });
      expect(response.status).toBe(413);
      expect(await rowsOf(user.userId)).toEqual([
        expect.objectContaining({ id, rating: 3, body: "original" }),
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  describe("malformed JSON", () => {
    const SYNTAX_ERRORS: [string, string][] = [
      ["truncated", '{"rating":'],
      ["trailing comma", '{"rating":3,}'],
      ["single quotes", "{'rating':3}"],
      ["unquoted key", "{rating:3}"],
      ["comment", '{"rating":3 /* c */}'],
      ["NaN literal", '{"rating":NaN}'],
      ["two documents", '{"rating":3}{"rating":4}'],
      ["top-level string (strict mode)", '"x"'],
      ["top-level number (strict mode)", "3"],
      ["top-level null (strict mode)", "null"],
      ["top-level true (strict mode)", "true"],
      ["control character in string", '{"body":"a\u0001b"}'],
      ["invalid escape", '{"body":"\\x41"}'],
    ];

    it("syntax errors are 400 from the parser (Express default HTML), never 5xx; nothing is stored and the server keeps serving", async () => {
      const user = await createSignedInUser(app);
      for (const [label, raw] of SYNTAX_ERRORS) {
        const response = await asUser(app, user)
          .post("/api/v1/reviews")
          .set("Content-Type", "application/json")
          .send(raw);
        expect(response.status, label).toBe(400);
        expect(response.headers["content-type"], label).toMatch(/^text\/html/);
      }
      expect(await rowsOf(user.userId)).toHaveLength(0);
      const landmark = await createLandmark();
      expect((await anonymous(app).get(listPath(landmark))).status).toBe(200);
    });

    it("Express's default HTML shows the stack outside production but only the status text in production (existing app-wide behaviour)", async () => {
      const development = await anonymous(app)
        .post("/api/v1/reviews")
        .set("Content-Type", "application/json")
        .send('{"rating":');
      expect(development.text).toMatch(/SyntaxError/);
      expect(development.text).toMatch(/node_modules/);

      const production = createApp();
      production.set("env", "production");
      for (const [raw, contentType, status, text] of [
        ['{"rating":', "application/json", 400, "Bad Request"],
        [
          padTo('{"rating":1}', PARSER_LIMIT_BYTES + 1),
          "application/json",
          413,
          "Payload Too Large",
        ],
        ['{"rating":1}', "application/json; charset=iso-8859-1", 415, "Unsupported Media Type"],
      ] as const) {
        const response = await anonymous(production)
          .post("/api/v1/reviews")
          .set("Content-Type", contentType)
          .send(raw);
        expect(response.status).toBe(status);
        expect(response.text).toContain(`<pre>${text}</pre>`);
        expect(response.text).not.toMatch(/Error:|node_modules|\bat \S+ \(/);
      }
    });

    it("deep nesting is parsed without a crash and refused by the reviews schema with a fixed message", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const id = await createVia(app, user, landmark, "kept");
      const deepArray = `${"[".repeat(40_000)}${"]".repeat(40_000)}`;
      const deepObject = (depth: number) => `${'{"a":'.repeat(depth)}1${"}".repeat(depth)}`;
      const cases: [string, "post" | "patch", string, string][] = [
        ["40,000 nested arrays as the whole body", "post", deepArray, MESSAGES.invalidBodyShape],
        [
          "15,000 nested objects in body",
          "post",
          `{"landmark_id":"${landmark}","rating":3,"body":${deepObject(15_000)}}`,
          MESSAGES.invalidBodyType,
        ],
        [
          "15,000 nested arrays in rating",
          "patch",
          `{"rating":${"[".repeat(15_000)}${"]".repeat(15_000)}}`,
          MESSAGES.invalidRating,
        ],
        [
          "15,000 nested objects under an unknown key",
          "patch",
          `{"rating":2,"extra":${deepObject(15_000)}}`,
          MESSAGES.unsupportedFields,
        ],
      ];
      for (const [label, method, raw, message] of cases) {
        expect(Buffer.byteLength(raw), label).toBeLessThanOrEqual(PARSER_LIMIT_BYTES);
        const pending =
          method === "post"
            ? asUser(app, user).post("/api/v1/reviews")
            : asUser(app, user).patch(reviewPath(id));
        const response = await pending.set("Content-Type", "application/json").send(raw);
        expectSafeError(response, label, "INVALID_REQUEST");
        expect(response.body.error.message, label).toBe(message);
      }
      expect(await rowsOf(user.userId)).toEqual([
        expect.objectContaining({ id, rating: 3, body: "kept" }),
      ]);
    });

    it("duplicate keys follow JSON.parse: the LAST value wins (create and edit)", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const created = await asUser(app, user)
        .post("/api/v1/reviews")
        .set("Content-Type", "application/json")
        .send(`{"landmark_id":"${landmark}","rating":1,"body":"first","rating":5,"body":"second"}`);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ rating: 5, body: "second" });

      const edited = await asUser(app, user)
        .patch(reviewPath(created.body.id as string))
        .set("Content-Type", "application/json")
        .send('{"rating":2,"rating":4,"body":null,"body":"kept last"}');
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ rating: 4, body: "kept last" });

      // A duplicate whose last value is invalid is refused as a whole.
      const refused = await asUser(app, user)
        .patch(reviewPath(created.body.id as string))
        .set("Content-Type", "application/json")
        .send('{"rating":3,"rating":"3"}');
      expectSafeError(refused, "last duplicate invalid", "INVALID_REQUEST");
      expect(await rowsOf(user.userId)).toEqual([
        expect.objectContaining({ rating: 4, body: "kept last" }),
      ]);
    });

    it("an empty JSON object is a schema error (400 with a fixed message), not a parser error", async () => {
      const user = await createSignedInUser(app);
      const empty = await asUser(app, user)
        .post("/api/v1/reviews")
        .set("Content-Type", "application/json")
        .send("{}");
      expectSafeError(empty, "empty create", "INVALID_REQUEST");
      const noBody = await asUser(app, user)
        .post("/api/v1/reviews")
        .set("Content-Type", "application/json");
      expectSafeError(noBody, "no body", "INVALID_REQUEST");
      expect(await rowsOf(user.userId)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe("numeric edge cases against the integer 1–5 rating contract", () => {
    const LITERALS: [string, number | null][] = [
      ["4.0", 4],
      ["4e0", 4],
      ["0.4e1", 4],
      ["40e-1", 4],
      ["4.0000000000000001", 4], // not representable apart from 4 in IEEE 754
      ["1e400", null], // Infinity
      ["-1e400", null],
      ["-0", null],
      ["0", null],
      ["4.5", null],
      ["4.000001", null],
      ["6", null],
      ["5e-324", null],
      ["9007199254740993", null],
      ['"4"', null],
      ["true", null],
      ["null", null],
      ["[4]", null],
      ['{"value":4}', null],
    ];

    it("create: literals that parse to the integers 1–5 are accepted; every other value is 400 with the rating message", async () => {
      const landmark = await createLandmark();
      const take = mutationBudget(app, landmark);
      for (const [literal, expected] of LITERALS) {
        // A fresh landmark for accepted literals avoids the one-review rule.
        const target = expected === null ? landmark : await createLandmark();
        const { user } = await take();
        const response = await asUser(app, user)
          .post("/api/v1/reviews")
          .set("Content-Type", "application/json")
          .send(`{"landmark_id":"${target}","rating":${literal}}`);
        if (expected === null) {
          expectSafeError(response, `create ${literal}`, "INVALID_REQUEST");
          expect(response.body.error.message, literal).toBe(MESSAGES.invalidRating);
        } else {
          expect(response.status, literal).toBe(201);
          expect(response.body.rating, literal).toBe(expected);
          const row = await prisma.review.findUnique({ where: { id: response.body.id as string } });
          expect(row?.rating, literal).toBe(expected);
        }
      }
    });

    it("edit: the same rule applies to PATCH; a refused value leaves the stored rating unchanged", async () => {
      const landmark = await createLandmark();
      const take = mutationBudget(app, landmark);
      for (const [literal, expected] of LITERALS) {
        const { user, reviewId } = await take();
        const before = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
        const response = await asUser(app, user)
          .patch(reviewPath(reviewId))
          .set("Content-Type", "application/json")
          .send(`{"rating":${literal}}`);
        const after = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
        if (expected === null) {
          expectSafeError(response, `patch ${literal}`, "INVALID_REQUEST");
          expect(after.rating, literal).toBe(before.rating);
        } else {
          expect(response.status, literal).toBe(200);
          expect(after.rating, literal).toBe(expected);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe("identifiers, query strings, and Content-Type", () => {
    it("oversized, encoded, and malformed IDs keep the existing route and validation behaviour", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const id = await createVia(app, user, landmark, "target");
      const huge = "a".repeat(8_000);

      // Oversized but within Node's 16 KB request-line limit: the fixed 400.
      for (const response of [
        await anonymous(app).get(listPath(huge)),
        await asUser(app, user).patch(reviewPath(huge)).send({ rating: 1 }),
        await asUser(app, user).delete(reviewPath(huge)),
      ]) {
        expectSafeError(response, "8,000-character ID", "INVALID_REQUEST");
      }
      // Beyond Node's request-line limit: Node itself answers 431 with no body.
      const tooLong = await rawRequest(port, {
        method: "GET",
        path: listPath("a".repeat(20_000)),
      });
      expect(tooLong.status).toBe(431);

      // Percent-encoding of a valid ID is decoded by Express: same resource.
      const encoded = Array.from(id, (c) => `%${c.charCodeAt(0).toString(16)}`).join("");
      const viaEncoded = await asUser(app, user).patch(reviewPath(encoded)).send({ rating: 2 });
      expect(viaEncoded.status).toBe(200);
      expect(viaEncoded.body.id).toBe(id);
      // A trailing slash routes the same (Express non-strict routing).
      const trailing = await asUser(app, user)
        .patch(`${reviewPath(id)}/`)
        .send({ rating: 5 });
      expect(trailing.status).toBe(200);

      // Encoded NUL, slash, dot segments, Unicode digits, and whitespace: the fixed 400.
      for (const raw of [
        `${id}%00`,
        `${id.slice(0, -1)}%2F`,
        "%2e%2e",
        // The first hex character as its full-width form (U+FF10–FF19, U+FF41–FF46).
        `${encodeURIComponent(String.fromCodePoint(id.codePointAt(0)! + 0xfee0))}${id.slice(1)}`,
        `%20${id}`,
        `${id}%0A`,
      ]) {
        const response = await asUser(app, user).patch(reviewPath(raw)).send({ rating: 1 });
        expectSafeError(response, `PATCH ${raw}`, "INVALID_REQUEST");
        expect(response.body.error.message).toBe(MESSAGES.invalidReviewId);
      }
      expect(await rowsOf(user.userId)).toEqual([expect.objectContaining({ id, rating: 5 })]);
    });

    it("malformed percent-encoding: Express's URL decoding fails before the reviews code (HTML 400 on the public list; recorded behaviour on protected routes)", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const id = await createVia(app, user, landmark, "unchanged");

      const publicList = await anonymous(app).get(listPath("%E0%A4%A"));
      expect(publicList.status).toBe(400);
      expect(publicList.headers["content-type"]).toMatch(/^text\/html/); // existing app-wide behaviour

      for (const response of [
        await asUser(app, user).patch(reviewPath("%E0%A4%A")).send({ rating: 1 }),
        await asUser(app, user).delete(reviewPath("%E0%A4%A")),
      ]) {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      }
      expect(await rowsOf(user.userId)).toEqual([
        expect.objectContaining({ id, rating: 3, body: "unchanged" }),
      ]);
    });

    it("public list: repeated, array, object, and malformed page/limit values are 400 INVALID_QUERY", async () => {
      const landmark = await createLandmark();
      const many = Array.from({ length: 1_001 }, (_, i) => `p${i}=1`).join("&");
      for (const query of [
        "page[]=1",
        "page=1&page=2",
        "limit=100&limit=1",
        "page[a]=1",
        "page[0]=1&page[1]=2",
        "a[b][c][d][e][f][g]=1",
        "page=1e2",
        "page=0",
        "page=-1",
        "page=%2B1",
        "page=%201",
        "page=01",
        "page=1%00",
        "page=%EF%BC%91", // full-width digit one
        "limit=101",
        "limit=0",
        "page=9007199254740993",
        "toString=1",
        "hasOwnProperty=1",
        "PAGE=1",
        many,
      ]) {
        const response = await anonymous(app).get(`${listPath(landmark)}?${query}`);
        expectSafeError(response, `?${query.slice(0, 40)}`, "INVALID_QUERY");
      }
    });

    it("query keys named __proto__ are dropped by Express's query parser before validation (recorded behaviour, no pollution)", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      const list = await anonymous(app).get(`${listPath(landmark)}?__proto__=1`);
      expect(list.status).toBe(200);
      const nested = await anonymous(app).get(`${listPath(landmark)}?__proto__[page]=1`);
      expect(nested.status).toBe(200);
      const lookup = await asUser(app, user).get(
        `/api/v1/reviews?landmark_id=${landmark}&__proto__=1`,
      );
      expect(lookup.status).toBe(200);
      expect(lookup.body).toEqual({ review: null });
      const created = await asUser(app, user)
        .post("/api/v1/reviews?__proto__=x")
        .send({ landmark_id: landmark, rating: 3 });
      expect(created.status).toBe(201);
      expect(({} as Record<string, unknown>).page).toBeUndefined();
      expect(({} as Record<string, unknown>).x).toBeUndefined();
    });

    it("own-review lookup: repeated, array, and extra parameters are 400 INVALID_QUERY", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      for (const query of [
        `landmark_id=${landmark}&landmark_id=${landmark}`,
        `landmark_id[]=${landmark}`,
        `landmark_id[x]=${landmark}`,
        `landmark_id=${landmark}&toString=1`,
        `LANDMARK_ID=${landmark}`,
        `landmark_id=${landmark}%00`,
      ]) {
        const response = await asUser(app, user).get(`/api/v1/reviews?${query}`);
        expectSafeError(response, query, "INVALID_QUERY");
      }
    });

    it("Content-Type: UTF-16 JSON is decoded correctly; unsupported charsets are 415; non-JSON types are a schema 400", async () => {
      const landmark = await createLandmark();
      const text = `Café ☕ \u{1F600} ${MARKER}`;
      const json = JSON.stringify({ landmark_id: landmark, rating: 4, body: text });

      for (const [label, contentType, body] of [
        ["charset=utf-8", "application/json; charset=utf-8", Buffer.from(json, "utf8")],
        ["upper-case type", "APPLICATION/JSON", Buffer.from(json, "utf8")],
        ["charset=utf-16le", "application/json; charset=utf-16le", Buffer.from(json, "utf16le")],
      ] as const) {
        const user = await createSignedInUser(app, label);
        const response = await rawRequest(port, {
          method: "POST",
          path: "/api/v1/reviews",
          body,
          headers: { "Content-Type": contentType },
          cookie: user.cookie,
        });
        expect(response.status, label).toBe(201);
        expect(JSON.parse(response.text).body, label).toBe(text);
        expect((await rowsOf(user.userId))[0]?.body, label).toBe(text);
      }

      const refusedUser = await createSignedInUser(app, "refused");
      for (const charset of ["iso-8859-1", "windows-1252", "utf-99", "ascii"]) {
        const response = await rawRequest(port, {
          method: "POST",
          path: "/api/v1/reviews",
          body: Buffer.from(json),
          headers: { "Content-Type": `application/json; charset=${charset}` },
          cookie: refusedUser.cookie,
        });
        expect(response.status, charset).toBe(415);
      }
      for (const contentType of [
        "application/vnd.api+json",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=x",
        "text/json",
      ]) {
        const response = await rawRequest(port, {
          method: "POST",
          path: "/api/v1/reviews",
          body: Buffer.from(json),
          headers: { "Content-Type": contentType },
          cookie: refusedUser.cookie,
        });
        expectSafeError(
          { ...response, headers: response.headers as Record<string, unknown> },
          contentType,
          "INVALID_REQUEST",
        );
      }
      const missing = await rawRequest(port, {
        method: "POST",
        path: "/api/v1/reviews",
        body: Buffer.from(json),
        cookie: refusedUser.cookie,
      });
      expectSafeError(
        { ...missing, headers: missing.headers as Record<string, unknown> },
        "no Content-Type",
        "INVALID_REQUEST",
      );
      expect(await rowsOf(refusedUser.userId)).toHaveLength(0);
    });

    it("charset=utf-7 is decoded by the parser BEFORE validation (recorded behaviour): validation and inert storage apply to the decoded text", async () => {
      // body-parser accepts any "utf-*" charset its decoder supports. In UTF-7,
      // "+ADw-" and "+AD4-" are "<" and ">", so ASCII bytes can carry markup.
      const landmark = await createLandmark();
      const user = await createSignedInUser(app);
      const ascii = `{"landmark_id":"${landmark}","rating":3,"body":"+ADw-b+AD4-${MARKER}"}`;
      const response = await rawRequest(port, {
        method: "POST",
        path: "/api/v1/reviews",
        body: Buffer.from(ascii, "ascii"),
        headers: { "Content-Type": "application/json; charset=utf-7" },
        cookie: user.cookie,
      });
      expect(response.status).toBe(201);
      expect(JSON.parse(response.text).body).toBe(`<b>${MARKER}`);
      expect((await rowsOf(user.userId))[0]?.body).toBe(`<b>${MARKER}`);
      // The response itself is always UTF-8 JSON, so the text stays data.
      expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");

      // The length rule is applied to the DECODED text: 2,001 "+ADw-" sequences
      // are 10,005 ASCII bytes but 2,001 code points ("<") — refused.
      const other = await createSignedInUser(app, "utf7-long");
      const long = await rawRequest(port, {
        method: "POST",
        path: "/api/v1/reviews",
        body: Buffer.from(
          `{"landmark_id":"${landmark}","rating":3,"body":"${"+ADw-".repeat(2001)}"}`,
          "ascii",
        ),
        headers: { "Content-Type": "application/json; charset=utf-7" },
        cookie: other.cookie,
      });
      expectSafeError(
        { ...long, headers: long.headers as Record<string, unknown> },
        "utf-7 over-long",
        "INVALID_REQUEST",
      );
      expect(JSON.parse(long.text).error.message).toBe(MESSAGES.bodyTooLong);
      // A decoded raw control character inside a JSON string is a parser syntax error.
      const nul = await rawRequest(port, {
        method: "POST",
        path: "/api/v1/reviews",
        body: Buffer.from(`{"landmark_id":"${landmark}","rating":3,"body":"a+AAA-b"}`, "ascii"),
        headers: { "Content-Type": "application/json; charset=utf-7" },
        cookie: other.cookie,
      });
      expect(nul.status).toBe(400);
      expect(nul.headers["content-type"]).toMatch(/^text\/html/); // existing parser behaviour
      expect(await rowsOf(other.userId)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe(`hostile-input corpus (${CORPUS.length} inputs × 5 positions)`, () => {
    it("as review text: accepted exactly per spec §4.1, or refused with a fixed message; never 5xx", async () => {
      const landmark = await createLandmark();
      const take = mutationBudget(app, landmark);
      for (const [label, input] of CORPUS) {
        const { user, reviewId } = await take();
        const response = await asUser(app, user).patch(reviewPath(reviewId)).send({ body: input });
        const expected = expectedBodyOutcome(input);
        const row = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
        if (expected.ok) {
          expect(response.status, label).toBe(200);
          expect(response.body.body, label).toBe(expected.body);
          expect(row.body, label).toBe(expected.body);
          expect(Object.keys(response.body).sort(), label).toEqual(
            ["author_label", "body", "created_at", "id", "rating", "updated_at"].sort(),
          );
        } else {
          expectSafeError(response, label, "INVALID_REQUEST");
          expect(row.body, label).not.toBe(input);
        }
      }
      // Accepted text is returned verbatim, as JSON string data, on the public list.
      const list = await anonymous(app).get(`${listPath(landmark)}?limit=100`);
      expect(list.status).toBe(200);
      expect(list.headers["content-type"]).toMatch(/^application\/json/);
    });

    it("as landmark_id, rating, or a field NAME on create: always the fixed 400, never reflected", async () => {
      const landmark = await createLandmark();
      const take = mutationBudget(app, landmark);
      for (const [label, input] of CORPUS) {
        const shapes: [string, Record<string, unknown>, string][] = [
          ["landmark_id", { landmark_id: input, rating: 3 }, MESSAGES.invalidLandmarkId],
          ["rating", { landmark_id: landmark, rating: input }, MESSAGES.invalidRating],
          [
            "field name",
            { landmark_id: landmark, rating: 3, [input]: 1 },
            MESSAGES.unsupportedFields,
          ],
        ];
        for (const [position, payload, message] of shapes) {
          const { user } = await take();
          const response = await asUser(app, user).post("/api/v1/reviews").send(payload);
          expectSafeError(response, `${position}: ${label}`, "INVALID_REQUEST");
          // "field name" with a key the schema recognises cannot occur: no corpus entry is one.
          expect(response.body.error.message, `${position}: ${label}`).toBe(message);
        }
      }
      // One seed review per budget user; nothing else was stored.
      const stored = await prisma.review.findMany({ where: { landmarkId: landmark } });
      expect(stored.every((r) => r.body === "seed" && r.rating === 3)).toBe(true);
    });

    it("as a path ID or a page value: the fixed 400, never reflected (well-formed inputs; a lone surrogate cannot be URL-encoded)", async () => {
      const landmark = await createLandmark();
      const take = mutationBudget(app, landmark);
      const encodable = CORPUS.filter(([, input]) =>
        (input as string & { isWellFormed(): boolean }).isWellFormed(),
      );
      // Node refuses a request line + headers over 16 KB with 431 before Express;
      // no input falls near that size, so each case has one deterministic outcome.
      const NODE_HEADER_LIMIT = 16 * 1024;
      for (const [label, input] of encodable) {
        const encoded = encodeURIComponent(input);
        expect(
          encoded.length < 12_000 || encoded.length > NODE_HEADER_LIMIT,
          `${label}: ${encoded.length}`,
        ).toBe(true);
        if (encoded.length > NODE_HEADER_LIMIT) {
          const tooLong = await rawRequest(port, { method: "GET", path: listPath(encoded) });
          expect(tooLong.status, label).toBe(431);
          expect(tooLong.text, label).toBe("");
          continue;
        }
        const { user } = await take();
        const patch = await asUser(app, user).patch(reviewPath(encoded)).send({ rating: 1 });
        expectSafeError(patch, `path: ${label}`, "INVALID_REQUEST");
        expect(patch.body.error.message, label).toBe(MESSAGES.invalidReviewId);
        const listById = await anonymous(app).get(listPath(encoded));
        expectSafeError(listById, `list path: ${label}`, "INVALID_REQUEST");
        const page = await anonymous(app).get(`${listPath(landmark)}?page=${encoded}`);
        expectSafeError(page, `page: ${label}`, "INVALID_QUERY");
      }
      const stored = await prisma.review.findMany({ where: { landmarkId: landmark } });
      expect(stored.every((r) => r.rating === 3)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe("response size: 100 maximum-length, escape-heavy reviews at limit=100", () => {
    /**
     * U+0001–U+0007 and U+000E–U+001F: control characters that are NOT
     * ECMAScript whitespace (so trim() keeps them) and that JSON.stringify
     * writes as the six-byte escape \u00XX — the most bytes any code point can
     * take in the response (see the bound below).
     */
    const SIX_BYTE = [
      ...Array.from({ length: 7 }, (_, i) => 0x01 + i),
      ...Array.from({ length: 18 }, (_, i) => 0x0e + i),
    ].map((code) => String.fromCodePoint(code));

    function maximalBody(seed: number): string {
      return Array.from(
        { length: MAX_BODY_CODE_POINTS },
        (_, i) => SIX_BYTE[(seed + i) % SIX_BYTE.length]!,
      ).join("");
    }

    it("the serialized page matches its exact size and stays within the computed worst-case bound; pagination and data are intact", async () => {
      // Every candidate code point really serializes to six bytes.
      for (const ch of SIX_BYTE) expect(Buffer.byteLength(JSON.stringify(ch)) - 2).toBe(6);

      const landmark = await createLandmark();
      const base = Date.UTC(2026, 0, 1);
      await prisma.user.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          name: "",
          email: `size-${i}-${Date.now()}@size.test`,
        })),
      });
      const users = await prisma.user.findMany({
        where: { email: { endsWith: "@size.test" } },
        orderBy: { email: "asc" },
      });
      expect(users).toHaveLength(100);
      const seeded = users.map((user, i) => ({
        userId: user.id,
        landmarkId: landmark,
        rating: (i % 5) + 1,
        body: maximalBody(i),
        createdAt: new Date(base + i * 1000),
        updatedAt: new Date(base + i * 1000),
      }));
      // Seeded text is exactly what the API itself would store.
      for (const s of seeded) {
        const outcome = expectedBodyOutcome(s.body);
        expect(outcome).toEqual({ ok: true, body: s.body });
      }
      await prisma.review.createMany({ data: seeded });

      const response = await anonymous(app).get(`${listPath(landmark)}?limit=100`);
      expect(response.status).toBe(200);
      const measured = Buffer.byteLength(response.text, "utf8");
      expect(Number(response.headers["content-length"])).toBe(measured); // not compressed

      // Exact: the page is precisely the serialization of the seeded data.
      const body = response.body as {
        reviews: { id: string; rating: number; body: string; created_at: string }[];
        aggregate: { average_rating: number; rating_count: number };
        page: number;
        limit: number;
        has_more: boolean;
      };
      expect(Buffer.byteLength(JSON.stringify(body))).toBe(measured);

      // Worst-case bound, from the contract alone:
      //  - a body has at most 2,000 code points; JSON.stringify writes each in
      //    at most 6 bytes (U+0000–U+001F as \u00XX; '"' and '\' as 2 bytes;
      //    any other BMP code point as at most 3 UTF-8 bytes; an astral code
      //    point as 4 UTF-8 bytes; lone surrogates are refused), plus 2 quotes;
      //  - every other review field has a fixed length (UUID 36, rating 1
      //    digit, two 24-character ISO timestamps, the fixed author label);
      //  - the envelope is fixed apart from the average, whose JSON number is
      //    at most 24 characters ("-1.7976931348623157e+308").
      const perReviewFixed = Buffer.byteLength(
        JSON.stringify({
          id: "00000000-0000-0000-0000-000000000000",
          rating: 5,
          body: "",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          author_label: "Community Member",
        }),
      );
      const perReviewMax = perReviewFixed + 6 * MAX_BODY_CODE_POINTS;
      const envelopeMax =
        Buffer.byteLength(
          JSON.stringify({
            reviews: [],
            aggregate: { average_rating: 0, rating_count: 100 },
            page: 1,
            limit: 100,
            has_more: false,
          }),
        ) -
        1 + // the "0" placeholder for the average
        24;
      const bound = envelopeMax + 100 * perReviewMax + 99; // 99 commas between reviews
      console.log(
        `[size] measured=${measured} bytes; bound=${bound} bytes; perReviewMax=${perReviewMax}; envelopeMax=${envelopeMax}`,
      );
      expect(measured).toBeLessThanOrEqual(bound);
      // These bodies are maximal, so the page sits within the envelope slack of the bound.
      expect(bound - measured).toBeLessThan(envelopeMax);

      // Shape, order, pagination, and data integrity.
      expect(Object.keys(body).sort()).toEqual(
        ["aggregate", "has_more", "limit", "page", "reviews"].sort(),
      );
      expect(body.page).toBe(1);
      expect(body.limit).toBe(100);
      expect(body.has_more).toBe(false);
      expect(body.aggregate).toEqual({ average_rating: 3, rating_count: 100 });
      expect(body.reviews).toHaveLength(100);
      const expectedOrder = [...seeded].reverse(); // newest first
      body.reviews.forEach((review, i) => {
        expect(review.body).toBe(expectedOrder[i]!.body);
        expect(review.rating).toBe(expectedOrder[i]!.rating);
        expect(review.created_at).toBe(expectedOrder[i]!.createdAt.toISOString());
        expect(Array.from(review.body)).toHaveLength(MAX_BODY_CODE_POINTS);
      });

      const half = await anonymous(app).get(`${listPath(landmark)}?limit=50`);
      expect(half.body.has_more).toBe(true);
      expect(half.body.reviews).toHaveLength(50);
      const next = await anonymous(app).get(`${listPath(landmark)}?page=2&limit=50`);
      expect(next.body.has_more).toBe(false);
      expect([...half.body.reviews, ...next.body.reviews].map((r: { id: string }) => r.id)).toEqual(
        body.reviews.map((r) => r.id),
      );
      const beyond = await anonymous(app).get(`${listPath(landmark)}?page=2&limit=100`);
      expect(beyond.body).toMatchObject({ reviews: [], has_more: false, page: 2, limit: 100 });

      // The database is unchanged by reading it.
      const stored = await prisma.review.findMany({ where: { landmarkId: landmark } });
      expect(stored).toHaveLength(100);
      const byUser = new Map(stored.map((r) => [r.userId, r]));
      for (const s of seeded) {
        expect(byUser.get(s.userId)?.body).toBe(s.body);
        expect(byUser.get(s.userId)?.rating).toBe(s.rating);
      }
    });
  });
});
