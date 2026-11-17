import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { CLIENT_IP_HEADER, createClientIpMiddleware } from "../src/auth/client-ip.js";

/**
 * M03-T02 Increment 5 — the client-IP trust boundary (unit: Express only, no
 * database). What Better Auth would be handed under each proxy topology.
 */

const CHAIN = "1.1.1.1, 2.2.2.2, 3.3.3.3";

function buildApp(trustedProxyHops: number) {
  const app = express();
  app.set("trust proxy", trustedProxyHops);
  app.use(createClientIpMiddleware({ trustedProxyHops }));
  app.get("/", (req: Request, res: Response) => {
    res.json({ handed: req.headers[CLIENT_IP_HEADER] ?? null });
  });
  return app;
}

async function handed(trustedProxyHops: number, headers: Record<string, string> = {}) {
  const response = await request(buildApp(trustedProxyHops)).get("/").set(headers);
  return response.body.handed as string | null;
}

describe("client-ip middleware (unit)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("zero hops (default): the socket peer, and any forwarding chain is ignored", async () => {
    const socket = await handed(0);
    expect(socket).toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/);
    expect(await handed(0, { "x-forwarded-for": CHAIN })).toBe(socket);
  });

  it("a correctly configured chain: N hops hands the address N entries from the right", async () => {
    expect(await handed(1, { "x-forwarded-for": CHAIN })).toBe("3.3.3.3");
    expect(await handed(2, { "x-forwarded-for": CHAIN })).toBe("2.2.2.2");
    expect(await handed(3, { "x-forwarded-for": CHAIN })).toBe("1.1.1.1");
  });

  it("attacker-supplied extra entries never change the identity under the correct hop count", async () => {
    // The proxy appends the real address LAST; whatever the client sent sits to its left.
    expect(await handed(1, { "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.7" })).toBe(
      "203.0.113.7",
    );
    expect(await handed(1, { "x-forwarded-for": "garbage, 203.0.113.7" })).toBe("203.0.113.7");
  });

  it("an OVER-counted hop value would trust a client-supplied entry (why the production count needs evidence)", async () => {
    expect(await handed(5, { "x-forwarded-for": CHAIN })).toBe("1.1.1.1");
  });

  it("malformed or port-suffixed values fall back to the socket peer instead of a bogus identity", async () => {
    const socket = await handed(0);
    expect(await handed(1, { "x-forwarded-for": "garbage" })).toBe(socket);
    expect(await handed(1, { "x-forwarded-for": "203.0.113.7:1234" })).toBe(socket);
    expect(await handed(1, { "x-forwarded-for": "" })).toBe(socket);
  });

  it("a direct request that bypassed the proxy chain gets the socket peer", async () => {
    const socket = await handed(0);
    expect(await handed(1)).toBe(socket);
  });

  it("a client-supplied copy of the private header is discarded", async () => {
    expect(
      await handed(1, { "x-forwarded-for": "203.0.113.7", [CLIENT_IP_HEADER]: "6.6.6.6" }),
    ).toBe("203.0.113.7");
    const socket = await handed(0);
    expect(await handed(0, { [CLIENT_IP_HEADER]: "6.6.6.6" })).toBe(socket);
  });

  it("IPv6 clients pass through unchanged", async () => {
    expect(await handed(1, { "x-forwarded-for": "2001:db8::1" })).toBe("2001:db8::1");
  });

  it("warns ONCE (event code only) when hops are positive but a request carries no forwarding header", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = buildApp(1);
    await request(app).get("/").set("x-forwarded-for", "203.0.113.7");
    expect(warn).not.toHaveBeenCalled();
    await request(app).get("/");
    await request(app).get("/");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("AUTH_PROXY_CHAIN_MISSING");
    expect(String(warn.mock.calls[0]![0])).not.toContain("127.0.0.1");
  });
});
