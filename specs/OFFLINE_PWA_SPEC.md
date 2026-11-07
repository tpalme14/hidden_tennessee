# Tennessee Natural Landmarks Explorer
## Specification 6: Offline Access and Progressive Web App

**Status:** Approved — October 29, 2026, for FR-13 (installable PWA; explicit offline saves). FR-14 (offline map downloads) remains conditional on M00-T06 feasibility, by design (§7, §9.7). Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (see §9.8).  
**Version:** 1.0 — October 29, 2026  
**Requirements:** FR-13 (saved offline data), FR-14 (conditional offline maps)  
**Architecture:** ADR-004 (Leaflet/tile-provider constraints), ADR-007 (PWA/IndexedDB), ADR-008 (same-origin deployment), ADR-009 (testing)

---

## 1. Purpose and Scope

Provide an installable, resilient web app and deliberate offline access to landmark and trip information saved by an authenticated user. Offline map-region downloads are a separate, conditional capability, gated on a documented provider-license and storage-feasibility decision.

**Required:** installable PWA where supported; offline application shell; explicitly saved landmark and trip snapshots; clear offline and storage states; account-scoped data handling; automated acceptance tests.

**Conditional:** bounded offline raster map-region downloads only after M00-T06 confirms a lawful, viable provider and approved implementation limits.

**Out of scope:** offline account sign-in, offline mutations or synchronization, offline creation/editing of trips or reviews, background map downloads, turn-by-turn navigation, and promises of permanent device storage.

## 2. Architectural Constraints

- React/TypeScript/Vite SPA with Workbox via `vite-plugin-pwa`.
- IndexedDB through `idb` for deliberately saved structured offline records.
- Leaflet/React Leaflet for map rendering; no assumptions that ordinary online tile caching permits bulk offline download.
- Same-origin production app and API routes as defined by ADR-008.
- Backend remains the authority for account ownership, current landmark visibility, and saved-trip content while online.
- Browser storage, PWA installation, and service-worker capabilities vary by platform. The UI must degrade gracefully.

## 3. User Experience

### 3.1 Installation

- Publish a valid web app manifest with name, icons, start URL, and display mode.
- Register a service worker only in supported secure contexts.
- Provide an install affordance when the platform exposes an install prompt; otherwise offer concise platform-specific guidance without claiming installation is available.
- Installation must not be a prerequisite for using online discovery or explicitly saved offline records.

### 3.2 Connectivity States

- Show an accessible offline indicator when connectivity is lost or requests fail due to connectivity.
- Do not treat `navigator.onLine` alone as proof that the API is reachable.
- Distinguish an offline failure from a server error when possible; provide retry behavior.
- Clearly label offline records as saved snapshots, potentially outdated.
- Do not display an empty list as though it proves no records exist when offline storage cannot be read.

### 3.3 Explicit Saving

- Provide **Save for offline** and **Remove offline copy** actions for eligible landmark profiles and owned trips while online.
- Show a clear saved/not-saved status and confirmation of success or failure.
- Do not automatically download every landmark, trip, review, or map tile for offline use.
- Offline content must be readable without network access after a successful save.
- Saving for offline access is distinct from adding a landmark to account favorites; one action must not silently perform the other.

### 3.4 Offline Views

- Provide an offline library/list of explicitly saved landmark and trip snapshots.
- Saved landmark detail includes safe display name, category, and approved descriptive data. Coordinates may be saved and displayed offline **only** for landmarks affirmatively approved for public coordinate disclosure under the shared sensitive-location policy; otherwise omit coordinates entirely.
- Saved trip detail includes name and ordered stops; if a stop cannot be safely shown, render an unavailable placeholder without restricted metadata.
- Offline views must not expose controls that imply a mutation will sync later. Online-only actions should be disabled or explain why they are unavailable.
- A saved trip may reference landmarks not independently saved for offline access. The trip snapshot must include sufficient approved stop summaries to render its itinerary offline. Retired or sensitive stops must use unavailable placeholders without names, coordinates, category, or source metadata. Publicly shared trips belonging to other users cannot be saved offline.

## 4. Offline Data Contract

### 4.1 IndexedDB Storage

- Use a versioned IndexedDB schema and migrations; avoid localStorage for structured offline records.
- Store only the minimum approved fields needed for offline display, plus snapshot timestamp and ownership scope. Enforce application-level limits of **200 saved landmark snapshots** and **25 saved owned-trip snapshots** per account per device. At a limit, reject additional saves with clear guidance to remove an existing copy; do not silently evict another saved record. Browser quota errors may occur before these limits and must be handled separately.
- Separate landmark snapshots, trip snapshots, and storage metadata.
- Use stable internal IDs for landmarks/trips and a per-account namespace or partition.
- Never store passwords, session tokens, password-reset tokens, or authentication cookies in IndexedDB.
- Treat browser storage as potentially evictable; do not promise permanent retention.

### 4.2 Account Isolation

- Offline records are scoped to the authenticated account that saved them.
- On sign-out, delete that account's local landmark and trip snapshots, account-scoped metadata, and any account-scoped cached content. Clear the local account marker immediately; block offline-library access even if physical deletion fails. Report cleanup failures and provide a retry action. On account switch, perform the same cleanup before presenting another account's data. Browser-level or forensic erasure cannot be guaranteed.
- Never display records from a prior account to a newly signed-in user.
- Offline access is permitted only for the last account identity previously verified online on this device, while the app retains a matching local account marker. This marker is an offline-library selector, **not** an authenticated session or proof of current server authorization. Do not provide offline sign-in or permit selecting arbitrary account identifiers. If the marker is missing, mismatched, or cleared, deny offline-library access until online authentication succeeds. Account switch requires online authentication and prior-account cleanup before displaying another account’s data.
- Shared-device privacy limitations must be communicated accurately: client-side deletion cannot guarantee forensic erasure or protect against a compromised device.

### 4.3 Visibility and Retirement

- While online, saving must respect the shared service-layer guard for inactive/sensitive landmarks.
- When refreshed online, a saved landmark or trip stop that has become unavailable must be removed or redacted in local snapshots, as applicable.
- Because offline snapshots cannot receive revocation updates without connectivity, the app must explain that saved data may be stale. Only coordinates affirmatively approved for public disclosure may be saved offline. The project-wide sensitive-location classification and revocation policy must be finalized before enabling coordinate-bearing offline snapshots.
- Do not automatically restore redacted details from stale offline records after a newer online visibility check.

### 4.4 Refresh and Removal

- Each snapshot records `saved_at` and, when updated, `refreshed_at`.
- Provide a **user-initiated refresh only**, available while online. Do not automatically refresh saved snapshots in the background, on startup, or on reconnect. A manual refresh must recheck authorization and visibility before replacing a snapshot; preserve the prior valid snapshot on transient network failure, subject to the stale-data warning and visibility rules.
- Removing a snapshot deletes its local record without deleting the server-side landmark, trip, or favorite.
- IndexedDB failures, quota errors, and unsupported storage must result in actionable feedback rather than a false success state.

## 5. Service Worker and Cache Policy

- Precache a bounded, versioned application shell and necessary static assets for offline startup.
- Avoid caching authenticated API responses in a shared service-worker cache by default; explicit offline records belong in account-scoped IndexedDB.
- Never cache authentication endpoints, credentials, reset URLs, or mutation responses for offline replay.
- Define navigation fallback so installed app routes open offline without confusing missing profile data with a network error.
- Use versioned caches and remove obsolete caches on upgrades.
- Apply an update strategy that does not unexpectedly discard an in-progress user action; provide a reload prompt when appropriate.
- Map tiles are **not** included in general-purpose bulk caching; any offline tile strategy requires the separate provider decision in Section 7.

## 6. API and Data Access Expectations

- Existing authenticated landmark/trip endpoints remain the authoritative online source; do not introduce an unauthenticated bulk-export endpoint for offline downloads.
- Offline save requests should fetch only the authorized, visibility-filtered data required by the snapshot contract.
- Trip snapshots must exclude private share tokens and other secrets.
- Only authenticated users’ **own trips** are eligible for offline saving. Publicly shared trips owned by other accounts are ineligible, even when the share URL is accessible.
- API failures must not overwrite previously saved, valid offline snapshots with empty or partial data.

## 7. Conditional Offline Map Regions (FR-14)

### 7.1 Feasibility Gate

Before implementation, M00-T06 must evaluate at least two viable tile providers or self-hosting approaches for:

1. Explicit permission for persistent, user-initiated offline tile downloads in a browser PWA.
2. Attribution and licensing requirements.
3. Cost, request quotas, and download restrictions.
4. Practical region, zoom, tile-count, and storage limits.
5. Browser and iOS storage eviction behavior.
6. Security of any provider API keys.

**Do not implement bulk downloads using the public OpenStreetMap tile servers.** A provider's permission for ordinary interactive browsing does not imply permission for offline bulk storage.

### 7.2 If Feasible and Approved

- Offer an explicit region-selection and download flow, not silent prefetching.
- Show an estimated download size and tile count before confirmation.
- Enforce approved geographic, zoom, tile-count, and per-device storage caps.
- Display required attribution while maps are viewed offline.
- Permit users to inspect and delete downloaded regions.
- Fail gracefully on interruption, quota exhaustion, or missing tiles; never claim an incomplete region is fully downloaded.
- Clearly distinguish offline map imagery from the separately saved landmark/trip snapshots.

### 7.3 If Not Feasible

- Do not ship a noncompliant workaround.
- Mark FR-14 as deferred with documented provider findings and the approving developer's decision.
- Deliver FR-13 and offline application-shell functionality independently.

## 8. Security, Privacy, and Accessibility

- Keep all private offline data partitioned by account; enforce ownership online before saving.
- Do not include sensitive coordinates, private share tokens, auth secrets, or restricted metadata in public or shared caches.
- Use safe text rendering for source descriptions and trip names.
- Offline status, save controls, quota errors, and deletion confirmations must be keyboard accessible and screen-reader understandable.
- Meet the project's WCAG 2.2 AA target for offline library and control flows.
- Honor reduced-motion preferences for status and update notifications.

## 9. Approved Offline Behavior and Remaining Dependencies

### 9.1 Offline Identity — Approved

Previously verified account data may be viewed offline on the same device **without offline login**, subject to the account-marker and isolation rules in Section 4.2. This does not constitute a new or renewed authenticated server session. Missing or mismatched identity markers must fail closed.

### 9.2 Sign-Out Cleanup — Approved

On sign-out, clear the local account marker **immediately, before asynchronous cleanup**, and block offline-library access. Attempt best-effort deletion of account-scoped IndexedDB snapshots, metadata, and caches. If deletion fails, maintain the access block, disclose the failure, and offer retry; never expose prior-account records to another user. Do not claim secure or forensic erasure from browser storage.

### 9.3 Offline Snapshot Scope — Approved (subject to sensitive-site policy)

Store only minimum safe landmark and owned-trip summary fields required for offline display. Coordinates are permitted **only for landmarks approved for public disclosure**. Final field-level schemas and the shared sensitive-location classification policy must be reconciled with Specifications 1–5 before implementation.

### 9.4 Refresh — Approved

Refresh only on an explicit user request while online. Do not automatically refresh on reconnect or startup. Label snapshots with their save/refresh timestamps and stale-data warning.

### 9.5 Application Storage Limits — Approved

Per account, per device: **maximum 200 explicitly saved landmark snapshots and 25 explicitly saved owned-trip snapshots**. Enforce these independently of browser quota and avoid silent eviction.

### 9.6 Shared Trips — Approved

Only trips owned by the authenticated user can be saved offline. Read-only publicly shared trips owned by other users are excluded.

### 9.7 FR-14 Offline Maps — Conditional Release Gate

FR-14 remains a **conditional release gate**, not a required dependency of FR-13. M00-T06 must evaluate at least two candidate tile approaches for licensing, offline persistence permissions, quotas/costs, region and zoom limits, attribution, browser storage, and device compatibility. Until a provider and bounded download policy are expressly approved, do not implement or advertise offline map downloads. If M00-T06 finds no compliant and viable solution, request an explicit developer decision to defer FR-14 for Phase 1; this shall not block FR-13 implementation or release. Record the decision and evidence in project planning/decision documents. No unlicensed bulk caching of public OSM tiles is allowed.

### 9.8 Sensitive-Site Policy — Unresolved Cross-Specification Dependency

Finalize classification, coordinate disclosure, redaction, and revocation behavior before enabling coordinate-bearing offline saves. Offline devices cannot receive immediate remote revocation; users must be warned about stale snapshots, and the online refresh path must remove/redact newly restricted data.

## 10. Acceptance Criteria and Tests

### 10.1 Installability and Shell

- Manifest validates and includes required icons and app metadata.
- Service worker installs/updates successfully on supported browsers.
- Previously loaded application shell opens without a network connection.
- Unsupported installation mechanisms degrade gracefully.

### 10.2 Explicit Offline Saves

- An authorized user can save a landmark and an owned trip while online.
- After disconnecting, the saved landmark and trip can be opened and read.
- A trip's ordered stops remain readable offline without requiring independent saves for every stop.
- Unsaved records do not appear as saved offline content.
- Removing an offline copy does not remove a server-side record or favorite.
- Failed or partial downloads do not show false success.

### 10.3 Security and Isolation

- No session token, password, or reset token is persisted in offline data.
- A second user on the same browser cannot see the first user's offline library.
- Sign-out clears the local account marker and deletes account-scoped snapshots; simulated cleanup failure blocks offline access and offers retry.
- A previously verified account can read its saved library offline without performing offline login; missing/mismatched identity markers deny access.
- Online refresh redacts or removes newly unavailable records.
- Offline snapshots do not bypass the server's sensitive-location restrictions.

### 10.4 Error Handling and Accessibility

- Storage quota exceeded, unsupported IndexedDB, and connectivity failures have clear recovery messaging.
- Offline-only actions are identified correctly; no mutation is silently queued.
- Keyboard and screen-reader users can save, remove, browse, and understand offline states.
- Tests cover stale snapshot handling and service-worker version updates.
- Tests verify refresh occurs only on user request, not on reconnect or startup.
- Tests verify the 200-landmark and 25-trip limits, clear capacity errors, and no silent eviction.
- Tests verify that another user’s publicly shared trip cannot be saved offline.
- Tests verify coordinates are absent from snapshots unless approved for public disclosure.

### 10.5 Conditional Maps

If FR-14 is approved: tests verify license-compatible provider configuration, region/tile limits, attribution, cancellation/interruption, partial downloads, and region deletion. If deferred: the release checklist records the approved deferral and the interface does not promise map downloads.

---

**End of Specification**