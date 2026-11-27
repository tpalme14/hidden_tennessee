import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * M06-T02 Increment 4c — a controlled, TEST-ONLY HTTP server for verifying
 * real service-worker updates (Specification 7 §5; decisions D9, U11; 4c
 * Option A). One server per test, inside the Playwright worker process,
 * bound to 127.0.0.1 on an OS-assigned port: an origin isolated from the
 * application's e2e server (http://localhost:3000), so worker registrations,
 * caches, and cookies are never shared with other tests.
 *
 * Versions:
 * - A — the accepted production build, read directly (read-only) from
 *   `frontend/dist`.
 * - B — built IN MEMORY from A (nothing is written to disk):
 *   - the main JavaScript bundle with one appended executable statement that
 *     sets `data-e2e-build-js="B"` on the document element, under a new asset
 *     name derived from the modified content;
 *   - `index.html` with a `<meta name="e2e-build" content="B">` marker and the
 *     new bundle reference;
 *   - `sw.js` with the new `index.html` MD5 revision and the new bundle URL in
 *     its precache list (A's bundle is no longer served, as after a deployment).
 *   Every rewrite must replace exactly one occurrence, or construction fails.
 *
 * Requests (explicit allowlist; never a general-purpose proxy):
 * - GET/HEAD `/api/...` and `/health` → forwarded unchanged (Origin and
 *   Referer untouched) to the guarded e2e backend.
 * - POST `/api/auth/request-password-reset` → answered HERE with the neutral
 *   `{ "status": true }` (200) the API contract uses; optionally held until the
 *   test releases it. NEVER forwarded: no backend reset logic runs and no mail
 *   is sent. This exercises the real frontend request and accounting path only.
 * - Any other non-GET/HEAD request → 405, locally, recorded; never forwarded and
 *   never answered by the SPA fallback.
 * - GET/HEAD for a file of the deployed version → that file; an extension-less
 *   application route (not /api, /health, /shared) → the deployed index.html.
 *   Everything else → 404.
 */

export type Version = "A" | "B";

interface Resource {
  body: Buffer;
  type: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

export const DEFAULT_DIST_DIR = fileURLToPath(new URL("../../frontend/dist", import.meta.url));
export const RESET_REQUEST_PATH = "/api/auth/request-password-reset";
export const JS_MARKER_STATEMENT =
  '\n;document.documentElement.setAttribute("data-e2e-build-js","B");\n';
const HTML_MARKER = '<meta name="e2e-build" content="B" />';

const md5 = (data: Buffer | string) => createHash("md5").update(data).digest("hex");

function replaceExactlyOnce(source: string, search: string, replacement: string, what: string) {
  const parts = source.split(search);
  if (parts.length !== 2) {
    throw new Error(`update-server: expected exactly one ${what}, found ${parts.length - 1}`);
  }
  return parts.join(replacement);
}

export interface VersionEvidence {
  /** Main bundle URL path in version A and in version B. */
  jsA: string;
  jsB: string;
  jsBytesDiffer: boolean;
  /** MD5 of each version's index.html (the precache revision it must carry). */
  indexMd5A: string;
  indexMd5B: string;
  /** Recorded revisions in each version's sw.js. */
  swIndexRevisionA: string;
  swIndexRevisionB: string;
  swB: string;
}

/** Builds versions A and B from a production build directory (read-only). */
export function buildVersions(distDir: string) {
  const read = (rel: string) => readFileSync(path.join(distDir, rel));
  const indexA = read("index.html").toString("utf8");
  const swA = read("sw.js").toString("utf8");
  const jsMatch = /\/(assets\/index-[\w-]+\.js)/.exec(indexA);
  if (!jsMatch) throw new Error("update-server: main bundle reference not found in index.html");
  const jsRelA = jsMatch[1]!;
  const jsA = read(jsRelA);

  const jsB = Buffer.concat([jsA, Buffer.from(JS_MARKER_STATEMENT, "utf8")]);
  const jsRelB = `assets/index-${createHash("sha256").update(jsB).digest("base64url").slice(0, 8)}.js`;
  if (jsRelB === jsRelA) throw new Error("update-server: version B bundle name did not change");

  let indexB = replaceExactlyOnce(indexA, `/${jsRelA}`, `/${jsRelB}`, "bundle reference");
  indexB = replaceExactlyOnce(
    indexB,
    '<meta charset="UTF-8" />',
    `<meta charset="UTF-8" />\n    ${HTML_MARKER}`,
    "charset meta",
  );

  const indexMd5A = md5(indexA);
  const indexMd5B = md5(indexB);
  let swB = replaceExactlyOnce(
    swA,
    `{url:"index.html",revision:"${indexMd5A}"}`,
    `{url:"index.html",revision:"${indexMd5B}"}`,
    "index.html precache entry carrying its MD5",
  );
  swB = replaceExactlyOnce(swB, `"${jsRelA}"`, `"${jsRelB}"`, "bundle precache URL");

  const revision = (sw: string) =>
    /\{url:"index\.html",revision:"([0-9a-f]+)"\}/.exec(sw)?.[1] ?? "";
  const evidence: VersionEvidence = {
    jsA: `/${jsRelA}`,
    jsB: `/${jsRelB}`,
    jsBytesDiffer: !jsA.equals(jsB),
    indexMd5A,
    indexMd5B,
    swIndexRevisionA: revision(swA),
    swIndexRevisionB: revision(swB),
    swB,
  };
  const overridesB = new Map<string, Resource>([
    ["/index.html", { body: Buffer.from(indexB, "utf8"), type: MIME[".html"]! }],
    ["/sw.js", { body: Buffer.from(swB, "utf8"), type: MIME[".js"]! }],
    [`/${jsRelB}`, { body: jsB, type: MIME[".js"]! }],
  ]);
  return { evidence, overridesB, removedInB: `/${jsRelA}` };
}

export interface UpdateServer {
  readonly origin: string;
  readonly evidence: VersionEvidence;
  deployed(): Version;
  /** Switches what the server serves; it never touches a page. */
  deploy(version: Version): void;
  /** While true, password-reset POSTs stay unanswered until `releaseResetRequests()`. */
  holdResetRequests(hold: boolean): void;
  releaseResetRequests(): void;
  /** Resolves when the n-th password-reset POST has reached this server. */
  waitForResetRequests(count: number): Promise<void>;
  readonly log: {
    resetRequests: number;
    heldNow: number;
    forwarded: string[];
    rejected: string[];
  };
  close(): Promise<void>;
}

export async function startUpdateServer({
  distDir = DEFAULT_DIST_DIR,
  backendOrigin = "http://localhost:3000",
}: { distDir?: string; backendOrigin?: string } = {}): Promise<UpdateServer> {
  const { evidence, overridesB, removedInB } = buildVersions(distDir);
  const root = path.resolve(distDir);
  let version: Version = "A";
  let holding = false;
  const held: http.ServerResponse[] = [];
  const log: UpdateServer["log"] = { resetRequests: 0, heldNow: 0, forwarded: [], rejected: [] };
  const waiters: { count: number; resolve: () => void }[] = [];
  const backendRequests = new Set<http.ClientRequest>();

  function resource(pathname: string): Resource | null {
    if (version === "B") {
      const override = overridesB.get(pathname);
      if (override) return override;
      if (pathname === removedInB) return null;
    }
    const file = path.resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + path.sep)) return null; // no traversal
    try {
      if (!statSync(file).isFile()) return null;
    } catch {
      return null;
    }
    return {
      body: readFileSync(file),
      type: MIME[path.extname(file)] ?? "application/octet-stream",
    };
  }

  function send(res: http.ServerResponse, status: number, resource: Resource, head: boolean) {
    res.statusCode = status;
    res.setHeader("Content-Type", resource.type);
    res.setHeader("Content-Length", resource.body.length);
    res.end(head ? undefined : resource.body);
  }

  function json(res: http.ServerResponse, status: number, body: unknown) {
    send(res, status, { body: Buffer.from(JSON.stringify(body)), type: MIME[".json"]! }, false);
  }

  function answerReset(res: http.ServerResponse) {
    if (!res.writableEnded && !res.destroyed) json(res, 200, { status: true });
  }

  function forward(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    log.forwarded.push(`${req.method} ${url.pathname}`);
    const target = new URL(url.pathname + url.search, backendOrigin);
    const headers = { ...req.headers, host: target.host };
    const upstream = http.request(target, { method: req.method, headers }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    backendRequests.add(upstream);
    upstream.on("close", () => backendRequests.delete(upstream));
    upstream.on("error", () => {
      if (!res.headersSent) json(res, 502, { code: "E2E_UPDATE_SERVER_UPSTREAM" });
      else res.destroy();
    });
    upstream.end();
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    const pathname = url.pathname;
    const readOnly = method === "GET" || method === "HEAD";

    // 1. The one locally answered mutation.
    if (method === "POST" && pathname === RESET_REQUEST_PATH) {
      req.resume(); // body ignored (synthetic address); never forwarded
      log.resetRequests += 1;
      for (const waiter of waiters.filter((w) => log.resetRequests >= w.count)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
      if (holding) {
        held.push(res);
        log.heldNow = held.length;
        return;
      }
      answerReset(res);
      return;
    }
    // 2. Every other mutation: rejected locally, never forwarded, never the SPA fallback.
    if (!readOnly) {
      req.resume();
      log.rejected.push(`${method} ${pathname}`);
      json(res, 405, { code: "E2E_UPDATE_SERVER_REJECTED" });
      return;
    }
    // 3. Read-only API and health: forwarded unchanged.
    if (pathname.startsWith("/api/") || pathname === "/health") {
      forward(req, res, url);
      return;
    }
    // 4. Static files of the deployed version.
    const file = resource(pathname === "/" ? "/index.html" : pathname);
    if (file) {
      res.setHeader(
        "Cache-Control",
        pathname === "/sw.js" || pathname === "/index.html" || pathname === "/"
          ? "no-cache"
          : "public, max-age=0",
      );
      send(res, 200, file, method === "HEAD");
      return;
    }
    // 5. SPA fallback for application routes only.
    const excluded = /^\/(api|health|shared)(\/|$)/.test(pathname) || path.extname(pathname) !== "";
    if (!excluded) {
      res.setHeader("Cache-Control", "no-cache");
      send(res, 200, resource("/index.html")!, method === "HEAD");
      return;
    }
    json(res, 404, { code: "E2E_UPDATE_SERVER_NOT_FOUND" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    evidence,
    deployed: () => version,
    deploy(next) {
      version = next;
    },
    holdResetRequests(hold) {
      holding = hold;
    },
    releaseResetRequests() {
      for (const res of held.splice(0)) answerReset(res);
      log.heldNow = 0;
    },
    waitForResetRequests(count) {
      if (log.resetRequests >= count) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push({ count, resolve }));
    },
    log,
    async close() {
      holding = false;
      // Held responses are terminated (not answered) so no promise stays pending.
      for (const res of held.splice(0)) res.destroy();
      log.heldNow = 0;
      for (const waiter of waiters.splice(0)) waiter.resolve();
      for (const upstream of backendRequests) upstream.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
