
# Tennessee Natural Landmarks Explorer
# Architecture Decision Log

## 1. Purpose

This document records significant architectural and technical decisions for Tennessee Natural Landmarks Explorer.

Each decision should explain the problem being addressed, the alternatives considered, the selected approach, and the reasoning behind the choice.

Decisions must be explicitly approved by the developer before they are considered authoritative.

## 2. Decision Principles

Architectural decisions should prioritize:

1. Simplicity and maintainability.
2. Alignment with approved project requirements.
3. Security and accessibility.
4. Testability and reliability.
5. Appropriate performance and scalability.
6. Compatibility with the existing GPX datasets.
7. Manageable complexity for an individual university project.
8. Clear justification of technical tradeoffs.

Avoid introducing technologies or architectural complexity without a demonstrated requirement.

## 3. Decision Status Definitions

| Status | Meaning |
|--------|---------|
| Proposed | A decision has been documented but not approved. |
| Accepted | The developer has explicitly approved the decision. |
| Superseded | A newer accepted decision replaces this decision. |
| Rejected | The proposed approach was evaluated and declined. |
| Deprecated | The decision remains recorded but is no longer recommended for new work. |

## 4. Decision Record Template

### ADR-XXX: Decision Title

**Status:** Proposed

**Date:** YYYY-MM-DD

**Related Requirements:** FR-XX

**Context:**
Describe the problem, requirements, and constraints motivating the decision.

**Options Considered:**
1. Option A
2. Option B
3. Option C

**Decision:**
Describe the proposed or approved approach.

**Rationale:**
Explain why this approach is preferred.

**Consequences:**
- Benefits
- Tradeoffs
- Risks
- Maintenance implications

**Related Documents:**
- Relevant project plans or specifications.

## 5. Decision Register

| ID | Decision | Status |
|----|----------|--------|
| ADR-001 | Frontend framework | Accepted |
| ADR-002 | Backend framework | Accepted |
| ADR-003 | Database and geospatial storage | Accepted |
| ADR-004 | Mapping library and map provider | Accepted |
| ADR-005 | GPX parsing and import strategy | Accepted |
| ADR-006 | Authentication and session management | Accepted |
| ADR-007 | Offline storage and map downloads | Accepted |
| ADR-008 | Hosting and deployment | Accepted |
| ADR-009 | Testing and continuous integration | Accepted |
| ADR-010 | Prisma migration workflow for the generated PostGIS `location` column | Accepted |
| ADR-011 | Identity schema conventions for Better Auth on Prisma | Accepted |
| ADR-012 | Authorization conventions for account-scoped API resources | Accepted |

All nine initially identified architectural decisions, plus ADR-010 (added during M01-T03 implementation), ADR-011 (M03-T01), and ADR-012 (M03-T04), are now Accepted.

## 6a. Decision Records

### ADR-001: Frontend Framework

**Status:** Accepted

**Date:** 2026-10-28

**Related Requirements:** FR-01 through FR-14; NFR 7.1 (Usability), 7.2 (Accessibility), 7.3 (Performance), 7.6 (Offline Availability), 7.7 (Maintainability and Testability), 7.8 (Compatibility)

**Context:**

The application requires an interactive map, search and filtering, user accounts, ratings/reviews, multi-stop trip planning, and offline access to selected landmark information and map regions. It is being developed by an individual student under a limited academic timeline, using an AI-assisted development workflow, and must remain maintainable, testable, and cheap to deploy.

Inspection of the eight GPX source files (`coordinates/*.gpx`, 1,693 waypoints total) confirmed a small, uniform dataset with no server-side rendering or SEO requirements — most content is personalized or behind authentication.

**Options Considered:**

1. **React + Vite (SPA)** — mature mapping integration (`react-leaflet`), broad PWA/offline tooling (`vite-plugin-pwa`), largest ecosystem and documentation base, best precedent coverage for AI-assisted code generation.
2. **Vue 3 + Vite (SPA)** — less opinionated, solid but smaller mapping (`vue-leaflet`) and offline-tooling community than React.
3. **Svelte/SvelteKit** — least boilerplate, but thinnest mapping (`svelte-leafletjs`) and offline-example ecosystem, and SvelteKit's default SSR adds deployment complexity not needed here.
4. **Full-stack SSR meta-framework (Next.js/Nuxt/SvelteKit SSR)** — rejected as a category: no SEO or server-rendering requirement exists, and running a Node server adds operational complexity disproportionate to project scope and timeline.

**Decision:**

Adopt **React with TypeScript and Vite** as the frontend framework, built as a static single-page application (not a server-rendered meta-framework).

**Rationale:**

- Mapping, search/filtering, trip planning, and offline support (Leaflet/MapLibre, service workers, IndexedDB) all have mature, well-documented React integrations.
- The dataset (~1,700 records) is small enough that client-side search/filtering and full offline caching of landmark data are straightforward regardless of framework; React's ecosystem simply has the deepest precedent for implementing these patterns correctly.
- React has the broadest training-data precedent among the options, reducing the risk of incorrect or outdated AI-generated code — directly supporting the project's AI-assisted development goal and verification requirements.
- A static SPA (via Vite) deploys to free static hosts (e.g., Netlify, Vercel, Cloudflare Pages, GitHub Pages) with minimal operational overhead, which fits the project's limited time and resource constraints better than an SSR framework requiring a running Node server.
- The React + Vite + Vitest + React Testing Library (+ Playwright for e2e) stack is well-documented and supports the project's testability and maintainability objectives (NFR 7.7).

**Consequences:**

- Benefits: mature mapping/offline/testing ecosystem; low-complexity static deployment; strong AI-assistance precedent; large pool of documentation and examples for a solo developer to rely on.
- Tradeoffs: React requires more explicit decisions than Vue/Svelte (state management, routing, project structure) that will need to be made in follow-up architectural work.
- Risks: none specific to this decision beyond ordinary framework-maintenance overhead; mapping library, backend, auth, and offline-storage choices remain separate, still-open decisions (ADR-002 through ADR-007) that will shape the concrete implementation.
- Maintenance implications: future contributors/graders will need basic React + Vite familiarity; no server-rendering runtime to operate or patch.

**Related Documents:**
- `docs/PROJECT_PLAN.md` — Sections 5 (Project Scope), 7 (Non-Functional Requirements), 8.3 (Technical Decisions Pending).
- `docs/IMPLEMENTATION_PLAN.md` — M00-T02 (Define System Architecture), Milestone 02 (Landmark Discovery).

**Amendment (2026-10-28):** The Rationale bullet above describing deployment "to free static hosts (e.g., Netlify, Vercel, Cloudflare Pages, GitHub Pages)" is superseded in practice by ADR-008, which adopts single-origin deployment on Render instead (the frontend build is served by the same Express process as the API, not a separate static host). The original text is preserved rather than rewritten, per this document's change-management rule in Section 6; readers should treat ADR-008 as authoritative on deployment topology.

### ADR-002: Backend Framework

**Status:** Accepted

**Date:** 2026-10-28

**Related Requirements:** FR-01 through FR-14 (API layer); NFR 7.3 (Performance), 7.4 (Security and Privacy), 7.5 (Reliability), 7.7 (Maintainability and Testability)

**Context:**

The application needs a REST-style API for landmark retrieval and geographic queries (FR-01–06), auth-gated CRUD for favorites, reviews, and trips (FR-07–12), and a repeatable GPX import process (M01-T04). It is being built solo under an academic timeline, with the course valuing demonstrated engineering practice (modularity, SOLID, security, testability), not only a working demo. ADR-001 selected React + TypeScript for the frontend.

**Options Considered:**

1. **Node.js + Express (TypeScript)** — minimal, unopinionated; layering (routes/services/data-access) is designed explicitly by the developer; shares TypeScript with the frontend.
2. **Node.js + NestJS (TypeScript)** — enforces structure via built-in dependency injection and modules; steeper learning curve and more boilerplate for an application of this size.
3. **Python + FastAPI** — strong typing/validation via Pydantic, mature GPX tooling (`gpxpy`) and geospatial support (GeoAlchemy2/Shapely), but introduces a second language/toolchain alongside the TypeScript frontend.
4. **Backend-as-a-Service (e.g., Supabase)** — fastest path to CRUD/auth, but most of the "architecture" becomes vendor configuration rather than developer-designed engineering, weakening the project's demonstrated engineering surface.

**Decision:**

Adopt **Node.js with Express and TypeScript**, structured with explicit route/service/data-access layering, to be paired with an ORM (e.g., Prisma) once the database decision (ADR-003) is made.

**Rationale:**

- Keeps the entire stack in one language (TypeScript) alongside the React frontend selected in ADR-001, avoiding the context-switching and dual-toolchain maintenance cost of a second language for a solo developer.
- Express carries the broadest documentation/precedent base of the options considered, reducing the risk of AI-generated code following outdated or inconsistent idioms — the same rationale applied in ADR-001.
- Being unopinionated requires the developer to deliberately design module boundaries, input validation, and error handling, which better serves the course's engineering-standards goal than a framework (NestJS) or BaaS that imposes or replaces that design work.
- FastAPI is a strong technical peer, particularly for GPX parsing and auto-generated API docs, but was not selected because it would require maintaining a second language and toolchain solo, for a benefit limited mostly to a one-time import script.
- A BaaS was not selected as the general backend approach because it would reduce the amount of backend engineering independently designed and demonstrable, though it remains worth reconsidering narrowly for authentication when ADR-006 is addressed.

**Consequences:**

- Benefits: single-language stack with the frontend; large ecosystem and precedent for AI-assisted development; explicit control over architecture supports the course's engineering-standards goal; deploys as a small Node service to low-cost hosts.
- Tradeoffs: unlike NestJS, no structure is enforced automatically — discipline is required to keep routes/services/data-access cleanly separated as the API grows.
- Risks: geospatial query ergonomics (FR-06) depend on the database choice (ADR-003) and will need a suitable query approach (e.g., PostGIS via raw SQL or ORM extensions) once that decision is made.
- Maintenance implications: testable with Jest/Vitest + Supertest; no additional language runtime beyond Node is introduced.

**Related Documents:**
- `docs/PROJECT_PLAN.md` — Sections 5 (Project Scope), 7 (Non-Functional Requirements), 8.3 (Technical Decisions Pending).
- `docs/IMPLEMENTATION_PLAN.md` — M00-T02 (Define System Architecture), Milestone 01 (Landmark Data Foundation).
- `docs/DECISIONS.md` — ADR-001 (Frontend Framework).

### ADR-003: Database and Geospatial Storage

**Status:** Accepted

**Date:** 2026-10-28

**Related Requirements:** FR-06 (Geographic Discovery), FR-07 through FR-12 (accounts, favorites, reviews, trips); NFR 7.3 (Performance), 7.5 (Reliability), 7.7 (Maintainability and Testability)

**Context:**

The application's data is relational by nature — users, landmarks, favorites, reviews, and trips/trip-stops all involve ownership and foreign-key relationships (FR-07–12). FR-06 additionally requires geographic bounding-box and proximity queries, and NFR 7.3 requires acceptable performance as the landmark dataset grows. Inspection of the GPX source files found a small current dataset (~1,700 waypoints across 8 categories), but the architecture should not assume it stays that size. ADR-002 selected Node.js + Express + TypeScript for the backend.

**Options Considered:**

1. **PostgreSQL + PostGIS** — relational database with a purpose-built geospatial extension providing indexed proximity/bounding-box queries (`ST_DWithin`, `ST_MakeEnvelope`, GiST indexes).
2. **SQLite + application-level distance calculation** — zero-ops, single-file database; geographic queries would be implemented as Haversine-distance calculations in SQL or application code with a bounding-box pre-filter, since no spatial extension is used.
3. **MongoDB + 2dsphere geospatial index** — document database with native geospatial query operators, but a weaker fit for this domain's relational data (ownership, foreign keys, ordered trip stops).

**Decision:**

Adopt **PostgreSQL with the PostGIS extension**, accessed through Prisma for the relational schema (users, landmarks, favorites, reviews, trips, trip_stops) and raw SQL (`$queryRaw`) for the PostGIS-specific geographic queries required by FR-06. The `users` table includes the fields required by Better Auth, managed through Prisma via Better Auth's supported Prisma adapter — see ADR-006's Schema and Migration Ownership clarification for the full statement of this division of responsibility.

**Rationale:**

- The core data model is relational; PostGIS adds geospatial querying as an extension of the same database rather than forcing a non-relational shape onto inherently relational entities.
- FR-06's proximity/bounding-box queries and the explicit testing requirement around geographic calculations and boundary conditions (M02-T07) are better served by PostGIS's indexed, purpose-built spatial functions than by hand-rolled distance math in application code.
- Free managed Postgres offerings with PostGIS available out of the box (e.g., Supabase, Neon, Railway) keep operational overhead low despite not being a single-file database, which fits the solo-developer, limited-time constraint.
- Prisma, already selected to pair with the Express/TypeScript backend, fully supports Postgres for the relational tables; the geospatial queries use the standard, documented `$queryRaw` escape hatch rather than a brittle workaround.
- SQLite with application-level Haversine distance was not selected because it would push genuine geospatial design into ad hoc code with no indexing, and would require rework if the dataset or query needs grow — a weaker fit for the project's software-engineering-standards goal and for demonstrating deliberate architecture.

**Consequences:**

- Benefits: correct, indexed geospatial queries; relational integrity for favorites/reviews/trips; low-cost managed hosting is readily available; aligns with the Express/TypeScript/Prisma stack from ADR-002.
- Tradeoffs: requires running or connecting to an actual Postgres instance even in local development, unlike SQLite's zero-setup file; PostGIS-specific queries bypass ORM type safety and need their own dedicated tests.
- Risks: none significant at the current dataset size; if a managed free-tier Postgres later proves inadequate, this remains a standard, portable stack to migrate off of.
- Maintenance implications: schema changes go through Prisma Migrate; raw-SQL geospatial queries should be isolated in a small, well-tested data-access module rather than scattered through the codebase.

**Related Documents:**
- `docs/PROJECT_PLAN.md` — Sections 5 (Project Scope), 7 (Non-Functional Requirements), 8.3 (Technical Decisions Pending).
- `docs/IMPLEMENTATION_PLAN.md` — M01 (Landmark Data Foundation), M02-T07 (Geographic Discovery).
- `docs/DECISIONS.md` — ADR-002 (Backend Framework).

### ADR-004: Mapping Library and Map Provider

**Status:** Accepted

**Date:** 2026-10-28

**Related Requirements:** FR-01 (Landmark Visualization), FR-06 (Geographic Discovery), FR-13 (Offline Landmark Information), FR-14 (Offline Maps); NFR 7.2 (Accessibility), 7.3 (Performance), 7.6 (Offline Availability)

**Context:**

The application needs an interactive map (FR-01), geographic bounding/proximity queries (FR-06), and offline access to selected map regions (FR-14), subject to mapping-provider licensing restrictions (an explicitly identified risk and open question in `docs/PROJECT_PLAN.md` §10.1/§10.2, Q8). The GPX dataset covers only Tennessee, but offline raster tile storage is driven by downloaded area and zoom level, not by the number of landmark records (1,693 total) — caching an entire state at hiking-relevant zoom levels could require substantial storage and is not assumed to be lightweight.

**Options Considered:**

1. **Leaflet + a raster tile provider whose terms explicitly permit client-side/offline caching** — mature library, largest ecosystem of offline-tile-caching plugins (e.g., `Leaflet.offline`) built around caching bounded regions on demand.
2. **MapLibre GL JS + vector tiles** — modern, open-source renderer with a more compact offline storage footprint than raster tiles, but thinner documented precedent for the specific "cache a region for offline use" workflow this project needs.
3. **Mapbox GL JS** — excluded: its terms of service restrict offline tile caching to Mapbox's own native SDK offline packs, not generally available for web apps.
4. **Google Maps JavaScript API** — excluded: its terms of service prohibit caching map tiles for offline use on the web; offline support is mobile-SDK-only.

**Decision:**

Adopt **Leaflet**, via `react-leaflet`, as the mapping library.

The specific raster tile provider is **not decided by this ADR**. The provider must satisfy a license/terms-of-service requirement — explicit permission to cache map tiles client-side for offline use, at the region sizes the application actually allows users to download — and will be selected during M06-T01 (Define Offline Requirements and Constraints / Evaluate mapping provider licensing), which exists specifically to verify current licensing terms before implementation. Candidate providers to evaluate there include MapTiler, Stadia Maps, Thunderforest, and self-hosting a Tennessee-only tile set; none of these is pre-approved by this decision.

Offline map downloads are expected to target **user-selected, bounded regions** (e.g., an area the user draws or selects around a saved trip or landmark), not bulk pre-caching of the entire state — consistent with FR-13's wording ("information that users have explicitly saved for offline use") and with the realistic storage constraints of mobile browsers.

**Rationale:**

- Google Maps and Mapbox GL JS are excluded on contractual grounds (ToS), independent of region size or implementation effort — this directly resolves PROJECT_PLAN's open question on provider restrictions for the two most commonly reached-for options.
- Leaflet's offline-tile-caching plugin ecosystem was built around exactly the "cache a bounded, user-selected region on demand" pattern this project needs, giving it more mature, documented precedent than MapLibre GL for this specific workflow, despite MapLibre's more compact vector-tile storage footprint.
- `react-leaflet`'s maturity is consistent with the ecosystem-depth rationale already applied in ADR-001 (React) and ADR-002 (Express).
- Deferring the specific tile provider to M06-T01 avoids committing to a vendor's terms that have not been verified, and keeps this decision honest about what is and is not yet established.
- Scoping offline downloads to user-selected regions, rather than the whole state, keeps offline storage requirements bounded regardless of which zoom levels are ultimately supported, and avoids an infeasible promise given mobile browser storage limits (including known aggressive storage eviction on iOS Safari, noted during the ADR-001 discussion).

**Consequences:**

- Benefits: ToS-compliant path to FR-14; mature offline-caching plugin precedent; realistic, bounded offline storage expectations; consistent with the React-centric stack already chosen.
- Tradeoffs: raster tiles are less storage-efficient per area than vector tiles, reinforcing the need to keep downloadable regions user-bounded rather than state-wide; the final tile provider and its exact free-tier limits remain unresolved until M06-T01.
- Risks: if no suitable provider is found with acceptable licensing and free-tier limits during M06-T01, the offline-maps scope (FR-14) may need developer-approved adjustment, as already anticipated in `docs/IMPLEMENTATION_PLAN.md` (Milestone 06 note on infeasibility requiring scope adjustment).
- Maintenance implications: whichever provider is selected will require an API key managed as an environment variable, not committed to the repository.

**Related Documents:**
- `docs/PROJECT_PLAN.md` — Sections 5.1 (Offline Access), 7.6 (Offline Availability), 10.1–10.2 (Risks and Open Questions, Q8).
- `docs/IMPLEMENTATION_PLAN.md` — Milestone 06 (Offline Access), M06-T01 (Define Offline Requirements and Constraints).
- `docs/DECISIONS.md` — ADR-001 (Frontend Framework), ADR-003 (Database and Geospatial Storage).

**Implementation note (2026-11-02, M02-T02):** the base map was implemented using the standard OpenStreetMap tile service (`{s}.tile.openstreetmap.org`), explicitly for local development and demonstration only, per this ADR's own deferral of the tile-provider decision. **This is not an approval of OpenStreetMap, or any provider, for public production deployment** — the production/offline-capable provider decision remains open and unresolved, to be made at M00-T06/M06-T01 as this ADR already states. No offline caching, prefetching, or bulk tile downloads were implemented or implied by this note.

### ADR-005: GPX Parsing and Import Strategy

**Status:** Accepted

**Date:** 2026-10-28

**Related Requirements:** FR-02 (Landmark Classification), FR-05 (Landmark Profiles); M01-T01 through M01-T04 in `docs/IMPLEMENTATION_PLAN.md`; NFR 7.5 (Reliability), 7.7 (Maintainability and Testability)

**Context:**

`coordinates/*.gpx` contains 8 files sharing one consistent schema (`<wpt lat lon><name><cmt><desc><link>?<sym></wpt>`, no tracks/routes/elevation/time/extensions), 1,693 total waypoint records. Inspection found: `<name>` codes are globally unique across all 8 files except one exact in-file duplicate (`MIF026`, "Denny Cove Falls," duplicated within `tnfalls.gpx` — confirmed by checking total vs. unique `<name>` counts and the file list containing the duplicate); `<link>` is optional and its `href` is frequently empty, with `<text>` often used as a land-manager/access label (e.g., "private", "GSMNP") rather than a real URL; category is determined by source filename, not by any field inside the record. Once users can favorite, review, or add landmarks to trips (FR-08–12), those relationships must survive re-imports of the source data. The backend is Node.js/TypeScript (ADR-002); the database is PostgreSQL (ADR-003).

**Options Considered:**

1. **Generic XML parser (`fast-xml-parser`) + explicit TypeScript mapping + schema validation (Zod)** — full control over mapping this dataset's simple, consistent field set, with validation and data-quality handling in reviewable, testable application code.
2. **GPX-specific parsing library** (e.g., `@tmcw/togeojson`, `gpxparser`) — convenient for typical track/route GPX use cases, but built around a richer object model this dataset doesn't use; would still need a custom wrapper on top.
3. **One-time manual conversion** to a static JSON/CSV artifact — rejected as not repeatable or re-runnable, conflicting with the explicit "repeatable GPX import process" requirement (M01-T04).

**Decision:**

Adopt a **standalone, repeatable Node/TypeScript import script** (not a live API endpoint) using **`fast-xml-parser` plus explicit TypeScript mapping and Zod validation**, run on demand against `coordinates/*.gpx`, writing only to the database. The script never modifies the source GPX files.

**Identifier and upsert strategy:**
- The landmarks table has its own internal, database-generated primary key, independent of any source data.
- The GPX `<name>` code is stored as a unique `source_code` column (a single-column uniqueness constraint, justified by the confirmed global uniqueness above); `source_file` is also stored for traceability but is not part of the uniqueness constraint.
- Favorites, reviews, and trip stops reference the internal primary key, never `source_code` directly.
- Import matches incoming records by `source_code`: an existing match is **updated in place**; a new code is **inserted**; records are never deleted and recreated. This guarantees a landmark's internal ID — and anything referencing it — survives re-imports.
- A landmark whose `source_code` is no longer present in a re-imported file is marked inactive/retired rather than hard-deleted, to avoid orphaning or cascading into user-generated relationships. The exact mechanism (a status flag or equivalent) is a detail for the M01-T02 data model, not fixed here.

**Failure handling (three tiers):**
1. **Invalid source records** (missing required field, out-of-range coordinate, malformed structure): skipped and reported, per a validation policy whose specific field-level rules are defined and approved as part of M01-T02 — not invented by this ADR.
2. **Database/transaction failures** (constraint violations unrelated to data validity, connection errors): the affected transaction is rolled back and the failure reported; no partially-applied import is left committed.
3. **Unexpected large-scale dataset change** (an import run would retire or alter a large share of existing records, or a category's record count deviates sharply from its source file): the import halts before applying changes and requires explicit developer approval. The specific threshold defining "substantial unexpected change" is a policy detail to be defined during implementation, not fixed by this ADR.

**Rationale:**

- A generic XML parser requires more explicit mapping code up front than a GPX-specific library, but that mapping code is exactly where this dataset's real complexities live (optional/empty links, embedded dimension text, category cross-checks, dedup by source code) — explicit, typed, tested code handles this more maintainably than conforming to an abstraction built for track/route GPX files this dataset doesn't contain.
- A surrogate internal primary key, with the GPX code treated strictly as an external identifier, decouples the application's referential integrity from the source dataset's own identifier scheme, protecting user-generated relationships (favorites/reviews/trips) across re-imports — directly addressing the risk that a naive delete-and-recreate import would silently break those relationships.
- Separating invalid-record handling, transaction failure, and large-scale unexpected change into three distinct responses prevents the specific failure mode of a malformed or incomplete GPX file silently overwriting a healthy dataset — "a few bad rows," "the database had a problem," and "something looks badly wrong" require different, deliberate responses rather than one uniform skip-and-continue behavior.
- Keeping import as an offline/CLI script rather than an HTTP endpoint matches the fact that landmark creation is explicitly out of scope as a user-facing feature (PROJECT_PLAN excludes "user-submitted creation of new landmark records"), keeping the attack surface smaller.

**Consequences:**

- Benefits: fully testable mapping/validation logic with fixture-based unit tests; safe, idempotent re-runs; user-generated relationships are structurally protected from import side effects; the one known duplicate record and the empty-href link pattern are explicitly handled rather than silently mishandled.
- Tradeoffs: more code to write than adopting a ready-made GPX library's object model; the inactive/retired-landmark mechanism adds a small amount of schema complexity beyond a simple hard delete.
- Risks: the specific validation field rules and the "substantial unexpected change" threshold remain undefined until M01-T02/M01-T04 implementation — this ADR establishes the required structure, not the exact parameters.
- Maintenance implications: if the source GPX files are ever regenerated with a different structure, the explicit mapping code makes any required changes visible and localized rather than hidden inside a third-party library's assumptions.

**Related Documents:**
- `docs/IMPLEMENTATION_PLAN.md` — M01-T01 (Analyze Landmark Dataset), M01-T02 (Design Landmark Data Model), M01-T04 (Implement GPX Data Import).
- `docs/PROJECT_PLAN.md` — Section 10.1 (Risks: Incomplete landmark data, Inaccurate coordinates).
- `docs/DECISIONS.md` — ADR-002 (Backend Framework), ADR-003 (Database and Geospatial Storage).

### ADR-006: Authentication and Session Management

**Status:** Accepted

**Date:** 2026-10-28

**Related Requirements:** FR-07 (User Authentication), FR-08 through FR-12 (auth-gated Favorites, Ratings and Reviews, Trip Creation and Management); NFR 7.4 (Security and Privacy)

**Context:**

The application requires secure registration/authentication (FR-07) and auth-gated, ownership-restricted access to favorites, reviews, and trips (FR-08–12). The frontend is a React SPA (ADR-001) calling an Express API (ADR-002) backed by PostgreSQL (ADR-003). The authorization model is simple ownership (a user may access only their own favorites, reviews, and trips) — no admin/moderator role is currently in scope; review moderation rules remain an open question in `docs/PROJECT_PLAN.md` §10.2 (Q5). NFR 7.4 requires protecting accounts and personal data, enforcing authentication and authorization, and minimizing unnecessary data collection.

**Options Considered:**

1. **Server-side sessions built directly on `express-session` + bcrypt** — standard, well-documented primitives, but requires the developer to correctly assemble the full session lifecycle, cookie handling, and password-hashing integration from scratch.
2. **Stateless JWT (access + refresh tokens)** — rejected: this application runs as a single backend instance with no horizontal-scaling need that would justify statelessness, and JWT revocation requires a server-side denylist, reintroducing state while keeping added complexity (refresh-token rotation) that increases the risk of a subtle security bug in a solo-built implementation.
3. **Managed third-party auth provider / BaaS (e.g., Supabase Auth, Auth0, Clerk)** — lowest implementation risk, but introduces a vendor dependency and moves security-critical logic into vendor configuration rather than reviewable application code, reducing the backend engineering demonstrated by the project.
4. **Better Auth** (a self-hosted TypeScript authentication framework running inside the application's own Express/Node process against its own PostgreSQL database) — handles password hashing, session token generation, and session-cookie lifecycle using audited library code, while the Express integration, protected-route middleware, and application-specific, per-resource authorization are still implemented and tested by the project itself.

**Decision:**

Adopt **Better Auth**, configured for **database-backed sessions** against the PostgreSQL database (ADR-003), integrated into the Express backend (ADR-002). Password hashing, session token generation, and session-cookie handling are delegated to Better Auth. The Express route wiring, protected-endpoint middleware, and all application-specific authorization logic are implemented and tested as part of this project's own backend code — adopting this framework does not remove backend engineering from the project's scope.

**Schema and Migration Ownership (clarified 2026-10-28):**

Prisma is the single schema and migration authority for PostgreSQL, including the tables Better Auth requires (user, session, account, verification, or equivalent). Better Auth is configured with its supported Prisma adapter rather than its own independent migration mechanism. No separate, redundant user table is introduced outside of this Prisma-managed schema. Any application-specific user profile fields are added to the same Prisma-managed `users` table (or a Prisma-managed table linked to it by foreign key), not to a parallel identity store.

**Authorization model:**

Authentication middleware establishes only the requesting user's identity (e.g., populating `req.user` from the session). It does not itself authorize access to any specific resource. A separate, service-layer check is required on every request that reads or modifies a specific resource (a favorite, review, or trip), verifying that the resource belongs to the authenticated user (e.g., confirming trip `123` belongs to `req.user.id`) before the operation proceeds. Being logged in is necessary but not sufficient.

**CSRF and CORS:**

- CSRF defense is not assumed to be covered by cookie attributes (e.g., `SameSite`) alone, since same-site and same-origin are distinct concepts and some deployment configurations would weaken or remove that protection. An explicit CSRF strategy — origin/referer validation and/or CSRF tokens, as appropriate to the final deployment topology — must be documented as part of M03-T02, before implementation.
- CORS configuration (explicit origin allow-listing, credentialed requests) is required only if the frontend and backend are ultimately deployed as separate origins. Whether that is the case is a deployment-topology decision belonging to ADR-008 (Hosting and Deployment), not something this ADR presupposes; if frontend and backend are served under a single origin, CORS configuration is not needed at all.

**Rationale:**

- JWT's principal advantage — statelessness across many backend instances — doesn't apply to this project's single-instance deployment, so its added complexity (refresh-token rotation, token storage) is not a good trade against the risk of a subtle bug in a solo-built implementation.
- A fully managed auth provider reduces implementation risk further than any self-hosted option, but does so by moving security-critical logic into vendor configuration rather than code the project designs and can demonstrate — a weaker fit for the project's explicit engineering-standards and AI-assisted-development-with-verification goals (Goals #7–8).
- Better Auth occupies a middle position that better fits this project than either alternative: it is self-hosted against the project's own database (no vendor dependency on the data itself, unlike option 3), and it delegates only the narrow, historically error-prone primitives (password hashing, session token generation) to audited library code, while leaving the Express integration and all per-resource authorization — the parts most relevant to demonstrating backend engineering for this course — as work the project still performs and tests directly.
- Treating authentication and authorization as distinct steps (identity vs. per-resource access) is required to prevent a real, common vulnerability class: an endpoint that checks only "is this user logged in" rather than "does this user own the specific resource being requested."
- Deferring the CORS requirement to ADR-008 avoids assuming a particular deployment topology (split origins vs. single origin) before that decision is made, and avoids overstating `SameSite` cookie attributes as a complete CSRF defense.

**Consequences:**

- Benefits: audited library code for the highest-risk primitives (hashing, session tokens); immediate session revocation (database-backed sessions can be deleted on logout); no vendor dependency on user data; authorization logic remains visible, testable application code.
- Tradeoffs: still requires careful implementation of route protection and per-resource authorization checks, and of an explicit CSRF strategy; exact Better Auth integration mechanics and ORM-adapter compatibility with the Prisma/PostgreSQL stack must be confirmed against current documentation at implementation time, not assumed here.
- Risks: as with any authentication implementation, correctness depends on careful testing (M03-T02/T04) and review (M07-T02); this ADR reduces but does not eliminate that risk.
- Maintenance implications: session secret and database credentials are managed as environment variables, never committed, consistent with NFR 7.4 and CLAUDE.md.

**Related Documents:**
- `docs/IMPLEMENTATION_PLAN.md` — M03-T01 (Design User Data Model), M03-T02 (Implement Authentication Backend), M03-T04 (Implement Authorization), M07-T02 (Perform Security Review).
- `docs/PROJECT_PLAN.md` — Section 7.4 (Security and Privacy), Section 10.2 (Q5 — rating/review moderation, still open).
- `docs/DECISIONS.md` — ADR-002 (Backend Framework), ADR-003 (Database and Geospatial Storage); depends on ADR-008 (Hosting and Deployment) for the CORS requirement.

### ADR-007: Offline Storage and Map Downloads

**Status:** Accepted

**Date:** 2026-10-28

**Related Requirements:** FR-13 (Offline Landmark Information), FR-14 (Offline Maps); NFR 7.4 (Security and Privacy), 7.5 (Reliability), 7.6 (Offline Availability)

**Context:**

FR-13 requires offline access to landmark information users have *explicitly* saved; FR-14 aims to support offline access to selected map regions, subject to feasibility and provider restrictions (ADR-004). NFR 7.6 requires distinguishing offline-capable features, handling unavailable/outdated/incomplete offline data, and persisting previously downloaded information without connectivity; NFR 7.5 requires graceful handling of network interruptions. A known platform constraint (raised during the ADR-001 discussion) is that iOS Safari aggressively evicts PWA storage unless the app is added to the home screen, and even then persistence is not guaranteed. The application also has user accounts (ADR-006) and may run on a shared device, which raises a privacy requirement not covered by the functional requirements directly: one account's offline data must never be exposed to a different account using the same browser.

**Options Considered:**

1. **Service Worker (Cache API) for everything** — caches HTTP responses (API calls, tile images). Rejected as the sole mechanism: Cache API is a URL→Response store poorly suited to structured querying (e.g., "list what this user explicitly saved," "is this stale") and to the privacy/account-scoping requirement below; it also naturally caches whatever was viewed rather than what was explicitly saved, which does not match FR-13's wording.
2. **IndexedDB (via the `idb` wrapper) as the primary structured offline store, map tile downloading treated as a required capability (not a named library), and a Service Worker scoped only to app-shell precaching** — separates concerns: structured, account-aware, queryable data in IndexedDB; map tiles handled by whichever implementation satisfies a defined capability contract; the service worker limited to making the app itself load offline.
3. **No real offline persistence** — rejected: contradicts FR-13/FR-14, which are explicit, in-scope functional requirements.

**Decision:**

Adopt **IndexedDB (via `idb`) as the primary offline data store**, structured into two classes of data, with map tile offline support defined as a **capability contract** whose specific implementing library is selected later, and a **Service Worker** (via `vite-plugin-pwa`/Workbox) scoped only to app-shell precaching.

**Offline data privacy model (two-tier storage):**

- **Public landmark reference data** (name, category, coordinates, description, source/access label) is not personal data and may persist in IndexedDB across accounts on a shared device, since it is visible to any user of the application regardless of login state.
- **Account-specific data** (explicitly saved trips, which landmarks a given user chose to save offline, download metadata tied to a user's saved trip) is scoped to the authenticated account and is **cleared from IndexedDB on logout**. The accepted tradeoff is that a user must re-download offline trip data after signing back in; this is preferred over risking exposure of one account's saved data to a different account on a shared device.
- The application must never display one account's account-specific offline data to a different account, enforced by both the logout-clear behavior and by always filtering reads against the currently authenticated user's identifier as a second safeguard.
- Session tokens and passwords are never stored in IndexedDB. This is a structural guarantee, not merely a coding convention: because ADR-006 places session identity in an httpOnly cookie managed by Better Auth, that token is inaccessible to JavaScript and therefore cannot be written to IndexedDB by any code path in the application.
- Logout-based cleanup is a best-effort mitigation, not a guarantee: a browser crash, forced close, or direct inspection of IndexedDB outside the application could leave account-specific data behind. This is documented as a known limitation of the initial implementation. A stronger guarantee (e.g., client-side encryption keyed to the login) is not adopted now, as it is materially more complexity than this project's scope and threat model (an individual-use application, not a shared kiosk system) currently justify; it is noted as a possible future enhancement if that assumption changes.

**Map tile offline support (capability contract, not a named dependency):**

Any implementation chosen for map tile offline downloads (at M06-T02/M06-T04 implementation time) must support:
- Downloading tiles for a specified geographic bounding box and zoom range (consistent with ADR-004's user-selected, bounded-region approach).
- Per-tile (not merely per-region) download status tracking, so that an interrupted download can be reconciled: on next launch, any region not marked complete is checked against its expected tile list, and only the missing tiles are retried, rather than either falsely presenting a partial region as complete or restarting the entire download.
- Reliable progress and failure reporting exposed to the UI.
- A way to identify, from storage, which regions are complete versus incomplete.

A specific library (e.g., `Leaflet.offline`) is a **candidate**, not an approved dependency, pending verification at implementation time of: compatibility with the Leaflet/`react-leaflet` versions in use, support for bounding-box/zoom-range downloads, quality of its progress/failure reporting, how it handles partial downloads, whether its storage model allows identifying completed regions, and its current maintenance status. If no existing library meets this contract, a small custom tile-fetch-into-IndexedDB implementation is an acceptable fallback.

True atomicity (all tiles for a region succeeding or none being stored) is not assumed to be achievable across a multi-network-fetch operation that can be interrupted at any point; the per-tile status tracking above is the chosen alternative to an unattainable all-or-nothing guarantee.

**Other design points:**

- Every offline-saved record (landmark data and map region) stores a last-synced timestamp, surfaced in the UI (e.g., "saved 3 days ago") with a manual refresh action, per NFR 7.6.
- Connectivity detection treats `navigator.onLine` only as a hint; the authoritative "offline" signal is a failed API request, since `navigator.onLine` reflects having a network interface, not that the API is actually reachable.
- Favoriting, submitting reviews, and editing trips require connectivity; while offline, these actions are disabled with an explicit message rather than silently failing or being queued. Background write-queueing/sync is deliberately deferred as a future enhancement, consistent with `docs/PROJECT_PLAN.md` §5.3 already listing advanced offline capabilities as not an approved requirement.
- The application is built as an installable PWA (manifest + service worker); the iOS Safari storage-eviction limitation is documented as an acknowledged constraint per Milestone 06's existing provision that infeasibility requires a documented, approved scope adjustment.
- The service worker script and web app manifest must be served from paths that give the service worker app-wide scope and are explicitly excluded from the SPA fallback — see ADR-008's routing contract, amended 2026-10-28, for the specific paths.

**Rationale:**

- Structured, account-aware, queryable data belongs in IndexedDB rather than the Cache API, which cannot represent "what did this specific user explicitly choose to save" or support the account-scoping required for the shared-device privacy scenario.
- Deciding a capability contract for map tile downloads, rather than naming a specific library, avoids repeating the mistake (caught during ADR-004's review) of treating an unverified third-party dependency as already approved.
- Per-tile status tracking is a more honest and implementable design than claiming atomic region completion, which cannot actually be guaranteed given that the browser can terminate the operation mid-download at any point.
- Clearing account-specific data on logout is the simplest policy that actually prevents cross-account exposure on a shared device, rather than relying on UI-level filtering alone, which does not protect against direct inspection of underlying storage.

**Consequences:**

- Benefits: privacy-safe behavior on shared devices by design; realistic, verifiable completeness tracking for interrupted downloads; no dependency is treated as approved before its capabilities are verified; clear, bounded offline scope (no write queueing) appropriate to the project's timeline.
- Tradeoffs: users must re-download offline trip data after each login; the final map-tile library is not yet selected and its verification is deferred to implementation time; no offline write support.
- Risks: logout-based cleanup cannot fully guarantee data removal in crash/forced-close scenarios — documented as a known limitation, not solved by this decision; iOS Safari's storage eviction remains an inherent platform limitation.
- Maintenance implications: storage quota awareness (e.g., `navigator.storage.estimate()`) should inform the enforced per-download region size limit, with the exact limit set as policy during M06-T01.

**Related Documents:**
- `docs/IMPLEMENTATION_PLAN.md` — Milestone 06 (Offline Access): M06-T01 (Define Offline Requirements and Constraints), M06-T02 (Establish Offline Application Support), M06-T03 (Implement Offline Landmark Data), M06-T04 (Implement Offline Map Regions), M06-T05 (Verify Offline Behavior).
- `docs/PROJECT_PLAN.md` — Section 5.1 (Offline Access), 5.3 (Future Enhancements), 7.6 (Offline Availability).
- `docs/DECISIONS.md` — ADR-004 (Mapping Library and Map Provider), ADR-006 (Authentication and Session Management).

### ADR-008: Hosting and Deployment

**Status:** Accepted

**Date:** 2026-10-28

**Related Requirements:** NFR 7.4 (Security and Privacy — protected configuration, no committed secrets); Section 8.2 (Constraints — individual project, limited time/resources); resolves the conditional CORS requirement deferred by ADR-006

**Context:**

ADR-001 through ADR-007 together establish a statically-buildable React SPA, a Node/Express backend, a PostgreSQL database with the PostGIS extension, session cookies managed by Better Auth, and a Service Worker for offline/PWA support (ADR-007). Service Workers require a secure context (HTTPS, or localhost for development), making HTTPS a functional requirement, not only a security best practice. ADR-006 left the CORS requirement conditional on whether the frontend and backend end up deployed as separate origins — a decision explicitly deferred to this ADR. Section 8.2 constrains this to a solo developer with limited time, and the Decision Principles in this document explicitly favor "manageable complexity for an individual university project."

**Options Considered:**

1. **Single-origin deployment** — one persistent Node process serves both the Express API and the built React static assets from the same origin.
2. **Split-origin deployment** — a static host (e.g., Netlify, Vercel, Cloudflare Pages) serves the built frontend, with the API deployed separately (e.g., Render, Railway, Fly.io).
3. **Serverless functions for the API** (e.g., Vercel/Netlify functions) — rejected primarily because short-lived serverless invocations typically require additional database-connection-pooling infrastructure against PostgreSQL and introduce cold-start latency, adding deployment complexity without a corresponding benefit at this project's scale. (Database-backed sessions, per ADR-006, are not themselves a blocker to serverless, since session state lives in PostgreSQL rather than in-process memory — the connection-pooling and cold-start costs are the actual reasons this option is set aside here.)
4. **Self-managed VPS** — rejected: requires manual OS patching, process supervision, and TLS configuration, none of which benefits this project at its current scale, and all of which consumes time better spent on the application itself given the solo-developer timeline constraint.

**Decision:**

Adopt **single-origin deployment**: the Express backend serves both the API and the built React static assets from one Node process/domain, deployed to **Render**, using Render's managed PostgreSQL with the PostGIS extension enabled for the database (ADR-003).

**Routing contract:**

| Path | Responsibility |
|---|---|
| `/api/*` | Express application API |
| `/api/auth/*` | Better Auth endpoints (per ADR-006, subject to verified integration specifics) |
| `/assets/*` | Built frontend static assets |
| `/sw.js` (or the build tool's generated service worker filename) | Service worker script, served from the site root so its scope covers the whole application |
| `/manifest.webmanifest` (or equivalent PWA manifest filename) | Web app manifest, served from the site root |
| `/health` | Application health endpoint |
| `/` and other frontend routes | React application (SPA fallback) |

The SPA fallback (serving `index.html` for client-side-routed paths) is registered last and is scoped to exclude `/api/*`, `/assets/*`, `/health`, the service worker script, and the web app manifest, so that an unmatched or broken API request returns a real error response rather than being silently swallowed into a successful HTML page, and so the service worker is never nested under `/assets/*` or any other path that would narrow its scope below the whole application (amended 2026-10-28, per ADR-007).

**Rationale:**

- Single-origin deployment directly resolves ADR-006's deferred CORS question: with frontend and backend genuinely same-origin, no CORS configuration is needed, and ADR-006's CSRF defenses (origin/referer validation and/or tokens) remain simpler to reason about with no legitimate cross-origin request pattern to distinguish from an attack.
- It also satisfies the Service Worker's secure-context requirement by relying on the hosting platform's default TLS, rather than needing to independently guarantee HTTPS across two separately deployed halves.
- Render is selected now, rather than deferred to later implementation, because hosting affects database configuration, deployment commands, environment variables, and operational testing from early in implementation (M00-T04), not only at final release preparation (M07-T05) — naming the platform now lets those decisions be made consistently from the start.
- Render fits this project's explicit "manageable complexity for an individual project" principle: straightforward Git-based deploys and a single platform for both the persistent web service and the managed database reduce the number of vendors and deployment mechanisms a solo developer must learn and operate.
- The exact current free-tier limits and cold-start behavior on Render should be confirmed when the account is actually set up (M00-T04) — this is a setup-time verification detail, not a reopening of the platform decision itself. If Render's managed Postgres does not support PostGIS in practice when verified, Supabase remains an available fallback used purely as a hosted Postgres+PostGIS instance alongside Render's web service.

**Consequences:**

- Benefits: CORS eliminated rather than managed; HTTPS and the Service Worker's secure-context requirement satisfied by default; a single platform to configure and operate; the platform decision is made early enough to inform setup rather than being revisited at release time.
- Tradeoffs: static assets are served from the same process/region as the API rather than a dedicated CDN edge network — acceptable given this project's scale and Tennessee-focused audience.
- Risks: Render's specific free-tier limits (build minutes, database storage, possible cold-start/sleep behavior) must be confirmed during M00-T04 setup; if PostGIS support does not hold up as expected, a fallback database provider will be needed alongside the chosen web-service platform.
- Maintenance implications: all secrets (database connection string, Better Auth session secret, the tile-provider API key once ADR-004/M06-T01 resolves it) are managed via Render's environment-variable mechanism, never committed to the repository.

**Related Documents:**
- `docs/IMPLEMENTATION_PLAN.md` — M00-T04 (Initialize Application Repository), M07-T05 (Prepare Deployment).
- `docs/DECISIONS.md` — ADR-001 (Frontend Framework), ADR-002 (Backend Framework), ADR-003 (Database and Geospatial Storage), ADR-006 (Authentication and Session Management), ADR-007 (Offline Storage and Map Downloads).

### ADR-009: Testing and Continuous Integration

**Status:** Accepted

**Date:** 2026-10-28

**Related Requirements:** NFR 7.7 (Maintainability and Testability); M00-T05 (Establish Automated Quality Checks); test-related acceptance criteria throughout Milestones 01–07, including M03-T04 (test unauthorized access attempts), M04-T04 (test malicious and invalid inputs), M06-T05 (verify offline behavior), M07-T01 (integration and regression testing), M07-T02 (security review)

**Context:**

This is the last decision on the original register (ADR-001–009); its acceptance completes the initial set of architectural decisions identified for M00-T02. The stack established by prior decisions is: React + Vite (ADR-001), Node.js + Express + TypeScript (ADR-002), PostgreSQL + PostGIS (ADR-003), Better Auth with database-backed sessions (ADR-006), IndexedDB-based offline storage (ADR-007), and single-origin deployment on Render (ADR-008). NFR 7.7 requires automated testing of "critical application functionality," not a specific coverage target.

**Options Considered:**

1. **Jest for both frontend and backend** — well-established, but requires separate configuration/transform setup alongside Vite rather than sharing it.
2. **Vitest for both frontend and backend** — shares Vite's (ADR-001) configuration and transform pipeline directly, avoiding a second, separately configured test-tooling setup for one codebase.
3. **A mixed toolchain** (e.g., Jest for the backend, a different runner for the frontend) — rejected: fragments tooling across two runners for no benefit specific to this project.

**Decision:**

Adopt **Vitest** as the single test runner for both frontend and backend, paired with **Supertest** for API/integration tests, **React Testing Library** for frontend component tests, and **Playwright** for end-to-end tests. **ESLint** and **Prettier** handle linting/formatting; `tsc --noEmit` handles type checking, across both frontend and backend.

**Testing layers:**

| Layer | Tool | Scope |
|---|---|---|
| Unit tests | Vitest | GPX import mapping/validation (ADR-005), authorization logic, service-layer business logic |
| API/integration tests | Vitest + Supertest | Express routes exercised against a real PostgreSQL+PostGIS instance (not mocked) |
| Frontend component tests | Vitest + React Testing Library | Search/filter logic, form validation, auth-gated UI states |
| End-to-end tests | Playwright | Golden-path workflows: map loads and renders markers, search/filter, login, favorite a landmark, build and save a trip |

Integration tests run against a **real** Postgres+PostGIS instance rather than a mocked database layer, because PostGIS's geospatial functions (`ST_DWithin`, `ST_MakeEnvelope`, per ADR-003) are not reliably fakeable — a mock that computes geographic distance incorrectly would let a real bug pass.

**Required authentication/authorization integration tests:**

Because ADR-006 relies on Better Auth with database-backed sessions, authentication and authorization behavior is verified with real HTTP requests, real session cookies, and the test database — not only mocked as an "authenticated user" in unit tests. The following scenarios are required:
- Login establishes a usable session.
- Unauthenticated requests to protected endpoints are rejected.
- User A cannot read, modify, or delete User B's trips, favorites, or reviews.
- Logout invalidates the session.
- Invalid or expired sessions are rejected.
- CSRF protections reject inappropriate requests.

**Database isolation for automated tests:**

- A dedicated database for automated tests, with its own test-specific credentials and environment configuration.
- No dependency on the live Render database (ADR-008) during automated tests.
- Schema migrations are applied before integration tests run.
- Deterministic fixtures, with cleanup between tests.
- A safeguard that refuses to execute destructive test operations against anything resembling a production connection string/environment.
- **Resetting test data is distinct from resetting database schema:** per-test/per-suite data cleanup (e.g., transactional rollback or table truncation) runs frequently; full schema rebuild via migrations runs once per CI run (or when migrations change), not before every individual test, to avoid making the suite unnecessarily slow.

**Continuous Integration (GitHub Actions):**

- **On pull requests (blocking):** install, lint, type-check, build verification, unit tests, integration tests (against a Postgres+PostGIS service container), and a small, critical Playwright **smoke suite** covering only the most important journeys (not comprehensive E2E coverage).
- **On merge to `main` or a scheduled basis (non-blocking safety net):** the broader Playwright **regression suite**.
- **Deployment gating:** Render deployment is not triggered by a raw push to `main`. GitHub branch protection requires all pull-request checks (including the smoke suite) to pass before merge, and the actual deploy is triggered only after those checks succeed (e.g., via a deploy hook invoked from the CI workflow), preventing the specific failure mode where a broken deploy ships before a slower regression suite finishes running.

**Dependency vulnerability auditing:**

GitHub Dependabot alerts are enabled, and `npm audit --audit-level=high` runs in CI, but audit findings are **triaged, not treated as an automatic, infallible gate**: a vulnerability in a development-only dependency has a different risk profile than one in a dependency the production API actually executes. Findings are reviewed by the developer; justified, documented temporary exceptions (e.g., an audit-ignore entry with a comment explaining the reasoning, to be revisited) are permitted for low-risk, dev-only findings, while critical findings affecting production-facing dependencies are never silently ignored.

**Coverage philosophy:**

No blanket numeric coverage threshold is adopted. NFR 7.7 asks for testing of "critical application functionality," not a coverage percentage; a hard numeric gate tends to incentivize low-value tests written to hit a number, which conflicts with this project's stated preference for avoiding unnecessary complexity. Test effort concentrates on security- and correctness-sensitive logic (authorization/ownership checks, GPX import validation, geospatial queries) rather than being spread evenly to satisfy a metric.

**Rationale:**

- Vitest's native Vite integration avoids maintaining two separately configured test-tooling setups for one codebase, consistent with the complexity-minimization principle applied throughout this decision log.
- A real Postgres+PostGIS instance for integration tests is necessary because mocking geospatial query correctness is unreliable and could mask real defects.
- Splitting Playwright into a blocking PR smoke suite and a non-blocking post-merge regression suite, combined with gating Render's deployment behind CI success rather than raw push, directly prevents a broken application from reaching production before its test results are known — the specific risk identified with running the full E2E suite only after merge.
- Explicit, real-HTTP authentication/authorization tests are required because ADR-006's actual security model (database-backed sessions via Better Auth, per-resource ownership checks) is best verified by exercising real session behavior, not by asserting it through mocks that could silently diverge from the real implementation.
- Explicit database isolation rules, including the schema-reset/data-reset distinction, keep the test suite both safe (never touching production) and fast (not rebuilding schema unnecessarily on every test).
- Treating dependency audit findings as a signal requiring triage, rather than an automatic gate, avoids both extremes: silently ignoring a real vulnerability, and blocking the build over a finding with no meaningful production risk.

**Consequences:**

- Benefits: one test runner across the whole stack; realistic integration and authentication tests; a deployment pipeline that cannot ship an untested change ahead of its own checks; low-maintenance dependency vulnerability awareness with room for judgment.
- Tradeoffs: running a database service container in CI adds pipeline setup compared to mocking; maintaining a documented audit-exception policy requires ongoing developer attention rather than a purely automated gate.
- Risks: none significant; this is a conventional, well-documented toolchain and pipeline structure.
- Maintenance implications: CI configuration lives in version control (`.github/workflows/`) and should be updated as new test suites are added per milestone; the audit-exception list should be periodically revisited rather than left indefinitely.

**Related Documents:**
- `docs/IMPLEMENTATION_PLAN.md` — M00-T05 (Establish Automated Quality Checks), M07-T01 (Integration and Regression Testing), M07-T02 (Security Review).
- `docs/DECISIONS.md` — ADR-001 (Frontend Framework), ADR-003 (Database and Geospatial Storage), ADR-006 (Authentication and Session Management), ADR-008 (Hosting and Deployment).

### ADR-010: Prisma Migration Workflow for the Generated PostGIS `location` Column

**Status:** Accepted

**Date:** 2026-10-30

**Related Requirements:** NFR 7.5 (Reliability), 7.7 (Maintainability and Testability); M01-T02 (Design Landmark Data Model), M01-T03 (Implement Database Schema)

**Context:**

M01-T02 approved a database-generated `location geography(Point,4326)` column on `landmarks`, computed from `latitude`/`longitude` via `GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED`, so the three representations can never diverge (ADR-003, ADR-005). Because Prisma's schema language has no syntax for the `GENERATED` modifier, this column is declared `Unsupported("geography(Point,4326)")` in `schema.prisma`, and its real definition — along with the accompanying `CHECK` constraints and GiST spatial index, which Prisma also cannot express declaratively — is hand-written directly into the migration SQL.

During M01-T03 implementation, the generated-column expression itself was verified correct in isolated, rollback-only transactions against the real `landmarks_test` database before any migration was created: the `::geography` cast is accepted inside a generated-column expression, coordinate ordering and SRID 4326 are correct, the column recomputes correctly after an `UPDATE`, `ST_DWithin` returns correct results, and PostgreSQL itself rejects any direct write to the generated column. The migration was then created, hand-edited, and applied successfully via `prisma migrate deploy` to both `landmarks_test` and `landmarks_dev`, with all columns, constraints, and indexes confirmed correct by direct inspection.

However, running `prisma migrate dev --create-only` a **second** time — with no further schema changes — repeatedly proposed an incorrect migration: dropping the GiST index on `location` and altering the column itself (observed, across two schema iterations, as both `ALTER COLUMN "location" DROP DEFAULT` and `ALTER COLUMN "location" DROP NOT NULL`). This is Prisma ORM 7.10.1's shadow-database diffing failing to correctly reconcile a hand-written `GENERATED ALWAYS AS ... STORED` expression and a hand-written index against an `Unsupported`-typed column — a tooling limitation, not evidence that the actual, directly-verified database schema is wrong. Neither proposed migration was applied; both were generated into throwaway migration folders, inspected, and deleted without ever touching a database.

Separately, a required `Unsupported` column with no Prisma-recognized default also made Prisma's query engine refuse to build *any* `create()`/`update()` operation for the `Landmark` model at all ("Operation 'createOne' for model 'Landmark' does not match any query"). This was resolved by marking the field `Unsupported("geography(Point,4326)")? @default(dbgenerated())` in `schema.prisma` — a client-type-level annotation only, which does not alter the real database column (still `NOT NULL GENERATED ALWAYS ... STORED`).

**Options Considered:**

1. **Continue using `prisma migrate dev` as normal**, relying on a developer to notice and reject any destructive-looking interactive prompt — rejected: `migrate dev` can also trigger an unprompted development-database reset when it misdiagnoses drift, and relies on a human catching every occurrence with no structural safeguard.
2. **Abandon the generated-column design** in favor of application-level write logic (no database-enforced consistency between `latitude`/`longitude` and `location`) — rejected: the generated column is directly verified correct and is the strongest available guarantee against the three representations diverging; discarding it trades a tooling inconvenience for a real data-integrity regression.
3. **Adopt a controlled migration workflow**: author and review all migration SQL directly, apply exclusively via `prisma migrate deploy`, and treat any `migrate dev`-generated diff touching `location` or its index as something to discard, never apply — accepted.

**Decision:**

Adopt the following project-specific migration workflow for this repository, effective immediately:

- Apply migrations only via `prisma migrate deploy`; never use `prisma migrate dev` to apply or automatically accept schema changes.
- Future migrations may be created from reviewed `prisma migrate dev --create-only`/migration-diff output, or from carefully hand-authored SQL, provided the complete migration history is preserved.
- Never automatically accept a generated or hand-written change that drops, recreates, or alters the generated `location` column or its GiST index without explicit developer review confirming it is an intended, correct change.
- Apply and verify every new migration against the isolated `landmarks_test` database before applying it to `landmarks_dev`.
- Never reset a database, delete a Docker volume, or discard data to resolve apparent migration drift.
- If a future migration cannot be generated or applied safely under this workflow, stop and request developer approval rather than forcing it through.

**Rationale:**

The underlying schema design (a database-generated `location` column, hand-written `CHECK` constraints, and a hand-written GiST index) is directly verified correct by inspection and by a full integration test suite against real PostGIS; the instability is isolated entirely to Prisma's `migrate dev` diffing tool, not to the schema itself. A workflow-level safeguard — applying only pre-reviewed migrations via `migrate deploy`, and never trusting `migrate dev`'s automatic diff for this table — fully contains the known failure mode without sacrificing the stronger data-integrity guarantee the generated column provides, and without introducing additional complexity (e.g., a trigger) to work around a tooling quirk rather than a real schema problem.

**Consequences:**

- Benefits: the generated-column design's consistency guarantee is preserved; the known Prisma limitation is fully contained by process rather than by weakening the schema; the workflow rule is simple enough to state as a short, repeatable checklist.
- Tradeoffs: migrations in this repository can no longer rely on `prisma migrate dev`'s normal interactive apply-and-generate workflow once the `landmarks` table exists; every future migration touching this table (or added after it) requires manual review before being applied.
- Risks: a future contributor unaware of this ADR could run plain `prisma migrate dev` and be presented with a destructive-looking diff; mitigated by recording this rule in `.claude/skills/postgres-prisma/SKILL.md` as an operational guardrail, not only here.
- Maintenance implications: this workflow must be followed for all future migrations in this repository (M01-T04 onward and beyond), not just for the initial `landmarks` table; it should be revisited if a future Prisma version resolves the underlying diffing limitation.

**Related Documents:**
- `docs/IMPLEMENTATION_PLAN.md` — M01-T02 (Design Landmark Data Model), M01-T03 (Implement Database Schema).
- `docs/DECISIONS.md` — ADR-003 (Database and Geospatial Storage), ADR-005 (GPX Parsing and Import Strategy).
- `.claude/skills/postgres-prisma/SKILL.md` — operational workflow guardrail derived from this decision.

### ADR-011: Identity Schema Conventions for Better Auth on Prisma

**Status:** Accepted — drafted 2026-11-07 from the developer-approved M03-T01 design decisions (all six approved 2026-11-07); the record itself was accepted by the developer on 2026-11-07. **Amended 2026-11-07** (decision 9: database-backed rate-limit storage with a Prisma-managed `rate_limits` table, approved during M03-T02 planning and implemented in M03-T02 Increment 1).

**Date:** 2026-11-07 (accepted 2026-11-07)

**Related Requirements:** FR-07 (User Authentication), FR-08 (Favorites); NFR 7.4 (Security and Privacy), 7.5 (Reliability), 7.7 (Maintainability and Testability); M03-T01 (Design User Data Model), M03-T02 (Implement Authentication Backend), M03-T05 (Implement Favorites Data Model and API)

**Context:**

ADR-006 adopted Better Auth with database-backed sessions and clarified that Prisma is the single schema and migration authority, including Better Auth's required tables, with no redundant user table. `specs/AUTHENTICATION_FAVORITES_SPEC.md` v0.3 adds concrete requirements: an email-and-password-only registration form, minimal data collection, case-handled email uniqueness, rate limiting on sign-in/registration/reset, no cascade behaviour for user deletion (§10.2.6), and a favorites relationship with a composite unique constraint. M03-T01 verified the relevant Better Auth behaviour against the library's source at tag `v1.7.18` (the latest release at review time, whose peer range accepts the project's Prisma 7.10.1) rather than assuming it, and surfaced several points where the library's defaults and the specification pull in different directions: Better Auth requires a `name` field the form does not collect; it populates session IP address and user agent unconditionally; its only built-in rate-limit rule covers sign-in; its duplicate-registration response reveals account existence unless `autoSignIn` is false; and nothing in the library prevents a second credential account for one user. The project's existing schema conventions (snake_case columns via `@map`, plural snake_case tables via `@@map`, database-generated UUID primary keys, hand-written constraints and indexes where Prisma's schema language cannot express them, migrations applied only via `prisma migrate deploy` per ADR-010) also had to be reconciled with the adapter.

**Options Considered:**

1. **Adopt Better Auth's generated Prisma models and defaults as-is** (camelCase columns, singular table names, library-generated string IDs, IP/user-agent persisted, library-default rate limiting) — rejected: it would introduce a second naming convention into one schema, persist personal data no approved feature uses, and leave registration and reset endpoints without rate-limit rules.
2. **Remap table and column names through Better Auth's `modelName`/`fields` options** — unnecessary: the Prisma adapter addresses Prisma models and fields through the generated client, so Prisma-level `@map`/`@@map` already yield the project's conventions with no library configuration.
3. **Hand-author the Prisma models to the project's conventions, keep Better Auth's field set intact, and encode the specification's rules as database constraints plus a small number of explicit library options and hooks** — accepted.

**Decision:**

1. **Shared identity models.** `User`, `Session`, `Account`, and `Verification` are hand-authored Prisma models in the single `schema.prisma`, carrying exactly Better Auth 1.7.18's core field set (so the library's startup schema validation passes), mapped to tables `users`, `sessions`, `accounts`, `verifications` with snake_case columns. The Better Auth CLI's generated models are reference only. No `modelName`/`fields` remapping is configured.
2. **Database-generated UUIDs.** Every identity table's `id` uses `@default(dbgenerated("gen_random_uuid()")) @db.Uuid`, matching `landmarks`, with Better Auth's `advanced.database.generateId` set to `false` so the insert omits the id and PostgreSQL supplies it. Foreign-key columns are `@db.Uuid`. Verified fallback if M03-T02's checks fail: `generateId: "uuid"` (library-generated UUID into the same column, no schema change).
3. **Minimal registration data.** `users.name` remains (required by Better Auth) and is forced to the empty string by a `databaseHooks.user.create.before` hook, overriding any client-supplied value; registration collects email and password only. `image` is never populated.
4. **No session metadata persistence.** `sessions.ip_address` and `sessions.user_agent` remain as nullable columns for schema compatibility but are blanked by a `databaseHooks.session.create.before` hook. IP tracking itself stays enabled (never `disableIpTracking`) so IP-keyed rate limiting works; IPs must be read from a trusted proxy configuration, not arbitrary forwarded headers.
5. **Email uniqueness.** In addition to Better Auth's unique `email`, a hand-written unique index on `lower(email)` enforces case-insensitive uniqueness at the database, independent of the library's lowercasing. `autoSignIn` is false so duplicate registration receives the generic response, followed by a user-initiated sign-in.
6. **One credential account per user.** Two constraints: a declarative Prisma unique on `(provider_id, account_id)` (general identity integrity) and a hand-written partial unique index on `accounts(user_id) WHERE provider_id = 'credential'` (the rule stated directly, independent of the library's account-id-equals-user-id convention).
7. **Delete behaviour.** Cascade from `users` is confined to Better Auth's own `sessions` and `accounts`. Every application relationship to `users` — `favorites` now; reviews and trips later — uses `ON DELETE RESTRICT`, and Better Auth's `deleteUser` feature stays disabled, so no user deletion can occur or propagate by accident; a deletion/anonymization policy requires its own approval (spec §10.2.6).
8. **Favorites.** `favorites(id uuid, user_id, landmark_id, created_at)` with unique `(user_id, landmark_id)`, RESTRICT foreign keys to `users` and `landmarks`, and an index on `(user_id, created_at DESC, id)` for the newest-first paginated listing; references the internal landmark UUID, never `source_code`.
9. **Rate-limit storage: database-backed** (amended 2026-11-07, approved by the developer during M03-T02 planning; the original M03-T01 text deferred this choice). Better Auth's `rateLimit.storage` is `"database"`, backed by a Prisma-managed `RateLimit` model (table `rate_limits`: database-generated UUID `id`, unique `key`, integer `count`, BigInt `last_request` epoch-ms) created in the same hand-reviewed ADR-010 migration as the identity tables (M03-T02 Increment 1). Rationale over in-memory storage: counters survive the Render instance's restarts and deploys (an in-memory limiter hands an attacker a fresh window after every restart), remain correct if a second instance is ever added, keep Prisma as the sole schema authority, and are reset by the existing test truncation and inspectable in tests; the cost is one row write per rate-limited auth request, negligible at this scale. Retention: the library never deletes rows, so the table grows by one row per distinct client address and limited path, updated in place thereafter — unbounded but small; a cleanup that deletes rows older than the longest configured window is recorded as a maintenance follow-up together with expired `sessions`/`verifications` rows. Rules for registration and reset endpoints, trusted-proxy IP sourcing, and throttling verification remain M03-T02 requirements before authentication acceptance. *Verification note (M03-T02 Increment 5, 2026-11-10):* the retention sentence above was written from the library's documentation and is **corrected by the installed 1.7.18 source** — its database storage DOES prune rows whose `last_request` is older than the longest configured window whenever any key's window resets (awaited inline, with a prune failure logged and never affecting the request), verified by integration test; the rate-limit cleanup follow-up is resolved, while expired `sessions`/`verifications` cleanup remains open. The registration/reset rules, Express-derived trusted-proxy IP sourcing, and throttling verification were implemented and verified in that increment (record in the implementation plan); the production proxy-hop count is a deployment blocker pending on-platform verification.
10. **Migration workflow.** All identity and favorites migrations are hand-reviewed SQL applied via `prisma migrate deploy` per ADR-010, verified against `landmarks_test` before `landmarks_dev`; constraints Prisma cannot express declaratively (functional and partial unique indexes) are hand-written into the migration, as the `landmarks` migration already does for its CHECK constraints and indexes.

**Rationale:**

- One naming convention across the whole schema keeps the data layer readable and keeps raw spatial SQL (ADR-003) and future favorites/reviews/trips queries consistent; the adapter's model-level addressing makes this free.
- Database-generated UUIDs resist enumeration (the same reasoning as M01-T02's landmark key) and keep ID generation in one place; the library verifiably supports omitting the id when `generateId` is `false`.
- Forcing `name` to an empty string server-side satisfies both the library's schema and NFR 7.4's data-minimization requirement, and prevents a client from injecting a value the application never asked for.
- Blanking session IP/user-agent persists nothing the approved features read, while keeping IP tracking for the rate limiter — disabling tracking globally would remove the brute-force protection the specification requires.
- Database-level constraints (case-insensitive email uniqueness, one credential account per user, composite favorites uniqueness, RESTRICT) make the specification's integrity rules hold regardless of library or application code paths, consistent with the `postgres-prisma` skill's guidance to enforce integrity in the database rather than the UI.
- Confining cascade to the library's identity tables honours spec §10.2.6 while still letting Better Auth manage its own session/account rows.

**Consequences:**

- Benefits: a single, conventional schema; verified rather than assumed library behaviour; the specification's security and privacy rules enforced at the database; account deletion impossible by accident; favorites survive landmark retirement.
- Tradeoffs: the Better Auth CLI cannot be used to maintain the models (hand-authored, so each library upgrade requires re-checking the core field set against the new version's `get-tables.ts`); unused OAuth token columns remain in `accounts` to satisfy schema validation; registration is not followed by an automatic sign-in.
- Risks: several behaviours were verified only against source, not a running installation — the adapter import path, startup schema validation against `@map`ped models, hashed storage of reset tokens, the `expiresIn`/`updateAge` mapping of the 30-day renewable session policy, the 30-minute reset expiry and all-session revocation, and the trusted IP header on Render — each is an explicit M03-T02 verification requirement that stops implementation if it fails. Expired `sessions`/`verifications` rows are not purged automatically by the library; cleanup is a recorded follow-up.
- Maintenance implications: any future identity field (for example a role) is added to the same Prisma-managed `users` table via Better Auth's `additionalFields`, never to a parallel store, per ADR-006.

**Related Documents:**
- `specs/AUTHENTICATION_FAVORITES_SPEC.md` v0.3 — §§2–3, 6, 9–10.
- `docs/IMPLEMENTATION_PLAN.md` — M03-T01 (Design User Data Model: full verification record and the six decisions), M03-T02, M03-T05.
- `docs/DECISIONS.md` — ADR-003, ADR-006, ADR-007, ADR-010.
- `.claude/skills/postgres-prisma/SKILL.md`, `.claude/skills/spec-driven-development/SKILL.md`.

### ADR-012: Authorization Conventions for Account-Scoped API Resources

**Status:** Accepted

**Date:** 2026-11-20

**Related Requirements:** FR-08 through FR-12 (favorites, ratings and reviews, trips); NFR 7.4 (Security and Privacy), 7.7 (Maintainability and Testability); `specs/AUTHENTICATION_FAVORITES_SPEC.md` §§5, 7, 9; M03-T04 (Implement Authorization), M03-T05, M04-T02, M05-T03

**Context:**
ADR-006 separates authentication (identity from the validated session) from authorization (a per-resource ownership check in the service or data layer). M03-T02 implemented the identity half: `requireSession` (401 `UNAUTHENTICATED` for missing, expired, forged, or revoked sessions; 503 for infrastructure failures) and `requireTrustedOrigin` (CSRF). Favorites (M03-T05), reviews (M04), and trips (M05) will each add account-scoped routes. Without one shared convention, each could protect routes, derive identity, report non-owned resources, and handle caching and errors differently — the inconsistency in which "logged in but not the owner" bugs occur. M03-T04 implemented the shared building blocks (`backend/src/auth/protected-route.ts`, `mount-protected.ts`), a deny-by-default structural test, and two-user test helpers.

**Options Considered:**
1. **Per-route ad hoc checks** — each router applies `requireSession` and checks ownership its own way. Flexible, but easy to omit on one route or method, and hard to verify structurally.
2. **A shared protected-mount convention plus owner-scoped data access, enforced by a deny-by-default route inventory (chosen).**
3. **A generic policy or permissions layer (roles, ACLs)** — unnecessary: the product has no roles, administrators, or sharing (spec §1).

**Decision:**
1. **Protected mounts.** Account-scoped routers are mounted through `mountProtected(parent, path, router)` at a specific literal path (the root, wildcards, and parameterised paths are refused). It registers one contiguous group at that path, in order: `noStore` (`Cache-Control: private, no-store`), `requireSession`, the router, and `protectedRouteErrorHandler`. Every method and every nested route under the path is protected; public routes and the 404 for unknown `/api/v1` paths are unaffected.
2. **Identity.** The acting user's ID is obtained only from the validated server session, through `authenticatedUserId(req)`. Query parameters, request bodies, path segments, and headers are never used as identity. The accessor returns only the user ID; the session object (including its token) is never placed in responses or logs. If no validated identity is present, it throws, so a mis-wired route fails closed rather than acting anonymously.
3. **Ownership.** Every read or write of an owned resource takes the authenticated user ID as a required parameter of the data-access function and applies it inside the database query itself, never as a check after an unscoped fetch. Ownership is enforced server-side in the service/data layer, independently of route middleware.
4. **Non-owned resources.** A resource that does not exist and one that belongs to another user produce the same response: HTTP 404 with the standard `NOT_FOUND` envelope. HTTP 403 is not used for ownership; it remains reserved for the CSRF origin check (`INVALID_ORIGIN`).
5. **Request validation.** Route schemas reject unexpected client-supplied identity fields (for example with strict Zod objects returning 400). Validation is defence in depth and does not replace decision 3.
6. **Response status summary.** No, expired, forged, or revoked session → 401 `UNAUTHENTICATED` (one identical body); session-validation infrastructure failure → 503 `SERVICE_UNAVAILABLE`; cookie-bearing state change without trusted origin → 403 `INVALID_ORIGIN`; invalid input → 400; missing or non-owned resource → 404 `NOT_FOUND`; throttled → 429 where a route defines a limit; unexpected failure → 500 `INTERNAL_ERROR` (decision 8).
7. **Caching.** Protected responses, including their 401, 503, and 500 responses, carry `Cache-Control: private, no-store`. This instructs shared caches and the browser's HTTP cache not to store them; it does not guarantee that a browser's back-forward cache or other in-memory page restoration will not redisplay previously rendered content.
8. **Errors in protected routes.** Intentional client errors that carry a 4xx status (for example a malformed body, or a deliberate not-found) keep their status and existing handling. Any other failure — including a handler that runs without an established identity — produces a fixed 500 JSON envelope with no message text, stack, or internal detail, and one log line carrying only an event code and the error's class name.
9. **Structural enforcement (deny by default).** A test inventories every endpoint the application can reach — routes and bare middleware functions — with its full path and effective middleware chain. Each endpoint must be either (a) inside a `mountProtected` group, recognised by the identity of its four functions, with nothing that could answer a request ahead of `requireSession`; or (b) an exact entry (kind, method set, full path) in the reviewed allowlist `backend/tests/helpers/public-api-routes.ts`. Allowlisted application endpoints must be GET-only; Better Auth's `/api/auth/*` is a separately classified, externally managed authentication entry identified by its handler, with its own controls covered by its own tests; stale entries fail. `requireSession` on a route alone, a guard after a handler, a guard on another path, a function merely named `requireSession`, an unknown global middleware, and any layer the inspector cannot interpret all fail. Behavioural tests complement the inventory: anonymous and forged-cookie requests to every discovered protected endpoint, including nested and parameterised ones, must be rejected before any handler runs. The inspector relies on Express 4 internals, isolated in one test helper behind a version check and self-tests; it sees registrations, identity, and order, not logic inside a function, which is why the behavioural checks remain required.
10. **Ownership testing.** Each feature that adds owned resources proves ownership with two real accounts created through the real registration, sign-in, and session endpoints (`backend/tests/helpers/test-users.ts`), over real HTTP and session cookies (ADR-009).

**Rationale:**
- Puts ADR-006's identity-then-ownership model into a form that is implemented once, tested once, and reused.
- Scoping ownership inside the query removes the check-then-act gap and makes another user's record unreachable rather than merely refused.
- A uniform 404 avoids revealing whether another user's resource exists (spec §5).
- Deny-by-default enforcement catches the realistic failure — a new account route added without protection — rather than only verifying routes already mounted correctly.
- Rejected alternatives: ad hoc checks cannot be verified structurally; a policy layer is speculative with no roles or sharing in scope.

**Consequences:**
- Benefits: one way to protect a route, one source of identity, one non-owned response, and a test suite that fails when an account route is unprotected, mis-ordered, or not listed.
- Tradeoffs: every owned-resource data-access function carries a user-ID parameter; a non-owner sees 404 rather than an explicit "forbidden"; adding a public endpoint requires a reviewed allowlist entry; the structural test depends on Express 4 internals and must be revisited on an Express upgrade.
- Does not cover: roles, administration, sharing, or account deletion (out of scope, spec §§1 and 10.2.6); application-route throttling, defined per feature (favorites in M03-T05); application-wide handling of unexpected errors on public routes (a separate follow-up).

**Related Documents:**
- `docs/DECISIONS.md` — ADR-006 (authorization model), ADR-008 (single-origin deployment), ADR-009 (authentication/authorization testing), ADR-011 (identity schema)
- `specs/AUTHENTICATION_FAVORITES_SPEC.md` — §§5, 7, 9
- `docs/IMPLEMENTATION_PLAN.md` — M03-T04, M03-T05, M04-T02, M05-T03
- `backend/src/auth/protected-route.ts`, `backend/src/auth/mount-protected.ts`, `backend/tests/helpers/route-inspection.ts`, `backend/tests/helpers/public-api-routes.ts`, `backend/tests/helpers/test-users.ts`

## 6. Decision Management

Before accepting a decision:

1. Identify the requirements and constraints.
2. Evaluate reasonable alternatives.
3. Explain tradeoffs and risks.
4. Recommend an approach.
5. Wait for explicit developer approval.
6. Record the accepted decision.
7. Update affected plans or specifications as needed.

Do not silently change an accepted decision.

If a decision must change, document the replacement and mark the original record as Superseded.

## 7. Current Status

**Project Phase:** Planning

**Accepted Architectural Decisions:** ADR-001 — Frontend Framework (React + Vite); ADR-002 — Backend Framework (Node.js + Express + TypeScript); ADR-003 — Database and Geospatial Storage (PostgreSQL + PostGIS); ADR-004 — Mapping Library (Leaflet; tile provider deferred to M06-T01); ADR-005 — GPX Parsing and Import Strategy (fast-xml-parser + Zod; surrogate key with upsert by source code; three-tier failure handling); ADR-006 — Authentication and Session Management (Better Auth with database-backed sessions; service-layer per-resource authorization; CSRF/CORS strategy to be finalized with ADR-008); ADR-007 — Offline Storage and Map Downloads (IndexedDB with account-scoped vs. public data; map tile library deferred to implementation-time verification; per-tile status tracking instead of claimed atomicity); ADR-008 — Hosting and Deployment (single-origin on Render; explicit routing contract; resolves ADR-006's CORS question); ADR-009 — Testing and Continuous Integration (Vitest/Supertest/React Testing Library/Playwright; gated deployment; required auth/authz integration tests; isolated test database; triaged dependency auditing)

All nine initially identified architectural decisions (ADR-001 through ADR-009) are now Accepted. On 2026-10-28, the developer explicitly approved the architecture overview as a whole, including ADR-001 through ADR-009 and the agreed clarifications (Better Auth/Prisma schema ownership, authenticated trip creation, accessibility, PWA routing, and deployment). This satisfies M00-T02's acceptance criteria in full, as verified against `docs/IMPLEMENTATION_PLAN.md`.

**ADR-010 — Prisma Migration Workflow for the Generated PostGIS `location` Column — added and Accepted 2026-10-30**, during M01-T03 implementation (Milestone 01, not M00). It documents a Prisma ORM tooling limitation discovered while implementing the M01-T02-approved generated `location` column, and the resulting standing project rule to apply migrations only via `prisma migrate deploy`. See the full record above and `.claude/skills/postgres-prisma/SKILL.md` for the operational guardrail.

**ADR-011 — Identity Schema Conventions for Better Auth on Prisma — drafted and Accepted 2026-11-07** during M03-T01 (Milestone 03). It records the six developer-approved M03-T01 design decisions (shared hand-authored identity models under project naming conventions; database-generated UUIDs with `generateId: false`; `name` forced empty; session IP/user-agent not persisted; case-insensitive email uniqueness with `autoSignIn: false`; one credential account per user via two constraints; RESTRICT on all application relationships; favorites model; rate-limit storage deferred to M03-T02). Eleven decisions (ADR-001 through ADR-011) are now Accepted.

**ADR-012 — Authorization Conventions for Account-Scoped API Resources — Accepted 2026-11-20** during M03-T04 (protected mounts through `mountProtected`, identity only from the validated session, owner-scoped queries, uniform 404 for non-owned resources, `private, no-store` caching, safe 500s, deny-by-default structural enforcement with a reviewed public allowlist, and two-user ownership testing). Twelve decisions (ADR-001 through ADR-012) are now Accepted.

**Next Decision:** none currently proposed. The rate-limit storage decision (memory vs. database) is made explicitly in M03-T02 before authentication acceptance, and may warrant an ADR amendment if it changes the schema.
