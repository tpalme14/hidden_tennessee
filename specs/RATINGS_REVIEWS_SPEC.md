# Tennessee Natural Landmarks Explorer
## Specification 4: Landmark Ratings and Reviews

**Status:** Approved — October 29, 2026. Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (see §10.2.3).  
**Version:** 1.0 — October 29, 2026  
**Requirements:** FR-09, FR-10; NFR 7.4, 7.5, 7.7  
**Implementation tasks:** M04-T01 through M04-T04  
**Architectural decisions:** ADR-001, ADR-002, ADR-003, ADR-005, ADR-006, ADR-008, ADR-009  
**Dependencies:** Approved Landmark Data Import v0.3, Landmark Discovery v1.0, Authentication and Favorites v0.3

---

## 1. Purpose and scope

Allow authenticated users to submit a numeric rating and optional written review for an active, publicly reviewable landmark; browse public reviews and aggregate ratings; and edit or delete their own reviews. Anonymous visitors may read public reviews but cannot write or manage them. The specification must preserve review relationships across GPX reimports, retirement, and reactivation.

**Out of scope for initial release:** public user profiles, review replies, votes/helpfulness, photo uploads, third-party ratings, advanced reputation systems, administrative dashboards, automatic AI moderation, and offline review writes/synchronization. No moderator/admin role is introduced without a separately approved decision.

## 2. Architectural and identity constraints

1. Implement reviews in the Express/TypeScript API using services and data-access separation; use Prisma with PostgreSQL for relational review records.
2. A review references the stable internal landmark ID, never GPX `source_code`, and the Better Auth-managed internal user ID; do not create duplicate identity tables.
3. The acting user is derived from a validated server session. Never trust a client-supplied `user_id` or `author_id` for authorization.
4. Every edit/delete operation must enforce review ownership in the service layer, not merely hide controls in the UI.
5. Reviews survive landmark metadata changes and retirement; GPX imports must not delete or recreate referenced landmark rows.
6. Review mutations require the same session-cookie, CSRF/origin, HTTPS, rate-limiting, and safe-error protections as Specification 3.
7. Do not implement code, migrations, or infrastructure changes based on this draft without separate explicit authorization.

## 3. Proposed review data contract

Each review shall contain:

| Field | Requirement |
|---|---|
| `id` | Stable, server-generated internal review ID |
| `landmark_id` | Required foreign key to stable internal landmark ID |
| `user_id` | Required foreign key to Better Auth user ID |
| `rating` | Required integer from 1 through 5; no fractional ratings |
| `body` | Optional plain-text review; `null` for rating-only submissions; when supplied, 1–2,000 characters after trimming |
| `created_at` | Server-generated timestamp |
| `updated_at` | Server-maintained timestamp |

**Approved rule:** One review per user per landmark, enforced by a database unique constraint on `(user_id, landmark_id)`. Users update their existing rating and optional text instead of creating multiple reviews.

Reviews must not expose author email addresses, session details, password metadata, or other private account fields. Public reviews use the fixed attribution label **Community Member**. For the currently authenticated author, the client may instead display **You** or **Your Review**, based on a server-derived `is_own_review` boolean. Public API responses must not include author email addresses, raw user UUIDs, or private account fields.

## 4. Create, edit, and delete behavior

### 4.1 Create

- Only authenticated users may submit reviews.
- The target landmark must exist, be active, and be publicly reviewable under the sensitive-location policy.
- Validate the rating and optional body server-side with Zod; frontend validation mirrors server rules but is not authoritative. A rating-only submission is valid. When a body is supplied, trim it; empty/whitespace-only text is stored as `null`, and nonempty text must be at most 2,000 characters. The request must contain a valid rating.
- Reject a second create by the same user for the same landmark with a stable conflict response; the UI should instead offer **Edit your review**.
- Enforce uniqueness in PostgreSQL to handle concurrent requests, not only an application precheck.
- A successful create returns the newly created review's safe public representation.

### 4.2 Edit

- A signed-in author may edit only their own review's rating and optional body. A PATCH must contain at least one of these fields; omission leaves a field unchanged, while `body: null` explicitly clears review text. A submitted body containing only whitespace also clears it.
- Editing preserves the review ID and original `created_at`, and updates `updated_at`.
- Nonowners must not learn private review information through error details.
- Editing is prohibited while a landmark is retired or non-public. The owner may still delete their review through its ID without receiving retired landmark location details.

### 4.3 Delete

- A signed-in author may delete only their own review.
- Deletion removes the review from public lists and aggregate calculations.
- The UI requires a confirmation step before deletion.
- Author-requested deletion permanently deletes the review row. No soft-deleted review content is retained under this feature. The deletion must immediately cease to contribute to public aggregates.

## 5. Public display and aggregates

- Active, publicly reviewable landmark profiles show aggregate rating, rating count, and a list of public reviews.
- When no reviews exist, show **No reviews yet** rather than a misleading zero-star rating.
- Aggregate ratings are calculated from eligible published reviews, not from unverified client input.
- Display rating precision consistently (recommended: one decimal place); retain full precision for calculation.
- Review lists are sorted by `created_at DESC, id DESC`, with `page=1` and `limit=20` by default (maximum `limit=100`). The public aggregate covers all eligible published reviews for the landmark, not just the current page.
- An author can identify their own review and access edit/delete actions; other users cannot see those controls.
- Review content is treated as untrusted text and displayed without executing HTML or scripts.
- No review content or user identity may imply that a landmark is legally accessible or safe to visit.

## 6. Proposed REST API contracts

Application-owned routes, subject to alignment with the shared API conventions in Specifications 2 and 3:

| Method | Route | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/landmarks/:landmarkId/reviews` | Public | Paginated reviews for a public landmark |
| `POST` | `/api/v1/landmarks/:landmarkId/reviews` | Authenticated | Create the current user's review |
| `PATCH` | `/api/v1/reviews/:reviewId` | Author only | Update rating and/or body |
| `DELETE` | `/api/v1/reviews/:reviewId` | Author only | Delete review |

**Public list query:** `page` positive integer, default 1; `limit` positive integer, default 20, maximum 100. Sort by `created_at DESC, id DESC`. Return HTTP 200 with this response shape:

```json
{
  "reviews": [],
  "aggregate": {
    "average_rating": null,
    "rating_count": 0
  },
  "page": 1,
  "limit": 20,
  "has_more": false
}
```

`reviews` contains safe public review representations (`id`, `rating`, `body`, `created_at`, `updated_at`, `author_label`, and, for authenticated requests, `is_own_review`). `author_label` is always `Community Member` in the API; the client may show `You` or `Your Review` for the current user's review. Never expose `user_id` or email. `aggregate.rating_count` counts **all** eligible published reviews of the landmark, independent of pagination. `aggregate.average_rating` is their arithmetic mean (display may round to one decimal) and **must be `null` when `rating_count` is zero**. `has_more` is true exactly when at least one additional matching review follows the returned page. Invalid pagination inputs return the established safe validation error envelope.

**Recommended create:** `201 Created`; **update:** `200 OK`; **delete:** `200 OK` with `{ "success": true }` (subject to §10). Error classes: `400` invalid IDs/parameters, `401` unauthenticated mutation, `403` forbidden where non-disclosing, `404` nonexistent/unavailable resource, `409` duplicate review, `422` invalid review content, `429` throttling, and safe `5xx` responses. Align final envelope/error codes with existing application API standards; avoid inconsistent error disclosure.

The API must never allow the client to set `user_id`, timestamps, publication status, or aggregate fields. Aggregate counts and averages must remain correct under concurrent creation, update, and deletion.

## 7. Landmark retirement and sensitive-site handling

- Retirement preserves existing review records and author relationships, consistent with Specification 1.
- Public detail/list routes must not reveal coordinates or restricted metadata for retired or non-public landmarks, consistent with Specifications 2 and 3.
- Reviews for retired landmarks must not be exposed through a public route that bypasses landmark visibility restrictions.
- Reviews for retired landmarks are hidden from public listings and aggregate displays. Authors may delete their own reviews on retired landmarks but may not edit them. The authenticated deletion route must verify ownership without returning retired landmark coordinates, names, or other restricted location details.
- For public review reads, the service must first check landmark visibility. If the landmark is missing, `is_active === false`, or `sensitivity_status !== 'PUBLIC'` (i.e., `SENSITIVE` or `UNREVIEWED`), `GET /api/v1/landmarks/:landmarkId/reviews` must return the **same generic `404 Not Found` response** as an unknown landmark ID, without review data, aggregates, names, or coordinates. Apply equivalent visibility guards to public review creation and edits; do not allow review endpoints to disclose a restricted landmark through response differences. Authenticated owners may still delete their own review of a retired or sensitive landmark by review ID after an ownership check, without receiving restricted landmark metadata. The sensitive-location classification and broader project-wide disclosure policy remain cross-specification dependencies; default to non-disclosure until resolved.

## 8. Abuse protection, accessibility, and reliability

- Apply reasonable per-account/IP rate limits to review mutations and reject oversized payloads before expensive processing.
- Render user-submitted text safely; do not inject raw review HTML into the DOM.
- Validate content size, numeric rating bounds, IDs, and pagination on the server.
- Use existing CSRF protection for cookie-authenticated mutations, including cross-origin rejection.
- No arbitrary client author identifiers or user impersonation.
- Accessible form labels, keyboard operation, error summaries, status feedback, and confirmation dialogs must meet the WCAG 2.2 AA target.
- Show loading, empty, success, retry, and error states without losing draft review text on transient failures.
- Do not claim a review was saved or deleted until the server confirms the action; roll back optimistic UI updates on failure.
- No offline writes or background synchronization for reviews in the initial release.

## 9. Required acceptance tests

1. Anonymous users can read public reviews but cannot create, edit, or delete reviews.
2. Authenticated users can create a valid whole-star rating with or without written text for an active, public landmark.
3. Rating validation rejects missing, fractional, nonnumeric, or out-of-range values; optional body accepts absence, `null`, or whitespace-only text as no review text and rejects nonempty text exceeding 2,000 characters after trimming.
4. A database uniqueness constraint prevents duplicate user-landmark reviews under concurrent requests.
5. Users can edit their own reviews; IDs and original creation timestamps remain stable.
6. User A cannot edit/delete User B's review by guessing review IDs or modifying payloads.
7. Hard-deleting a review removes its database row and recomputes aggregates correctly, including for rating-only reviews.
8. Aggregate counts and averages are correct for create, edit, delete, and empty-state scenarios.
9. Public responses never expose emails, session secrets, or private identity fields.
10. Review text containing HTML/script-like content is displayed inertly and cannot execute code.
11. For nonexistent, retired, and sensitive landmarks, public review GET returns the same generic 404 with no review, aggregate, name, or location data; create/edit routes cannot bypass visibility checks, while ownership-checked deletion remains possible without metadata disclosure.
12. Reviews remain associated with the same landmark after GPX update, retirement, and reactivation; while retired they are hidden publicly, cannot be edited, and can be deleted by their authors.
13. Pagination defaults to page 1/limit 20, rejects limits over 100, sorts by `created_at DESC, id DESC`, sets `has_more` correctly, and uses the approved response envelope. Aggregate values reflect all eligible published reviews rather than only the current page, with `average_rating: null` when count is zero. Public attribution is `Community Member`; the current user sees `You`/`Your Review` without exposing emails or user UUIDs. Validation errors, rate limits, and safe server errors behave as specified.
14. UI forms, confirmation dialogs, loading/error states, and keyboard/screen-reader interactions are tested.
15. CSRF/origin protection rejects untrusted state-changing requests; authenticated tests use real HTTP sessions.
16. Integration tests use a dedicated PostgreSQL database; no tests mutate production data.

## 10. Approved behavior and remaining decisions

### 10.1 Approved by developer

1. **Rating scale:** Integer 1–5 stars, no half-star submissions. Public averages may be displayed to one decimal place; calculations use unrounded values.
2. **Optional written reviews:** Rating alone is sufficient. The body is optional; missing, `null`, empty, or whitespace-only text is normalized to `null`. Nonempty text is plain text, trimmed, and limited to 2,000 characters. Preserve internal line breaks; do not render user HTML or Markdown.
3. **One review per user per landmark:** Enforce `(user_id, landmark_id)` uniqueness at the database layer; a user edits the existing review rather than creating a second.
4. **Publishing:** Publish valid reviews immediately, subject to authentication, rate limiting, input validation, and safe rendering. No manual approval queue or admin moderation interface is in scope. Do not imply active human moderation or promise a report-handling workflow that has not been established.
5. **Deletion:** An author may permanently delete their review. Require confirmation in the UI and ownership checks on the server. After successful deletion the record must not appear in public results or rating aggregates.
6. **Retired landmarks:** Retain existing review rows while a landmark is retired; hide reviews and aggregate ratings from public endpoints. Authors may delete but not edit their own reviews on retired landmarks. Deletion must not reveal location details.

### 10.2 Resolved decisions for Version 1.0

1. **Author attribution (§10.2.1):** Public reviews display **Community Member**. The currently signed-in author sees **You** or **Your Review** in the client interface, derived from the authenticated session. Public responses never expose email addresses, raw internal user UUIDs, or other private account data.
2. **Review ordering and API responses (§10.2.2):** Sort reviews by `created_at DESC, id DESC`. Defaults are `page=1`, `limit=20`, with a maximum limit of 100. `GET /api/v1/landmarks/:landmarkId/reviews` returns `{ reviews, aggregate: { average_rating, rating_count }, page, limit, has_more }`. Aggregates include all eligible published reviews, not just the page. When no eligible reviews exist, `rating_count` is 0 and `average_rating` is `null`. The response must follow the application's existing safe error conventions.
3. **Sensitive-location gate (§10.2.3):** The review service checks the landmark before public retrieval. If `landmark.is_active === false`, `landmark.sensitivity_status !== 'PUBLIC'` (i.e., `SENSITIVE` or `UNREVIEWED`), or the ID is unknown, `GET /api/v1/landmarks/:landmarkId/reviews` returns the same generic 404 without disclosing whether a restricted landmark exists. Review creation and editing must also enforce visibility restrictions. Authenticated authors may delete their own reviews by review ID after ownership verification, even when the landmark is retired or sensitive; no restricted landmark metadata is returned.

**Cross-specification dependency:** The project-wide rules for identifying sensitive landmarks and determining when they may be publicly disclosed are not defined by this review specification. Until that policy is approved, landmarks whose `sensitivity_status` is `SENSITIVE` or `UNREVIEWED` must not be exposed through reviews. The `sensitivity_status` field (`UNREVIEWED`/`PUBLIC`/`SENSITIVE`) and its safe default have been reconciled with the landmark schema (see `docs/IMPLEMENTATION_PLAN.md` M01-T02); the classification policy and initial dataset review remain separately unresolved and release-blocking.

## 11. Traceability and review workflow

| Requirement/task | Coverage |
|---|---|
| FR-09 | Rating submission, written reviews, aggregate display, public review reading |
| FR-10 | Author-only editing and deletion, ownership checks |
| M04-T01 | Review model, rating rules, moderation decisions |
| M04-T02 | Review API and validation |
| M04-T03 | Review interface and accessibility |
| M04-T04 | Security, abuse protection, moderation, tests |

---

**End of Specification**
