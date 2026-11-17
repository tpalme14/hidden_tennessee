# Tennessee Natural Landmarks Explorer

See `docs/PROJECT_PLAN.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/DECISIONS.md` for the
project's scope, roadmap, and architectural decisions. `specs/README.md` indexes the approved
feature specifications. This README's full project overview, architecture summary, and
deployment documentation will be completed in Milestone 07 (M07-T06); this section only covers
local development setup for the foundation established in M00-T04.

## Development Setup

Requires Node.js >= 22 and Docker (for the local PostgreSQL/PostGIS database).

```bash
npm install
cp backend/.env.example backend/.env
docker compose up -d
npm run dev
```

This starts the Express backend on port 3000 and the Vite dev server (with hot reload) on its
default port, proxying `/api/*` and `/health` to the backend. Visit the URL Vite prints.

Other root-level commands:

```bash
npm run build       # builds backend then frontend
npm run typecheck   # type-checks both workspaces
npm run lint        # lints both workspaces
npm run format      # formats the repository with Prettier
```

`docker compose up -d` creates two local databases on the same Postgres/PostGIS instance:
`landmarks_dev` for development and `landmarks_test` for the automated integration tests.

## Backend Authentication Setup

The backend's email/password authentication (Better Auth 1.7.18 on the Prisma adapter, M03-T02)
is configured entirely through environment variables read by `backend/src/config/env.ts`. The
server refuses to start when a required value is missing; it never falls back to a built-in
secret. `backend/.env.example` lists every variable with a placeholder; real values live only in
the git-ignored `backend/.env`.

| Variable                  | Required               | Purpose                                                                                                                                                                                                            |
| ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`      | always                 | Signs session cookies. Generate one with the command below; never commit, print, or log it.                                                                                                                        |
| `BETTER_AUTH_URL`         | always                 | The public origin the app is served from (`http://localhost:3000` locally; the `https://` origin in production). It also decides cookie security: an `https` origin yields `__Secure-`-prefixed, `Secure` cookies. |
| `BETTER_AUTH_TELEMETRY`   | recommended `0`        | Keeps the library's telemetry off (it is also disabled in code).                                                                                                                                                   |
| `AUTH_RATE_LIMIT_ENABLED` | optional               | Database-backed rate limiting is on automatically when `NODE_ENV=production`; set `true` to turn it on elsewhere.                                                                                                  |
| `AUTH_TRUSTED_PROXY_HOPS` | optional, default `0`  | Reverse-proxy hops whose `X-Forwarded-For` entries are trusted when deriving the client address for rate limiting. Keep `0` until the deployed proxy chain has been verified (see below).                          |
| `MAIL_TRANSPORT`          | required in production | `smtp` or `disabled`. Outside production the default is `disabled`, under which password-reset requests answer `503` and create nothing.                                                                           |
| `SMTP_URL`                | with `smtp`            | SMTP connection URL, e.g. `smtps://user:password@smtp.example.com:465`. It carries the credentials: `.env` only.                                                                                                   |
| `MAIL_FROM`               | with `smtp`            | The verified sender identity for password-reset mail.                                                                                                                                                              |

Generate a secret:

```bash
node -p "require('crypto').randomBytes(32).toString('base64url')"
```

Behaviour as implemented: registration and sign-in require only an email address and an 8–128
character password; sessions last 30 days and are renewed when used with fewer than seven days
left; sign-out revokes the current session only; a successful password reset revokes every
session. Password-reset links are single-use, expire after 30 minutes, and point at
`<BETTER_AUTH_URL>/reset-password?token=…`. Sign-in is limited to 5 attempts per minute per
client address, registration to 5 per 10 minutes, reset requests to 3 per 10 minutes, and reset
completions to 5 per 10 minutes.

**Development and test defaults.** `npm run dev` reads `backend/.env`; only the two
`BETTER_AUTH_*` values need to be real locally. The integration tests and the Playwright suite
set their own test-only secret, `BETTER_AUTH_URL`, and `MAIL_TRANSPORT=disabled` and run against
`landmarks_test` only; they never read your `.env`. To exercise password-reset mail locally,
point `SMTP_URL` at a local capture server (for example Mailpit) and set `MAIL_TRANSPORT=smtp`.

**Production requirements.** Set `NODE_ENV=production`, an `https` `BETTER_AUTH_URL`, a freshly
generated `BETTER_AUTH_SECRET`, an explicit `MAIL_TRANSPORT` (with `SMTP_URL` and `MAIL_FROM` for
`smtp`), and `AUTH_TRUSTED_PROXY_HOPS` only after verifying the platform's proxy chain: with the
candidate value deployed, make one sign-in attempt from a machine whose public address you know,
once without and once with a deliberately spoofed `X-Forwarded-For` header, and confirm the
`rate_limits` row key is `<your public address>|/sign-in/email` both times (details in
`backend/src/auth/client-ip.ts`). Until that check passes, leave the hop count at `0`.

Verification commands (run from the repository root; `npm run` wrappers may be blocked by local
policy, in which case invoke the binaries under `node_modules` with `node` directly):

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run test:unit
```

```bash
npm run test:integration
```

```bash
npm run build
```

```bash
npm run test:e2e
```
