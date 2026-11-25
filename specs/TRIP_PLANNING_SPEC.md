# Tennessee Natural Landmarks Explorer
## Specification 5 — Trip Planning and Management

**Status:** **Approved — Version 1.1, November 23, 2026** (M05-T01; §6.4 stop-add error precedence amended November 23, 2026 in M05-T03 — see §11). Version 1.1 is the current approved specification; it amends Version 1.0 (approved October 29, 2026), which is superseded. It was prepared from the design decisions T1–T16 that the developer approved on November 23, 2026 (recorded in `docs/IMPLEMENTATION_PLAN.md` under M05-T01 and in ADR-014, Accepted November 23, 2026). Passages changed by the amendment are marked *(v1.1)*; the replaced Version 1.0 text and the amendment history are preserved in §11. Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (see §10.5); production trip sharing is additionally gated by §10.6 *(v1.1)*.  
**Version:** 1.1 — November 23, 2026 (amends 1.0 — October 29, 2026)  
**Requirements:** FR-11, FR-12  
**Related decisions:** ADR-002 (Express API), ADR-003 (PostgreSQL/PostGIS/Prisma), ADR-006 (Better Auth), ADR-007 (offline saved trips), ADR-009 (testing), ADR-010 (migration workflow), ADR-011 (schema conventions), ADR-012 (authorization conventions), ADR-013 (Unicode text rules, by reference), ADR-014 (trip model and API alignment) *(v1.1)*

---

## 1. Purpose and Scope

Authenticated users can create personal trips, select landmarks as stops, arrange their order, view trip details, rename trips, and delete trips. Trips are private by default; owners may explicitly enable read-only public sharing through an unguessable share link. A trip is a manually ordered collection of landmark stops, **not** a navigational route or itinerary with calculated travel times.

**In scope:** authenticated CRUD; optional read-only sharing via owner-controlled links; adding/removing/reordering stops; ownership enforcement; basic trip and stop display; straight-line distances between adjacent available stops (§5.6) and a supplementary map of available stops (§8) *(v1.1)*; stable references to imported landmarks; error/loading/empty states; tests; an offline-compatible data shape for Specification 6.

**Out of scope:** guest trip creation; route optimization; driving/walking directions; turn-by-turn navigation; travel, driving, walking, or trail distances and travel-time estimates; route lines drawn between stops *(v1.1)*; maps downloaded for offline use; collaborative trip editing; public trip discovery or indexing; automatic schedules, reservations, or trip cost estimates.

## 2. User Stories

- As a signed-in user, I can create a named trip.
- I can add landmarks from discovery or a landmark profile to one of my trips.
- I can view a trip's ordered stops and change their order manually.
- I can remove stops, rename the trip, and delete the trip.
- I can see when a previously saved landmark is no longer publicly available without exposing restricted location information.
- I cannot view or change another user's private trips; I can view a publicly shared trip only through its valid share link.
- I can enable or disable a read-only share link for my own trip.

## 3. Data Model and Invariants

### 3.1 Trip

- `id`: database-generated UUID (`gen_random_uuid()`), following ADR-011's conventions (table `trips`, snake_case columns). *(v1.1)*
- `user_id`: required Better Auth user foreign key; owner. `ON DELETE RESTRICT` (ADR-011 decision 7). *(v1.1)*
- `name`: required; validated by the rule in §5.1.1; 1–100 Unicode code points after trimming. *(v1.1)*
- `created_at`, `updated_at`: server-managed timestamps. Every successful trip or stop mutation sets `updated_at` to the database's current time. *(v1.1)*
- `version`: server-managed optimistic-concurrency integer, starting at 0 and incremented by exactly 1 for every successful trip/stop mutation (including rename, stop add/remove/reorder, and share enable/rotate/revoke). *(v1.1)*
- `share_token_hash`: nullable securely hashed random share token; null means private. Raw token must not be stored in plaintext. Sharing must be explicitly enabled by the owner. The hash is a SHA-256 digest of the raw token, unique when present (§10.3). *(v1.1)*

### 3.2 Trip Stop

- `id`: stable internal ID — a database-generated UUID. *(v1.1)*
- `trip_id`: required foreign key, cascade delete when trip is deleted.
- `landmark_id`: required foreign key to the stable internal landmark ID (never GPX `source_code`). `ON DELETE RESTRICT`. *(v1.1)*
- `position`: required nonnegative integer used for ordering.
- `created_at`: server-managed timestamp.

For each trip, positions must be contiguous (`0...n-1`) after every successful mutation. Stop ordering changes must be transactional. A trip can contain zero stops.

A landmark can appear only once in the same trip; enforce database uniqueness on (`trip_id`, `landmark_id`). A trip may contain at most **25 stops**; enforce on the server inside the write transaction.

Landmark retirement or reactivation must not break existing trip-stop foreign keys. Deleting a trip removes its stops, not landmark records.

**Database constraints** *(v1.1; verified against PostgreSQL 17.5 during M05-T01 — see ADR-014)*:

- `CHECK (position >= 0)`.
- `UNIQUE (trip_id, landmark_id)` — an ordinary (non-deferrable) constraint, because stop addition uses it as the `ON CONFLICT` arbiter and PostgreSQL does not accept deferrable constraints as arbiters.
- `UNIQUE (trip_id, position)` declared **`DEFERRABLE INITIALLY IMMEDIATE`**, so it is checked at the end of each SQL statement rather than after each row. This is what allows a reorder to rewrite all positions in one statement and a removal to shift the following positions down in one statement; an ordinary unique constraint rejects both (PostgreSQL checks non-deferrable uniqueness row by row). `INITIALLY DEFERRED` is not used, so a violation is reported by the statement that causes it, not at commit.
- `trips`: `CHECK (char_length(name) BETWEEN 1 AND 100)` as a backstop; the full name rule (§5.1.1) is enforced by the service, as review text is (ADR-013 decision 2).
- Prisma's schema language cannot express `DEFERRABLE`. The `(trip_id, position)` constraint is therefore hand-written in the reviewed migration SQL (ADR-010, ADR-011 decision 10), and **every future Prisma migration must preserve it**: a migration that drops, recreates, or redeclares it must keep `DEFERRABLE INITIALLY IMMEDIATE`, and a test must assert the constraint's deferrability from the database catalog.

## 4. Authentication, Authorization, and Privacy

- All owner trip endpoints require a valid Better Auth session. The dedicated public shared-trip read endpoint is the only unauthenticated exception.
- Owner endpoints are mounted only through `mountProtected` at `/trips` (ADR-012 decision 1); the public shared-trip endpoint is a reviewed GET-only allowlist entry (ADR-012 decision 9). *(v1.1)*
- The authenticated user ID comes from the server session, never from a request-provided owner field.
- Every trip lookup, edit, deletion, and stop mutation is scoped to the current user.
- Missing and non-owned trip IDs return the same generic `404` response; do not reveal whether another user's trip exists.
- Unauthenticated requests return the project-standard `401` response.
- All state-changing endpoints follow the CSRF, cookie, Origin/Referer, and rate-limit protections established in Specification 3.
- Trip names are rendered as plain text, never unsanitized HTML.
- Trips are private by default and must not be publicly listed or indexed. Only an explicitly enabled, unguessable share link may provide read-only access.
- Shared views expose only the trip name and safe ordered stop summaries; never expose owner IDs, email addresses, internal share token hashes, or private metadata.
- A public shared-trip endpoint must apply the same retired/sensitive landmark redaction as the owner view and must never expose restricted coordinates or metadata. Every public trip response must apply the guard server-side before JSON serialization. For each stop whose landmark has `is_active === false` or `sensitivity_status !== 'PUBLIC'` (i.e., `SENSITIVE` or `UNREVIEWED`), preserve the trip-stop ID and position, but replace the landmark summary with `{ "id": "<landmark-id>", "is_available": false }`. Do not include its display name, coordinates, category, source metadata, or profile URL. A missing referenced landmark must receive the same redaction.
- **The owner view applies exactly the same visibility test and redaction** as the shared view: a stop is *available* only when its landmark currently exists, `is_active` is true, and `sensitivity_status` is `PUBLIC`, evaluated when the trip is read, in the same SQL statement that reads the stops. Coordinates and every other landmark field are included only for available stops (§7.2), and responses are built from an explicit field allowlist, never by spreading a database row. *(v1.1)*
- Share tokens must contain at least 32 cryptographically secure random bytes (for example, `crypto.randomBytes(32)` encoded as base64url), be stored only as a secure hash, checked without exposing token validity through sensitive error details, and be revocable by the owner. The raw token is returned only when created or rotated; lost tokens require rotation. Disabling sharing immediately revokes the token. Every explicit enable or re-enable action issues a new token and invalidates any previous token; merely viewing sharing settings does not rotate the token.
- Shared responses must not be cached in publicly shared caches or indexed by search engines; use appropriate `Cache-Control` and `X-Robots-Tag` headers. Shared links can be forwarded by recipients, so the UI must disclose this limitation.
- Sharing is controlled by the server setting `TRIP_SHARING_ENABLED` (§10.6). The setting is a safeguard only; **it does not by itself satisfy any production release requirement**. *(v1.1)*

## 5. Trip Creation and Management

### 5.1 Create

- A signed-in user may create a trip with a valid name.
- Newly created trips contain no stops unless a specifically supported add-to-trip workflow creates a trip and adds a stop atomically. *(No such atomic workflow is provided in v1.1; "New trip" in the add-to-trip flow creates the trip and then adds the stop as two requests — §8.)* *(v1.1)*
- Invalid names return a validation error without creating a trip.

#### 5.1.1 Trip-name rule *(v1.1)*

Applied identically to create and rename, by the server (authoritative) and mirrored by the client. The steps run in this order; the first failure returns `400 INVALID_REQUEST` with a fixed message that never echoes the input.

1. The value must be a JSON string.
2. It must be well-formed Unicode: no unpaired UTF-16 surrogate (`String.prototype.isWellFormed()`).
3. Trim leading and trailing whitespace with ECMAScript `String.prototype.trim()`. Tabs, line breaks, and other whitespace **at either end** are removed and therefore allowed.
4. After trimming, the name must contain **no control or line-separator character anywhere**: U+0000–U+001F (including tab U+0009, line feed U+000A, carriage return U+000D, and NUL), U+007F, U+0080–U+009F (including U+0085 NEXT LINE, which `trim()` does not remove), U+2028 LINE SEPARATOR, and U+2029 PARAGRAPH SEPARATOR. Format characters (General Category `Cf` — for example U+200D ZERO WIDTH JOINER, U+200C ZERO WIDTH NON-JOINER, U+00AD SOFT HYPHEN, and bidirectional marks) are allowed inside a name; names are always rendered direction-isolated (§8).
5. The name must contain **at least one visible character**: a code point whose Unicode General Category is a Letter (`L*`: Lu, Ll, Lt, Lm, Lo), Number (`N*`: Nd, Nl, No), Punctuation (`P*`: Pc, Pd, Ps, Pe, Pi, Pf, Po), or Symbol (`S*`: Sm, Sc, Sk, So) — in JavaScript, `/[\p{L}\p{N}\p{P}\p{S}]/u`. Marks (`M*`), separators (`Z*`), and other categories (`C*`: control, format, surrogate, private use, unassigned) are not visible characters and cannot satisfy the rule alone.
6. Its length, counted in **Unicode code points** (the unit PostgreSQL's `char_length` counts in a UTF-8 database), must be at most 100.

No Unicode normalization is applied; the stored name is exactly the trimmed input.

| Input (code points) | Result | Why |
|---|---|---|
| `"  Smoky Falls\n"` | valid, stored `"Smoky Falls"` | outer whitespace trimmed |
| `"Day 1\tFalls"` | rejected | internal tab |
| `"Line one` + U+000A + `two"` | rejected | internal line feed |
| `"e"` + U+0301 (é as base + combining acute) | valid, 2 code points | `e` is a letter; the mark is allowed but not counted as visible |
| U+0301 alone, or several combining marks only | rejected | marks are not visible characters |
| U+1F3DE U+FE0F (a national-park emoji with emoji-presentation selector) | valid, 2 code points | U+1F3DE is a symbol (`So`); U+FE0F is a mark |
| A ZWJ emoji sequence such as U+1F469 U+200D U+1F469 U+200D U+1F467 (a family emoji) | valid, 5 code points | emoji components are `So`; ZWJ is `Cf` |
| A flag such as U+1F1F9 U+1F1F3 (two regional indicators) | valid, 2 code points | regional indicators are `So` |
| A keycap such as U+0031 U+FE0F U+20E3 | valid, 3 code points | `1` is a number |
| U+FE0F, U+200B, U+200D, or U+2060 alone (or only such characters) | rejected | no visible character |
| Private-use characters only (U+E000–U+F8FF) | rejected | `Co` is not visible |
| U+00A0 or U+3000 only | rejected | trimmed to empty |
| `"Café"` + U+0085 | rejected | NEXT LINE is a control character not removed by `trim()` |
| 100 code points including astral emoji | valid | counted in code points, not UTF-16 units |
| 101 code points after trimming | rejected | over the limit |

**Parity:** the frontend and backend implement this rule independently and must agree. Both sides are tested against one shared, ASCII-only test corpus (code points written as `U+XXXX`) covering every row above plus the boundaries, following the M04-T04 review-text parity pattern; each side pins the same corpus fingerprint. Category tests depend on the runtime's Unicode version, so a character assigned after a given browser's Unicode version may be classified differently on the client; the server's result is authoritative, and the client shows the server's validation error.

### 5.2 List

- Show the user's trips, most recently updated first, with stable ID tie-breaking.
- Display trip name, stop count, and last-updated date.
- Empty state: explain that no trips exist and provide a Create Trip action.
- Pagination is required; `page=1`, `limit=20`, maximum `100`.

### 5.3 View

- Show trip name and ordered stops.
- Each available stop shows a safe landmark summary and a link to its profile.
- Stops whose landmark is not currently available — retired, `SENSITIVE`, `UNREVIEWED`, or missing (§4) — show **"No longer available"** without coordinates, location details, or a profile link. Stop removal remains available. *(v1.1)*
- A trip with zero stops has an actionable empty state.
- Straight-line distances between adjacent available stops, and a partial or complete straight-line total, are shown as defined in §5.6. *(v1.1)*

### 5.4 Public Sharing

- A trip starts private. The owner may explicitly enable a read-only share link or disable an existing link.
- Anyone possessing a currently valid share link may view the trip without signing in, but may not add, remove, reorder, rename, or delete anything.
- Sharing is by possession of an unguessable link only; there is no searchable public directory or public owner profile.
- Revocation immediately invalidates the prior link. Each explicit enable/re-enable action invalidates the previous token and generates a fresh independent token; viewing the current sharing state does not rotate it.
- The shared response includes only safe fields and redacts retired/sensitive landmarks before serialization. Stop order and count remain intact.
- Deleting a trip also invalidates its share link.
- **Release gate** *(v1.1)*: sharing is fully specified and implemented, but it must not be enabled in production until both release blockers in §10.6 are resolved and the developer explicitly approves enabling it. While `TRIP_SHARING_ENABLED` is off, enabling a link returns `409 TRIP_SHARING_UNAVAILABLE`, every shared-link request returns the generic `404`, and the interface hides the share controls.

### 5.5 Rename and Delete

- Owners may rename their trips using the same name validation as creation.
- A rename request may include the last observed `version`; when it does and the version is stale, the rename returns `409 TRIP_VERSION_CONFLICT` and changes nothing. The interface always sends it. *(v1.1)*
- Owners may delete a trip after a confirmation step in the UI.
- Deletion removes the trip and its trip-stop records in one transaction.
- A successful deletion cannot delete landmark records, reviews, or favorites.

### 5.6 Straight-Line Distances *(v1.1)*

Trip planning presents geographic separation only, never travel distance.

- **Legs.** For a trip with `n` stops there are `max(n − 1, 0)` legs; leg *i* joins the stops at positions *i − 1* and *i*. A leg is **measured** only when both of its stops are available (§4). A leg with an unavailable stop at either end is **not measured**, and no distance is ever computed across or around an unavailable stop (a distance touching a hidden stop could reveal its location, and a distance that skips it would misstate the itinerary).
- **Calculation.** Measured legs use the same geodesic calculation as proximity discovery (Specification 2): PostGIS `ST_Distance` on `geography` values of the stops' WGS84 coordinates, computed by the server at read time. The API returns unrounded miles; the interface shows miles to one decimal place with the kilometre equivalent (1 mile = 1.609344 km), as Specification 2 does.
- **Per stop.** `distance_from_previous_miles` is the measured leg ending at that stop, or `null` for the first stop and for any unmeasured leg.
- **Total.** `distance_summary` is `{ total_miles, measured_legs, total_legs }`: `total_legs = max(n − 1, 0)`; `measured_legs` is the number of measured legs; `total_miles` is the sum of the measured legs, or `null` when `measured_legs` is 0. The total is **complete** when `measured_legs = total_legs` and **partial** otherwise.
- **Labels.** Every distance and total is labelled as straight-line distance that is not a travel, driving, walking, or trail distance. A partial total is labelled with the number of measured legs (for example, "Straight-line total of 1 of 3 legs") and explains that legs next to an unavailable stop are not measured. A trip with fewer than two stops shows no total.
- **Example.** Stops A, B, C, D with B unavailable: A→B and B→C are not measured; C→D is measured. `distance_summary` = `{ total_miles: <C→D>, measured_legs: 1, total_legs: 3 }` (partial).
- The same rules apply to the shared view.

## 6. Stop Management

### 6.1 Add Stop

- A signed-in user may add an active, publicly eligible landmark to one of their trips from discovery or a profile.
- Server validates landmark existence and public eligibility; unknown, retired, or sensitive landmarks are not addable. *(Unknown, retired, `SENSITIVE`, and `UNREVIEWED` landmarks return the generic `404`.)* *(v1.1)*
- Adding a stop appends it to the end of the trip.
- If the trip already contains 25 stops, reject the addition with `409 TRIP_STOP_LIMIT_REACHED` and do not modify the trip. *(v1.1)*
- Adding a duplicate landmark returns `409 Conflict` (`TRIP_STOP_ALREADY_EXISTS`) and leaves the trip unchanged. *(v1.1)*
- Server transaction and database constraints prevent duplicate positions under concurrent requests.

### 6.2 Remove Stop

- Owners can remove a stop from their own trip, including unavailable stops.
- Remaining positions are compacted atomically.
- Removing a stop does not remove the landmark or affect other trips.

### 6.3 Reorder Stops

- Owners can explicitly reorder stops through accessible controls (e.g., Move Up/Move Down); drag-and-drop may supplement but not replace keyboard support.
- The client submits the complete ordered list of trip-stop IDs.
- Server validates that each existing stop appears exactly once, no unknown IDs are included, and all IDs belong to the specified trip.
- The reorder is atomic: invalid lists leave the original order unchanged.
- The request must include the last observed trip `version`. A stale version returns `409 Conflict` without changing stop order; successful reorders increment the version.
- Order of checks *(v1.1)*: the request shape (a `version` integer and a non-empty list of well-formed, distinct stop IDs) is validated before any lookup (`400 INVALID_REQUEST`); then, under the trip lock (§6.4), a stale `version` returns `409 TRIP_VERSION_CONFLICT`; then a list that does not contain exactly the trip's current stop IDs returns `400 INVALID_REQUEST` — the same response whether an ID is unknown or belongs to another trip.

### 6.4 Transactions and Concurrency *(v1.1)*

Every stop mutation, rename, and share change runs in a single database transaction that first locks the owner's trip row:

`SELECT … FROM trips WHERE id = $tripId AND user_id = $userId FOR UPDATE`

No row means `404` (missing and non-owned are indistinguishable). Mutations of the same trip are therefore serialized; mutations of different trips never wait for each other, and each operation takes exactly one trip-row lock, so trips cannot deadlock one another.

| Operation | Inside the transaction, after the lock |
|---|---|
| Add stop *(amended November 23, 2026 — see §11)* | Checks in this order, all under the trip-row lock: (1) the trip is missing or not owned → the generic `404` (the lock statement itself); (2) the landmark is missing, inactive, `SENSITIVE`, or `UNREVIEWED` → the generic `404`; (3) the visible landmark is already in this trip → `409 TRIP_STOP_ALREADY_EXISTS`; (4) the trip already contains 25 stops → `409 TRIP_STOP_LIMIT_REACHED`; (5) otherwise insert at `position = count`, with `ON CONFLICT (trip_id, landmark_id) DO NOTHING` kept as the uniqueness backstop, then `version = version + 1` (exactly once) and `updated_at = now()`. Consequently, on a full trip an unavailable or nonexistent landmark answers `404` and a landmark already in the trip answers `409 TRIP_STOP_ALREADY_EXISTS`; only a new, visible landmark answers `409 TRIP_STOP_LIMIT_REACHED`. |
| Remove stop | Delete the stop scoped to the locked trip (no row → `404`); shift every later stop down by one in a single statement; then increment `version` and set `updated_at`. |
| Reorder | Check `version` (§6.3); check the ID set; rewrite every position in a single `UPDATE … FROM unnest(…)` statement; then increment `version` and set `updated_at`. |
| Rename | If a `version` is supplied and stale → `409 TRIP_VERSION_CONFLICT`; otherwise update the name, increment `version`, set `updated_at`. |
| Enable/rotate or revoke sharing | Replace or clear `share_token_hash`; increment `version`; set `updated_at`. |
| Delete trip | Delete the trip (its stops cascade). Later mutations of it return `404`. |

These rules satisfy §9 #10: concurrent additions cannot produce duplicate positions or exceed 25 stops, and a reorder prepared against an older view of the trip — including one that predates another add or remove — is rejected with `409` instead of silently undoing the other change. Stop additions and removals do not take a `version`; they compose correctly under the lock. Responses with no body (`204`) carry no version, so after an add or remove the client reloads the trip before a reorder.

## 7. Proposed REST API Contract

All endpoints are under `/api/v1` and return JSON. The precise common error envelope must remain consistent with Specifications 2–4.

| Method | Endpoint | Behavior |
|---|---|---|
| `GET` | `/trips?page=&limit=` | List current user's trips |
| `POST` | `/trips` | Create trip `{ "name": "..." }`; `201` |
| `GET` | `/trips/:tripId` | Trip details and ordered stops |
| `PATCH` | `/trips/:tripId` | Rename trip `{ "name": "...", "version": 3 }` (`version` optional — §5.5) *(v1.1)* |
| `DELETE` | `/trips/:tripId` | Delete trip and its stops |
| `POST` | `/trips/:tripId/stops` | Add stop `{ "landmark_id": "..." }` |
| `DELETE` | `/trips/:tripId/stops/:stopId` | Remove stop |
| `PUT` | `/trips/:tripId/stops/order` | Replace ordering `{ "stop_ids": ["..."], "version": 3 }` |
| `POST` | `/trips/:tripId/share` | Owner explicitly enables or rotates share link; atomically invalidates prior token and returns full link once |
| `DELETE` | `/trips/:tripId/share` | Owner revokes share link |
| `GET` | `/shared/trips/:shareToken` | Public read-only safe trip view; no session required |

**Example owner response** *(v1.1 — follows §7.2; IDs, coordinates, and the distance are illustrative)*: three stops, the first two available and the third unavailable. The leg into stop 2 is measured; the leg into stop 3 touches an unavailable stop and is not measured, so the total is partial (1 of 2 legs).

```json
{
  "trip": {
    "id": "trip-uuid",
    "name": "Weekend Waterfalls",
    "version": 3,
    "created_at": "2026-10-29T16:00:00.000Z",
    "updated_at": "2026-10-29T16:05:00.000Z",
    "is_shared": false,
    "sharing_enabled": true,
    "stops": [
      {
        "id": "stop-uuid-1",
        "position": 0,
        "is_available": true,
        "distance_from_previous_miles": null,
        "landmark": { "id": "landmark-uuid-1", "display_name": "Example Falls", "category": "falls", "latitude": 35.61, "longitude": -83.52 }
      },
      {
        "id": "stop-uuid-2",
        "position": 1,
        "is_available": true,
        "distance_from_previous_miles": 5.24,
        "landmark": { "id": "landmark-uuid-2", "display_name": "Example Arch", "category": "arch", "latitude": 35.66, "longitude": -83.45 }
      },
      {
        "id": "stop-uuid-3",
        "position": 2,
        "is_available": false,
        "distance_from_previous_miles": null,
        "landmark": { "id": "landmark-uuid-3", "is_available": false }
      }
    ],
    "distance_summary": { "total_miles": 5.24, "measured_legs": 1, "total_legs": 2 }
  }
}
```

The shared view of the same trip (`GET /shared/trips/:shareToken`) contains only `name`, `stops` (with identical stop objects), and `distance_summary` — no `id`, `version`, timestamps, `is_shared`, or `sharing_enabled` (§7.2).

A restricted stop must omit location-bearing fields and source metadata. Do not rely solely on the frontend to hide sensitive data.

**Mutation response rules:** Create trip and add stop return `201 Created` with the created resource; successful rename/reorder return `200 OK` with the updated trip and incremented version; successful trip deletion and stop removal return `204 No Content` with no body. Share-link revocation returns `204 No Content`. Duplicate add and stale version return `409`; malformed input returns `400` or the project-standard validation status. Ownership failures return `404`. All error bodies follow the project-standard error envelope.

**Public share response:** `{ "trip": { "name": "...", "stops": [ /* safe ordered summaries */ ] } }`. For unavailable stops, return a stop wrapper retaining its stop ID and `position`, with `landmark: { "id": "...", "is_available": false }`; omit all other landmark details. The `landmark.id` is an opaque internal ID, not a source code or location-bearing identifier. Redact before serialization for every public trip representation. A missing, revoked, or invalid token returns the same generic `404`. Do not include internal owner information or sensitive landmark details.

### 7.1 Mounting and Throttling *(v1.1)*

- Every `/trips` route is mounted only through `mountProtected(apiRouter, "/trips", …)` (ADR-012 decision 1); the order is `requireTrustedOrigin` → `noStore` → `requireSession` → router → `protectedRouteErrorHandler`, and every owner response, including errors, carries `Cache-Control: private, no-store`.
- `GET /api/v1/shared/trips/:shareToken` is a GET-only entry in the reviewed public allowlist (ADR-012 decision 9). It never reads the session and its response is identical for every caller.
- Owner routes are throttled per authenticated user and per process with the existing generic limiter: **60 mutations and 120 reads per 60-second window** (mutations: create, rename, delete, stop add/remove/reorder, share enable/revoke; reads: list and detail), answering `429 RATE_LIMITED` with `Retry-After`. The shared-trip endpoint is not throttled, consistent with the other public read routes (its token carries 256 bits of randomness).
- Checks run in the order origin → session → rate limit → validation → service, so a `400` never depends on whether a trip or stop exists.

### 7.2 Representations *(v1.1)*

**Landmark summary in a stop.** For an available stop (§4): `{ "id", "display_name", "category", "latitude", "longitude" }`, with `category` as the discovery API's category slug (for example `falls`, `arch`) — and nothing else (no descriptions, source code, source file, source metadata, or other columns). For an unavailable stop: exactly `{ "id": "<landmark-id>", "is_available": false }`. Each stop also carries a stop-level `"is_available"` boolean.

**Owner trip** (`GET /trips/:tripId`, create, rename, reorder): `{ "trip": { "id", "name", "version", "created_at", "updated_at", "is_shared", "sharing_enabled", "stops": [ { "id", "position", "is_available", "distance_from_previous_miles", "landmark" } ], "distance_summary": { "total_miles", "measured_legs", "total_legs" } } }`, with `stops` in position order. The example in §7 shows an available stop with a measured leg, an available first stop, and an unavailable stop. A newly created trip has `stops: []` and `distance_summary` `{ "total_miles": null, "measured_legs": 0, "total_legs": 0 }`.

`is_shared` reports whether a share link is currently active (never the token or its hash); `sharing_enabled` reports the server's `TRIP_SHARING_ENABLED` setting so the interface can hide share controls.

**Trip list** (`GET /trips`): `{ "trips": [ { "id", "name", "stop_count", "updated_at", "is_shared" } ], "page", "limit", "has_more" }`, ordered `updated_at DESC, id DESC` (§10.1).

**Add stop** (`201`): `{ "stop": { "id", "position", "is_available": true, "landmark": { … } } }`.

**Enable or rotate sharing** (`200`): `{ "share_url": "<public origin>/shared/trips/<token>" }`, built from the application's configured public origin (the origin used for password-reset links). This is the only response that ever contains the raw token.

**Shared trip** (`GET /shared/trips/:shareToken`, `200`): `{ "trip": { "name", "stops": [ { "id", "position", "is_available", "distance_from_previous_miles", "landmark" } ], "distance_summary" } }` — no trip ID, owner, version, timestamps, or sharing state. Response headers: `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`. The application page that displays a shared trip (`/shared/trips/:shareToken`) is also served with `X-Robots-Tag: noindex, nofollow` and a `noindex` robots meta tag, and the existing `strict-origin` Referrer-Policy keeps the token out of outgoing `Referer` headers.

Timestamps use ISO 8601 UTC with milliseconds, like the reviews API.

### 7.3 Error Responses *(v1.1 — aligned with ADR-012 and the reviews API)*

| Status and code | When |
|---|---|
| `400 INVALID_REQUEST` | Malformed `tripId`, `stopId`, or `landmark_id`; an invalid name (§5.1.1); a malformed reorder body; a reorder list that does not exactly match the trip's current stops; unexpected or client-supplied identity fields. Fixed messages that never echo input. |
| `400 INVALID_QUERY` | Invalid pagination; unexpected query parameters. |
| `401 UNAUTHENTICATED` | Any owner route without a valid session. |
| `403 INVALID_ORIGIN` | A cookie-bearing state-changing request without trusted origin evidence. Never used for ownership. |
| `404 NOT_FOUND` | A missing or non-owned trip or stop; adding a missing, retired, `SENSITIVE`, or `UNREVIEWED` landmark; a missing, revoked, malformed, or unknown share token; any shared-link request while sharing is disabled. |
| `409 TRIP_STOP_ALREADY_EXISTS` | Adding a landmark already in the trip. |
| `409 TRIP_STOP_LIMIT_REACHED` | Adding a 26th stop. |
| `409 TRIP_VERSION_CONFLICT` | A stale `version` on reorder (or on rename, when supplied). |
| `409 TRIP_SHARING_UNAVAILABLE` | Enabling or rotating a share link while `TRIP_SHARING_ENABLED` is off. |
| `429 RATE_LIMITED` | Throttled owner requests, with `Retry-After`. |
| `500 INTERNAL_ERROR` / `503 SERVICE_UNAVAILABLE` | Safe server errors with no internal detail. |

No error body includes a trip, stop, landmark, or share-token value.

## 8. UI and Accessibility

- Provide Create Trip, My Trips, Trip Detail, Rename, Delete, Add Stop, Remove Stop, and Reorder actions.
- Add-to-trip from a landmark profile or discovery view should prompt for one of the user's existing trips; creating a new trip from that flow may be supported if it remains simple and authenticated. *(v1.1: the picker lists the user's trips and offers "New trip", which creates the trip and then adds the stop as two requests; if the addition fails, the new empty trip remains and the error is shown.)*
- Disable or explain unavailable actions while a mutation is pending; avoid duplicate submissions.
- Provide an explicit Share Trip control with a clear indication that anyone with the link can view the trip; provide Copy Link and Disable Sharing actions. *(v1.1: hidden when the trip response reports `sharing_enabled: false`.)*
- Confirm destructive trip deletion; give clear feedback after success or failure.
- Preserve user-entered form values on recoverable errors.
- Provide keyboard-operable reorder controls, visible focus states, accessible names, and screen-reader announcements of position changes.
- Target WCAG 2.2 AA, consistent with the discovery specification.
- **Map** *(v1.1)*: the ordered stop list is the primary and fully accessible view. A supplementary map shows only available stops as numbered markers (the number equals the stop's position + 1, matching the list), fitted to those stops; each marker links to its landmark profile. No line, path, or route is drawn between stops. Unavailable stops do not appear on the map. A trip with no available stops shows its list (and empty state) without a map. The map reuses the existing Leaflet components and their keyboard behavior.
- **Distances** *(v1.1)*: shown in the stop list as defined in §5.6, with the straight-line wording visible next to the values, not only in a tooltip.
- **Names** *(v1.1)*: trip names are rendered as plain text with their direction isolated (as review text is), and the client mirrors the §5.1.1 rule, counting code points.

## 9. Acceptance Criteria and Tests

1. Anonymous users cannot create, read, edit, or delete trips or stops.
2. A user can create, list, view, rename, and delete only their own trips.
3. A user cannot access another user's trip by guessing IDs; unauthorized ownership probes return generic `404`.
4. Trip names reject empty or over-limit input; names are safely rendered.
5. Adding a valid landmark appends exactly one stop in the correct position.
6. Unknown, retired, or sensitive landmarks cannot be newly added.
7. Removing a stop compacts positions without affecting other trips.
8. Reordering with a valid complete ID list persists the exact requested order.
9. Reordering with missing, duplicate, foreign, or unknown stop IDs fails without changing the existing order.
10. Concurrent edits cannot create duplicate positions or silently lose changes.
11. Deleting a trip removes its stops but not landmark records, reviews, or favorites.
12. Retiring a landmark preserves existing trip-stop references and displays an unavailable placeholder without coordinates.
13. Reactivating a landmark restores its safe display in the existing trip without recreating the stop.
14. Trip-list pagination is stable and owner-scoped: default `page=1`, `limit=20`, maximum `limit=100`, sorted by `updated_at DESC, id DESC`.
15. The UI supports keyboard-only creation, removal, and reordering with useful error announcements.
16. API authorization, transaction behavior, and foreign-key constraints are tested against a real PostgreSQL test database.
17. Trip names are 1–100 characters after trimming, duplicate stops are blocked, and adding a 26th stop is rejected.
18. Trips are private by default and not discoverable without owner authentication or a valid share link.
19. A valid public share link permits read-only access without authentication; all mutations remain owner-only.
20. Revoking a share link immediately invalidates it; each explicit enable/re-enable action rotates the token, while simply viewing sharing settings does not.
21. Shared trip views never expose owner identifiers or coordinates/metadata for retired or sensitive landmarks; redacted stops retain their stop ID and position and expose only an opaque landmark ID plus `is_available: false`.
22. Stale trip versions cause atomic `409` responses on reorder; successful mutations increment the version.

*Added in v1.1:*

23. The trip-name rule (§5.1.1) is enforced on create and rename exactly as specified — internal tabs, line breaks, and other control characters rejected; outer whitespace trimmed; names without a visible character rejected; combining marks and emoji sequences handled per the §5.1.1 table; length counted in code points — and frontend/backend parity tests over one shared corpus agree on every case.
24. The owner and shared views include coordinates and other landmark fields only for stops whose landmark is currently active and `PUBLIC`; `UNREVIEWED`, `SENSITIVE`, retired, and missing landmarks receive the exact placeholder in both views, and responses contain no field outside the §7.2 allowlists.
25. Straight-line distances are correct against a real PostGIS test database; legs touching an unavailable stop are never measured; `distance_summary` reports `total_miles`, `measured_legs`, and `total_legs` exactly as in §5.6, including the interrupted-sequence and fewer-than-two-stops cases; the interface labels every distance as straight-line and marks partial totals.
26. Concurrent additions to one trip never exceed 25 stops or produce duplicate positions; concurrent duplicate additions produce exactly one stop and `409 TRIP_STOP_ALREADY_EXISTS`; a reorder racing an add or remove is rejected with `409 TRIP_VERSION_CONFLICT` and changes nothing.
27. The `(trip_id, position)` unique constraint exists and is `DEFERRABLE INITIALLY IMMEDIATE` in the database catalog; the `(trip_id, landmark_id)` unique constraint is not deferrable.
28. With `TRIP_SHARING_ENABLED` off, enabling a link returns `409 TRIP_SHARING_UNAVAILABLE`, every shared-link request returns the generic `404`, `sharing_enabled` is `false`, and the interface shows no share controls; with it on, §9 #19–#21 hold.
29. Shared responses carry `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`; raw share tokens never appear in logs, error bodies, trip responses, or the database.
30. The trip map shows only available stops, numbered to match the list, with no line drawn between stops.
31. All owner routes are covered by the deny-by-default route inventory and behavioral guard tests, and the shared-trip route is the only new public allowlist entry.

## 10. Confirmed Implementation Defaults and Dependencies

### 10.1 Pagination and Ordering

`GET /api/v1/trips` defaults to `page=1`, `limit=20`; the maximum limit is `100`. Results are ordered by `updated_at DESC, id DESC` and scoped to the authenticated owner. Invalid pagination parameters return the project-standard validation error.

### 10.2 Mutation Status Codes and Concurrency

- Trip creation and stop addition return `201 Created`.
- Successful rename and reorder return `200 OK` with the updated trip and its incremented `version`.
- Trip deletion and stop removal return `204 No Content` without a response body.
- Duplicate landmark addition and stale reorder version return `409 Conflict`, with no partial mutation.
- Share-link revocation returns `204 No Content`.
- All errors use the common project API error envelope.
- Enabling or rotating a share link returns `200 OK` with the share URL (§7.2); error codes are listed in §7.3; transaction rules are in §6.4. *(v1.1)*

### 10.3 Share-Link Generation and Rotation

Each explicit enable/re-enable or rotate operation atomically invalidates any previous share token and issues a fresh token generated from at least 32 cryptographically secure random bytes, encoded using a URL-safe format such as base64url. Store only a secure token hash in the database. Return the raw token/full URL only on creation or rotation; do not log it. Disabling sharing immediately revokes the token. Viewing the sharing settings does not rotate the token. A revoked, malformed, or unknown token yields the same generic `404`.

*(v1.1)* The token is exactly 32 bytes from `crypto.randomBytes(32)`, encoded base64url (43 characters). The stored hash is the hexadecimal SHA-256 digest of the token string, with a unique index; a request is resolved by hashing the presented token and looking the hash up, so no stored value is compared character by character. A fast hash is sufficient because the token is high-entropy and random, not a password. A path value that is not 43 base64url characters returns the generic `404` without a database lookup.

### 10.4 Shared-Trip Sensitive-Location Guard

Every public trip response must perform a server-side visibility check before JSON serialization. If a stop references a landmark with `is_active === false` or `sensitivity_status !== 'PUBLIC'` (i.e., `SENSITIVE` or `UNREVIEWED`), replace its landmark summary with `{ "id": "<opaque-landmark-id>", "is_available": false }`. Retain the trip-stop ID and position so itinerary order and count remain stable. Omit display name, coordinates, category, source metadata, and profile URL. Missing landmark records are treated as unavailable. No client-side hiding may substitute for this guard.

### 10.5 Cross-Specification Dependencies

The project-wide sensitive-location classification policy and the initial dataset review against it must be finalized before public sharing is enabled; the `sensitivity_status` (`UNREVIEWED`/`PUBLIC`/`SENSITIVE`) schema itself is resolved (see `docs/IMPLEMENTATION_PLAN.md` M01-T02), but no classification policy or initial classification review is approved by that schema decision. This approval candidate specifies the required *behavior* of the guard, not how landmarks are classified.

Specification 6 defines caching of explicitly saved trips and safe landmark summaries; offline trip editing, synchronization, and automatic publication of locally cached data remain out of scope.

*(v1.1)* Until real landmarks are classified `PUBLIC`, no real landmark can be added to a trip and every real stop would display as unavailable, so trip planning is verified with guarded synthetic `PUBLIC` fixtures (as favorites and reviews are). Trip responses never contain a share token, so they remain compatible with Specification 6's trip snapshots (§9.6 there).

### 10.6 Production Sharing Release Gate *(v1.1)*

Public trip sharing must not be enabled in production until **both** of the following release blockers are resolved **and** the developer explicitly approves enabling it:

1. **Sensitive-location classification** — the project-wide classification policy and the initial dataset review (§10.5, `specs/README.md`).
2. **Share-token exposure in access logs** — share tokens travel in the URL path, so the hosting platform's and any proxy's access logs may record them. The deployed logging configuration must be reviewed and the exposure removed or accepted by the developer, as for password-reset links (the existing reset-link access-log release blocker). The application itself never logs share tokens or share URLs.

`TRIP_SHARING_ENABLED` is the enforcement mechanism, not an approval. It defaults to **off** when `NODE_ENV=production` unless explicitly set to `true`, and to on in development and test environments. Setting it to `true` in production does **not** by itself satisfy either blocker or any other release requirement (Specification 7). Sharing remains a fully specified, implemented, and tested capability; only its production enablement is gated.

## 11. Amendment Record

### Version 1.1 — approved November 23, 2026 (M05-T01)

Prepared from the M05-T01 design decisions T1–T16 and seven clarifications that the developer approved on November 23, 2026, including a PostgreSQL 17.5 probe of the reorder and locking design (recorded in `docs/IMPLEMENTATION_PLAN.md` under M05-T01 and in ADR-014). Drafted as an approval candidate in M05-T01 Increment 1, corrected after conditional acceptance (the §7 example response), and **approved by the developer on November 23, 2026**, together with the acceptance of ADR-014 and the documented API response contracts; from that date Version 1.1 is the current approved specification and Version 1.0 is superseded (its replaced text is preserved below). **No approved functionality is removed, and no requirement is loosened**: sharing remains in scope; navigation, travel-time estimates, and route optimization remain out of scope; acceptance tests #1–#22 are unchanged and #23–#31 are added.

| Section | Change | Kind |
|---|---|---|
| Header | Status, version, related decisions (adds ADR-010–ADR-014) | Amendment tracking |
| §1 | In scope adds straight-line distances and a supplementary map; out of scope adds travel distances, travel-time estimates, and route lines | Additive / clarification |
| §3.1 | UUID per ADR-011; `user_id` RESTRICT; name rule by reference; `updated_at` and `version` semantics; SHA-256 token hash | Clarification |
| §3.2 | Stop UUID; `landmark_id` RESTRICT; database constraints, including the deferrable `(trip_id, position)` unique and its preservation | Clarification |
| §4 | Mounting; owner view uses the shared view's visibility test (hides `UNREVIEWED` too); field allowlists; sharing setting | Alignment (tightening) / additive |
| §5.1, §5.1.1 | No atomic create-and-add workflow; exact trip-name rule with control-character and visible-character requirements and parity tests | Clarification / **tightening** |
| §5.3 | "Retired or sensitive" → not currently available (adds `UNREVIEWED` and missing); distances | Alignment / additive |
| §5.4 | Production release gate and disabled-sharing behavior | Additive |
| §5.5 | Optional `version` on rename | Additive |
| §5.6 | Straight-line distances | Additive (new behavior) |
| §6.1, §6.3 | Error codes; order of checks | Clarification |
| §6.4 | Transactions and concurrency | Clarification |
| §7 | Rename row; example owner response replaced by a v1.1 example (available and unavailable stops, distance fields); §§7.1–7.3 mounting, throttling, representations, error table | Clarification / additive |
| §8 | Picker, sharing-control visibility, map, distances, name rendering | Clarification / additive |
| §9 | Tests #23–#31 added | Additive |
| §10.2, §10.3, §10.5 | Share response; token and hash details; synthetic-fixture verification and offline compatibility | Clarification |
| §10.6 | Production sharing release gate | Additive |

**Version 1.0 text replaced by this amendment (preserved for traceability):**

- Header: "**Status:** Approved — October 29, 2026. Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (see §10.5)."; "**Version:** 1.0 — October 29, 2026"; "**Related decisions:** ADR-002 (Express API), ADR-003 (PostgreSQL/PostGIS/Prisma), ADR-006 (Better Auth), ADR-007 (offline saved trips), ADR-009 (testing)"
- §1 In scope: "authenticated CRUD; optional read-only sharing via owner-controlled links; adding/removing/reordering stops; ownership enforcement; basic trip and stop display; stable references to imported landmarks; error/loading/empty states; tests; an offline-compatible data shape for Specification 6."
- §1 Out of scope: "guest trip creation; route optimization; driving/walking directions; turn-by-turn navigation; maps downloaded for offline use; collaborative trip editing; public trip discovery or indexing; automatic schedules, reservations, or trip cost estimates."
- §3.1: "`id`: stable internal UUID (or project-standard generated ID; confirm consistency with existing schema)."; "`user_id`: required Better Auth user foreign key; owner."; "`name`: required, trimmed, nonempty; maximum 100 Unicode characters, minimum 1 after trimming."; "`created_at`, `updated_at`: server-managed timestamps."; "`version`: server-managed optimistic-concurrency integer, incremented for every successful trip/stop mutation."; "`share_token_hash`: nullable securely hashed random share token; null means private. Raw token must not be stored in plaintext. Sharing must be explicitly enabled by the owner."
- §3.2: "`id`: stable internal ID."; "`landmark_id`: required foreign key to the stable internal landmark ID (never GPX `source_code`)." (The "Database constraints" paragraph is new in v1.1.)
- §5.1: "Newly created trips contain no stops unless a specifically supported add-to-trip workflow creates a trip and adds a stop atomically." (§5.1.1 is new in v1.1.)
- §5.3: "Retired or sensitive landmarks show **“No longer available”** without coordinates, location details, or a profile link. Stop removal remains available." (The distance bullet is new in v1.1.)
- §6.1: "Server validates landmark existence and public eligibility; unknown, retired, or sensitive landmarks are not addable."; "If the trip already contains 25 stops, reject the addition with a validation/conflict response and do not modify the trip."; "Adding a duplicate landmark returns `409 Conflict` and leaves the trip unchanged."
- §7 route row: "`PATCH` | `/trips/:tripId` | Rename trip `{ "name": "..." }`" (§§7.1–7.3 are new in v1.1; the v1.0 mutation response rules and public share response paragraphs are retained unchanged.)
- §7 example owner response (v1.0, replaced in v1.1 because it predates §7.2 and omitted coordinates, `is_shared`, `sharing_enabled`, and the distance fields; its `"waterfalls"` category value also differs from the discovery API's slug, `falls`):

  ```json
  {
    "trip": {
      "id": "trip-uuid",
      "name": "Weekend Waterfalls",
      "version": 3,
      "created_at": "2026-10-29T16:00:00Z",
      "updated_at": "2026-10-29T16:00:00Z",
      "stops": [
        { "id": "stop-uuid", "position": 0, "landmark": { "id": "landmark-uuid", "display_name": "Example Falls", "category": "waterfalls" }, "is_available": true }
      ]
    }
  }
  ```
- §8: "Add-to-trip from a landmark profile or discovery view should prompt for one of the user's existing trips; creating a new trip from that flow may be supported if it remains simple and authenticated." and "Provide an explicit Share Trip control with a clear indication that anyone with the link can view the trip; provide Copy Link and Disable Sharing actions." are retained with v1.1 annotations; the map, distance, and name bullets are new.
- §4 (two bullets added; no v1.0 bullet removed or reworded), §5.4 (release-gate bullet added), §5.5 (version bullet added), §5.6 (new), §6.3 (order-of-checks bullet added), §6.4 (new), §9 (#23–#31 added), §10.2 (one bullet added), §10.3 (one paragraph added), §10.5 (one paragraph added), §10.6 (new), §11 (new).

### Amendment — November 23, 2026 (M05-T03 Increment 1): stop-add error precedence

Approved by the developer on November 23, 2026, during M05-T03 planning (revised decision on stop-add error precedence), together with the corresponding clarification of ADR-014 decision 4. The specification remains Version 1.1; only the §6.4 "Add stop" row changes. The outcomes are unchanged — `404`, `409 TRIP_STOP_ALREADY_EXISTS`, and `409 TRIP_STOP_LIMIT_REACHED` all remain, with the same codes — but their precedence is now explicit: the visibility and duplicate checks run **before** the capacity check, all under the owner-scoped trip-row lock. The only observable difference is on a full (25-stop) trip: an unavailable or nonexistent landmark now answers `404` (previously `409 TRIP_STOP_LIMIT_REACHED`), and a landmark already in the trip answers `409 TRIP_STOP_ALREADY_EXISTS` (previously `409 TRIP_STOP_LIMIT_REACHED`). No outcome depends on anything other than the caller's own trip and public landmark state, so the change discloses nothing new. §§6.1, 7.3, 9, and 10.2 are unchanged.

**Superseded §6.4 "Add stop" text (Version 1.1 as approved November 23, 2026, preserved for traceability):** "Count the trip's stops; if 25 → `409 TRIP_STOP_LIMIT_REACHED`. Insert at `position = count` in one statement that also checks landmark visibility and uses `ON CONFLICT (trip_id, landmark_id) DO NOTHING`; no row inserted → `404` when the landmark is not visible, otherwise `409 TRIP_STOP_ALREADY_EXISTS`. Then `version = version + 1`, `updated_at = now()`."

---

**End of Specification**
