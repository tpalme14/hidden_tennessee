# Tennessee Natural Landmarks Explorer
## Specification 7 — Deployment, Testing, and Release Readiness

**Status:** Approved specification; implementation requires separate task authorization  
**Version:** 1.0 — October 29, 2026  
**Scope:** M00 foundation, M07 release; cross-cutting verification of FR-01–FR-14  
**Related ADRs:** ADR-001 through ADR-009, particularly ADR-008 and ADR-009

---

## 1. Objective and boundaries

Define a repeatable, secure deployment and a measurable release gate for the Tennessee Natural Landmarks Explorer. This specification does not replace the six approved feature specifications, the implementation plan, or ADRs. Where they conflict, the developer must flag the conflict for approval rather than silently choose an interpretation.

**Target:** feature-complete by December 1, 2026; release verification December 2–4, 2026. These are planning targets, not permission to bypass release gates.

## 2. Deployment architecture

- Production uses a Render-hosted Node.js/Express service that serves the built React/Vite frontend and versioned `/api/v1/*` endpoints from the same origin, consistent with ADR-008.
- Better Auth routes remain available at their approved `/api/auth/*` paths. Static assets, PWA manifest, service worker, and `/health` must be served correctly. The SPA fallback must be last and must never turn unknown API paths into HTML responses.
- PostgreSQL with PostGIS stores application data. Prisma is the schema/migration authority; raw parameterized spatial SQL is isolated in the data-access layer.
- Verify Render's chosen database tier supports PostGIS, connection limits, backups, and required extensions before provisioning production infrastructure.
- Build and start commands, Node version, environment variables, and database migration steps must be documented and reproducible. No secrets may be committed.
- Production secrets, Better Auth secret, canonical origin, database URL, and password-reset email credentials must be supplied through protected environment configuration.
- HTTPS is required in production; authentication cookies use appropriate `Secure`, `HttpOnly`, and `SameSite` settings.
- Production startup must fail clearly on missing critical configuration. The application must not run against a production database with an unapproved schema state.

## 3. Environments and database changes

- Development, automated test, and production data must be isolated. Tests must never use production credentials or a production database.
- CI spatial/integration tests must run against a real PostgreSQL/PostGIS instance, not SQLite or a mock pretending to support PostGIS.
- Schema changes are committed as Prisma migrations and applied using a documented, noninteractive production migration procedure.
- The GPX import is a separate, explicitly authorized CLI operation, not an automatic side effect of web-service startup. Its preflight, global transaction, retirement safeguards, and approval gates remain governed by Specification 1.
- Document how to back up the database before consequential migrations/imports and how to restore service following a failed deployment. Do not assume a migration can always be reversed automatically.
- Use a minimal seed/test dataset for automated tests; production import uses the approved eight-file inventory.

## 4. CI quality gates

GitHub Actions shall run on pull requests and the main branch:

1. Dependency installation from committed lockfiles.
2. Formatting verification (Prettier) and linting (ESLint).
3. TypeScript type checks for frontend, backend, and applicable CLI code.
4. Frontend and backend unit/component tests (Vitest and React Testing Library where applicable).
5. API integration tests (Supertest), including real PostGIS-backed tests.
6. Production frontend and backend build verification.
7. A limited Playwright browser smoke suite in a suitable test environment.

A failed required check blocks merging or release. Secrets must not appear in logs or artifacts. CI configuration should cache dependencies without caching secrets. Dependency/security scanning is recommended; any critical known vulnerability affecting a deployed code path must be assessed and resolved or explicitly accepted before release.

## 5. Minimum automated regression coverage

The release test suite must demonstrate the following behaviors, with exact expected responses defined by the approved feature specifications:

| Area | Minimum verification |
|---|---|
| GPX import | Source mapping, duplicate handling, idempotence, identity stability, false-retirement prevention, reactivation, global rollback, threshold approvals |
| Discovery | Map/list consistency, partial search, multi-category filters, explicit search-this-area, pagination/truncation, proximity, URL restoration |
| Authentication | Registration/login/logout, protected endpoints, account isolation, password-reset expiry/single use, all-session revocation, CSRF rejection |
| Favorites | Add/remove idempotence, owner-only access, pagination, retired-landmark placeholders |
| Reviews | Whole-star validation, rating-only submission, uniqueness, author-only edits/deletes, public aggregation, retirement/sensitivity guards |
| Trips | Owner-only CRUD, 25-stop limit, duplicate conflict, ordering/version conflict, share-token rotation/revocation, public stop redaction |
| PWA/offline | Installable build, explicit offline saves, storage caps, manual refresh, account marker cleanup, offline fallback, no offline mutations |
| Accessibility | Keyboard navigation, labeled controls, focus management, list equivalent to map, representative automated and manual checks against WCAG 2.2 AA target |

Security tests must verify that a user cannot access another user's favorites, reviews management, or private trips by changing identifiers. Public APIs must not reveal restricted landmark coordinates through alternate endpoints, error responses, caches, or shared-trip payloads.

## 6. Release smoke tests

On the deployed production-like build, manually verify at least:

1. Home page and deep links load over HTTPS; refresh on a nested SPA route works.
2. Static assets, manifest, service worker, `/health`, and API routes respond with correct content types and statuses.
3. Map, accessible list, category filters, name search, landmark details, and proximity work in the latest stable Chrome, Firefox, and Safari, with mobile browser testing where available. Record platform limitations when Safari or mobile devices are unavailable in CI.
4. A test user can register, sign in, reset a password through the configured email service, and sign out.
5. Favorites, ratings/reviews, and private trip creation/editing persist across sessions.
6. A shared trip is read-only; token revocation works; restricted stops are redacted.
7. The app installs where supported; previously saved structured data can be read offline; sign-out blocks app access to prior offline data.
8. Browser console, server logs, and network traces show no uncaught critical errors or leaked credentials/tokens.
9. Database migrations and the approved production GPX import have been verified against expected record counts.

Run the smoke suite after deployment, not only against a developer workstation.

## 7. Cross-cutting release blockers

The following must be resolved before enabling affected production features:

- **Sensitive-location policy:** establish how `sensitivity_status` (`UNREVIEWED`/`PUBLIC`/`SENSITIVE`) is assigned, who can change it, how public API responses and offline snapshots respond to newly restricted landmarks, and how existing data is handled. Until resolved, do not publish potentially sensitive coordinates through discovery, reviews, shared trips, or offline exports; treat `UNREVIEWED` the same as `SENSITIVE` for disclosure purposes.
- **Better Auth compatibility:** verify selected package/version supports the approved session renewal, password-reset, revocation, and Prisma model requirements. Adapt implementation only through documented approval if a mismatch is found.
- **Email delivery:** choose and configure a production-capable password-reset provider, with domain/origin verification and secure secret storage.
- **Tile licensing:** complete M00-T06 provider evaluation. FR-14 remains conditional. Do not implement persistent tile downloads against public OSM tile servers or another provider without explicit permission.
- **Infrastructure feasibility:** confirm Render/PostGIS support, resource limits, and a workable backup/restore approach for the chosen tier.

A blocked conditional feature may be deferred only by an explicit recorded scope decision; it must not be presented as delivered.

## 8. Operational readiness

- `/health` is a readiness endpoint that checks both the application and database connectivity. Return HTTP `200` only when the service can handle requests and a bounded database connectivity check succeeds; otherwise return HTTP `503`. Responses must not expose credentials, connection strings, SQL, or personal information. A lightweight process-only liveness check may be provided separately if required by hosting configuration; it must not be mistaken for readiness.
- Server logs capture actionable errors without logging passwords, reset tokens, full session cookies, or unnecessary precise user locations.
- Define basic incident handling: where to check Render logs, how to restart/redeploy, how to restore from backup, and how to roll back application code safely.
- Document known limitations and browser support, including offline storage eviction and differences in PWA installability.
- Record the deployed commit/version, migration state, source-data import summary, and release date.

## 9. Release acceptance and sign-off

Release may be approved only when:

- All six approved feature specifications have their required acceptance tests completed, except explicitly approved conditional deferrals.
- Required CI checks are green on the release commit.
- Production-like smoke tests pass and critical user journeys work on desktop and mobile.
- No unresolved critical security, privacy, data-loss, or authorization defect remains.
- Production configuration, migrations, backup/restore steps, and import outcomes are documented.
- Sensitive-location policy and password-reset email delivery are resolved for features exposed publicly.
- FR-14 has a documented **supported-and-tested** or **formally deferred** decision following M00-T06.
- The developer explicitly authorizes release after reviewing the evidence.

A release checklist shall record each criterion as **Pass**, **Fail**, **Deferred with approval**, or **Not applicable**, with evidence links and an approver. Failed mandatory criteria cannot be waived implicitly.

## 10. Approved operational defaults and remaining release decisions

### 10.1 Approved deployment trigger

Production deployment is **manual and requires passing CI checks** for the exact commit to be released. A successful push to `main` shall not by itself trigger a production deployment. If Render is connected to GitHub, disable automatic production deployment or configure equivalent manual gating. Record the deployed commit and the person approving deployment. Manual deployment does not bypass the post-deployment smoke tests or final release sign-off.

### 10.2 Approved readiness health check

The `/health` endpoint shall verify both application readiness and database connectivity, using a bounded timeout. It returns `200 OK` when ready and `503 Service Unavailable` otherwise. It must not disclose secrets, database internals, or personal information. The implementation may provide a separate process-only liveness endpoint if operationally necessary; readiness and liveness must have distinct documented semantics. Tests must verify both healthy and database-unavailable cases.

### 10.3 Approved browser baseline

The target browser baseline is the **latest stable Chrome, Firefox, and Safari**, including mobile testing where available. Automated Playwright coverage should exercise Chromium, Firefox, and WebKit where feasible; these are test engines and do not replace real Safari/mobile checks. At least one practical mobile-viewport smoke test is mandatory. Record the actual browser versions, devices/emulators, test results, and any environmental limitations. A browser-specific critical defect in a supported user journey blocks release unless the developer explicitly approves a documented scope change.

## 10.4 Release Dependencies and Final Operational Decisions

### 10.4.1 Render PostgreSQL, PostGIS, and Recovery

- Production shall use a paid Render PostgreSQL compute plan that supports the required PostgreSQL version, PostGIS extension, and Render's backup/recovery facilities. The exact compute plan, storage allocation, workspace plan, and recurring cost shall be verified and explicitly approved before provisioning; this specification does not select a paid tier or authorize spending.
- The deployment verification shall confirm `CREATE EXTENSION IF NOT EXISTS postgis;` can be applied using the approved migration/provisioning procedure, and shall verify the installed extension with `SELECT PostGIS_Version();`.
- Before launch, document recovery procedures in `DEPLOYMENT.md` (or `README.md`): Render point-in-time recovery, creation/download of a logical export, recovery to a separate database, validation, and application connection-string cutover. Never rehearse destructive restoration against the live production database.
- Confirm and record the actual recovery window and backup capabilities for the selected paid compute and workspace plans. A daily logical export is not assumed to be automatic; if daily exported backups are required, explicitly implement and test that schedule.
- A successful nonproduction restore rehearsal is a release gate.

### 10.4.2 FR-14 Offline Map Downloads

- FR-13 (installable PWA and explicitly saved structured landmark/owned-trip snapshots) is required for Phase 1 and may be implemented independently.
- FR-14 (bounded offline map downloads) remains **conditional on M00-T06**, the tile-provider feasibility study. It is not authorized for implementation until provider licensing, offline caching permissions, pricing/quotas, storage constraints, and a developer-approved feasibility decision are documented.
- If M00-T06 finds no feasible option, record an explicit Phase 1 deferral without blocking FR-13 or the remainder of the release.

### 10.4.3 Unified Sensitive-Location Disclosure Policy

- The authoritative database field `landmark.sensitivity_status` (`UNREVIEWED`/`PUBLIC`/`SENSITIVE`) shall default to `UNREVIEWED`, a conservative, explicitly documented classification process. The application shall not infer that an unreviewed (`UNREVIEWED`) location is safe to disclose solely because it exists in a GPX source.
- Landmarks whose `sensitivity_status` is `SENSITIVE` or `UNREVIEWED` may appear in public text-based discovery by display name and category only; `UNREVIEWED` and `SENSITIVE` remain distinct classification states for review-workflow purposes, but both require the same location and sensitive-metadata redaction until a landmark is explicitly classified `PUBLIC`. Public APIs shall omit or null precise coordinates, bounding-box/map geometry, county, exact descriptions, source/access metadata, and other fields that reveal precise location for either state. Such landmarks shall not produce public map markers, proximity results that reveal position, or downloadable coordinates.
- Public reviews endpoints for sensitive or inactive landmarks shall return the same generic `404` response as an unknown landmark, consistent with Specification 4.
- Publicly shared trips shall redact sensitive or inactive stops to an unavailable placeholder, retaining only non-identifying stop order and an opaque stop identifier; never expose the landmark ID if it enables an otherwise restricted lookup.
- Offline exports and IndexedDB snapshots shall not contain sensitive landmark coordinates or identifying location metadata. Previously cached snapshots cannot be remotely guaranteed erased: on the next online refresh, purge or redact newly restricted data, and document this limitation. Offline-only copies may remain stale until the device reconnects.
- The GPX importer shall preserve the existing `sensitivity_status` value (`UNREVIEWED`, `PUBLIC`, or `SENSITIVE`) on updates, retirements, and reactivations in all cases; source import shall never silently reset or alter this field.
- Enforce disclosure rules centrally in the service/data-serialization layer and test all public surfaces, including search, detail, reviews, public trip sharing, and offline export. Do not rely on frontend hiding alone.
- Before public launch, the developer shall approve a classification process, initial review of the source dataset, and tests demonstrating that sensitive coordinates are not disclosed.

---

**End of Specification**
