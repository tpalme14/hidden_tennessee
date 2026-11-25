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

**Frontend pages (M03-T03).** `/register`, `/sign-in`, `/forgot-password`, and `/reset-password`
use these endpoints through the typed wrappers in `frontend/src/api/auth.ts`; the header shows the
signed-in address and a Sign out button, restored on reload from the session endpoint (nothing is
kept in browser storage). `frontend/index.html` sets a global `strict-origin` referrer policy, so
every Referer is the bare origin — never a path or query — while map tiles still receive the
Referer OpenStreetMap's tile policy requires. On `/reset-password`, `frontend/src/main.tsx` takes
the token out of the URL before React starts, keeps it in memory only, and sends it only in the
reset request's body. The Playwright server sets `AUTH_RATE_LIMIT_ENABLED=false` because the
journeys sign in and register repeatedly from one address.

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
A reset link's token is part of the first request for `/reset-password?token=…`, before any
script can remove it, so check whether the hosting platform's or any proxy's access logs keep
query strings, and treat those logs as sensitive for the token's 30-minute lifetime.

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

## Favorites API

Account-scoped favorites (API: M03-T05; the interface that uses it, M03-T06, is described in the
next section). Mounted with
`mountProtected` (ADR-012), so every request needs a valid session cookie, and its responses —
including errors — carry `Cache-Control: private, no-store` (the one exception: a malformed JSON
body still gets Express's default HTML `400`, an existing app-wide limitation). The full contract
and its verification are in the M03-T05 record of `docs/IMPLEMENTATION_PLAN.md`.

| Method and path                        | Success                                | Body                                      |
| -------------------------------------- | -------------------------------------- | ----------------------------------------- |
| `GET /api/v1/favorites?page&limit`     | `200`                                  | `{ favorites, page, limit, has_more }`    |
| `PUT /api/v1/favorites/:landmarkId`    | `201` newly saved, `200` already saved | `{ "success": true, "landmark_id": "…" }` |
| `DELETE /api/v1/favorites/:landmarkId` | `200` whether or not it was saved      | `{ "success": true, "landmark_id": "…" }` |

- **Identity:** taken only from the session; every query is scoped to that user. PUT and DELETE
  accept no query parameters and only an absent or empty JSON body; GET accepts only `page`
  (default 1) and `limit` (default 50, maximum 100). `:landmarkId` is the internal landmark UUID.
- **CSRF:** cookie-bearing PUT/DELETE requests need a trusted `Origin` (or a trusted `Referer`
  when `Origin` is absent); otherwise `403 INVALID_ORIGIN`, also with `no-store`.
- **Errors:** `400 INVALID_REQUEST` / `400 INVALID_QUERY`, `401 UNAUTHENTICATED`, `403
INVALID_ORIGIN`, `404 NOT_FOUND` (PUT on an unknown, retired, or not-yet-public landmark),
  `429 RATE_LIMITED` with `Retry-After`, `503 SERVICE_UNAVAILABLE`, `500 INTERNAL_ERROR`.
- **Ordering and throttling:** newest first. Each signed-in user may make 120 reads and 60
  changes per minute; counters are kept per server process.
- **Entries:** `available` (active, public: `id`, `display_name`, `category`, `latitude`,
  `longitude`), `redacted` (active, not yet public: `id`, `display_name`, `category`,
  `redacted: true`, no coordinates), or `unavailable` (retired: the landmark ID only; still
  removable). Only landmarks classified `PUBLIC` can be added, and none are classified yet.

## Favorites UI and E2E Fixtures

The favorites interface (M03-T06) adds a favorite toggle to full landmark profiles and the
geographic results list, and a **My Favorites** page at `/favorites` (linked in the navigation
only when signed in). Because no real landmark is classified `PUBLIC` yet, the real favorites
journeys in `e2e/favorites.spec.ts` run against synthetic landmarks created by the guarded helper
`e2e/helpers/favoritesFixtures.ts` (its guards are tested in `e2e/fixture-guard.spec.ts`):

- **`landmarks_test` only.** Every fixture statement runs in a transaction that first applies the
  existing test-database guard (`DATABASE_URL_TEST` on `localhost`/`127.0.0.1`, database
  `landmarks_test`) and then checks `current_database()` on the same connection before writing.
  Nothing is ever written to `landmarks_dev`.
- **What it writes.** Each test gets three synthetic landmarks (`ZZ…` source codes, names
  `E2E Fixture <run> <test> …`, located far outside Tennessee so other specs never see them).
  Favorites are created only through the real API or UI, never inserted directly. Teardown runs
  even when a test fails, and deletes only the rows that test recorded after verifying each one.
- **Leftovers.** A process killed mid-run can leave fixtures behind. They are never deleted
  automatically: each Playwright worker logs a read-only count of fixtures from earlier runs.
  Test-created accounts (`e2e-fav-…@example.com`) are kept, because account deletion is disabled.
- **Do not run backend integration tests and Playwright at the same time.** The integration
  suite resets `landmarks_test` (it truncates every application table), which would remove
  fixtures and accounts from under a running browser test. Run them one after the other.

## Reviews API

Landmark ratings and reviews (backend: M04-T02; the interface is M04-T03 — see "Reviews
interface" below). Specified by `specs/RATINGS_REVIEWS_SPEC.md` v1.1 and ADR-013; the full contract
and its verification are in the M04-T02 record of `docs/IMPLEMENTATION_PLAN.md`. The `reviews`
table comes from migration `20261121000000_reviews`.

| Method and path                             | Access      | Success                                                                                 |
| ------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `GET /api/v1/landmarks/:landmarkId/reviews` | Public      | `200` `{ reviews, aggregate: { average_rating, rating_count }, page, limit, has_more }` |
| `POST /api/v1/reviews`                      | Signed in   | `201` the new review                                                                    |
| `GET /api/v1/reviews?landmark_id=…`         | Signed in   | `200` `{ "review": … }`, or `{ "review": null }` if you have none                       |
| `PATCH /api/v1/reviews/:reviewId`           | Author only | `200` the updated review                                                                |
| `DELETE /api/v1/reviews/:reviewId`          | Author only | `200` `{ "success": true }`                                                             |

- **Review object:** `id`, `rating` (whole number 1–5), `body` (text or `null`), `created_at`,
  `updated_at` (ISO 8601, UTC, with milliseconds), and `author_label`, always
  `"Community Member"`. No user ID, email, or landmark data is ever returned.
- **Creating:** the body is `{ landmark_id, rating, body? }`. `body` is trimmed; empty text is
  stored as `null`; it may hold at most 2,000 characters, counted as Unicode code points; text
  containing NUL or broken surrogate pairs is rejected; nothing is normalized. One review per
  user per landmark — a second create is `409 REVIEW_ALREADY_EXISTS` (edit the existing review
  instead).
- **Editing:** send `rating`, `body`, or both. Leaving `body` out keeps the text; `body: null` (or
  whitespace) clears it.
- **Visibility:** only active landmarks classified `PUBLIC` have public reviews. For a missing,
  retired, `SENSITIVE`, or `UNREVIEWED` landmark, the list, create, lookup, and edit all answer
  the same `404 NOT_FOUND`; an author can still delete their own review by its ID. No landmark is
  classified `PUBLIC` yet, so the API is exercised with synthetic test landmarks only.
- **Public list:** identical for every caller (it never reads the session), newest first, `page`
  default 1 and `limit` default 20 (maximum 100). The aggregate covers all of the landmark's
  reviews; `average_rating` is the unrounded mean, or `null` when there are none.
- **Signed-in routes:** the session comes only from the cookie, and every query is scoped to that
  user; another user's review answers `404`, exactly like a missing one. Writes need a trusted
  `Origin` (otherwise `403 INVALID_ORIGIN`). Responses, including errors, carry
  `Cache-Control: private, no-store`.
- **Errors:** `400 INVALID_REQUEST` (body or ID) / `400 INVALID_QUERY` (query string),
  `401 UNAUTHENTICATED`, `403 INVALID_ORIGIN`, `404 NOT_FOUND`, `409 REVIEW_ALREADY_EXISTS`,
  `429 RATE_LIMITED` with `Retry-After`, `503 SERVICE_UNAVAILABLE`, `500 INTERNAL_ERROR`. A
  malformed or oversized (over 100 kB) JSON body still gets Express's default HTML response, and
  an unexpected error on the public list uses Express's default error page — which shows error
  details unless `NODE_ENV=production` (an existing app-wide follow-up).
- **Throttling:** each signed-in user may make 20 changes (creates, edits, and deletes combined)
  and 120 lookups per minute. Counters are kept per server process. The public list is not
  throttled.

### Review limits and protection

Verified in M04-T04 (record in `docs/IMPLEMENTATION_PLAN.md`):

- **Request size:** JSON bodies are limited to 100 kB (102,400 bytes; gzip is measured after
  decompression). Larger bodies get `413` before any review processing.
- **Rate-limit windows:** a user's 60-second window opens with their first allowed request and is
  fixed; `Retry-After` gives the whole seconds left (at least 1). Every admitted request counts,
  including invalid ones (`400`, `404`, `409`); refused requests (`429`) don't count and change
  nothing. Changes and lookups have separate counters. The limiter tracks at most 10,000 users
  at once: when full, a user it isn't already tracking gets `429` with `Retry-After: 60`, and one
  log line is written each time it fills.
- **Not covered:** there is no per-IP limit, so one person with several accounts gets each
  account's allowance; counters reset on restart and aren't shared between server processes.
- **Moderation:** valid reviews are published immediately. There is no approval queue, report
  button, content filter, or in-app removal; authors can delete their own reviews.
- **Text:** zero-width-only text (for example U+200B) is valid and can look empty. Text made of
  many stacked combining marks is clipped to its own box on the page; the full text is kept and
  shown when editing.
- **Concurrency:** a duplicate create racing another from the same user gets `409`, and an edit
  racing a delete of the same review gets `200` or `404`; aggregates always match the stored
  reviews.

`backend/tests/reviews-stress.integration.test.ts` (about 10 s) runs as part of the backend
integration suite and can also be run on its own by path. It creates and removes only its own
rows, and checks that every table's row count afterwards matches its count before the run.

## Reviews interface

The full profile of an active `PUBLIC` landmark (`/landmarks/:id`) has a **Reviews** section
(M04-T03): the average rating to one decimal place and the review count (or "No reviews yet"), a
reminder that reviews do not establish public access or safety, the reviews newest first with
**Show more reviews**, and — for a signed-in visitor — a form to write a review, or their own
review with **Edit** and **Delete** (deleting asks for confirmation first). Anonymous visitors
see a "Sign in to write a review" link that returns them to the page.

- Other people's reviews are attributed to "Community Member"; your own review is shown as
  "Your review". Review text is shown as plain text (HTML is never interpreted), and its
  direction is isolated so right-to-left or control characters cannot reorder the page.
- Nothing is shown as posted, saved, or deleted until the server confirms it. Drafts stay on the
  page if a request fails or your session ends (they are not stored anywhere else); signing in
  as a different account clears them.
- Forms have an error summary with links to the fields, success messages are announced, and
  focus moves to the relevant heading or control after each action. Everything works from the
  keyboard.

End-to-end coverage is in `e2e/reviews.spec.ts`, using the guarded fixtures described under
"Favorites UI and E2E Fixtures": teardown also deletes the reviews on the test's own fixture
landmarks (and only those), and the leftover report counts reviews on abandoned fixtures.
Test-created accounts (`e2e-rev-…@example.com`) are kept, like the favorites accounts.

## Trips API

Trip planning and sharing (backend: M05-T03; the trip interfaces are M05-T04 to M05-T06).
Specified by `specs/TRIP_PLANNING_SPEC.md` v1.1 (including its 2026-11-23 add-stop amendment) and
ADR-014; the full record and its verification are under M05-T03 in `docs/IMPLEMENTATION_PLAN.md`.
The tables come from migration `20261123000000_trips`.

> **API availability is not approval to share in production.** The sharing endpoints exist, but
> `TRIP_SHARING_ENABLED` is **off by default in production** (on in development and test). It
> must not be turned on in production until both release blockers recorded under M07-T05 are
> resolved — the sensitive-location classification policy and initial dataset review, and a
> review of share tokens in hosting and proxy access logs — and the developer explicitly approves
> it. The setting enforces that gate; it does not satisfy it.

| Method and path                              | Access | Success                                             |
| -------------------------------------------- | ------ | --------------------------------------------------- |
| `GET /api/v1/trips?page&limit`               | Owner  | `200` `{ trips, page, limit, has_more }`            |
| `POST /api/v1/trips`                         | Owner  | `201` `{ trip }`                                    |
| `GET /api/v1/trips/:tripId`                  | Owner  | `200` `{ trip }`                                    |
| `PATCH /api/v1/trips/:tripId`                | Owner  | `200` `{ trip }`                                    |
| `DELETE /api/v1/trips/:tripId`               | Owner  | `204`, no body                                      |
| `POST /api/v1/trips/:tripId/stops`           | Owner  | `201` `{ stop }`                                    |
| `DELETE /api/v1/trips/:tripId/stops/:stopId` | Owner  | `204`, no body                                      |
| `PUT /api/v1/trips/:tripId/stops/order`      | Owner  | `200` `{ trip }`                                    |
| `POST /api/v1/trips/:tripId/share`           | Owner  | `200` `{ share_url }`                               |
| `DELETE /api/v1/trips/:tripId/share`         | Owner  | `204`, no body                                      |
| `GET /api/v1/shared/trips/:shareToken`       | Public | `200` `{ trip: { name, stops, distance_summary } }` |

### Owner routes

- **Authentication and ownership:** every `/api/v1/trips` route needs a valid session cookie
  (`401 UNAUTHENTICATED` otherwise). The user comes only from the session; every query is scoped
  to that user, and another user's trip or stop answers `404 NOT_FOUND`, exactly like a missing
  one. Client-supplied identity fields (`user_id` and the like) are rejected with `400`.
- **CSRF:** cookie-bearing writes (`POST`, `PATCH`, `PUT`, `DELETE`) need a trusted `Origin` (or
  a trusted `Referer` when `Origin` is absent); otherwise `403 INVALID_ORIGIN`.
- **Order of checks:** origin → session → rate limit → validation → service, so a `400` never
  depends on whether a trip or stop exists. All responses, including errors, carry
  `Cache-Control: private, no-store`.
- **Validation:** IDs are UUIDs (any case). Bodies are strict JSON objects — unknown fields are
  `400 INVALID_REQUEST`; `DELETE` routes and share enable accept no body fields; only the list
  accepts query parameters (anything else is `400 INVALID_QUERY`). Error messages are fixed and
  never echo the input.
- **Trip names** (create `{ name }`, rename `{ name, version? }`): a string that, after trimming
  outer whitespace, contains no control or line-separator characters, has at least one letter,
  number, punctuation mark, or symbol, and is at most 100 characters counted as Unicode code
  points. Nothing is normalized; the trimmed name is stored as sent.
- **Owner trip** (`{ trip }`): `id`, `name`, `version`, `created_at`, `updated_at` (ISO 8601 UTC
  with milliseconds), `is_shared` (whether a link is active — never the token or its hash),
  `sharing_enabled` (the server setting, so the interface can hide share controls), `stops` in
  position order, and `distance_summary`. A new trip has `version: 0` and no stops.
- **List:** `page` (default 1) and `limit` (default 20, maximum 100), ordered by `updated_at`
  newest first, then `id`; each item is `{ id, name, stop_count, updated_at, is_shared }`.
- **Stops:** at most **25** per trip, each landmark at most once, positions `0 … n-1`. Adding
  (`{ landmark_id }`) appends; the `201` is `{ stop: { id, position, is_available: true,
landmark } }` with **no distance** (reload the trip for distances and the new `version`).
  Removing closes the gap. Removal works for unavailable stops too.
- **Add-stop errors, checked in this order** (Spec 5 §6.4 as amended 2026-11-23): trip missing
  or not yours → `404`; landmark missing, retired, `SENSITIVE`, or `UNREVIEWED` → `404`; landmark
  already in the trip → `409 TRIP_STOP_ALREADY_EXISTS`; trip already has 25 stops → `409
TRIP_STOP_LIMIT_REACHED`. So on a full trip only a new, visible landmark gets the limit error.
- **Versions and conflicts:** every successful change (rename, stop add/remove/reorder, share
  enable/revoke) increments `version` exactly once. Reorder requires `{ stop_ids, version }`:
  `stop_ids` lists every current stop exactly once. A stale `version` is `409
TRIP_VERSION_CONFLICT` (checked first); a list that is not exactly the trip's stops is `400
INVALID_REQUEST`. Rename may include `version` and gets the same `409` when it is stale. Nothing
  changes on any refusal. Changes to one trip are serialized by a row lock.
- **Other errors:** `429 RATE_LIMITED` with `Retry-After`, `503 SERVICE_UNAVAILABLE`, `500
INTERNAL_ERROR` (fixed body, no detail). A malformed JSON body still gets Express's default
  HTML `400` (the existing app-wide limitation).
- **Throttling:** per signed-in user, 60 changes (create, rename, delete, stop add/remove/reorder,
  share enable/revoke) and 120 reads (list and detail) per minute, with the same fixed-window,
  every-admitted-request-counts, 10,000-user-cap rules as reviews. Counters are per server
  process. The public shared-trip route is not throttled.

### Stops, redaction, and distances

- **Available stops:** a stop is available only when its landmark exists, is active, and is
  classified `PUBLIC`, checked every time the trip is read. Its `landmark` is exactly `{ id,
display_name, category, latitude, longitude }` (`category` is the discovery slug, such as
  `falls` or `arch`).
- **Unavailable stops** (retired, `SENSITIVE`, `UNREVIEWED`, or missing) keep their stop `id` and
  `position` but show only `landmark: { id, is_available: false }` — no name, coordinates,
  category, or source data — in both the owner and shared views. A reactivated landmark
  reappears without recreating the stop.
- **Distances are straight-line** geographic separation (PostGIS geodesic distance, in unrounded
  miles), **not travel, driving, walking, or trail distances**. `distance_from_previous_miles` is
  measured only between adjacent stops that are both available, and is `null` for the first stop
  and next to any unavailable stop (no distance is ever computed across or around one).
  `distance_summary` is `{ total_miles, measured_legs, total_legs }`; the total is partial when
  `measured_legs < total_legs`, and `total_miles` is `null` when nothing was measured.

### Sharing

- **Enable or rotate** (`POST …/share`): the owner gets `{ share_url }` —
  `<public origin>/shared/trips/<token>`, built from `BETTER_AUTH_URL` like password-reset links.
  The token is 32 random bytes as 43 base64url characters; only its SHA-256 hash is stored, and
  this response is the only place the token ever appears (a lost link must be rotated). Every
  enable issues a new token and immediately invalidates the previous one. A missing or
  someone else's trip is `404` first; then, for the owner only, sharing switched off is `409
TRIP_SHARING_UNAVAILABLE` with nothing changed.
- **Revoke** (`DELETE …/share`): `204`, invalidates the link at once, and works whether sharing
  is on or off. Revoking when no link is active still answers `204` and increments `version`.
  Deleting a trip also invalidates its link.
- **Public read** (`GET /api/v1/shared/trips/:shareToken`): no session needed, never reads or
  sets a cookie, identical for every caller. Returns only `{ trip: { name, stops,
distance_summary } }` — the same stop objects and redaction as the owner view, and no trip ID,
  owner, version, timestamps, or sharing state. Headers: `Cache-Control: no-store` and
  `X-Robots-Tag: noindex, nofollow`, on success and error alike. **Query parameters are ignored:**
  they are not filters or options and never change the response.
- **Generic 404:** a value that is not 43 base64url characters (answered without a database
  lookup), an unknown, rotated, or revoked token, a deleted trip, and every request while sharing
  is off all get the same `404 NOT_FOUND`. An unexpected failure gets the fixed JSON `500` and
  one log line with only an event code and error class — never the token or URL. (A malformed
  percent-encoded path such as `%E0%A4%A` still gets Express's default `400` before the route
  runs — the existing app-wide follow-up.)
- **Turning sharing off hides links; it does not revoke them.** While `TRIP_SHARING_ENABLED` is
  off, every shared link answers `404`, but tokens stay stored: if the setting is turned back on,
  **previously issued, unrevoked links work again**. Owners who want a link gone must revoke it
  (or rotate it). This is part of the production-release considerations under M07-T05.
- **Shared-trip page HTML** (`GET /shared/trips/<segment>`, served by the SPA fallback for any
  single segment, any case, trailing slashes allowed): `X-Robots-Tag: noindex, nofollow` and
  `Cache-Control: no-store`, whatever the token and whether or not sharing is enabled; other
  pages and static assets keep their usual headers.
- **Logs:** application code never logs tokens or share URLs, but the token travels in the URL
  path, so hosting and proxy access logs may record it — the access-log review is a separate
  M07-T05 release blocker.

## Trip planning interface

The trip interfaces: the trip page and "Add to trip" (M05-T04), nearby landmarks (M05-T05),
and My Trips, rename, delete, owner sharing, and the public shared-trip page (M05-T06). Built on
the Trips API above; the full records are under M05-T04 to M05-T06 in
`docs/IMPLEMENTATION_PLAN.md`. Trips plan geographic organization only: there is no route,
trail, or travel-distance calculation, no route optimization, and no offline trip access.

- **My Trips (`/trips`):** the "My Trips" link in the main navigation appears once you are
  signed in (signed out, `/trips` offers a sign-in link that returns there). It lists your
  trips 20 per page, most recently changed first (the server's order), each with its name,
  stop count, last-updated date, and "Shared" when a share link is active; Previous/Next keep
  the page in the URL (`?page=2`). An invalid page number shows page 1; a page past the end says
  so with a link back to page 1.
- **Creating a trip:** type a name in "New trip name" and choose "Create trip" (names follow the
  trip-name rule above; the server's message is shown on the field when it disagrees). You go
  straight to the new, empty trip, and its creation is announced once. If the connection fails
  after you submit, nothing is re-sent: the page says the trip may have been created and shows
  page 1 of your trips (newest first) so you can check before trying again.
- **Trip page (`/trips/:tripId`):** signed-in owners only — signed out, a sign-in link returns
  to the trip; a missing trip, someone else's trip, and a malformed link all show the same "This
  trip couldn't be found" message.
- **Renaming:** "Rename" opens a form with the current name; "Save name" sends the name with the
  trip's current version. If the trip changed elsewhere (`409`), the latest trip is shown and
  your typed name is kept for you to review and save again; an unknown outcome is checked
  against the re-read trip and never re-sent.
- **Deleting:** "Delete trip" asks for confirmation (the trip's stops are removed with it; the
  landmarks themselves are not deleted). After "Delete trip permanently" you return to My Trips
  with a one-time notice — "Deleted trip …", or "That trip is no longer available." when the
  trip was already gone (a qualified version when the request's own outcome was unknown).
- **Sharing (owner):** shown only when the server has sharing enabled (`sharing_enabled`).
  "Create share link" makes a read-only link: anyone who has it can see the trip's name, stops,
  and map without signing in, and can forward it. The link is shown in a read-only field with
  "Copy link" (manual copying works if the clipboard is unavailable). The link is shown only
  right after it is created — **it cannot be retrieved later** (only a hash is stored); after a
  reload the page says sharing is on but the link can't be shown again. **"Create new link"**
  replaces it: the previous link stops working at once. **"Turn off sharing"** makes the current
  link stop working. A received link is shown only after the trip is re-read and confirms it
  (sharing on, and the version exactly one higher); otherwise it is discarded with an
  explanation. Changes share the trip's one-change-at-a-time lock and are never re-sent
  automatically.
- **Shared trips (`/shared/trips/:shareToken`):** public and read-only — no sign-in, no editing
  controls, no owner information. The page shows the trip name, the ordered stops (unavailable
  stops as "No longer available"), straight-line distances, and the numbered map. A wrong,
  revoked, replaced, or deleted link — or any link while sharing is off on the server — shows the
  same "This shared trip isn't available…" message. The page HTML is sent with
  `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`, and the page adds a
  `noindex, nofollow` robots meta tag while it is open. With the app's `strict-origin` referrer
  policy, the browser sends only `http://<host>/` as the Referer from this page — same-origin and
  cross-origin — but the token is still part of the page and API request URLs, so hosting and
  proxy access logs can record it (a production release blocker; see below).
- **Stops** are an ordered list numbered "Stop 1, Stop 2, …" by the server's order. A stop whose
  landmark is retired or not public shows only "No longer available" — no name, link, category,
  or location — and can still be moved or removed.
- **Editing:** Move up, Move down, and Remove on every stop, all by keyboard. Nothing changes on
  screen until the server confirms; one change runs at a time. After a removal the trip is
  re-read before anything else; if the trip changed in another tab, a move is refused and the
  latest order shown ("This trip changed since you loaded it…"); if a change's outcome is unknown
  (lost connection), the trip is re-read and the change is never re-sent. Focus moves to the
  next sensible control, and every result is announced.
- **Distances** are the server's straight-line miles (and kilometres), labelled as such on the
  page with "Straight-line distances, not travel or trail distances." A leg next to an
  unavailable stop is not measured, and a partial total says how many legs it covers.
- **Map:** a supplementary map with numbered markers for available stops only (the numbers
  match the list), fitted to them, with no lines between stops — it shows locations, not a route.
  Markers work from the keyboard like the discovery map's. Stops at exactly the same
  coordinates share one marker showing up to two stop numbers and "+k" for the rest
  (for example "2,3" or "1,2 +23"); its popup lists every stop there with its own profile link.
- **Add to trip** appears on a public landmark's full profile and on each geographic result
  (never on a redacted or unavailable landmark). It opens a picker of your trips ("Show more
  trips" for more than 100) with a "New trip" option that creates the trip and then adds the
  landmark. If the trip is created but the landmark can't be added, the new trip is kept and
  "Try adding again" adds to that same trip. If an add's outcome is unknown, the next attempt
  first reads the trip and sends nothing more if the landmark is already there.
- **Nearby landmarks (M05-T05):** each available stop has "Find nearby". It opens one panel
  below the stop list and searches, only when asked, for public landmarks around that stop's
  exact location with the existing proximity search (`GET /api/v1/landmarks?near=…&radius=…`,
  the first 200 results, closest first). Nothing is fetched before then, and nothing is kept in
  the URL.
  - **Radius:** 5, 10, 25 (the default), 50, or 100 miles, with kilometres shown; the choice is
    kept for later searches until the page is reloaded.
  - **Distances** are the server's straight-line (geodesic) distances in miles and kilometres —
    not travel or trail distances. The stop itself is left out of the list; another landmark at
    exactly the same point is listed ("Less than 0.1 mi").
  - **Coverage:** when the server reports more matches than it returned, the panel says not
    every landmark in that radius is listed (choose a smaller radius); results that cannot be
    shown are counted, and an empty result only says nothing else is nearby when the search
    was complete and every item usable. While a new radius loads, or after it fails, the
    earlier results stay visible, labelled with the radius they belong to.
  - **Map:** a supplementary map inside the panel shows the stop (a dark square "Stop N"
    marker) and the listed results (round markers; a number shows how many share one point),
    with the same popups and keyboard behaviour as the trip map; the list stays the primary,
    complete view, and the trip's own numbered map is unchanged.
  - **Adding:** "Add to this trip" adds a result directly to this trip (no picker). Landmarks
    already in the trip show "In this trip (Stop N)"; a full trip (25 stops) says so; earlier
    results kept during an update cannot be added. Adds share the trip's one-change-at-a-time
    lock, and the trip is re-read from the server before anything is shown; an unknown outcome
    is checked against the re-read trip and never re-sent automatically.
- **Browser tests:** `e2e/trips.spec.ts` uses the guarded fixtures described under "Favorites UI
  and E2E Fixtures", plus four extra synthetic stop landmarks per test and accounts named
  `e2e-trip-…@example.com`. Teardown deletes those accounts' trips (and their stops on the
  test's fixtures) before the fixture landmarks; the accounts are kept, like the others. Tests
  marked `[intercepted]` reproduce failures by holding, failing, or answering one named request.
  `e2e/nearby.spec.ts` uses the same fixtures for the nearby panel and map; because other tests
  create fixture landmarks in the same region at the same time, it takes its expectations from
  the captured proximity response rather than from fixed counts (its keyboard walk sizes its Tab
  budget from the listed rows for the same reason). `e2e/my-trips.spec.ts` covers My Trips,
  creation, rename, conflicts, and deletion; `e2e/trip-sharing.spec.ts` covers the sharing
  lifecycle against the real API, the public page and its redaction, the page and API headers,
  the browser's credentials and Referer behavior, the clipboard, keyboard activation, and
  failure paths.
- **Test-only sharing setting:** the Playwright server (`playwright.config.ts`) runs in
  production mode with `TRIP_SHARING_ENABLED=true` so the sharing journeys can run. This is a
  test setting only: the production default stays off, and it is not approval to share in
  production.
- **Verification commands** (from the repository root unless noted; `DATABASE_URL_TEST` must
  name the local `landmarks_test` database for the integration and browser suites):
  `npm run test:unit --workspace frontend`, `npm run test:unit --workspace backend`,
  `npm run test:integration --workspace backend`, and `npm run build` followed by
  `npm run test:e2e` (Playwright serves the built `frontend/dist` and `backend/dist`).
- **Known limitations:** browser checks run in Chromium only, with map tiles stubbed and no
  screen reader; map needs-review accessibility items are deferred to the accessibility review;
  synthetic test accounts accumulate in `landmarks_test`.
- **Production prerequisites for sharing:** sharing stays off in production until the
  sensitive-location classification policy and initial dataset review are done, the hosting and
  proxy access logs have been reviewed for token-bearing request paths, a decision has been made
  about links issued earlier and never revoked (they work again if the setting is switched back
  on), and the developer explicitly approves enabling it — alongside the other release
  prerequisites (production email, trusted proxy and HTTPS, production environment settings).
