import net from "node:net";
import type { NextFunction, Request, Response } from "express";
import { safeAuthLog } from "./log-sanitizer.js";

/**
 * Client-IP trust boundary for rate limiting (M03-T02 Increment 5).
 *
 * Better Auth reads the client address from the headers it is told to trust
 * and, when it cannot resolve one, falls back to ONE shared bucket for the
 * whole path — so a client that merely sends its own `X-Forwarded-For` could
 * exhaust the sign-in budget for everyone. Instead, the address is derived
 * HERE from Express's `trust proxy` setting (the configured number of
 * trusted hops, default 0), validated, and written to a private header that
 * the library is configured to read exclusively (`ipAddressHeaders`). Any
 * inbound copy of that header is discarded first. The library therefore
 * always sees exactly one server-derived, syntactically valid address and
 * never reads a forwarding header itself.
 *
 * DEPLOYMENT BLOCKER (developer decision, 2026-11-10): the production value of
 * AUTH_TRUSTED_PROXY_HOPS must be established from evidence on the deployed
 * platform, never assumed. Verification procedure: with the candidate hop
 * count deployed, make one sign-in attempt from a machine whose public
 * address is known, (a) with no forwarding header and (b) with a deliberately
 * spoofed `X-Forwarded-For: 203.0.113.9`; in both cases the `rate_limits` row
 * key must be `<known public address>|/sign-in/email` — not the proxy's
 * address (hop count too LOW: everyone shares one bucket) and not
 * `203.0.113.9` (hop count too HIGH: clients control their own identity).
 * Until that check passes, the default 0 stays, which can only under-count.
 */

/** Private header carrying the server-derived client address; never trusted from the wire. */
export const CLIENT_IP_HEADER = "x-app-client-ip";

export interface ClientIpOptions {
  /** The same value given to Express `trust proxy`; used only for the diagnostic below. */
  trustedProxyHops: number;
}

export function createClientIpMiddleware(options: ClientIpOptions) {
  let warnedMissingChain = false;

  return function clientIp(req: Request, _res: Response, next: NextFunction) {
    // 1. Never trust a client-supplied copy of the private header.
    delete req.headers[CLIENT_IP_HEADER];

    // 2. Express applies `trust proxy`: with N hops it returns the address N
    //    entries from the right of X-Forwarded-For (the socket peer with 0).
    //    The value is not validated by Express, so validate it here and fall
    //    back to the socket peer for anything that is not an IP literal.
    const derived = req.ip ?? "";
    const address = net.isIP(derived) !== 0 ? derived : (req.socket.remoteAddress ?? "");
    if (address) req.headers[CLIENT_IP_HEADER] = address;

    // 3. Diagnostic, once per process: a positive hop count means every
    //    request should arrive through a proxy that appends a forwarding
    //    header. One without it reached this process by another path, or the
    //    chain is not what was configured. No request values are logged.
    if (
      options.trustedProxyHops > 0 &&
      !warnedMissingChain &&
      req.headers["x-forwarded-for"] === undefined
    ) {
      warnedMissingChain = true;
      safeAuthLog(
        "warn",
        "AUTH_PROXY_CHAIN_MISSING: a request arrived without X-Forwarded-For although AUTH_TRUSTED_PROXY_HOPS is positive; verify the deployed proxy chain",
        {
          code: "AUTH_PROXY_CHAIN_MISSING",
        },
      );
    }
    next();
  };
}
