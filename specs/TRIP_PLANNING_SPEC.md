# Tennessee Natural Landmarks Explorer
## Specification 5 — Trip Planning and Management

**Status:** Approved — October 29, 2026. Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (see §10.5).  
**Version:** 1.0 — October 29, 2026  
**Requirements:** FR-11, FR-12  
**Related decisions:** ADR-002 (Express API), ADR-003 (PostgreSQL/PostGIS/Prisma), ADR-006 (Better Auth), ADR-007 (offline saved trips), ADR-009 (testing)

---

## 1. Purpose and Scope

Authenticated users can create personal trips, select landmarks as stops, arrange their order, view trip details, rename trips, and delete trips. Trips are private by default; owners may explicitly enable read-only public sharing through an unguessable share link. A trip is a manually ordered collection of landmark stops, **not** a navigational route or itinerary with calculated travel times.

**In scope:** authenticated CRUD; optional read-only sharing via owner-controlled links; adding/removing/reordering stops; ownership enforcement; basic trip and stop display; stable references to imported landmarks; error/loading/empty states; tests; an offline-compatible data shape for Specification 6.

**Out of scope:** guest trip creation; route optimization; driving/walking directions; turn-by-turn navigation; maps downloaded for offline use; collaborative trip editing; public trip discovery or indexing; automatic schedules, reservations, or trip cost estimates.

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

- `id`: stable internal UUID (or project-standard generated ID; confirm consistency with existing schema).
- `user_id`: required Better Auth user foreign key; owner.
- `name`: required, trimmed, nonempty; maximum 100 Unicode characters, minimum 1 after trimming.
- `created_at`, `updated_at`: server-managed timestamps.
- `version`: server-managed optimistic-concurrency integer, incremented for every successful trip/stop mutation.
- `share_token_hash`: nullable securely hashed random share token; null means private. Raw token must not be stored in plaintext. Sharing must be explicitly enabled by the owner.

### 3.2 Trip Stop

- `id`: stable internal ID.
- `trip_id`: required foreign key, cascade delete when trip is deleted.
- `landmark_id`: required foreign key to the stable internal landmark ID (never GPX `source_code`).
- `position`: required nonnegative integer used for ordering.
- `created_at`: server-managed timestamp.

For each trip, positions must be contiguous (`0...n-1`) after every successful mutation. Stop ordering changes must be transactional. A trip can contain zero stops.

A landmark can appear only once in the same trip; enforce database uniqueness on (`trip_id`, `landmark_id`). A trip may contain at most **25 stops**; enforce on the server inside the write transaction.

Landmark retirement or reactivation must not break existing trip-stop foreign keys. Deleting a trip removes its stops, not landmark records.

## 4. Authentication, Authorization, and Privacy

- All owner trip endpoints require a valid Better Auth session. The dedicated public shared-trip read endpoint is the only unauthenticated exception.
- The authenticated user ID comes from the server session, never from a request-provided owner field.
- Every trip lookup, edit, deletion, and stop mutation is scoped to the current user.
- Missing and non-owned trip IDs return the same generic `404` response; do not reveal whether another user's trip exists.
- Unauthenticated requests return the project-standard `401` response.
- All state-changing endpoints follow the CSRF, cookie, Origin/Referer, and rate-limit protections established in Specification 3.
- Trip names are rendered as plain text, never unsanitized HTML.
- Trips are private by default and must not be publicly listed or indexed. Only an explicitly enabled, unguessable share link may provide read-only access.
- Shared views expose only the trip name and safe ordered stop summaries; never expose owner IDs, email addresses, internal share token hashes, or private metadata.
- A public shared-trip endpoint must apply the same retired/sensitive landmark redaction as the owner view and must never expose restricted coordinates or metadata. Every public trip response must apply the guard server-side before JSON serialization. For each stop whose landmark has `is_active === false` or `sensitivity_status !== 'PUBLIC'` (i.e., `SENSITIVE` or `UNREVIEWED`), preserve the trip-stop ID and position, but replace the landmark summary with `{ "id": "<landmark-id>", "is_available": false }`. Do not include its display name, coordinates, category, source metadata, or profile URL. A missing referenced landmark must receive the same redaction.
- Share tokens must contain at least 32 cryptographically secure random bytes (for example, `crypto.randomBytes(32)` encoded as base64url), be stored only as a secure hash, checked without exposing token validity through sensitive error details, and be revocable by the owner. The raw token is returned only when created or rotated; lost tokens require rotation. Disabling sharing immediately revokes the token. Every explicit enable or re-enable action issues a new token and invalidates any previous token; merely viewing sharing settings does not rotate the token.
- Shared responses must not be cached in publicly shared caches or indexed by search engines; use appropriate `Cache-Control` and `X-Robots-Tag` headers. Shared links can be forwarded by recipients, so the UI must disclose this limitation.

## 5. Trip Creation and Management

### 5.1 Create

- A signed-in user may create a trip with a valid name.
- Newly created trips contain no stops unless a specifically supported add-to-trip workflow creates a trip and adds a stop atomically.
- Invalid names return a validation error without creating a trip.

### 5.2 List

- Show the user's trips, most recently updated first, with stable ID tie-breaking.
- Display trip name, stop count, and last-updated date.
- Empty state: explain that no trips exist and provide a Create Trip action.
- Pagination is required; `page=1`, `limit=20`, maximum `100`.

### 5.3 View

- Show trip name and ordered stops.
- Each available stop shows a safe landmark summary and a link to its profile.
- Retired or sensitive landmarks show **“No longer available”** without coordinates, location details, or a profile link. Stop removal remains available.
- A trip with zero stops has an actionable empty state.

### 5.4 Public Sharing

- A trip starts private. The owner may explicitly enable a read-only share link or disable an existing link.
- Anyone possessing a currently valid share link may view the trip without signing in, but may not add, remove, reorder, rename, or delete anything.
- Sharing is by possession of an unguessable link only; there is no searchable public directory or public owner profile.
- Revocation immediately invalidates the prior link. Each explicit enable/re-enable action invalidates the previous token and generates a fresh independent token; viewing the current sharing state does not rotate it.
- The shared response includes only safe fields and redacts retired/sensitive landmarks before serialization. Stop order and count remain intact.
- Deleting a trip also invalidates its share link.

### 5.5 Rename and Delete

- Owners may rename their trips using the same name validation as creation.
- Owners may delete a trip after a confirmation step in the UI.
- Deletion removes the trip and its trip-stop records in one transaction.
- A successful deletion cannot delete landmark records, reviews, or favorites.

## 6. Stop Management

### 6.1 Add Stop

- A signed-in user may add an active, publicly eligible landmark to one of their trips from discovery or a profile.
- Server validates landmark existence and public eligibility; unknown, retired, or sensitive landmarks are not addable.
- Adding a stop appends it to the end of the trip.
- If the trip already contains 25 stops, reject the addition with a validation/conflict response and do not modify the trip.
- Adding a duplicate landmark returns `409 Conflict` and leaves the trip unchanged.
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

## 7. Proposed REST API Contract

All endpoints are under `/api/v1` and return JSON. The precise common error envelope must remain consistent with Specifications 2–4.

| Method | Endpoint | Behavior |
|---|---|---|
| `GET` | `/trips?page=&limit=` | List current user's trips |
| `POST` | `/trips` | Create trip `{ "name": "..." }`; `201` |
| `GET` | `/trips/:tripId` | Trip details and ordered stops |
| `PATCH` | `/trips/:tripId` | Rename trip `{ "name": "..." }` |
| `DELETE` | `/trips/:tripId` | Delete trip and its stops |
| `POST` | `/trips/:tripId/stops` | Add stop `{ "landmark_id": "..." }` |
| `DELETE` | `/trips/:tripId/stops/:stopId` | Remove stop |
| `PUT` | `/trips/:tripId/stops/order` | Replace ordering `{ "stop_ids": ["..."], "version": 3 }` |
| `POST` | `/trips/:tripId/share` | Owner explicitly enables or rotates share link; atomically invalidates prior token and returns full link once |
| `DELETE` | `/trips/:tripId/share` | Owner revokes share link |
| `GET` | `/shared/trips/:shareToken` | Public read-only safe trip view; no session required |

**Example owner response:**

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

A restricted stop must omit location-bearing fields and source metadata. Do not rely solely on the frontend to hide sensitive data.

**Mutation response rules:** Create trip and add stop return `201 Created` with the created resource; successful rename/reorder return `200 OK` with the updated trip and incremented version; successful trip deletion and stop removal return `204 No Content` with no body. Share-link revocation returns `204 No Content`. Duplicate add and stale version return `409`; malformed input returns `400` or the project-standard validation status. Ownership failures return `404`. All error bodies follow the project-standard error envelope.

**Public share response:** `{ "trip": { "name": "...", "stops": [ /* safe ordered summaries */ ] } }`. For unavailable stops, return a stop wrapper retaining its stop ID and `position`, with `landmark: { "id": "...", "is_available": false }`; omit all other landmark details. The `landmark.id` is an opaque internal ID, not a source code or location-bearing identifier. Redact before serialization for every public trip representation. A missing, revoked, or invalid token returns the same generic `404`. Do not include internal owner information or sensitive landmark details.

## 8. UI and Accessibility

- Provide Create Trip, My Trips, Trip Detail, Rename, Delete, Add Stop, Remove Stop, and Reorder actions.
- Add-to-trip from a landmark profile or discovery view should prompt for one of the user's existing trips; creating a new trip from that flow may be supported if it remains simple and authenticated.
- Disable or explain unavailable actions while a mutation is pending; avoid duplicate submissions.
- Provide an explicit Share Trip control with a clear indication that anyone with the link can view the trip; provide Copy Link and Disable Sharing actions.
- Confirm destructive trip deletion; give clear feedback after success or failure.
- Preserve user-entered form values on recoverable errors.
- Provide keyboard-operable reorder controls, visible focus states, accessible names, and screen-reader announcements of position changes.
- Target WCAG 2.2 AA, consistent with the discovery specification.

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

### 10.3 Share-Link Generation and Rotation

Each explicit enable/re-enable or rotate operation atomically invalidates any previous share token and issues a fresh token generated from at least 32 cryptographically secure random bytes, encoded using a URL-safe format such as base64url. Store only a secure token hash in the database. Return the raw token/full URL only on creation or rotation; do not log it. Disabling sharing immediately revokes the token. Viewing the sharing settings does not rotate the token. A revoked, malformed, or unknown token yields the same generic `404`.

### 10.4 Shared-Trip Sensitive-Location Guard

Every public trip response must perform a server-side visibility check before JSON serialization. If a stop references a landmark with `is_active === false` or `sensitivity_status !== 'PUBLIC'` (i.e., `SENSITIVE` or `UNREVIEWED`), replace its landmark summary with `{ "id": "<opaque-landmark-id>", "is_available": false }`. Retain the trip-stop ID and position so itinerary order and count remain stable. Omit display name, coordinates, category, source metadata, and profile URL. Missing landmark records are treated as unavailable. No client-side hiding may substitute for this guard.

### 10.5 Cross-Specification Dependencies

The project-wide sensitive-location classification policy and the initial dataset review against it must be finalized before public sharing is enabled; the `sensitivity_status` (`UNREVIEWED`/`PUBLIC`/`SENSITIVE`) schema itself is resolved (see `docs/IMPLEMENTATION_PLAN.md` M01-T02), but no classification policy or initial classification review is approved by that schema decision. This approval candidate specifies the required *behavior* of the guard, not how landmarks are classified.

Specification 6 defines caching of explicitly saved trips and safe landmark summaries; offline trip editing, synchronization, and automatic publication of locally cached data remain out of scope.
---

**End of Specification**