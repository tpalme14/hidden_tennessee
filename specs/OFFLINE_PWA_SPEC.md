# Tennessee Natural Landmarks Explorer
## Specification 6: Offline Access and Progressive Web App

**Status:** Approved — October 29, 2026, for FR-13 (installable PWA; explicit offline saves). FR-14 (offline map downloads) remains conditional on M00-T06 feasibility, by design (§7, §9.7). Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (see §9.8). **FR-14 deferral clarification (November 25, 2026; accepted by the developer November 25, 2026 — see §7.4 and §11):** the M00-T06 gate was resolved on October 30, 2026 by the developer's decision to **defer FR-14** for this phase; no tile provider is selected. FR-13 remains approved and in Milestone 06 scope. **Version 1.1 — Approved November 25, 2026 (M06-T01; §12):** Version 1.1 is the governing offline-access specification. It amends Version 1.0 (approved October 29, 2026). Where §12 refines, narrows, or supersedes a v1.0 provision (listed in §12.16), §12 takes precedence; every other v1.0 provision remains in force. The v1.0 text in §1–§10 is preserved unchanged as the amended baseline, and the amendment history is in §11.  
**Version:** 1.1 — November 25, 2026 (approved; amends 1.0 — October 29, 2026; §12). Version 1.0 — October 29, 2026, with the FR-14 deferral clarification accepted November 25, 2026 (§11). Clarification of §3.1 installation guidance approved November 26, 2026 (§11, §12.17); not a new version. Clarification of OFF-OUT-7 (absent coordination facility) approved November 26, 2026 (§11, §12.4 OFF-OUT-7); not a new version. Clarification and narrow amendment of OFF-FAIL-3, OFF-FAIL-5, and OFF-LIFE-9 (recovery and discard authorization) approved November 26, 2026 (§11, §12.3, §12.6, §12.14 AC-40); not a new version. Requirements amendment for the authentication and recovery policy (Web Locks required; the OFF-OUT-7 fallback clarification superseded; OFF-OUT-11 and §12.18 added; AC-41 added) approved November 26, 2026 (§11); not a new version.  
**Requirements:** FR-13 (saved offline data), FR-14 (conditional offline maps — deferred October 30, 2026; §7.4)  
**Architecture:** ADR-004 (Leaflet/tile-provider constraints), ADR-007 (PWA/IndexedDB), ADR-008 (same-origin deployment), ADR-009 (testing)

---

## 1. Purpose and Scope

Provide an installable, resilient web app and deliberate offline access to landmark and trip information saved by an authenticated user. Offline map-region downloads are a separate, conditional capability, gated on a documented provider-license and storage-feasibility decision.

**Required:** installable PWA where supported; offline application shell; explicitly saved landmark and trip snapshots; clear offline and storage states; account-scoped data handling; automated acceptance tests.

**Conditional:** bounded offline raster map-region downloads only after M00-T06 confirms a lawful, viable provider and approved implementation limits. *(Deferred October 30, 2026 — not in Milestone 06 scope; see §7.4.)*

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
- Provide an install affordance when the platform exposes an install prompt; otherwise offer concise platform-specific guidance without claiming installation is available. *(Clarified November 26, 2026 — capability-based guidance; see §12.17.)*
- Installation must not be a prerequisite for using online discovery or explicitly saved offline records.

### 3.2 Connectivity States

- Show an accessible offline indicator when connectivity is lost or requests fail due to connectivity.
- Do not treat `navigator.onLine` alone as proof that the API is reachable.
- Distinguish an offline failure from a server error when possible; provide retry behavior.
- Clearly label offline records as saved snapshots, potentially outdated.
- Do not display an empty list as though it proves no records exist when offline storage cannot be read.

### 3.3 Explicit Saving

- Provide **Save for offline** and **Remove offline copy** actions for eligible landmark profiles and owned trips while online.
  - *Clarification (M06-T03 Increment 3e, decision E2, approved November 27, 2026):* **Save for offline** and **Refresh** need the server and remain online-only. **Remove offline copy** deletes only the copy stored on this device, sends no server request, and is therefore also available without a connection, including while reading saved copies offline (§4.2, §9.1). It keeps every lifecycle, security, coordination, and deletion-ordering check (a delayed operation never recreates a removed copy), and it never changes server-side landmarks, trips, or favorites.
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

## 7. Conditional Offline Map Regions (FR-14) — Deferred October 30, 2026 (see §7.4)

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

### 7.4 Deferral Record *(clarification, November 25, 2026 — M06-T01 Increment 1; accepted by the developer November 25, 2026)*

This subsection records an existing developer decision; §7.1–§7.3 are preserved unchanged as the approved conditional design.

- **Feasibility evidence (M00-T06, October 30, 2026):** at least two approaches were evaluated, as §7.1 requires. Verdict: **feasible only with significant constraints** — a small region (about a 5-mile radius, zoom 12–15) was plausible on licensing and storage grounds; a large region (25-mile radius, zoom 12–16) was not, independent of provider. Stadia Maps' terms permit limited offline caching "in a mobile application", not confirmed to cover a web PWA; MapTiler's terms prohibit bulk tile download; a self-hosted Tennessee tile set was judged not realistic within the project timeline. The full evidence is preserved in `docs/IMPLEMENTATION_PLAN.md` M00-T06.
- **Decision (developer, October 30, 2026):** **FR-14 is deferred** for this phase rather than contacting a provider or proceeding on a licensing assumption. **No tile provider is selected.** Stadia Maps remains a **research candidate only** — not selected, not contacted.
- **Effect:** §7.3 applies. §7.2 is not active. No offline tile download, prefetching, or tile caching (including service-worker runtime caching) may be implemented, and the interface must not offer, advertise, or imply offline map downloads. Milestone 06 task M06-T04 (Implement Offline Map Regions) is recorded as **Deferred**, not Complete.
- **Unaffected:** FR-13 — the installable PWA, offline application shell, and explicitly saved landmark and owned-trip snapshots — remains approved and in Milestone 06 scope. Offline snapshot views do not depend on map tiles.
- **Reconsideration:** reconsidering FR-14, contacting or selecting a tile provider, or amending ADR-004 for this purpose each requires a new, explicit developer decision. FR-14 itself (`docs/PROJECT_PLAN.md`) is preserved unchanged as a deferred requirement.

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

*Status (clarification, November 25, 2026):* M00-T06 found no solution that was both confirmed compliant for a web PWA and viable at useful region sizes, and the developer deferred FR-14 for Phase 1 on October 30, 2026. The decision and evidence are recorded in §7.4 and `docs/IMPLEMENTATION_PLAN.md` M00-T06. FR-13 implementation and release are not blocked by this deferral.

### 9.8 Sensitive-Site Policy — Unresolved Cross-Specification Dependency

Finalize classification, coordinate disclosure, redaction, and revocation behavior before enabling coordinate-bearing offline saves. Offline devices cannot receive immediate remote revocation; users must be warned about stale snapshots, and the online refresh path must remove/redact newly restricted data.

*v1.1 clarification (approved November 25, 2026; §12.13, developer decision D9):* the policy must also explicitly address persistent offline distribution of coordinates before production release; a `PUBLIC` classification by itself does not resolve it.

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

*Applicable branch (clarification, November 25, 2026):* FR-14 is deferred (§7.4), so the deferral branch applies: verification confirms the recorded deferral and that no interface element offers or implies offline map downloads.

## 11. Amendment Record

### Clarification — November 25, 2026 (M06-T01 Increment 1): FR-14 deferral record — *accepted by the developer November 25, 2026*

- **Type:** clarification reconciling an existing developer decision (October 30, 2026, recorded under M00-T06); not a scope change to FR-13 and not a new specification version. Version 1.0 remains the approved specification.
- **Changed:** the status, version, and requirements lines; §1 (*Conditional* line annotated); the §7 heading; new §7.4 (Deferral Record); status notes appended to §9.7 and §10.5. No approved text was removed; the conditional FR-14 design in §7.1–§7.3 is preserved.
- **Not changed:** every FR-13 requirement, account-isolation rule, storage limit, and acceptance criterion; §9.8 (sensitive-site policy) remains unresolved and release-blocking.
- **Pending separately:** the M06-T01 requirements amendment (ADR-007 reconciliation and FR-13 clarifications), proposed as Version 1.1 in M06-T01 Increment 2, is **not** part of this clarification and is not approved. *(Historical note: Version 1.1 was subsequently approved on November 25, 2026 — see the next entry.)*

### Version 1.1 — November 25, 2026 (M06-T01) — *Approved by the developer November 25, 2026*

- **Approval:** approved by the developer on November 25, 2026, together with the ADR-007 amendment and the Specification 7 §5 browser-verification amendment, at the close of M06-T01. Version 1.1 is the governing offline-access specification. *History:* drafted in M06-T01 Increment 2 and refined in a final increment, both while marked "Proposed; awaiting final review".
- **Content:** §12, written from the developer's M06-T01 decisions of November 25, 2026 (approved: D1–D9, D11–D20, D4a, D22; deferred: D10, and D21 until M06-T03) and the developer's refinements to D4, D5, D7, D9, and D16.
- **Form:** v1.1 is a self-contained amendment in §12. §1–§10 keep the approved Version 1.0 text, apart from the accepted FR-14 clarification and a pointer added to §9.8. §12.16 lists each v1.0 provision that v1.1 refines, narrows, or supersedes; for those provisions §12 takes precedence. All other v1.0 provisions remain in force. The v1.0 text is preserved unchanged.
- ~~**Not approved:** nothing in §12 is in effect until the developer approves Version 1.1. M06-T01 is not complete.~~ *(Superseded by the approval above; M06-T01 is Complete as of November 25, 2026.)*
- **Final refinement (November 25, 2026; approved with Version 1.1):** incorporates the developer's approvals of:
  - D22 — a device-wide `localStorage` safety lock, the only approved storage exception (OFF-FAIL-5);
  - unavailable trip markers (OFF-SNAP-6);
  - sequential Sign in again (OFF-OUT-6) and sign-out intent preserved across local recovery (OFF-LIFE-9);
  - fail-closed cross-tab coordination (OFF-OUT-7, new §12.6a);
  - established-ordering rules (OFF-EV-5 (f)–(k));
  - persisted removal of invalidated distance summaries (OFF-SNAP-5);
  - `401` handling (OFF-EV-1, OFF-EV-2);
  - timestamp clarifications (OFF-SNAP-7);
  - per-account, per-device limits (OFF-STORE-1).

  Acceptance criteria AC-31–AC-39 were added.

### Clarification — November 26, 2026 (M06-T02 Increment 5a, audit disposition A1): §3.1 installation guidance — *approved by the developer November 26, 2026*

- **Type:** a narrow clarification within Version 1.1, not a new specification version (as with the FR-14 clarification above).
- **Changed:** new §12.17; a §12.16 entry; a pointer after the §3.1 install-affordance bullet; the version line. The §3.1 text is preserved unchanged as the amended baseline.
- **Effect:** the unconditional "platform-specific guidance" requirement is replaced by truthful, capability-based guidance (§12.17). The existing installation implementation (M06-T02 Increment 4d) is unchanged.
- **Not changed:** every other requirement and acceptance criterion; installation remains optional and never a prerequisite.

### Clarification — November 26, 2026 (M06-T03 Increment 3b, decision DR-1): OFF-OUT-7 absent coordination facility — *approved by the developer November 26, 2026; **superseded** the same day by the authentication and recovery policy amendment below (no longer in effect; kept as history)*

- **Type:** a narrow clarification within Version 1.1, not a new specification version (as with the FR-14 and §3.1 clarifications above).
- **Changed:** a clarification sub-bullet appended under OFF-OUT-7; the §12.16 "Clarifies" entry; the version line. The OFF-OUT-7 text is preserved unchanged.
- **Effect:** where the preferred cross-tab coordination facility is entirely absent, ordinary online sign-in, sign-out, and session checks may remain available, serialized within the tab only, solely when the absence of every kind of conflicting offline security state has been established without creating or modifying storage, in a supported execution environment; offline lifecycle creation and all offline-library access and persistence are then disabled and cross-tab serialization is not claimed. Every other case fails closed with disclosure, and existing offline security state is never cleared to enable authentication.
- **Not changed:** every other requirement and acceptance criterion; no particular locking API is prescribed; OFF-CONC-3 and OFF-FAIL-5 are unchanged.

### Clarification and narrow amendment — November 26, 2026 (M06-T03 Increment 3b-iii-c2, decisions Q32–Q39): failure-record recovery, safety-lock clearing, and discard authorization — *approved by the developer November 26, 2026*

- **Type:** An approved clarification and narrow requirement amendment within Version 1.1, not a new specification version.
- **Clarified:** OFF-FAIL-3 (what recovery from a durable failure record requires; the rule that a failure record is never the only durable record of an unresolved server sign-out; local recovery without a server request), and AC-4, AC-20, AC-32, and AC-33 (clarifying sentences appended).
- **Narrowed:** OFF-FAIL-5 Clearing. The safety lock is cleared only with a server confirmation obtained within the recovery and with all records in the application's offline data database in this browser removed and their absence verified; the completed-new-sign-in branch is no longer used for the lock.
- **Strengthened:** OFF-LIFE-9. A recovery that discards saved offline copies, or removes a valid current lifecycle or a malformed lifecycle marker, requires explicit authorization after disclosure. Mandatory invalidation cleanup is unchanged.
- **Added:** AC-40 (§12.14), traced in §12.15 to OFF-LIFE-1–9 and OFF-FAIL-1–6.
- **Also changed:** the §12.16 "Clarifies" entry and the version line. Existing text is preserved; the clarifications are appended.
- **Not changed:** mandatory sign-out, session-absence, and account-switch cleanup; server-confirmed recovery of an unresolved sign-out intent (OFF-OUT-5, OFF-OUT-6); no automatic retry; no physical-erasure claim; the numbering of existing acceptance criteria. The removal scope is the offline data database only; the application-shell cache, the service-worker registration, unrelated browser storage, and the offline security state are not removed by it.

### Requirements amendment — November 26, 2026 (M06-T03, authentication and recovery policy, Decisions 1–3 and U1–U2): Web Locks required, sign-out confirmation limit, limited exceptional recovery — *approved by the developer November 26, 2026*

- **Type:** a dated requirements amendment within Version 1.1, not a new specification version.
- **Superseded:** the November 26, 2026 OFF-OUT-7 clarification (decision DR-1, the tab-local authentication fallback), together with OFF-OUT-7's sentence requiring a fallback where the preferred facility is unavailable; the third bullet of AC-32; and the original text of AC-36. The superseded clarification record above is kept as history only. The OFF-OUT-7 main text is otherwise preserved.
- **Amended:** OFF-OUT-7 (Web Locks required; refusal with a compatibility explanation; an existing session there does not restore signed-in functionality and uncoordinated sign-out is refused); OFF-OUT-6 and OFF-FAIL-5 Clearing (no in-app safety-lock clearing; no credentials and no signed-in functionality while the lock is present or unreadable; Finish signing out stays available where coordination and server communication work); OFF-CONC-4 (Web Locks named); OFF-FAIL-6 (three residual risks); AC-8, AC-32, AC-33, AC-35, and AC-36.
- **Added:** OFF-OUT-11 (limit of server sign-out confirmation), §12.18 (OFF-REC-1–4), AC-41, and the OFF-REC traceability row (§12.15).
- **Accepted risk, kept distinct:** the developer explicitly accepts only the OFF-OUT-11 risk — an earlier authentication request interrupted in a terminated browser context may establish a server session after a confirmed sign-out, possibly undetectably — and only for ordinary sign-out, Finish signing out, and Sign in again. It does not extend to safety-lock clearing or to any other requirement.
- **Not changed:** backend authentication and the authentication API contract (ADR-006, Specification 3); mandatory cleanup and invalidation; the immediate local block at sign-out; lifecycle creation conditions; failure-record recovery (OFF-FAIL-3, AC-40); Delete all offline data; discard authorization; every other requirement and acceptance criterion; the numbering of existing acceptance criteria.

## 12. Version 1.1 Amendment (M06-T01) — *Approved November 25, 2026*

> **Status:** Approved by the developer on November 25, 2026; previously Proposed. This section governs: it takes precedence over the Version 1.0 provisions it refines, narrows, or supersedes (§12.16), and every other Version 1.0 provision in §1–§10 remains in force. Requirement IDs (`OFF-…`) are used by the acceptance criteria (§12.14) and the traceability table (§12.15). Implementation mechanisms that are left open are chosen during M06-T02/M06-T03 planning, and each requires its own approval.

### 12.1 Terms

- **Account marker:** the local record `{ account_id, lifecycle_id, verified_at }` that selects whose offline library may be shown. It is an offline-library selector, **not** an authenticated session and not proof of current server authorization (§4.2, §9.1).
- **Lifecycle:** one continuous period of local offline use by one account on one browser profile, identified by a random `lifecycle_id`.
- **Verified identity:** a successful server session check (`GET /api/auth/get-session` returning a session for the marker's account), recorded as `verified_at`.
- **Server session:** the Better Auth session held in the httpOnly cookie. Only the server can confirm whether it exists.
- **Local sign-out:** the user's sign-out action as applied on this device. **Confirmed server sign-out:** the server has confirmed that no session remains for this browser. **Cleanup status:** in progress, complete, or failed. These three are independent states and are always reported separately.
- **Authoritative evidence:** a validated server response that establishes a landmark's or trip's current eligibility (§12.5).
- **Invalidation:** recording that previously stored content is no longer eligible. **Durable (persisted) invalidation:** an invalidation successfully written to persistent storage. **Successful logical deletion:** the affected records were deleted and the deletion was verified by a subsequent read; this is not physical erasure. **In-memory-only block:** an invalidation enforced only in the running application instance. **Unconfirmed durable protection:** the state in which neither a durable invalidation nor a successful logical deletion could be confirmed.
- **Safety lock (D22):** a single, fixed, device-wide value in `localStorage` that blocks offline-library access (OFF-FAIL-5). It is not an authentication mechanism and contains no identifier or content.

### 12.2 Account-Scoped Storage (D1)

- **OFF-SCOPE-1:** Every landmark snapshot, owned-trip snapshot, unavailable marker, and account-related offline record is scoped to both the saving account's `account_id` and its current `lifecycle_id`. There is no cross-account or cross-lifecycle reuse of saved snapshots.
- **OFF-SCOPE-2:** The only account-independent offline storage is the service worker's application-shell precache (§12.10), which contains no landmark, trip, or account data, plus the D22 safety lock (OFF-FAIL-5), which contains no data at all. D22 is the only approved exception to keeping offline state out of `localStorage`.
- **OFF-SCOPE-3:** Coordinates may be stored only in eligible (§12.5), server-redacted, account-scoped snapshots, and remain subject to §9.8 and §12.13.
- *Rationale:* a user's selection of public landmarks can itself reveal travel plans or interests. *Accepted tradeoff:* the same landmark may be stored once per account on a shared device, within each account's limits.

### 12.3 Account Lifecycle (D5)

- **OFF-LIFE-1 — Marker:** the marker stores `account_id`, `lifecycle_id`, and `verified_at`, the time of the last successful server identity verification for that account. It stores no email address, session ID, token, or cookie value.
- **OFF-LIFE-2 — Creating a lifecycle:** a new `lifecycle_id` is created **only** when a genuinely new local account lifecycle is established. That happens when a verified server identity is obtained and, at that moment, all of the following hold: no marker exists (or the previous lifecycle has been invalidated); no sign-out intent is pending (§12.4); and no required cleanup is unresolved. Examples: the first verified sign-in on the device; signing in after a completed sign-out; signing into a different account after the previous lifecycle was cleaned up.
- **OFF-LIFE-3 — Continuity:** a new lifecycle is **not** created by a session check, an application reload, a temporary loss of connectivity, or a successful revalidation of the same active lifecycle. When a session check confirms the marker's own account and no sign-out intent is pending, the lifecycle is kept and only `verified_at` is updated.
- **OFF-LIFE-4 — Invalidation triggers:** the current lifecycle is invalidated by any of:
  - local sign-out (§12.4);
  - a confirmed absence of a server session (D3; §12.4 OFF-OUT-8);
  - a session check confirming a different account (account switch);
  - the user's "Delete all offline data on this device" action.

  Signing back into the same account after any of these creates a new lifecycle.
- **OFF-LIFE-5 — Residual data:** snapshots and markers belonging to an invalidated lifecycle are never readable again, including when the same account signs in again, and are removed by cleanup (OFF-LIFE-9).
- **OFF-LIFE-6 — Validation:** every snapshot read must confirm that the record's `account_id` and `lifecycle_id` match the current marker and that no safety lock is present (OFF-FAIL-5). Every asynchronous save and refresh records the lifecycle it started under, and must confirm in the same storage transaction as its commit that this lifecycle is still current. It must also confirm, immediately before committing, that no safety lock is present. If either check fails, it commits nothing.
- **OFF-LIFE-7 — Multiple tabs:** a tab that invalidates a lifecycle notifies other open tabs where the browser supports it. A notified tab discards rendered and in-memory account data and leaves offline-library views. As additional safeguards, a tab re-validates the lifecycle when it regains focus or visibility and before any further offline-library access. *Limitation:* the browser cannot guarantee prompt notification of suspended, frozen, or unresponsive tabs. Such a tab may keep already-rendered content on screen until it resumes and re-validates, and the specification does not claim otherwise.
- **OFF-LIFE-8 — Account switch:** when a session check confirms an account different from the marker's account, the previous lifecycle is invalidated and its data is cleaned up **before** any of the new account's offline data is shown or saved.
- **OFF-LIFE-9 — Strict cleanup recovery:** while required cleanup of an invalidated lifecycle is unresolved:
  - The new lifecycle's offline library stays **locked**: no reads, saves, or refreshes.
  - Verified online functionality may remain available, except while a sign-out intent is pending (§12.4).
  - The user is offered two explicit recovery actions:
    - **Retry cleanup.**
    - **Delete all offline data on this device.** The confirmation must state that this deletes every saved offline copy on this device for every account, that saved copies must then be saved again, and that it does **not** delete server-side landmarks, favorites, trips, or reviews.
  - Database deletion can be blocked by open connections in other tabs. The application must report that state accurately — for example, by asking the user to close the app's other tabs — and must not report deletion as complete until it has completed.
  - "Delete all offline data" must not clear, or silently discard, a pending sign-out intent (§12.4), the safety lock (OFF-FAIL-5), or a recorded storage-failure state (§12.6).
    - A pending sign-out intent must be stored where that action does not remove it — for example, a separate IndexedDB database or store excluded from the deletion; the mechanism is chosen in M06-T03 planning.
    - If the deletion would remove the only durable record of a pending sign-out intent, the safety lock must first be durably set, since it conservatively stands for a possible unresolved sign-out (OFF-FAIL-5).
    - If neither can be confirmed, the action is **blocked** until the server sign-out is confirmed (OFF-OUT-5), and the reason is disclosed.
    - No other storage mechanism is introduced for this purpose.
  - *Clarification (M06-T03, approved November 26, 2026):* Mandatory invalidation cleanup (the cleanup that follows a sign-out (OFF-OUT-1 step 4), a confirmed absence of a session (OFF-OUT-8), or an account switch (OFF-LIFE-8), and Retry cleanup of that invalidated lifecycle's records) requires no further authorization and is not weakened by this clarification. Any other recovery action that would discard saved offline copies (available snapshots, unavailable markers, and unreadable copies, of any account or lifecycle) requires the user's explicit authorization after disclosure that saved offline landmarks and trips stored in this browser will be removed and must be saved again, and that server-side landmarks, favorites, trips, and reviews are unaffected. This applies to recovery from a durable failure record (OFF-FAIL-3), recovery from the safety lock (OFF-FAIL-5) *[editorial note, M06-T03 3c-2: not supported in the application since the November 26, 2026 OFF-FAIL-5 amendment; see OFF-REC-2]*, explicit destructive cleanup, and "Delete all offline data", whose confirmation satisfies it when it discloses these consequences. The same authorization is required before recovery removes a valid current lifecycle or a malformed lifecycle marker. It is not required when the offline data database is already empty or contains only known disposable lifecycle metadata; stored data the application does not recognize is never treated as disposable, and the absence of a marker is never treated as authorization. Authorization never overrides storage that cannot be reliably read: such recovery is refused. If the user declines, any recorded failure, safety lock, and sign-out intent remain and the offline library stays locked. Such removal never occurs implicitly during sign-in, session checks, reloads, or connectivity changes, and recovery is separate from releasing the application's local block.

### 12.4 Offline Sign-Out Intent and Recovery (D4, D4a)

- **OFF-OUT-1 — Order of operations:** when the user signs out:
  1. Immediately block offline account data, and authenticated application functionality, in memory.
  2. Notify other tabs where supported.
  3. Durably record a **sign-out intent** and remove the account marker, in one storage transaction where possible.
  4. Start best-effort local cleanup of the lifecycle's data.
  5. Send the server sign-out request.

  Local cleanup is never treated as proof that the server session has ended.
- **OFF-OUT-2 — Sign-out intent record:** minimal and non-sensitive — a pending state and its creation time. No credential, token, email address, or snapshot content.
- **OFF-OUT-3 — Unconfirmed server sign-out:** if the server sign-out cannot be confirmed (network failure, server error, or an invalid response), the interface states that the user is **signed out on this device**, that **the server sign-out is not confirmed**, and that the browser's existing session may still be valid. It shows the cleanup status separately, and offers an explicit **Finish signing out** action. The server request is **not retried automatically** — not on reconnect, reload, or any timer — and no background or general mutation queue is introduced.
- **OFF-OUT-4 — No silent reversal:** while a sign-out intent is pending, an authenticated `get-session` response — including one for the original account, from a still-valid cookie — must **not** restore authenticated application functionality, recreate the account marker, create a lifecycle, or grant offline-library access. Receiving such a response is not a deliberate new sign-in.
- **OFF-OUT-5 — Finish signing out:** a user-initiated action, available when the server can be reached. It sends the server sign-out request. The server sign-out is **confirmed** either by a successful sign-out response or by a subsequent session check that confirms no session. On confirmation, the intent is cleared and the interface reports a confirmed sign-out. On failure, the intent remains pending and the failure is disclosed.
- **OFF-OUT-6 — Deliberate new sign-in (the only recovery path that creates a lifecycle while an intent is pending, or while the safety lock may stand for one):** in either situation, sign-in is available only as an explicit, sequential **Sign in again** action:
  1. It first finishes the server sign-out of the previous session (as in OFF-OUT-5).
  2. Only if that is confirmed does it submit the user's credentials.
  3. If finishing the sign-out fails, the credentials are **not** submitted and the intent remains pending.
  4. A new lifecycle is created only after successful server authentication and only once the existing cleanup requirements are met (OFF-LIFE-9).

  The server sign-out is not retried automatically on reconnect. An ordinary authenticated `get-session` response is never a deliberate new sign-in (OFF-OUT-4). A pending sign-out intent survives every local recovery action, including "Delete all offline data" (OFF-LIFE-9).
  - *Amendment (M06-T03 authentication policy, approved November 26, 2026):* While the safety lock is present or cannot be read, Sign in again does not submit credentials, and no signed-in functionality or offline-library access is available, because in-app resolution of the lock is not supported (OFF-FAIL-5). Finish signing out remains available where cross-tab coordination (OFF-OUT-7) and server communication are operational; it does not clear the lock. Sign in again with a pending sign-out intent and no safety lock is unchanged.
- **OFF-OUT-7 — Serialized authentication operations:** sign-in, sign-out, and Finish-signing-out operations must never overlap. A sign-in may not start while a sign-out request is in flight, because a delayed sign-out response could otherwise clear the session cookie of a newly established session. A sign-out result that arrives after a newer authentication operation has begun is ignored for interface and lifecycle purposes. These operations must be coordinated across tabs. Where the preferred coordination facility is unavailable, a fallback must still prevent overlap; **if safe coordination cannot be established, the operation is not started** (fail closed), and the user is told to retry or close the app's other tabs. Lack of a preferred API never authorizes overlapping operations. No particular locking API is prescribed; the smallest reliable mechanism is selected in M06-T03 planning (§12.6a).
  - *Amendment (M06-T03 authentication policy, approved November 26, 2026; supersedes the November 26, 2026 clarification of this requirement, which permitted a tab-local fallback and is no longer in effect (§11), and the fallback sentence above):* Cross-tab coordination of these operations requires the browser's Web Locks facility to be present and usable. No fallback coordination mechanism and no tab-local authentication mode is provided. Where the facility is absent, or present but not usable, sign-in, sign-out, Finish signing out, and Sign in again are not started (fail closed); offline-library functionality is unavailable; and the interface explains that this browser does not support the coordination these features require and suggests using a current version of a supported browser. In such a browser, an existing session cookie does not restore signed-in functionality (an authenticated session-check response is not acted on), uncoordinated sign-out is refused, and the server session may therefore remain active until it expires; the explanation says so. Existing offline security state (a sign-out intent, a durable failure record, the safety lock, and saved records) is preserved and is never cleared or deleted to enable authentication. Public landmark browsing remains available.
- **OFF-OUT-8 — Confirmed absence of a session (D3):** a session check that confirms there is no server session for this browser invalidates the current lifecycle and starts cleanup, exactly as a sign-out does. If a sign-out intent is pending, it also confirms the server sign-out. A failed or unavailable session check (network error, `5xx`, invalid response) changes nothing.
- **OFF-OUT-9 — Server confirmed, cleanup failed:** if the server sign-out is confirmed but local cleanup fails, residual offline data stays blocked, the cleanup failure is disclosed, and the recovery actions of OFF-LIFE-9 are offered.
- **OFF-OUT-10:** Specification 3's authentication requirements are unchanged; in particular, a failed sign-out request is never reported as a confirmed server-side logout (Specification 3 §4.4). These requirements change only frontend state handling; no authentication API contract is changed.
- **OFF-OUT-11 — Limit of server sign-out confirmation (approved November 26, 2026):** A server sign-out is confirmed (OFF-OUT-5, OFF-OUT-6, OFF-OUT-8) only by a validated server response obtained within the coordinated authentication operation that sent the request: a successful sign-out response, or a session check confirming that no session exists. A synthetic, inferred, or unvalidated result never confirms a sign-out. A confirmation establishes that the server reported no session at that time. It does not guarantee that an earlier authentication request, interrupted in a browser context that has since terminated (for example a closed or crashed tab), cannot still cause the server to establish a session afterwards, and such a session may not be detectable by the application. This residual risk is accepted for ordinary sign-out, Finish signing out, and Sign in again (OFF-FAIL-6). The interface may report a confirmed server sign-out, but never claims that no later session can be issued. This acceptance is limited to that risk: it does not extend to clearing the safety lock (OFF-FAIL-5) or to any other requirement, and every other security requirement of this specification applies unchanged. Where the application detects unresolved uncertainty (an unreadable sign-out intent, failure record, or safety lock, or a result it cannot validate), it keeps the applicable protections and fails closed.

### 12.5 Authoritative Evidence and Redaction Precedence (D7, D8)

- **OFF-EV-1 — Landmark responses** (`GET /api/v1/landmarks/:id`, Specification 2 §7.3 and §9.4a):

  | Response | Classification |
  |---|---|
  | `200`, valid full profile (OFF-EV-3) | Eligible; the landmark is available |
  | `200`, valid minimal redacted profile — exactly `id`, `display_name`, `category`, `redacted: true`, with `id` equal to the requested ID | **Authoritative redacted** |
  | `404` with the project's JSON error envelope (`NOT_FOUND`) | **Authoritative unavailable** |
  | `401` | Authentication failure, **not** landmark unavailability. Stored content is unchanged, and session verification follows (OFF-OUT-8). |
  | Network failure, timeout, `429`, `5xx` | Transient; not authoritative |
  | Any other status, or a `2xx` body that fails validation | Invalid; not authoritative |

- **OFF-EV-2 — Owned-trip responses** (`GET /api/v1/trips/:tripId`, Specification 5 §7.2):

  | Response | Classification |
  |---|---|
  | `200`, valid owner trip (OFF-SNAP-4) with `id` equal to the requested ID | Authoritative for the trip as a whole. Each **validated unavailable stop** is authoritative evidence that its landmark is unavailable. Each available stop's fields are eligible for that trip snapshot only. |
  | `404` with the project's JSON error envelope | **Authoritative trip unavailable** (deleted or not owned). This is **not** evidence about any landmark in the trip. |
  | `401` | Authentication failure, **not** trip or landmark unavailability. Stored content is unchanged, and session verification follows (OFF-OUT-8). |
  | Network failure, timeout, `429`, `5xx` | Transient; not authoritative |
  | Any other status, or a `2xx` body that fails validation | Invalid; not authoritative |

- **OFF-EV-3 — Landmark eligibility (D8; correction 2):** only a validated full-profile response is eligible. Validation requires all of the following:
  - HTTP `200` with a JSON body;
  - `id` equal to the requested ID;
  - `display_name` a non-empty string;
  - `category` one of the known category slugs;
  - finite `latitude` in [−90, 90] and `longitude` in [−180, 180];
  - `source_description`, `source_access_label`, and `source_url` each a string or `null`;
  - no `redacted` property.

  The absence of a `redacted` flag alone is insufficient.
- **OFF-EV-4 — Precedence:** authoritative redaction and unavailability take precedence over preserving an earlier snapshot. Once authoritative evidence shows that stored content is no longer eligible, that content must not be displayed again, even if storing the redaction fails (§12.6). Transient and invalid responses never overwrite or extend a snapshot. The prior snapshot is kept, labelled stale, and the failure is reported. An invalid response is reported as an unexpected server response, not as connectivity loss.
- **OFF-EV-5 — Invalidation ordering (beyond per-snapshot revisions):** the implementation must maintain a lifecycle-scoped invalidation mechanism — for example, landmark-specific invalidation records ordered by a lifecycle-scoped sequence, or an equivalent selected during M06-T03 planning — that protects both existing and newly created snapshots:
  - (a) An operation (save or refresh) that started before an applicable authoritative invalidation of a landmark must not write that landmark's protected fields into any snapshot, whether it is creating or updating one.
  - (b) A stale response must not create, recreate, or restore a snapshot that was deleted, replaced by an unavailable marker, or invalidated after the operation started.
  - (c) A concurrent trip save or refresh carrying earlier "available" data for a landmark invalidated after the operation started must store that stop as unavailable.
  - (d) When landmark and trip evidence conflict and their order cannot be established from the mechanism, **unavailability prevails**; the user may refresh again.
  - (e) Each snapshot also carries a revision that a commit must match, so that a concurrent duplicate save or delayed refresh cannot overwrite a newer snapshot of the same item (correction 3).
  - (f) **When ordering is established:** the order of two results is established only when one operation's response was received before the other operation started. Operations that overlapped in time have **no established order**, because the server may have evaluated them in either order. In that case clause (d) applies.
  - (g) **Delayed available responses:** these may write protected fields only if no applicable invalidation, deletion, or unavailable marker was recorded after the operation started.
  - (h) **Delayed authoritative unavailable responses:** these are always applied (OFF-EV-6), unless a later operation that started *after* this response was received has already restored availability through an eligible refresh (OFF-EV-8).
  - (i) **Previously unsaved items:** a save never creates a snapshot from a response that started before an applicable invalidation.
  - (j) **Deleted items:** a save or refresh never recreates a snapshot the user removed after it started.
  - (k) **Concurrent landmark and trip operations:** these follow (a)–(h), so each landmark's protected fields reach a snapshot only from evidence that is not superseded by unavailability.

  An older local copy never restores invalidated content.
- **OFF-EV-6 — Propagation:** authoritative unavailability of a landmark — from a landmark refresh or save attempt, or from a validated unavailable stop in an owned-trip refresh — is applied, in one storage transaction where possible, to every snapshot in the same account lifecycle that contains that landmark:
  - The landmark snapshot becomes an unavailable marker (OFF-SNAP-3).
  - In each trip snapshot, the stop becomes the exact unavailable placeholder `{ id, is_available: false }`; the name, category, and coordinates are removed; and `distance_from_previous_miles` becomes `null` for the stop and for the following stop.
  - The trip's distance summary enters an explicit **invalidated** state (OFF-SNAP-5). The obsolete numeric summary values are **removed from the persisted record**, not merely hidden. Unaffected server-provided leg distances are kept. No replacement distance is calculated on the client.
- **OFF-EV-7 — Trip unavailability:** a trip-level authoritative `404` replaces that trip snapshot with an unavailable trip marker (OFF-SNAP-6). It is not a successful refresh and is **not** propagated as evidence that any of the trip's landmarks are unavailable. It changes no landmark snapshot and no other trip snapshot. An unavailable trip marker is distinct from an available trip that contains unavailable stops.
- **OFF-EV-8 — Restoration:** availability is restored only by an explicit, user-initiated, eligible, validated refresh of the snapshot concerned, from an operation that started after the latest applicable invalidation. Restoring one snapshot never restores protected fields in any other snapshot. Invalidated content is never recovered from an older local copy.
- **OFF-EV-9 — Individual refresh only:** refresh is per snapshot and user-initiated. Bulk "refresh all" is deferred (D10) as a possible future enhancement, not a release requirement. There is no automatic refresh on startup, reload, or reconnect (§4.4, §9.4).

### 12.6 Persistent-Storage Failure, Durable Invalidation, and Residual Risk

- **OFF-FAIL-1 — Sequence:** when sign-out intent, lifecycle invalidation, or authoritative redaction must be persisted, the application:
  1. immediately blocks the affected data from display;
  2. attempts the transactional invalidation, redaction, or cleanup;
  3. if that fails, attempts a safe deletion of the affected records or another durable invalidation record in IndexedDB;
  4. if IndexedDB cannot durably record the security invalidation, sets the D22 safety lock (OFF-FAIL-5);
  5. in every case where durable invalidation is not confirmed, keeps the affected library or records blocked for the current application instance;
  6. notifies other active tabs where possible;
  7. discloses the failure and offers explicit recovery actions (Retry; Delete all offline data on this device).
- **OFF-FAIL-2 — Reported states:** the interface and logs distinguish, and never conflate:
  - durable invalidation;
  - successful logical deletion (completed cleanup, verified by a read);
  - safety lock set (defense in depth only);
  - in-memory-only blocking;
  - unconfirmed durable protection.

  Physical erasure of browser storage is **never** claimed. Overwriting or deleting a record does not guarantee that the data is erased from disk.
- **OFF-FAIL-3 — Fail closed on startup:** where an invalidation or cleanup failure has been durably recorded, every subsequent startup keeps the affected offline library locked until recovery succeeds.
  - *Clarification (M06-T03, approved November 26, 2026):* A durably recorded failure represents only local storage obligations: offline records that must be removed because a cleanup, an invalidation, or an account-switch invalidation could not be completed. A failure record must never be the only durable record of an unresolved server sign-out; such an obligation is recorded as a sign-out intent (§12.4) or the safety lock (OFF-FAIL-5). The record does not identify the affected records, and later failures are joined to it rather than replacing it, so its recorded reason is not a complete account of the failures it represents. Recovery from a failure record therefore requires that all records in the application's offline data database in this browser, across all five of its data stores, have been removed and their absence verified by a subsequent read, before the failure record itself is removed and that removal is verified. This is logical deletion; physical erasure is not claimed. The application-shell cache, the service-worker registration, unrelated browser storage, and the separate offline security state (the sign-out intent, the failure record, and the safety lock) are not part of this removal. This recovery requires no server request. It is refused without durable modification if, at its initial inspection, a sign-out intent or the safety lock is present, or either, or the applicable storage, cannot be reliably read; the recovery of OFF-OUT-5, OFF-OUT-6, or OFF-FAIL-5 then applies *[editorial note, M06-T03 3c-2: under the OFF-FAIL-5 amendment the safety lock is not cleared in the application]*. A safety lock established while the recovery is in progress is never cleared by it, and the recovery then does not report overall security recovery (AC-40). Where it would discard saved offline copies, the authorization of OFF-LIFE-9 applies. Completing it does not by itself restore offline access or release the application's local block: offline access resumes only through a verified identity and a new lifecycle (OFF-LIFE-2).
- **OFF-FAIL-4 — Inherent limitation:** if every available persistent-storage write and deletion fails, the application **cannot guarantee** that an in-memory invalidation or sign-out block survives closing or reloading the application. Previously stored content could then become readable to the application again after reload. The application must disclose this risk when it occurs (for example: "This device could not record the change. Closing this page may make the removed content available again until it can be cleaned up."). Unconditional durable protection is not claimed.
- **OFF-FAIL-5 — Device-wide safety lock in `localStorage` (D22; approved storage exception, 2026-11-25):** the only approved exception to keeping offline state out of `localStorage`. It is defense in depth, **not** guaranteed durable protection.
  - **Content:** a single fixed safety-lock value (a boolean or equivalent constant). It never contains an account or lifecycle identifier, credential, session token, share token, coordinate, snapshot content, timestamp, or other personal information. It is not an authentication mechanism and is never treated as evidence of identity or of a session.
  - **When set:** whenever IndexedDB cannot durably record a security invalidation — sign-out intent, lifecycle invalidation, or authoritative redaction (OFF-FAIL-1 step 4) — and before a "Delete all offline data" action that would remove the only durable record of a pending sign-out intent (OFF-LIFE-9).
  - **Effect:** while present, all offline-library access is blocked on this device for every account: no reads, saves, refreshes, or lifecycle creation. It is checked at startup **before** offline-library access is restored, before lifecycle creation, and before every snapshot read and commit (OFF-LIFE-6). Changes are propagated to other active tabs where supported.
  - **Conservative recovery:** when the lock is the only surviving evidence of a failed security operation — no IndexedDB record explains it — recovery must assume that a sign-out intent may be unresolved:
    - authenticated functionality is **not** silently restored from an authenticated `get-session` response;
    - the user must use Finish signing out or Sign in again (OFF-OUT-5, OFF-OUT-6);
    - residual offline data is cleaned up and the cleanup verified.
  - **Clearing:** only after the required recovery has completed **and been verified**, meaning:
    - required invalidations are durably recorded, or the affected records are logically deleted and verified;
    - no residual records of invalidated lifecycles remain readable;
    - where a sign-out may be unresolved, the server sign-out is confirmed or a deliberate new sign-in (OFF-OUT-6) has completed.

    The lock is never cleared merely because a user signs in, the application reloads, or IndexedDB is reopened. Deleting IndexedDB does not clear it.
    - *Clarification and narrowing amendment (M06-T03, approved November 26, 2026):* Because the lock carries no detail and may stand for an unresolved sign-out, for the lock "the server sign-out is confirmed" means: a server sign-out, or a session check confirming that no session exists, initiated after the recovery inspected the durable offline state and confirmed by a validated server response, with no other authentication request made between that confirmation and the clearing. The deliberate-new-sign-in branch is not used to clear the lock: Sign in again (OFF-OUT-6) resolves it, if at all, after its sign-out step is confirmed and before the user's credentials are submitted. In addition, all records in the application's offline data database in this browser, across all five of its data stores, must have been removed and their absence verified; any sign-out intent and durable failure record must have been resolved through their own approved steps; and the lock's removal must be verified by a subsequent read. Where any of these cannot be established, including where it cannot be established that the confirmation still reflects this browser's session when the lock is cleared, the lock is not cleared and offline access stays blocked. These are the conditions any clearing must satisfy; they do not establish that a particular clearing procedure satisfies them under every interleaving. The server request is never retried automatically. Clearing the lock does not by itself release the application's local block or restore offline access.
    - *Amendment (M06-T03 authentication policy, approved November 26, 2026):* The application does not clear the safety lock in this release. No in-app procedure has been established to satisfy the clearing conditions above, and the accepted residual risk of OFF-OUT-11 does not extend to clearing. While the lock is present or unreadable: offline-library access stays blocked; no signed-in functionality is available; credentials are not submitted; authenticated functionality is not restored from a session check; and the interface explains the limitation and the available actions (OFF-REC-2 to OFF-REC-4). The "Conservative recovery" steps above therefore resolve, where possible, a pending sign-out intent through Finish signing out, but never the lock itself. Removing this site's data in the browser removes the lock, but this is not verified recovery (OFF-REC-3).
  - **Absence:** a missing lock is **not** evidence that cleanup or invalidation succeeded.
  - **Failure:** if `localStorage` is unavailable or the write fails, the in-memory block is kept, and the interface discloses that durable protection could not be confirmed (OFF-FAIL-4 applies).
  - **Limitation:** the lock does not survive a user or browser clearing site data, or eviction of the origin's storage.
  - **Open:** the exact implementation and recovery mechanism are subject to M06-T03 planning and approval.
- **OFF-FAIL-6 — Residual risks** (recorded for M07-T02 security review and production-readiness assessment):
  - no remote revocation of content on a device that stays offline;
  - no guaranteed physical erasure;
  - loss of in-memory blocks when all storage writes fail, including the safety lock (OFF-FAIL-4, OFF-FAIL-5);
  - delayed invalidation in suspended tabs (OFF-LIFE-7) — an inherent notification limitation, distinct from preventable concurrent-write races, which must be prevented (§12.6a);
  - reduced availability when safe cross-tab coordination cannot be established, because the operations are refused (OFF-OUT-7, §12.6a);
  - an unrevoked server session after an unconfirmed sign-out until Finish signing out succeeds (OFF-OUT-3);
  - browser eviction, including iOS Safari (§4.1);
  - device clocks used for local timestamps (OFF-SNAP-7);
  - *(added November 26, 2026)* a server session established after a confirmed sign-out by an earlier authentication request interrupted in a terminated browser context, which may not be detectable (OFF-OUT-11; explicitly accepted by the developer November 26, 2026, and limited to that risk);
  - *(added November 26, 2026)* once set, the safety lock is not cleared in the application, so offline-library access and signed-in functionality stay unavailable in that browser until the user removes the site's data (OFF-FAIL-5 amendment);
  - *(added November 26, 2026)* browsers without usable Web Locks receive public landmark browsing only, and a server session existing there may remain active until it expires (OFF-OUT-7 amendment).

### 12.6a Cross-Tab Coordination and Concurrency

- **OFF-CONC-1:** The browser's limits on notifying suspended, frozen, or unresponsive tabs are accepted as an inherent limitation (OFF-LIFE-7). **Preventable concurrent-write races are not accepted**: the lack of a preferred coordination facility never authorizes an unsafe concurrent operation.
- **OFF-CONC-2:** Regardless of coordination facility, the implementation must provide:
  - lifecycle validation on every read and commit (OFF-LIFE-6);
  - transactional checks for every applicable write — lifecycle, revision, invalidation ordering (OFF-EV-5), limits (OFF-STORE-1), and the safety lock;
  - protection against stale and conflicting responses (OFF-EV-5);
  - prompt cross-tab invalidation where supported, with focus, visibility, and access checks as the fallback (OFF-LIFE-7).
- **OFF-CONC-3:** Where safe coordination of an operation cannot be established, that operation is refused (fail closed) and the reason is disclosed (OFF-OUT-7).
- **OFF-CONC-4:** No particular locking or messaging API is prescribed by this specification. The smallest reliable mechanism is evaluated in M06-T03 planning.
  - *Amendment (M06-T03 authentication policy, approved November 26, 2026):* Web Locks is the required coordination facility for the authentication operations of OFF-OUT-7 and for offline-library security transitions, reads, and commits. Cross-tab notification remains best-effort (OFF-LIFE-7).

### 12.7 Snapshot Data Contracts (D6, D12, D15, D17; corrections)

- **OFF-SNAP-1 — General:**
  - Every offline record is built from an explicit field allowlist and validated on write and on read.
  - Raw API responses and authentication responses are never persisted.
  - Never persisted: passwords, session tokens, session IDs, cookies, reset tokens, share tokens or share URLs, email addresses, reviews and ratings (D15), favorite state, `sensitivity_status`, `is_active`, source codes or files, other GPX metadata, `distance_miles`, and any field not on the allowlist.
  - Every record carries `schema_version`, `account_id`, `lifecycle_id`, and `revision`.
- **OFF-SNAP-2 — Available landmark snapshot:** from a validated full profile only.
  - *Required:* `landmark_id`, `status: "available"`, `display_name`, `category`, `latitude`, `longitude`, `saved_at`.
  - *Optional, stored exactly as returned:* `source_description`, `source_access_label`, `source_url`, `refreshed_at`.
- **OFF-SNAP-3 — Unavailable landmark marker (D6):** contains only the management metadata: `landmark_id`, `status: "unavailable"`, `saved_at` (the original value, retained for ordering and management), and `unavailable_recorded_at`, plus the common fields of OFF-SNAP-1. No name, category, coordinates, or source fields. It **counts toward the 200-landmark limit** until the user explicitly removes it. Recording unavailability is not a successful refresh.
- **OFF-SNAP-4 — Available owned-trip snapshot:** from a validated owner trip response only. Validation covers:
  - an `id` matching the requested trip;
  - a `name` of 1–100 characters;
  - `stops` in position order with contiguous positions 0…n−1 and at most 25 stops;
  - each stop's exact allowlisted shape;
  - `distance_summary` consistent with Specification 5 §5.6 (`total_legs = max(n − 1, 0)`; `measured_legs ≤ total_legs`; `total_miles` `null` exactly when `measured_legs` is 0).

  Stored fields:
  - *Required:* `trip_id`, `status: "available"`, `name`, `stops[]`, `distance_summary`, `distance_summary_state: "server"`, `saved_at`.
  - *Each stop:* `stop_id`, `position`, `is_available`, `distance_from_previous_miles`, and `landmark`. An available landmark has exactly `{ id, display_name, category, latitude, longitude }`; an unavailable landmark has exactly `{ id, is_available: false }`.
  - *Optional:* `trip_updated_at` (the server's `updated_at`), `refreshed_at`, `partially_invalidated_at`.
  - *Excluded (D17):* `version`, `is_shared`, `sharing_enabled`, `share_url`, and any token or owner identifier other than the account scope.

  Server ordering and straight-line distance semantics are preserved exactly. No route, line, travel distance, or fabricated coordinate is stored or displayed.
- **OFF-SNAP-5 — Invalidated distance summary:** set only by OFF-EV-6. The persisted record holds `distance_summary_state: "invalidated"` and `distance_summary: null`: the obsolete `total_miles`, `measured_legs`, and `total_legs` values are **removed**, not merely hidden. The affected adjacent legs are `null`. Unaffected server-provided leg distances remain as stored. The interface states that the distance summary is unavailable until the trip is refreshed. No distance is recalculated on the client. Only an eligible, explicit, validated refresh of that trip restores `distance_summary_state: "server"` and a server-provided summary.
- **OFF-SNAP-6 — Unavailable trip marker (D6 applied to owned trips; approved 2026-11-25):** contains only the management metadata: `trip_id`, `status: "unavailable"`, `saved_at` (original, retained for ordering and management), and `unavailable_recorded_at`, plus the common fields of OFF-SNAP-1.
  - The trip name, stops, landmark data, coordinates, distances, distance summary, `trip_updated_at`, and all other trip content are removed.
  - It is not a successful full-content refresh, and it **counts toward the 25-trip limit** until the user explicitly removes it.
  - It is created only by a trip-level authoritative `404` (OFF-EV-7) and is never evidence about the trip's landmarks.
  - It is distinct from an available trip snapshot that contains unavailable stops.
- **OFF-SNAP-7 — Timestamps:** ISO 8601 UTC, from the device clock, and presented as approximate.

  | Field | Meaning | When it changes |
  |---|---|---|
  | `saved_at` | When the user first explicitly saved the item | Never; retained by unavailable markers |
  | `refreshed_at` | When a validated server response last replaced the **whole** snapshot through an explicit refresh | Each successful whole-snapshot refresh; absent until the first |
  | `last_synced_at` | The latest whole-snapshot synchronization with the server; the freshness value shown to users | Derived as `refreshed_at` if present, otherwise `saved_at`; not stored separately |
  | `unavailable_recorded_at` | When authoritative unavailability was recorded locally | When a marker is created |
  | `partially_invalidated_at` | When a propagated redaction last changed part of a trip snapshot | On propagation |

  A propagated redaction does **not** update `refreshed_at` or `last_synced_at`, and the interface must not present it as a successful refresh of the trip. The interface shows that part of the trip was updated locally and that the trip should be refreshed. Recording unavailability — creating either kind of marker — is not a successful full-content refresh and does not update `refreshed_at`. Freshness labels for markers state when unavailability was recorded (for example, "No longer available — recorded <date>") and never imply that the content was refreshed or synced.
- **OFF-SNAP-8 — Invalid or incompatible records:** a record that fails read validation, or has an unknown `schema_version`, is never displayed — not even partially. It is listed as an unreadable saved copy that the user can remove. Schema upgrades use versioned IndexedDB migrations. A failed migration locks the library and offers the OFF-LIFE-9 recovery actions.
- **OFF-SNAP-9 — No backend change:** these contracts are satisfiable from the existing landmark detail and owner trip responses (Specifications 2 and 5); no backend or API change is required or authorized.

### 12.8 Storage Limits and Storage Failures

- **OFF-STORE-1:** **Per account, per device:** at most **200** landmark snapshots and **25** owned-trip snapshots (§4.1, §9.5). Available snapshots and unavailable markers both count; metadata, sign-out intent, invalidation records, and the safety lock do not. Limits are checked inside the write transaction. Lifecycle identifiers enforce isolation only and must not be a way around the limits: a new lifecycle cannot save while records of an earlier lifecycle remain unresolved (strict cleanup lock, OFF-LIFE-9), so at most one lifecycle's records per account are ever counted and readable.
- **OFF-STORE-2:** At a limit, a new save is rejected without changing any record, with guidance to remove a saved copy. No silent eviction. Refreshing an existing snapshot, or restoring an unavailable marker through an eligible refresh, does not change the count and is allowed at the limit.
- **OFF-STORE-3:** A duplicate save of an already saved, available item does not create a second record and does not change the count. Concurrent duplicates resolve to one record (OFF-EV-5(e)).
- **OFF-STORE-4:** Browser quota errors (for example `QuotaExceededError`) are distinct from application limits and have their own message. A failed write leaves the prior record unchanged and never reports success.
- **OFF-STORE-5:** If IndexedDB is unavailable, disabled, or restricted (including some private-browsing modes), save controls are disabled with an explanation, and the library shows that offline storage is unavailable — never an empty list.
- **OFF-STORE-6 (D13):** Persistent storage is requested once, at the first successful save, where supported. The result is reported honestly; persistence is never promised.
- **OFF-STORE-7 (correction 5):** An empty library is shown neutrally (for example: "No saved copies on this device. Saved copies can be removed by the browser or when you sign out."). It is presented as browser eviction **only** with positive evidence, and no such evidence mechanism is required by this specification.

### 12.9 Connectivity (correction 1)

- **OFF-NET-1:** The application distinguishes four signals:
  - **browser connectivity hints** (`navigator.onLine` and `online`/`offline` events), which are hints only;
  - **network failures** (a request that fails without a response — which may be caused by the device, the network, DNS, a captive portal, or the server being unreachable);
  - **server failures** (`5xx`, `503`, or an invalid response from a reachable server);
  - **verified server reachability** (a valid response from the application's own API).
- **OFF-NET-2:** A failed request does not prove that the device has no internet connection. Messages say the app "can't reach the server" unless the browser also reports being offline. Server errors are worded as server errors. Retry is offered.
- **OFF-NET-3:** Connectivity events never trigger snapshot refreshes (OFF-EV-9).

### 12.10 Service-Worker Boundaries (D14)

- **OFF-SW-1:** The service worker precaches only the versioned application shell — the built `index.html`, hashed JavaScript and CSS, icons, and the manifest — and removes obsolete caches on upgrade. Updates use a user-visible reload prompt and never discard an in-progress action (§5).
- **OFF-SW-2:** Navigation fallback to the precached shell excludes `/api/*`, `/health`, and `/shared/trips/*`. Shared-trip page navigations always go to the network, so the server's `X-Robots-Tag` and `Cache-Control` headers apply.
- **OFF-SW-3:** No runtime caching of:
  - `/api/v1/*`;
  - `/api/auth/*`;
  - `/api/v1/shared/*`;
  - account-specific or protected landmark responses;
  - map tiles or other external origins.

  Account data lives only in IndexedDB.

### 12.11 Offline Experience and Accessibility (D11, D12, D19)

- **OFF-UX-1:** Explicit **Save for offline**, **Remove offline copy**, and per-item **Refresh** actions, separate from Favorite. Each has an accessible status, and success or failure is announced.
- **OFF-UX-2 (D11):** Dedicated offline-library routes list saved landmarks, saved trips, unavailable markers, and unreadable copies. Online profile and trip pages are never silently replaced by saved copies; when one of them fails to load, it may link to the saved copy.
- **OFF-UX-3 (D12):** Offline snapshot views show no map. Coordinates of available landmarks are shown as text, with Specification 2's statement that coordinates do not establish public access, legal entry, maintained trails, or safety.
- **OFF-UX-4 (D19):** Every snapshot view always shows its last-synced time and a warning that the content may be outdated and that availability may have changed. There is no numeric staleness threshold.
- **OFF-UX-5:** Online-only actions (favorite, review, trip edits, sharing, sign-in) are disabled while the server cannot be reached, with a reason. Nothing is queued.
- **OFF-UX-6:** States covered: loading; empty (OFF-STORE-7); storage unavailable; unreadable copy; no longer available; limit reached; quota exceeded; cleanup failed; sign-out pending ("Signed out on this device — server sign-out not confirmed" and "Finish signing out"); invalidated trip distances; unavailable trip; safety lock present (OFF-FAIL-5); coordination unavailable — operation refused (OFF-CONC-3); in-memory-only block (OFF-FAIL-4).
- **OFF-UX-7:** WCAG 2.2 AA target, keyboard operation, visible focus, status announcements, and reduced-motion support (§8). **Zero automated axe violations is evidence, not proof, of conformance:** manual keyboard and assistive-technology review remain required (correction 8).

### 12.12 Browser Verification Projects (D16)

- **OFF-VER-1:** All existing Playwright browser tests (165 at the M05 baseline), and their assertions, are preserved. The existing regression project may block service workers so that request interception keeps working.
- **OFF-VER-2:** A separate, service-worker-enabled browser-test project runs against the actual production build and verifies:
  - application-shell precaching;
  - offline navigation;
  - service-worker updates;
  - authentication and sign-out behavior, including the sign-out intent states;
  - representative existing API operations;
  - shared-trip navigation and its response headers;
  - cache exclusions (OFF-SW-2, OFF-SW-3);
  - account isolation;
  - offline snapshot behavior;
  - relevant failure and recovery scenarios.
- **OFF-VER-3:** Both projects must ultimately be part of required regression verification. Playwright configuration, CI workflows, and test files are not changed by M06-T01; their changes are planned and approved within M06-T02, M06-T03, and M06-T05. Coverage remains Chromium-only unless otherwise approved; Firefox, Safari, and iOS behavior are recorded as manual or unverified (Specification 7 §10.3).

### 12.13 Release Gates and Deferred Items

- **OFF-GATE-1 (D9):** The sensitive-location classification policy (§9.8) must explicitly address **persistent offline distribution** of coordinates — whether `PUBLIC` coordinates may be stored on user devices, and the retention and revocation expectations — before production release. A `PUBLIC` classification by itself does not resolve this. No coordinate feature flag is introduced. Verification uses guarded synthetic `PUBLIC` fixtures. §9.8 remains a production release blocker.
- **OFF-GATE-2:** FR-14 remains **deferred** (§7.4), and M06-T04 remains Deferred. Bulk refresh (D10) is deferred. The fake-IndexedDB test dependency (D21) is to be decided at M06-T03; no dependency is approved by this specification.

### 12.14 Acceptance Criteria (v1.1, approved November 25, 2026)

The verification key (§12.15) is: **U** = unit or component test; **B-R** = regression browser project; **B-SW** = service-worker-enabled browser project; **M** = manual.

*Scope and lifecycle*

- **AC-1:** Snapshots saved by account A are not readable by account B on the same browser, nor by a later lifecycle of A after sign-out and re-sign-in. Residual records of an invalidated lifecycle stay unreadable even when cleanup failed.
- **AC-2:** A reload, temporary offline period, or repeated session check for the same account keeps the same `lifecycle_id`; only `verified_at` changes.
- **AC-3:** A save or refresh whose lifecycle is invalidated before it commits commits nothing. This is tested with a deliberately delayed response.
- **AC-4:** With required cleanup unresolved, the new lifecycle's library is locked. Retry cleanup and Delete all offline data are offered. Deletion that is blocked by another open tab is reported as blocked, not complete. Server-side favorites and trips are unchanged after deletion. *Clarification (approved November 26, 2026):* Delete all offline data, and any recovery that discards saved copies, first discloses the consequences and obtains explicit authorization (OFF-LIFE-9); Retry cleanup of an invalidated lifecycle does not require it.
- **AC-5:** After a lifecycle invalidation in one tab, a second tab discards rendered snapshot content on notification, or at the latest on its next focus, visibility change, or offline-library access.

*Sign-out*

- **AC-6:** Signing out with the server unreachable shows "signed out on this device" and "server sign-out not confirmed" with the cleanup status. Offline account data and authenticated functionality stay blocked after reload, and no sign-out request is sent automatically on reconnect.
- **AC-7:** While a sign-out intent is pending, an authenticated `get-session` response for the original account does not restore the signed-in interface, the marker, or offline access.
- **AC-8:** Finish signing out clears the intent only after confirmed server sign-out. Sign in again submits credentials only after that confirmation and creates a new lifecycle. *Amendment (approved November 26, 2026):* confirmation comes only from a validated server response within the coordinated operation (OFF-OUT-11); an unvalidated or synthetic result leaves the intent pending; the interface never claims that no later session can be issued.
- **AC-9:** A sign-in cannot start while a sign-out request is in flight. A delayed sign-out result does not alter a newer session's interface state or lifecycle.
- **AC-10:** Server sign-out confirmed with an injected cleanup failure: residual data remains blocked, the failure is disclosed, and recovery actions are offered.
- **AC-11:** A session check confirming no session triggers cleanup (D3). A failed session check changes nothing.

*Evidence, redaction, and concurrency*

- **AC-12:** Only a validated full profile can be saved. A minimal redacted profile, a full profile missing a required field, a mismatched `id`, out-of-range coordinates, or a body without the `redacted` flag but failing validation are each rejected.
- **AC-13:** A landmark refresh returning the redacted profile or an authoritative `404` leaves no name, category, coordinates, or source fields for that landmark in any snapshot of the lifecycle. Every trip snapshot containing it stores the exact placeholder, `null` adjacent legs, unchanged unaffected legs, `distance_summary_state: "invalidated"`, and `distance_summary: null`. No obsolete `total_miles`, `measured_legs`, or `total_legs` value remains in the persisted record, and no total is displayed.
- **AC-14:** An owned-trip refresh containing a validated unavailable stop propagates unavailability to the landmark snapshot and to other trip snapshots in the lifecycle.
- **AC-15:** A trip-level `404` produces an unavailable trip marker containing only `trip_id`, `status`, the original `saved_at`, `unavailable_recorded_at`, and the common fields: no name, stops, coordinates, distances, or `trip_updated_at`. It leaves `refreshed_at` unset or unchanged, counts toward the 25-trip limit until explicitly removed, can be removed, and changes no landmark snapshot or other trip snapshot.
- **AC-16 (concurrency):** Using controlled response ordering:
  - (a) a save started before an invalidation of the same landmark, resolving after it, creates no snapshot with protected fields;
  - (b) a trip refresh started before a landmark invalidation, resolving after it, stores that stop as unavailable;
  - (c) a refresh for a snapshot removed after the refresh started does not recreate it;
  - (d) two concurrent duplicate saves produce one record and an unchanged count;
  - (e) a delayed refresh does not overwrite a newer revision;
  - (f) when the landmark and trip results conflict in an unprovable order, the landmark is unavailable after both commit;
  - (g) an "available" landmark response from an operation that overlapped an operation returning "unavailable" writes no protected fields, whichever response arrives first;
  - (h) a delayed authoritative unavailable response is applied even when it arrives after an overlapping "available" response committed;
  - (i) a refresh that started after an unavailable response was received, and that returns a valid full profile, restores only that landmark's snapshot.
- **AC-17:** Restoring a landmark through an eligible refresh does not restore it in any trip snapshot, and no older local copy reappears.
- **AC-18:** A transient (network, `429`, `5xx`) or invalid response leaves the snapshot unchanged and labelled stale, and is reported by its category.

*Storage failure*

- **AC-19:** With an injected failure of the redaction transaction, the fallback deletion is attempted; if it succeeds, the content is gone. If all writes fail, the content is not displayed for the rest of the application instance, the in-memory-only state and the OFF-FAIL-4 risk are disclosed, and nothing claims erasure or durable protection.
- **AC-20:** A durably recorded cleanup or invalidation failure keeps the library locked on the next startup until recovery succeeds. *Clarification (approved November 26, 2026):* Recovery succeeds through the recovery of OFF-FAIL-3 (all records in the application's offline data database in this browser, across all five of its data stores, removed and their absence verified, then the failure record's removal verified) or of OFF-FAIL-5 *[editorial note, M06-T03 3c-2: safety-lock recovery is not supported in the application; OFF-FAIL-5 amendment]*; a successful retry of the originally failed operation alone does not remove the record.

*Contracts and limits*

- **AC-21:** Stored records contain exactly their allowlisted fields. A scan of offline storage finds no session token, session ID, email address, share token, review, rating, `version`, `is_shared`, or `sharing_enabled` value. This includes after saving while the authentication responses carry a token.
- **AC-22:** `saved_at` never changes. `refreshed_at` changes only on a successful whole-snapshot refresh. A propagated redaction sets `partially_invalidated_at` and leaves `last_synced_at` unchanged.
- **AC-23:** The 200th landmark and 25th trip saves succeed. The next save is rejected with no record changed. Unavailable markers count toward the limits. Refresh at a limit succeeds. Nothing is evicted.
- **AC-24:** Quota errors, unavailable IndexedDB, and unreadable or unknown-schema records produce their specific messages and never a false success or an empty list.
- **AC-25:** No refresh request occurs on startup, reload, or reconnect. Only per-item refresh exists.

*Connectivity, service worker, and experience*

- **AC-26:** With the browser reporting online but the API unreachable, the interface says it cannot reach the server. `navigator.onLine` alone never establishes reachability.
- **AC-27:** The shell loads offline after one online visit. `/api/*`, `/api/auth/*`, `/api/v1/shared/*`, tile, and external requests never appear in service-worker caches. `/shared/trips/*` navigations reach the server and receive its headers. An update shows a reload prompt.
- **AC-28:** Offline snapshot views show no map, show last-synced time and the stale warning, and disable online-only actions with a reason.
- **AC-29:** Keyboard and screen-reader users can save, remove, refresh, browse, and recover. Automated axe scans report zero violations, and the manual accessibility review is recorded separately.
- **AC-30:** No interface element offers or implies offline map downloads (FR-14 deferred).

*Final refinements (added 2026-11-25)*

- **AC-31 (D22 contents):** after any lock-setting failure, the only offline value in `localStorage` is the fixed safety-lock value. A scan finds no account or lifecycle identifier, token, coordinate, timestamp, or snapshot content there.
- **AC-32 (D22 behavior):**
  - with an injected IndexedDB write failure during sign-out, redaction, or lifecycle invalidation, the lock is set, and offline-library access stays blocked after reload, after sign-in, and after IndexedDB is reopened;
  - another tab is notified where supported;
  - ~~the lock is cleared only after verified recovery (as defined in the OFF-FAIL-5 clarification; never by failure-record recovery, Delete all offline data, sign-in, or reload);~~ *superseded by the amendment approved November 26, 2026:* the lock is never cleared by the application (OFF-FAIL-5 amendment), including by failure-record recovery, Delete all offline data, sign-in, Finish signing out, or reload;
  - with `localStorage` writes also failing, the in-memory block remains and "durable protection could not be confirmed" is disclosed.
- **AC-33 (lock as sole evidence):** with the lock present and no explaining IndexedDB record, an authenticated `get-session` response does not restore authenticated functionality or offline access. Recovery requires Finish signing out or Sign in again, plus verified cleanup. *Clarification (approved November 26, 2026):* The confirming sign-out or no-session check is initiated after the recovery inspected the durable state; verified cleanup means all records in the application's offline data database in this browser, across all five of its data stores, removed and their absence verified; for Sign in again, the lock is resolved before credentials are submitted. *Amendment (approved November 26, 2026; governs over the preceding sentences of this criterion):* Finish signing out may be used but does not clear the lock. No credentials are submitted and no signed-in functionality is available while the lock is present or unreadable, and the OFF-REC-3 and OFF-REC-4 explanation is shown.
- **AC-34 (sign-out intent survives recovery):** with a sign-out intent pending, "Delete all offline data" leaves the intent, or the durably set safety lock, in place afterwards. When neither can be confirmed, the action is blocked until the server sign-out is confirmed.
- **AC-35 (Sign in again):** with an intent pending, Sign in again sends no credentials if finishing the sign-out fails. Otherwise, sign-in begins only after the sign-out is confirmed. No automatic sign-out request is sent on reconnect. *Amendment (approved November 26, 2026):* with the safety lock present or unreadable, Sign in again submits no credentials.
- **AC-36 (fail-closed coordination; amended November 26, 2026 — the original text, "with the preferred cross-tab coordination facility unavailable, overlapping sign-in and sign-out attempts from two tabs never run concurrently; one is refused with a disclosed reason", is superseded):** With Web Locks absent or unusable, sign-in, sign-out, Finish signing out, and Sign in again are not started; a browser-compatibility explanation is shown; no offline storage is created or modified; existing offline security state is unchanged; an authenticated session-check response does not restore authenticated functionality; and public landmark browsing works. With Web Locks available, overlapping sign-in and sign-out attempts from two tabs never run concurrently. Concurrent snapshot writes from two tabs still respect the lifecycle, revision, invalidation, and limit checks.
- **AC-37 (`401`):** a `401` during a landmark or trip save or refresh leaves stored content unchanged, creates no unavailable marker, and starts session verification.
- **AC-38 (limits per account per device):** after sign-out and re-sign-in of the same account with residual records unresolved, the new lifecycle cannot save. After cleanup, the account's counts start from that lifecycle's records only, and the 200/25 limits are never exceeded for one account on one device.
- **AC-39 (freshness labels):** markers show when unavailability was recorded, never "refreshed" or "synced". A propagated redaction leaves `last_synced_at` unchanged.
- **AC-40 (local failure-record recovery; added November 26, 2026):** With a durable failure record present, reliably readable applicable storage, and neither a sign-out intent nor a safety lock present, explicit local recovery makes no server request. It removes all records from the application's offline data database in this browser, across all five data stores, and verifies their absence before removing the failure record and verifying that removal. Where saved offline copies, a current lifecycle, a malformed lifecycle marker, or unrecognized stored data would be discarded, recovery proceeds only after explicit authorization; without it, no durable records are removed. If a sign-out intent or safety lock is present or cannot be reliably inspected at the initial inspection, local recovery is refused without durable modification. If a safety lock is established before the final failure-record removal gate, the failure record is retained. If a safety lock is established during or after failure-record removal, it remains in place and the operation does not report overall security recovery. Local failure-record recovery never clears a sign-out intent or safety lock, never implies server sign-out confirmation, and never releases the application's local block. Subsequent authorization requires fresh durable-state inspection, and offline access resumes only through verified identity and an applicable new lifecycle.
- **AC-41 (unsupported recovery and explanations; added November 26, 2026):** For each unsupported recovery state (safety lock present; safety lock unreadable; unreadable sign-out intent, failure record, or offline database; coordination unavailable), offline-library access stays blocked, nothing is cleared, and an explanation names the unavailable function, the reason, and the available actions. Any mention of site-data removal states that it is destructive, removes saved offline copies, does not confirm server sign-out, and is not verified recovery. The explanations are reachable by keyboard and announced to screen readers.

### 12.15 Traceability (v1.1, approved November 25, 2026)

| Requirement | Source | Acceptance criteria | Verification | Task |
|---|---|---|---|---|
| OFF-SCOPE-1–3 | §4.1–§4.2, ADR-007 amendment, D1 | AC-1, AC-21 | U, B-SW | M06-T03 |
| OFF-LIFE-1–9 | §4.2, §9.1–§9.2, D5 | AC-1–AC-5, AC-20, AC-34, AC-38, AC-40 | U, B-SW, M | M06-T03 |
| OFF-OUT-1–11 | §9.2, Specification 3 §4.4, D3, D4, D4a; authentication policy (November 26, 2026) | AC-6–AC-11, AC-33–AC-36, AC-41 | U, B-SW | M06-T03 |
| OFF-EV-1–9 | §4.3–§4.4, §6, §9.8, D7, D8, D10 | AC-12–AC-18, AC-25, AC-37 | U, B-SW | M06-T03 |
| OFF-FAIL-1–6 | §4.2, §4.4, ADR-007, D22 | AC-19, AC-20, AC-31–AC-34, AC-40, AC-41 | U, B-SW, M | M06-T03; M07-T02 |
| OFF-CONC-1–4 | §12.3–§12.5, D5, D7 | AC-3, AC-5, AC-16, AC-36 | U, B-SW | M06-T03 |
| OFF-REC-1–4 | §12.3, §12.4, §12.6, §12.18; authentication policy (November 26, 2026) | AC-4, AC-20, AC-33–AC-35, AC-40, AC-41 | U, B-SW, M | M06-T03 |
| OFF-SNAP-1–9 | §3.4, §4.1, §9.3; Specifications 2 and 5; D6, D12, D15, D17 | AC-13, AC-15, AC-21, AC-22, AC-24, AC-39 | U, B-SW | M06-T03 |
| OFF-STORE-1–7 | §4.1, §4.4, §9.5, D13 | AC-23, AC-24, AC-38 | U, B-SW | M06-T03 |
| OFF-NET-1–3 | §3.2, ADR-007 | AC-25, AC-26 | U, B-SW | M06-T02 |
| OFF-SW-1–3 | §5, ADR-008, D14 | AC-27 | B-SW | M06-T02 |
| OFF-UX-1–7 | §3, §8, D11, D12, D19 | AC-28, AC-29 | U, B-SW, M | M06-T02, M06-T03 |
| OFF-VER-1–3 | ADR-009, Specification 7 §5, D16 | All | B-R, B-SW | M06-T02, M06-T05 |
| OFF-GATE-1–2 | §7.4, §9.7–§9.8, D9 | AC-30 | Documentation, B-SW | M06-T05, M07 |

### 12.16 Relationship to Version 1.0 (in effect from November 25, 2026)

For the provisions listed below, §12 takes precedence. All other Version 1.0 provisions remain in force unchanged.

- **Refines without replacing:** §3.2 (by §12.9); §3.3 and §3.4 (by §12.7 and §12.11); §4.1 (by §12.2, §12.7, §12.8); §4.2 and §9.1–§9.2 (by §12.3–§12.4); §4.3 (by §12.5); §5 (by §12.10); §6 (by §12.5); §8 (by §12.11); §9.3 (by §12.7); §9.8 (by §12.13); §10 (supplemented by §12.14).
- **Narrows:** §4.4's "preserve the prior valid snapshot on transient network failure" is limited by OFF-EV-4. Authoritative redaction or unavailability always takes precedence, and invalid responses are non-authoritative.
- **Clarifies (November 26, 2026):** §3.1's install-guidance bullet (by §12.17); OFF-OUT-7's fail-closed coordination requirement where the preferred facility is entirely absent (by the clarification under OFF-OUT-7; *superseded November 26, 2026 — see "Amends" below*); OFF-FAIL-3 failure-record recovery, OFF-FAIL-5 clearing (narrowed), and OFF-LIFE-9 discard authorization (strengthened), with AC-4, AC-20, AC-32, and AC-33 clarified and AC-40 added (by the clarifications under those requirements).
- **Amends (November 26, 2026 — authentication and recovery policy):** OFF-OUT-7 (the tab-local fallback is removed and Web Locks is required; the November 26, 2026 OFF-OUT-7 clarification listed under "Clarifies" above is superseded), OFF-OUT-6, OFF-CONC-4, OFF-FAIL-5 Clearing (no in-app clearing), and OFF-FAIL-6 (three residual risks added); adds OFF-OUT-11 and §12.18 (OFF-REC-1–4); amends AC-8, AC-32, AC-33, AC-35, and AC-36; adds AC-41.
- **Unchanged:** §1–§2 scope and architecture; §7 and the FR-14 deferral; the 200/25 limits; no offline mutations; no offline sign-in; owned-trip-only saves.

### 12.17 Installation Guidance (clarification of §3.1 — approved November 26, 2026)

- **OFF-INST-1:** When the browser exposes an install prompt, the application may offer an install affordance that shows the browser's prompt only on an explicit user action.
- **OFF-INST-2:** Installation guidance is truthful and capability-based. Platform-specific instructions may be given only when reliable capability or platform evidence supports them. When installation availability cannot be established, generic guidance — for example, that the browser may offer **Install app** or **Add to Home Screen** in its menu — is acceptable.
- **OFF-INST-3:** Guidance never guarantees or claims that installation is available, and never presents installation as downloading offline data. Installation remains optional and is never a prerequisite (§3.1).

### 12.18 Supported Recovery and User-Facing Explanations (amendment — approved November 26, 2026)

- **OFF-REC-1 — Supported recovery,** each with its existing preconditions:
  - Retry cleanup of an invalidated lifecycle (OFF-LIFE-9);
  - local failure-record recovery (OFF-FAIL-3, AC-40);
  - Finish signing out for a pending sign-out intent (OFF-OUT-5, OFF-OUT-11);
  - Sign in again with a pending sign-out intent and no safety lock (OFF-OUT-6);
  - Delete all offline data on this device (OFF-LIFE-9).
- **OFF-REC-2 — Not supported in the application:**
  - clearing the safety lock (OFF-FAIL-5 amendment);
  - any recovery while a required sign-out intent, failure record, safety lock, or offline database cannot be reliably read;
  - any recovery without usable cross-tab coordination (OFF-OUT-7 amendment);
  - removing a sign-out intent without a validated server confirmation (OFF-OUT-11).

  In these cases the protections remain, offline-library access stays blocked, nothing is cleared, and the interface explains the limitation. In-app recovery from every exceptional failure is not guaranteed; stronger recovery mechanisms are possible future enhancements, not current requirements.
- **OFF-REC-3 — Site-data removal:** where the remaining remedy is removing this site's data in the browser's settings, the interface explains all of the following:
  - it is destructive: it deletes every saved offline copy in this browser for every account, along with the offline security state and the browser's session cookie;
  - it does not end, or confirm the end of, the server session, and it does not establish verified recovery;
  - server-side landmarks, favorites, trips, and reviews are unaffected.

  It is never presented as a verified security bypass, and the application never performs it.
- **OFF-REC-4 — Explanations:** every refusal and unsupported state states, in plain language, what is unavailable, why, and the actions available (for example: retry, Finish signing out, close the app's other tabs, use a supported browser, or, where applicable, site-data removal under OFF-REC-3). It meets the accessibility requirements of OFF-UX and AC-29.

---

**End of Specification**