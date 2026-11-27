
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
| ADR-007 | Offline storage and map downloads | Accepted (amended 2026-11-25 and 2026-11-26; both amendments accepted) |
| ADR-008 | Hosting and deployment | Accepted |
| ADR-009 | Testing and continuous integration | Accepted |
| ADR-010 | Prisma migration workflow for the generated PostGIS `location` column | Accepted |
| ADR-011 | Identity schema conventions for Better Auth on Prisma | Accepted |
| ADR-012 | Authorization conventions for account-scoped API resources | Accepted |
| ADR-013 | Ratings and reviews data model and API alignment | Accepted |
| ADR-014 | Trip planning data model, API, concurrency, and sharing alignment | Accepted |

All nine initially identified architectural decisions, plus ADR-010 (added during M01-T03 implementation), ADR-011 (M03-T01), ADR-012 (M03-T04), ADR-013 (M04-T01), and ADR-014 (M05-T01), are now Accepted.

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

**FR-14 deferral clarification (2026-11-25, M06-T01 Increment 1; accepted by the developer 2026-11-25):** this note records an existing developer decision; it does not change the Leaflet/`react-leaflet` decision above, and the original decision text is preserved as written. The tile-provider evaluation this ADR assigned to M06-T01 was performed early, in M00-T06 (verdict: feasible only with significant constraints — see `docs/IMPLEMENTATION_PLAN.md` M00-T06). On **2026-10-30 the developer deferred FR-14** (offline map-region downloads) for this phase instead of contacting a provider or proceeding on a licensing assumption. Consequently: **no tile provider has been selected**, and none will be selected during M06-T01; Stadia Maps remains a **research candidate only** (not selected, not contacted); MapTiler, Thunderforest, and a self-hosted Tennessee tile set remain unapproved; and no offline tile caching, prefetching, or download is authorized. The interactive base map continues to use the development-and-demonstration-only tile service described in the implementation note above, which is still not approved for production. Reconsidering FR-14 — including contacting or selecting a provider — requires a new, explicit developer decision, and any resulting amendment to this ADR requires its own approval. The production tile-provider requirement remains an open release prerequisite independent of FR-14.

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

**Amendment — 2026-11-25 (M06-T01) — Accepted by the developer 2026-11-25.** *(History: drafted in M06-T01 Increment 2 and refined in the final increment while marked "Proposed; awaiting final developer acceptance".)* This amendment governs wherever it supersedes or corrects the original decision text above. Original provisions it does not address remain in effect. The original text is preserved unchanged as decision history. It reconciles this ADR with Specification 6 (Version 1.0 §4.1–§4.2, and Version 1.1 §12, approved 2026-11-25) using developer decisions D1, D20, D2, and D22 of 2026-11-25:

1. **Saved offline data is account-scoped; the cross-account "public landmark reference data" tier no longer applies to saved data (D1).** The bullet stating that public landmark reference data "may persist in IndexedDB across accounts on a shared device" does not apply to any data a user explicitly saves. Landmark snapshots and owned-trip snapshots are both scoped to the account that saved them, and to that account's current local lifecycle (Specification 6 v1.1 §12.3). A saved landmark snapshot is never reused by, or shown to, another account or a later lifecycle of the same account. Coordinates may be stored only in eligible, server-redacted, account-scoped snapshots of landmarks the server returns as `PUBLIC`, and only subject to the unresolved sensitive-location policy (Specification 6 §9.8). The only account-independent offline storage is the service worker's application-shell precache, which contains no landmark, trip, or account data, plus the device-wide safety lock of item 4, which contains no data. *Rationale:* a user's selection of publicly available landmarks can itself reveal personal travel plans or interests. *Accepted tradeoff:* the same landmark may be stored once per account on a shared device, within each account's 200-landmark limit. The existing safeguards — cleanup at sign-out, and filtering every read by the current account (now account and lifecycle) — are retained; the second applies against the local account marker, which is not proof of a current server session.
2. **Correction to the session-token statement (D20).** The sentence stating that the session token is "inaccessible to JavaScript and therefore cannot be written to IndexedDB by any code path" is inaccurate as written. The Better Auth session **cookie** is httpOnly and is not readable by JavaScript. However, Better Auth's JavaScript-readable JSON response bodies also carry a session token: `GET /api/auth/get-session` returns the caller's session token in the body (recorded in M03-T02), and the sign-in response includes a `token` field. These body tokens are a **distinct exposure** from the protected cookie and are not categorically harmless. The application does not currently accept `Authorization: Bearer` authentication (verified in M03 tests), but the exposure is recorded for security review under M07-T02. The protection against persisting session tokens in IndexedDB therefore does **not** follow structurally from the cookie being httpOnly. It must be enforced by building every offline record from an explicit field allowlist, never persisting raw API or authentication responses, and verifying with tests that no token value appears in offline storage (Specification 6 v1.1 §12.7). No authentication response contract is changed by this amendment.
3. **FR-14 provisions inactive (D2).** FR-14 was deferred by the developer on 2026-10-30 (see ADR-004's deferral clarification and Specification 6 §7.4). The *map tile offline support (capability contract)* section, the per-tile status-tracking design, and references to map-region download metadata and map-region last-synced timestamps are **inactive** while FR-14 is deferred. They are preserved as the approved conditional design and must not be implemented without a new, explicit developer decision. They have no effect on the FR-13 implementation.
4. **Approved storage exception — device-wide safety lock in `localStorage` (D22, approved by the developer 2026-11-25).** This is the only exception to keeping offline state out of `localStorage`, and it is defense in depth, not guaranteed durable protection.
   - **Content:** a single fixed safety-lock value, with no account or lifecycle identifier, credential, token, coordinate, snapshot content, or personal information. It is not an authentication mechanism.
   - **When set:** when IndexedDB cannot durably record a security invalidation (sign-out intent, lifecycle invalidation, or authoritative redaction), and before a "Delete all offline data" action that would remove the only durable record of a pending sign-out intent.
   - **Effect:** while present, offline-library access is blocked on the device. It is checked at startup, at lifecycle creation, and before every snapshot read and commit, and changes are propagated to other tabs where supported.
   - **Recovery:** when the lock is the only surviving evidence of a failed operation, recovery assumes a possibly unresolved sign-out intent and does not silently restore authenticated functionality.
   - **Clearing:** only after the required recovery has completed and been verified; never because of a sign-in, a reload, reopening IndexedDB, or deleting IndexedDB. A missing lock is not evidence of success.
   - **Failure:** if `localStorage` is unavailable or the write fails, the in-memory block remains and the interface discloses that durable protection could not be confirmed.
   - **Limitation:** if every persistent-storage operation fails, an in-memory block may not survive closing or reloading the application.
   - **Open:** the implementation and recovery mechanism are subject to M06-T03 planning and approval. Details are in Specification 6 v1.1 OFF-FAIL-5.
5. **Unchanged:** IndexedDB via `idb` as the structured offline store; the service worker limited to application-shell precaching; no offline mutations or write queueing; connectivity detection that does not rely on `navigator.onLine` alone; best-effort cleanup at sign-out, without any claim of guaranteed or forensic erasure; the iOS Safari storage-eviction limitation; and the routing contract with ADR-008.

**Amendment — 2026-11-26 (M06-T03 authentication and recovery policy) — Accepted by the developer 2026-11-26.** This amendment governs wherever it supersedes the 2026-11-25 amendment or the original text above. All other provisions remain in effect, and the earlier text is preserved as decision history. It reconciles this ADR with the Specification 6 v1.1 requirements amendment of 2026-11-26 (developer Decisions 1–3 and U1–U2):

1. **Cross-tab coordination requires Web Locks.** Web Locks is required for the authentication operations that need cross-tab coordination (sign-in, sign-out, Finish signing out, Sign in again) and for offline-library functionality. There is no fallback mechanism and no tab-local authentication mode. Where Web Locks is absent or unusable, those features are refused with a browser-compatibility explanation; an existing session cookie does not restore signed-in functionality there, and uncoordinated sign-out is refused, so a server session may remain active until it expires. Existing offline security state is preserved, and public landmark browsing remains available (Specification 6 OFF-OUT-7 amendment, OFF-CONC-4).
2. **Safety lock (amendment item 4, Clearing).** The application does not clear the D22 safety lock in this release (Specification 6 OFF-FAIL-5 amendment). While it is present or unreadable, there is no signed-in functionality or offline-library access, and no credentials are submitted. Finish signing out remains available where coordination and server communication work, but does not clear the lock. Removing the site's data in the browser removes the lock, but it is destructive and is not verified recovery (OFF-REC-3).
3. **Server sign-out confirmation limit (accepted risk).** A confirmed server sign-out does not guarantee that an earlier authentication request, interrupted in a terminated browser context, cannot establish a server session afterwards, possibly undetectably. The developer explicitly accepts this residual risk **only** for ordinary sign-out, Finish signing out, and Sign in again (Specification 6 OFF-OUT-11). It does not extend to safety-lock clearing or any other security requirement.
4. **Unchanged:** ADR-006 and the backend authentication design, session handling, and API contract (no backend redesign and no new server-side protocol); every other provision of this ADR and of its 2026-11-25 amendment.

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

**Clarifications (M03-T05, 2026-11-20 — how the decisions above were applied; no decision is changed):**
- **Decision 7 (caching) and the CSRF check.** `requireTrustedOrigin` runs on all of `/api/v1` *before* any protected mount, so the mount's `noStore` never reaches its rejections. Its 403 `INVALID_ORIGIN` responses therefore set `Cache-Control: private, no-store` themselves (developer-approved Option A, M03-T05 Increment 3). This covers every cookie-bearing state-changing rejection under `/api/v1`; the status, body, origin-validation logic, and middleware order are unchanged, and successful public GET responses still send no `Cache-Control`. Effective order for a protected route: `requireTrustedOrigin` → `noStore` → `requireSession` → router → `protectedRouteErrorHandler`.
- **"Does not cover" — application-route throttling, as defined for favorites.** Favorites throttling (M03-T05, decision D6) is per authenticated user and per bucket (120 reads / 60 mutations per 60 s fixed window), attached to each route after `requireSession`, answering 429 `RATE_LIMITED` with `Retry-After`, with a 10,000-counter cap that refuses rather than evicts. Counters live in one process: not shared across instances and reset on restart — exact for the single Render instance (ADR-008); shared storage would require its own decision. Later account-scoped features define their own limits.

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

### ADR-013: Ratings and Reviews Data Model and API Alignment

**Status:** Accepted — drafted 2026-11-21 (M04-T01 Increment 2) from the design decisions D1–D4 and A1–A9 that the developer approved on 2026-11-21 at the close of M04-T01 Increment 1, including the two clarifications on non-visible review deletion and `updated_at` semantics; the record itself was **accepted by the developer on 2026-11-21**, together with the approval of `specs/RATINGS_REVIEWS_SPEC.md` v1.1.

**Date:** 2026-11-21 (accepted 2026-11-21)

**Related Requirements:** FR-09 (Ratings and Reviews), FR-10 (Review Management); NFR 7.4 (Security and Privacy), 7.5 (Reliability), 7.7 (Maintainability and Testability); `specs/RATINGS_REVIEWS_SPEC.md` v1.1 (approved 2026-11-21; amends v1.0 of 2026-10-29); M04-T01 (Design Ratings and Reviews Model), M04-T02, M04-T03, M04-T04

**Context:**
`specs/RATINGS_REVIEWS_SPEC.md` v1.0 (approved 2026-10-29) already settles the substance of reviews: an integer rating from 1 to 5, an optional plain-text body of up to 2,000 characters, one review per user per landmark, immediate publication with no moderation queue, permanent author deletion, and a sensitive-location gate that answers a generic 404 for missing, retired, `SENSITIVE`, and `UNREVIEWED` landmarks. Its route table and error classes, however, were written before ADR-012 (accepted 2026-11-20) and say they are "subject to alignment" with the shared API conventions. Three points do not fit those conventions as written: (1) the create route `POST /api/v1/landmarks/:landmarkId/reviews` cannot be protected by `mountProtected`, which refuses parameterised paths and protects every method under its path (so it could not coexist with the public `GET` on the same path), while ADR-012 decision 9 permits only GET-only public allowlist entries and rejects route-level `requireSession`; (2) the public list's `is_own_review` flag would make a public route read the session optionally — a pattern ADR-012 does not define — and would make a public response vary by cookie; it also cannot tell a client whether the user has already reviewed a landmark when that review is not on the current page; (3) the spec's 422 for invalid content and 403 "where non-disclosing" differ from ADR-012 decisions 4 and 6 (400 for invalid input, 404 for missing or non-owned resources, 403 reserved for `INVALID_ORIGIN`). Separately, the spec's "2,000 characters" was undefined at the Unicode level, and the repositories' raw-SQL pattern (favorites, M03-T05) bypasses Prisma's client-side `@updatedAt`.

**Options Considered:**
1. **Create-route placement.** (A) Keep the spec's route and extend `mountProtected` and the route inspector to protect one method on a parameterised path — an ADR-012 amendment and a change to security-reviewed code; (B) a protected `/reviews` mount, with the landmark named in the request body — a spec §6 amendment only (**chosen**); (C) as B under another prefix — no advantage; (D) route-level `requireSession` — prohibited by ADR-012 decision 9.
2. **Identifying the user's own review.** (B1) `is_own_review` on the public list, as v1.0 specifies; (B2) a separate authenticated own-review lookup, with an identical public list for every caller (**chosen**); (B3) both — all of B1's costs plus B2's.
3. **Error codes.** Keep the spec's 422/403, or align with ADR-012 (**chosen**).
4. **Character counting.** UTF-16 code units (JavaScript `.length`), grapheme clusters, or Unicode code points (**chosen** — the unit PostgreSQL's `char_length` uses in a UTF-8 database).

**Decision:**
1. **Review model (M04-T02 implements it).** Prisma model `Review`, table `reviews`, under ADR-011's conventions: `id` UUID primary key (`@default(dbgenerated("gen_random_uuid()")) @db.Uuid`); `user_id` `@db.Uuid` FK → `users` **ON DELETE RESTRICT** (ADR-011 decision 7); `landmark_id` `@db.Uuid` FK → `landmarks` **ON DELETE RESTRICT**, referencing the internal landmark UUID, never `source_code`; `rating` `INTEGER NOT NULL`; `body` `TEXT NULL`; `created_at` and `updated_at` `TIMESTAMP(3) NOT NULL`. Composite **unique `(user_id, landmark_id)`**. Index **`(landmark_id, created_at DESC, id DESC)`**. Back-relations `reviews Review[]` on `User` and `Landmark` (no columns). No publication-status column, no soft-delete column, and no stored aggregate columns.
2. **Hand-written constraints** (in the migration SQL, per ADR-010 and ADR-011 decision 10): `reviews_rating_range_check CHECK ("rating" BETWEEN 1 AND 5)`; `reviews_body_length_check CHECK ("body" IS NULL OR char_length("body") BETWEEN 1 AND 2000)`. The database does not re-implement trimming (ECMAScript and PostgreSQL whitespace definitions differ); it is a backstop for writes that bypass the service.
3. **Timestamp semantics.** `created_at` defaults to `CURRENT_TIMESTAMP` and never changes. `updated_at` is declared `@default(now()) @updatedAt`, so the database supplies it on insert even for raw SQL (a deliberate difference from the earlier tables, whose `updated_at` has no database default), and **every successful PATCH explicitly assigns the database's current timestamp** (`now()`, the transaction start time) to `updated_at`, including a PATCH whose submitted values equal the stored ones. `updated_at` is **not guaranteed to increase strictly**: equal values (same millisecond), commit order differing from transaction start order, and server clock adjustments are all possible, and it is not guaranteed to exceed `created_at`. Nothing depends on monotonicity — list order uses `created_at DESC, id DESC`, reviews have no optimistic concurrency, and clients must not use `updated_at` for ordering or conflict detection.
4. **Routes (D1, option B; D2, option B2).**
   - `GET /api/v1/landmarks/:landmarkId/reviews` — public, GET-only reviewed allowlist entry (ADR-012 decision 9). The response is identical for every caller; the route never reads the session.
   - Mounted only through `mountProtected(apiRouter, "/reviews", …)`: `POST /api/v1/reviews` (body `{ landmark_id, rating, body? }`), `GET /api/v1/reviews?landmark_id=<uuid>` (the caller's own review for that landmark: `{ "review": <safe representation> | null }`), `PATCH /api/v1/reviews/:reviewId`, `DELETE /api/v1/reviews/:reviewId`.
   - `landmark_id` in the create body names a target, not an identity; strict schemas still reject `user_id`, `author_id`, timestamps, `is_own_review`, and aggregate fields (ADR-012 decision 5).
5. **Ownership.** The acting user comes only from `authenticatedUserId(req)`; every read or write of a review is scoped by that user ID inside the SQL statement (ADR-012 decisions 2–3). A missing review and another user's review produce the same 404 `NOT_FOUND`; 403 is never used for ownership.
6. **Visibility.** A landmark is *visible* when it exists, `is_active` is true, and `sensitivity_status = 'PUBLIC'`. For a landmark that is missing, retired, `SENSITIVE`, or `UNREVIEWED`, the public list, create, the own-review lookup, and PATCH all answer the same 404 `NOT_FOUND` with no review, aggregate, name, or location data. The visibility check and the write share one SQL statement (the favorites `addFavorite` pattern): create is a visible-landmark CTE followed by `INSERT … ON CONFLICT (user_id, landmark_id) DO NOTHING RETURNING …`, distinguishing 404, 409, and 201 without a check-then-act gap. The public list computes the visibility check, the aggregate, and the page in one statement so the count and page reflect the same snapshot. DELETE is owner-scoped by review ID only and never joins or returns `landmarks`, so an author can delete their review whatever the landmark's state.
7. **Responses and error mapping (D3, A1, A2, A4).** Create → 201 with the safe public representation; PATCH → 200 with the updated representation; DELETE → 200 `{ "success": true }`; a repeated DELETE → 404 (the review is the resource; unlike favorites, not idempotent). The safe representation is `id`, `rating`, `body`, `created_at`, `updated_at`, `author_label` (always `Community Member`) — never a user ID or email. Errors: malformed path or body ID → 400 `INVALID_REQUEST`; invalid or missing `landmark_id` query on the lookup, invalid pagination, or unexpected query parameters → 400 `INVALID_QUERY`; invalid review content (rating, body, an empty PATCH, unexpected or identity fields) → 400 `INVALID_REQUEST` with a fixed message that never echoes input; no or invalid session → 401 `UNAUTHENTICATED`; untrusted origin → 403 `INVALID_ORIGIN`; non-visible landmark, missing review, or another user's review → 404 `NOT_FOUND`; PATCH of one's own review on a non-visible landmark → 404 `NOT_FOUND`; duplicate create → **409 `REVIEW_ALREADY_EXISTS`** with the plain error envelope and no review ID; throttled → 429 `RATE_LIMITED` with `Retry-After`; session infrastructure failure → 503 `SERVICE_UNAVAILABLE`; unexpected failure in a protected route → 500 `INTERNAL_ERROR`. Checks run in the order origin → session → rate limit → validation → service, so a 400 never depends on whether a review exists.
8. **Validation (D4, A7).** Server-side Zod strict objects (the frontend mirrors but is not authoritative). `rating`: a JSON number that is an integer from 1 to 5, required on create; strings, booleans, `null`, fractions, and out-of-range values are rejected. PATCH: at least one of `rating` and `body`; an omitted field is unchanged. `body`: absent or `null` → `null`; otherwise it must be a string, processed in order: reject if it contains U+0000 (NUL); reject if it is not well formed (an unpaired UTF-16 surrogate, tested with `String.prototype.isWellFormed()`, available under the project's Node `>=22` engine); trim with ECMAScript `String.prototype.trim()`; empty → `null`; otherwise its length in **Unicode code points** (`[...body].length`) must not exceed 2,000. No Unicode normalization (NFC/NFKC) is applied; internal line breaks are preserved; other control characters are allowed (rendering is inert). Pagination: `page` ≥ 1 (default 1), `limit` 1–100 (default 20). IDs use the existing UUID syntax and are lower-cased.
9. **Moderation (A8).** As spec §§1, 8, and 10.1.4 establish: valid reviews publish immediately; there is no approval queue, moderator or administrator role, reporting workflow, automatic or AI moderation, or profanity filter, and the interface must not imply human moderation. Abuse protection is authentication, CSRF/origin checks, rate limits, validation and size limits, safe text rendering, and author deletion. There is no in-app operator removal of a review; removal by the operator would be a manual database action outside the application.
10. **Rate limiting (A6).** Review routes are throttled per authenticated user, per process, following the favorites pattern recorded in ADR-012's M03-T05 clarification; exact limits are proposed in M04-T02 and require approval. The public list is not throttled, consistent with the public landmark routes.
11. **Ownership of implementation (A9).** M04-T02 implements the schema and the hand-reviewed migration (applied with `prisma migrate deploy`, verified against `landmarks_test` before `landmarks_dev`) as well as the API, and must confirm `server_encoding` is `UTF8` on each database so `char_length` counts code points.

**Rationale:**
- Option B keeps every ADR-012 guarantee (session-derived identity, owner-scoped SQL, the deny-by-default inventory, `no-store`, the fixed 500) with no change to security-reviewed infrastructure; the cost is one spec route string.
- Option B2 keeps public responses identical and cacheable for every caller, introduces no optional-authentication pattern, and answers "have I already reviewed this landmark?" regardless of pagination, which the spec's "Edit your review" behaviour (§4.1) needs.
- Aligned error codes give clients one vocabulary across favorites and reviews and keep ownership non-disclosing.
- Code points are the only unit the application and PostgreSQL count identically; rejecting NUL and unpaired surrogates prevents a database error (NUL) and silent replacement with U+FFFD (surrogates); skipping normalization preserves the user's text exactly.
- Computing aggregates on read keeps them correct under concurrent create, edit, and delete without counters to maintain.

**Consequences:**
- Benefits: reviews reuse the favorites and authorization infrastructure unchanged; integrity rules hold in the database; aggregates cannot drift.
- Tradeoffs: the spec's route table and error classes change (spec v1.1); a signed-in profile view makes two requests (public list and own-review lookup); `updated_at` gains a database default unlike earlier tables and is not monotonic; `OFFSET` paging and on-read aggregates scan rows in proportion to a landmark's reviews (acceptable at this scale; no covering index or counters).
- **Accepted limitation — non-visible review deletion.** When a landmark becomes retired, `SENSITIVE`, or `UNREVIEWED`, its reviews disappear from the public list and the own-review lookup returns 404, including for the author. The API still lets the author delete the review by its ID, but the M04 interface exposes no way to discover that ID, so in practice the author cannot find or delete such a review through the application. The row remains stored, hidden, and excluded from every aggregate. **Deferred improvement (outside M04):** an authenticated, owner-scoped "My reviews" page listing the user's reviews — including those on non-visible landmarks, shown only with a generic "Landmark unavailable" label and no landmark name, coordinates, or other metadata — with confirmed deletion; it requires its own specification amendment and approval.
- Other limitations: no in-app operator removal; per-process throttling (not shared across instances; resets on restart); multi-code-point emoji count as several characters; the public list inherits the open app-wide follow-up for non-JSON errors on public routes; no real landmark is `PUBLIC` yet, so end-to-end verification needs guarded synthetic fixtures.
- Maintenance implications: every raw `UPDATE` of `reviews` must set `updated_at = now()` explicitly (to be covered by a test); the M04-T03 character counter must count code points, not rely on `maxLength`; M04-T03 must not request reviews for a redacted (non-`PUBLIC`) profile or must treat the 404 as "reviews unavailable".

**Related Documents:**
- `specs/RATINGS_REVIEWS_SPEC.md` — v1.1 (approved 2026-11-21), with the v1.0 baseline and amendment history in its §12.
- `docs/DECISIONS.md` — ADR-003, ADR-006, ADR-009, ADR-010, ADR-011 (decisions 7, 10), ADR-012 (decisions 1–9 and the M03-T05 clarifications). Neither ADR-011 nor ADR-012 is changed by this record.
- `docs/IMPLEMENTATION_PLAN.md` — M04-T01 (design record), M04-T02, M04-T03, M04-T04.
- `.claude/skills/postgres-prisma/SKILL.md`, `.claude/skills/spec-driven-development/SKILL.md`.

### ADR-014: Trip Planning Data Model, API, Concurrency, and Sharing Alignment

**Status:** Accepted — drafted 2026-11-23 (M05-T01 Increment 1) from the design decisions T1–T16 and seven clarifications that the developer approved on 2026-11-23; the record itself was **accepted by the developer on 2026-11-23**, together with the approval of `specs/TRIP_PLANNING_SPEC.md` v1.1 and the documented API response contracts.

**Date:** 2026-11-23 (accepted 2026-11-23)

**Related Requirements:** FR-06 (Geographic Discovery, for straight-line distance), FR-11 (Trip Creation), FR-12 (Trip Management); NFR 7.2 (Accessibility), 7.4 (Security and Privacy), 7.5 (Reliability), 7.7 (Maintainability and Testability); `specs/TRIP_PLANNING_SPEC.md` v1.0 (approved 2026-10-29) and its v1.1 amendment; M05-T01 (Define Trip Planning Behavior) through M05-T06

**Context:**
`specs/TRIP_PLANNING_SPEC.md` v1.0 (approved 2026-10-29) already settles the substance of trips: authenticated owners, named trips of up to 25 manually ordered stops with no duplicates, contiguous positions, an optimistic-concurrency `version` required on reorder, uniform 404s for missing and non-owned trips, a sensitive-location redaction guard, and optional read-only sharing through an unguessable, hashed, revocable link (FR-12). It predates ADR-011 (schema conventions), ADR-012 (authorization conventions), and ADR-013 (which aligned reviews with them and defined Unicode text rules). Several points were open: the API's error codes and the 25-stop response ("validation/conflict"); what a "character" is in a trip name and which characters are allowed; whether the owner view includes coordinates (the map needs them) and whether it hides `UNREVIEWED` landmarks as the shared view does; how geographic distance is presented (M05-T01 scope: "clarify geographic distance calculations"); expected map interactions; how sharing is kept off in production while its release blockers remain; how simultaneous mutations stay correct; and which tasks own sharing (no M05 task scope mentioned it). ADR-012's text also describes the product as having no sharing — a statement made in the context of Specification 3's account features, which this record must reconcile with Specification 5's approved sharing.

**Options Considered:**
1. **Position uniqueness.** (a) An ordinary `UNIQUE (trip_id, position)` with reorders written as several statements through temporary positions; (b) `DEFERRABLE INITIALLY DEFERRED`; (c) **`DEFERRABLE INITIALLY IMMEDIATE`** with single-statement rewrites (**chosen**); (d) no position uniqueness, relying on the lock alone.
2. **Concurrency control.** (a) `version` required on every mutation; (b) **a row lock on the trip for every mutation, with `version` required on reorder and optional on rename** (**chosen**); (c) serializable isolation with retries.
3. **Distance.** (a) No distances; (b) client-side haversine from the returned coordinates; (c) **server-side PostGIS geodesic legs between adjacent available stops, with a measured/total leg summary** (**chosen**); (d) distances that bridge unavailable stops.
4. **Keeping sharing off in production.** (a) A release-checklist entry only; (b) **a server setting `TRIP_SHARING_ENABLED`, off by default in production, plus the release-checklist entries** (**chosen**); (c) removing sharing from M05 (rejected — sharing is approved functionality).
5. **Share-token placement.** (a) **The approved path form `/shared/trips/:shareToken`, with an access-log release blocker** (**chosen**); (b) the token in the page URL's fragment and an HTTP header, which would amend the approved route.

**Decision:**
1. **Specification baseline (T1).** Specification 5 v1.0's substance stands; v1.1 amends it only for alignment, clarification, and gaps, preserving the replaced text in its §11. No approved functionality — sharing included — is removed; navigation, directions, travel distances and times, route lines, and route optimization stay out of scope. ADR-011, ADR-012, and ADR-013 are not changed.
2. **Routes and mounting (T2).** The owner routes of spec §7 are mounted only through `mountProtected(apiRouter, "/trips", …)`. `GET /api/v1/shared/trips/:shareToken` is a GET-only entry in the reviewed public allowlist — the one public route trips add. It is compatible with ADR-012 decision 9 as written. ADR-012's "no sharing" wording describes Specification 3's account features; trip sharing is a capability-URL read, not an authorization role, and introduces no roles, policies, or optional authentication.
3. **Errors and statuses (T3).** The reviews vocabulary — `400 INVALID_REQUEST` / `INVALID_QUERY`, `401 UNAUTHENTICATED`, `403 INVALID_ORIGIN` (never ownership), `404 NOT_FOUND`, `429 RATE_LIMITED`, `500`/`503` — plus four named conflicts: `409 TRIP_STOP_ALREADY_EXISTS`, `409 TRIP_STOP_LIMIT_REACHED`, `409 TRIP_VERSION_CONFLICT`, `409 TRIP_SHARING_UNAVAILABLE`. Specification 5's approved statuses are kept, including `204 No Content` for trip deletion, stop removal, and share revocation (unlike reviews' `200 { "success": true }`).
4. **Concurrency (T4, clarification 1).** Every mutation runs in one transaction that first locks the owner's trip row (`SELECT … FOR UPDATE` scoped by trip ID and user ID; no row → 404). Add counts under the lock and inserts at `position = count` with the landmark-visibility check and `ON CONFLICT (trip_id, landmark_id) DO NOTHING` in one statement; remove deletes and shifts later positions in one statement; reorder checks `version` (required, as approved) and then the exact stop-ID set, and rewrites positions in one statement; rename accepts an optional `version` (stale → 409; the interface always sends it). Every successful mutation, including share changes, increments `version` and sets `updated_at`. One trip-row lock per operation serializes a trip's mutations without cross-trip waits or deadlocks. *Clarification (2026-11-23, M05-T03 planning; developer-approved; Specification 5 v1.1 §6.4 amended the same day — the superseded wording is preserved in its §11):* under the trip-row lock, adding a stop checks, in order, (1) trip missing or not owned → generic 404, (2) landmark missing, inactive, `SENSITIVE`, or `UNREVIEWED` → generic 404, (3) visible landmark already in the trip → `409 TRIP_STOP_ALREADY_EXISTS`, (4) trip already at 25 stops → `409 TRIP_STOP_LIMIT_REACHED`, then (5) inserts at `position = count` with `ON CONFLICT (trip_id, landmark_id) DO NOTHING` as the uniqueness backstop and increments `version` exactly once. The sentence above ("Add counts under the lock and inserts … in one statement") described the capacity check first; the visibility and duplicate checks now take precedence over it. The outcomes and codes are unchanged.
5. **Trip names (T5, clarification 2).** Well-formed string → ECMAScript `trim()` → no C0/C1 control characters, U+007F, U+2028, or U+2029 anywhere → at least one Letter, Number, Punctuation, or Symbol code point (`/[\p{L}\p{N}\p{P}\p{S}]/u`; marks, separators, format, private-use, and unassigned code points do not count) → at most 100 code points. No normalization; `Cf` characters allowed inside; names rendered direction-isolated. The frontend mirrors the rule, and frontend/backend parity tests run over one shared ASCII-only corpus (spec §5.1.1). The database keeps `CHECK (char_length(name) BETWEEN 1 AND 100)` as a backstop.
6. **Representations and redaction (T6, T7, clarification 3).** A stop is available only when its landmark currently exists, is active, and is `PUBLIC`, evaluated at read time in the statement that reads the stops — in the owner view and the shared view alike (the owner view thus also hides `UNREVIEWED`, aligning spec §5.3 with §4 and §10.4). Available stops carry exactly `id`, `display_name`, `category`, `latitude`, `longitude`; unavailable stops carry exactly `{ id, is_available: false }`. Responses are built from explicit field allowlists before serialization. The owner trip adds `is_shared` and `sharing_enabled`; the shared trip carries only the name, stops, and distance summary, with `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.
7. **Straight-line distance (T8, clarification 4).** Legs join adjacent positions; a leg is measured only when both stops are available, never across or around an unavailable stop. Distances use PostGIS `ST_Distance` on `geography`, as proximity discovery does, returned unrounded in miles (`distance_from_previous_miles` per stop) with `distance_summary { total_miles, measured_legs, total_legs }`, where `total_legs = max(n − 1, 0)` and `total_miles` is the sum of measured legs or `null` when none is measured; the total is partial when `measured_legs < total_legs`. Every value is labelled as straight-line, not travel or trail, distance.
8. **Map (T9).** The ordered list is primary and accessible; a supplementary Leaflet map shows only available stops as numbered markers matching the list, fitted to them, with no line drawn between stops.
9. **Throttling (T10).** Owner routes: per user, per process, 60 mutations and 120 reads per 60 s, using the existing generic limiter (ADR-012's M03-T05 clarification). The shared route is not throttled (256-bit token), like the other public reads.
10. **Share tokens and the production release gate (T11, clarification 5).** `crypto.randomBytes(32)` encoded base64url; stored as a unique hexadecimal SHA-256 digest and resolved by hashing the presented token; returned only as the `share_url` of an enable/rotate response; never logged. `TRIP_SHARING_ENABLED` defaults to off in production (unless explicitly `true`) and on in development and test; when off, enabling returns `409 TRIP_SHARING_UNAVAILABLE`, shared links return the generic 404, and the interface hides share controls. **The setting does not by itself satisfy any release requirement**: production sharing requires both release blockers — the sensitive-location classification policy and initial dataset review, and the review of share-token exposure in hosting and proxy access logs — to be resolved, and the developer's explicit approval.
11. **Add-to-trip flow (T13).** A picker of the user's trips plus "New trip", implemented as create-then-add (two requests); no atomic create-and-add endpoint.
12. **Task ownership (T14, clarification 6).** M05-T02 schema and migration; M05-T03 the API **including the sharing endpoints**; M05-T04 the trip detail and editing interface, map, and distances; M05-T05 nearby landmarks for a selected stop using the existing proximity API; M05-T06 the trips list, create/rename/delete, **the sharing interface and shared-trip page**, and unavailable-stop handling. No approved functionality is deferred; any deferral requires the developer's explicit approval.
13. **Offline (T15).** No offline work in M05. Trip responses use stable IDs and safe summaries and never contain a share token, so Specification 6's owned-trip snapshots can be built from them later.
14. **Data model (T16, clarification 7).** Tables `trips` and `trip_stops` under ADR-011 conventions: database-generated UUIDs; `trips.user_id` → `users` and `trip_stops.landmark_id` → `landmarks` `ON DELETE RESTRICT`; `trip_stops.trip_id` → `trips` `ON DELETE CASCADE`; `CHECK (position >= 0)`; ordinary `UNIQUE (trip_id, landmark_id)` (the `ON CONFLICT` arbiter); **`UNIQUE (trip_id, position) DEFERRABLE INITIALLY IMMEDIATE`**, hand-written in the reviewed migration because Prisma's schema language cannot express deferrability. Every future migration must preserve it, and a test asserts its deferrability from the catalog. Exact columns, indexes, and Prisma declarations are designed in M05-T02.

**Verification (PostgreSQL 17.5, `landmarks_test`, 2026-11-23; a scratch schema created and dropped by a throwaway script, no repository or `landmarks_dev` change):** reversing three positions in one `UPDATE … FROM unnest(…)` fails with an ordinary unique constraint (23505, checked per row) and succeeds with `DEFERRABLE INITIALLY IMMEDIATE` and with `INITIALLY DEFERRED`; `ON CONFLICT (trip_id, landmark_id)` works while the position constraint is deferrable, and PostgreSQL refuses a deferrable constraint as an `ON CONFLICT` arbiter; a duplicate position is still refused immediately; with the trip-row lock, two concurrent appends received positions 0 and 1, two concurrent appends of one landmark produced one stop and one duplicate, and two concurrent appends to a 25-stop trip were both refused with the count unchanged.

**Rationale:**
- Option 1(c) is the only form that allows single-statement reorder and compaction while still reporting a violation at the statement that causes it; 1(a) needs multi-step temporary positions, 1(b) defers errors to commit, and 1(d) leaves integrity to application code.
- Option 2(b) prevents lost and conflicting updates without forcing a version round-trip on every click, matches the approved contract (version required on reorder), and uses one lock per operation.
- Option 3(c) gives one authoritative calculation consistent with proximity discovery and testable against real PostGIS, and the measured-leg rule prevents a distance from revealing a hidden stop's location or misrepresenting the itinerary.
- Option 4(b) makes the approved release gate enforceable rather than procedural while keeping sharing fully implemented and tested.
- Option 5(a) keeps the approved route; the log exposure is handled like the existing reset-link access-log blocker.
- Reusing the review and favorites conventions gives clients one error vocabulary and keeps every ADR-012 guarantee with no change to security-reviewed infrastructure.

**Consequences:**
- Benefits: trips reuse the protected-mount, identity, limiter, and route-inventory infrastructure unchanged; ordering integrity holds in the database; concurrency outcomes are deterministic and testable; no response can expose a hidden landmark's location, directly or through a distance.
- Tradeoffs: the deferrable constraint lives outside Prisma's schema language and must be guarded by a test; every mutation takes a row lock; after an add or remove (`204` or a stop-only `201`) the client reloads the trip to obtain the new `version`; a partial distance total is less informative than a total that bridged unavailable stops; `TRIP_SHARING_ENABLED` is one more production setting to verify.
- Risks: the trip-name visible-character test depends on the runtime's Unicode version, so a newly assigned character can be classified differently in an older browser (the server is authoritative); share tokens may appear in hosting access logs until reviewed (release blocker); with no landmark classified `PUBLIC`, trips are verified only with synthetic fixtures.
- Maintenance implications: every trip and stop mutation must lock the trip row first, increment `version`, and set `updated_at`; every migration touching `trip_stops` must preserve `DEFERRABLE INITIALLY IMMEDIATE`; any new trip field returned to clients must be added to the explicit allowlists.

**Related Documents:**
- `specs/TRIP_PLANNING_SPEC.md` — v1.1 (approved 2026-11-23), with the v1.0 baseline and amendment history in its §11.
- `specs/LANDMARK_DISCOVERY_SPEC.md` (straight-line distance and units), `specs/OFFLINE_PWA_SPEC.md` (trip snapshots), `specs/RATINGS_REVIEWS_SPEC.md` v1.1 (text and error conventions).
- `docs/DECISIONS.md` — ADR-003, ADR-006, ADR-007, ADR-009, ADR-010, ADR-011 (decisions 7, 10), ADR-012 (decisions 1–10 and the M03-T05 clarifications), ADR-013 (decisions 7–8, by analogy). None of them is changed by this record.
- `docs/IMPLEMENTATION_PLAN.md` — M05-T01 (design record) and the clarified scopes of M05-T02 through M05-T06.
- `.claude/skills/postgres-prisma/SKILL.md`, `.claude/skills/spec-driven-development/SKILL.md`.

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

**Project Phase:** Implementation — incremental, plan-first feature development under approved specifications and ADRs (M00 through M04 complete — Milestone 04, Ratings and Reviews, closed 2026-11-23; Milestone 05, Trip Planning, in progress — M05-T01 (Define Trip Planning Behavior) Complete 2026-11-23 with ADR-014 Accepted; M05-T02 (Design Trip Data Model) Complete 2026-11-23; M05-T03 (Implement Trip Management API) is the next planning boundary, not started and not authorized). *(Updated 2026-11-23; previously recorded as "Planning", then as M04 in progress, then as M05-T02 not yet started.)*

**Accepted Architectural Decisions:** ADR-001 — Frontend Framework (React + Vite); ADR-002 — Backend Framework (Node.js + Express + TypeScript); ADR-003 — Database and Geospatial Storage (PostgreSQL + PostGIS); ADR-004 — Mapping Library (Leaflet; tile provider deferred to M06-T01); ADR-005 — GPX Parsing and Import Strategy (fast-xml-parser + Zod; surrogate key with upsert by source code; three-tier failure handling); ADR-006 — Authentication and Session Management (Better Auth with database-backed sessions; service-layer per-resource authorization; CSRF/CORS strategy to be finalized with ADR-008); ADR-007 — Offline Storage and Map Downloads (IndexedDB with account-scoped vs. public data; map tile library deferred to implementation-time verification; per-tile status tracking instead of claimed atomicity); ADR-008 — Hosting and Deployment (single-origin on Render; explicit routing contract; resolves ADR-006's CORS question); ADR-009 — Testing and Continuous Integration (Vitest/Supertest/React Testing Library/Playwright; gated deployment; required auth/authz integration tests; isolated test database; triaged dependency auditing)

All nine initially identified architectural decisions (ADR-001 through ADR-009) are now Accepted. On 2026-10-28, the developer explicitly approved the architecture overview as a whole, including ADR-001 through ADR-009 and the agreed clarifications (Better Auth/Prisma schema ownership, authenticated trip creation, accessibility, PWA routing, and deployment). This satisfies M00-T02's acceptance criteria in full, as verified against `docs/IMPLEMENTATION_PLAN.md`.

**ADR-010 — Prisma Migration Workflow for the Generated PostGIS `location` Column — added and Accepted 2026-10-30**, during M01-T03 implementation (Milestone 01, not M00). It documents a Prisma ORM tooling limitation discovered while implementing the M01-T02-approved generated `location` column, and the resulting standing project rule to apply migrations only via `prisma migrate deploy`. See the full record above and `.claude/skills/postgres-prisma/SKILL.md` for the operational guardrail.

**ADR-011 — Identity Schema Conventions for Better Auth on Prisma — drafted and Accepted 2026-11-07** during M03-T01 (Milestone 03). It records the six developer-approved M03-T01 design decisions (shared hand-authored identity models under project naming conventions; database-generated UUIDs with `generateId: false`; `name` forced empty; session IP/user-agent not persisted; case-insensitive email uniqueness with `autoSignIn: false`; one credential account per user via two constraints; RESTRICT on all application relationships; favorites model; rate-limit storage deferred to M03-T02). Eleven decisions (ADR-001 through ADR-011) are now Accepted.

**ADR-012 — Authorization Conventions for Account-Scoped API Resources — Accepted 2026-11-20** during M03-T04 (protected mounts through `mountProtected`, identity only from the validated session, owner-scoped queries, uniform 404 for non-owned resources, `private, no-store` caching, safe 500s, deny-by-default structural enforcement with a reviewed public allowlist, and two-user ownership testing). Twelve decisions (ADR-001 through ADR-012) are now Accepted. **ADR-012 clarified 2026-11-20** during M03-T05 (CSRF 403 responses also carry `private, no-store`; favorites throttling recorded as the first application-route limit) — clarification notes only; no decision changed.

**ADR-013 — Ratings and Reviews Data Model and API Alignment — drafted and Accepted 2026-11-21** during M04-T01 (Milestone 04). It records the developer-approved M04-T01 design decisions (the `reviews` model with RESTRICT foreign keys, rating and body CHECK constraints, and the `(landmark_id, created_at DESC, id DESC)` index; `updated_at` database default with non-monotonic semantics; the protected `/reviews` mount with `POST /api/v1/reviews` and an authenticated own-review lookup; a public list identical for every caller; ADR-012-aligned errors including 409 `REVIEW_ALREADY_EXISTS`; Unicode code-point validation with NUL and unpaired-surrogate rejection; moderation limited to the specification's abuse protections; the non-visible review deletion limitation). `specs/RATINGS_REVIEWS_SPEC.md` v1.1 was approved the same day. Thirteen decisions (ADR-001 through ADR-013) are now Accepted; ADR-011 and ADR-012 are unchanged.

**ADR-014 — Trip Planning Data Model, API, Concurrency, and Sharing Alignment — drafted and Accepted 2026-11-23** during M05-T01 (Milestone 05). It records the developer-approved M05-T01 decisions T1–T16 and seven clarifications (owner routes through `mountProtected("/trips")` and one GET-only shared-trip allowlist entry; the reviews error vocabulary plus four named 409 codes; trip-row locking with `version` required on reorder and optional on rename; the trip-name Unicode rule with parity tests; read-time redaction and field allowlists in owner and shared views; straight-line distances between adjacent available stops; a supplementary numbered-marker map without route lines; per-user throttling; SHA-256-hashed share tokens and the `TRIP_SHARING_ENABLED` production release gate; task ownership; and the `UNIQUE (trip_id, position) DEFERRABLE INITIALLY IMMEDIATE` constraint, verified by a PostgreSQL probe), together with the approval of `specs/TRIP_PLANNING_SPEC.md` v1.1. ADR-011, ADR-012, and ADR-013 are unchanged.

**ADR-007 amended and ADR-004 clarified — 2026-11-25** during M06-T01 (Milestone 06), both accepted by the developer 2026-11-25.
- **ADR-007 amendment** (governing where it supersedes the original text):
  - account- and lifecycle-scoped saved snapshots replace the cross-account public-data tier for saved data;
  - the session-token statement is corrected: the httpOnly cookie is distinct from tokens in JavaScript-readable response bodies, which are referred to M07-T02;
  - the FR-14 map-tile provisions are inactive while FR-14 is deferred;
  - D22, a device-wide `localStorage` safety lock, is the only approved storage exception.
- **ADR-004 FR-14 deferral clarification:** no tile provider is selected; reconsideration requires explicit approval.

Approved together with `specs/OFFLINE_PWA_SPEC.md` v1.1. Fourteen decisions (ADR-001 through ADR-014) remain Accepted; no new ADR was added.

**ADR-007 amended — 2026-11-26** during M06-T03 (Milestone 06), accepted by the developer 2026-11-26 with the Specification 6 v1.1 requirements amendment of the same date:
- Web Locks is required for coordinated authentication and offline-library functionality; there is no fallback;
- the D22 safety lock is not cleared in the application in this release;
- the interrupted-request sign-out confirmation risk is accepted, limited to ordinary sign-out flows.

ADR-006 is unchanged. Fourteen decisions (ADR-001 through ADR-014) remain Accepted; no new ADR was added.

**Next Decision:** none currently proposed. *(Updated 2026-11-20: the rate-limit storage decision this line previously anticipated was made in M03-T02 — database-backed storage, recorded as the ADR-011 decision 9 amendment.)*
