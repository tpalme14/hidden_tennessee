import type { BetterAuthOptions } from "better-auth";

/**
 * Better Auth database hooks (ADR-011, M03-T02 Increment 2).
 *
 * A `before` hook that returns `{ data }` has that object shallow-merged OVER
 * the pending row (verified in the installed 1.7.18 `createWithHooks`), so
 * the values here always win over anything a client submitted.
 */
export const databaseHooks = {
  user: {
    create: {
      // The product has no display name (specification §user profile). The
      // sign-up endpoint requires a `name` field, so the API stores "" no
      // matter what the client sent.
      before: async () => ({ data: { name: "" } }),
    },
    update: {
      // Same rule on the library's own /update-user endpoint.
      before: async () => ({ data: { name: "" } }),
    },
  },
  session: {
    create: {
      // Session metadata is NOT persisted (ADR-011 decision 3). The library
      // computes both values from the request before this hook runs; they
      // are blanked here. IP tracking itself stays enabled so the rate
      // limiter (Increment 5) can still key on the client address.
      before: async () => ({ data: { ipAddress: null, userAgent: null } }),
    },
  },
} satisfies BetterAuthOptions["databaseHooks"];
