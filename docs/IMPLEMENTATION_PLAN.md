
# Tennessee Natural Landmarks Explorer
# Implementation Plan

## 1. Purpose

This document defines the incremental implementation roadmap for Tennessee Natural Landmarks Explorer.

It translates the approved project scope into small, independently verifiable development tasks and serves as the authoritative record of implementation progress.

Development must follow the workflow established in `CLAUDE.md`.

This document is a living plan. Task details, dependencies, statuses, and verification records will be updated as development progresses.

The project scope is defined in `docs/PROJECT_PLAN.md`. Detailed feature behavior belongs in `specs/`, approved architectural decisions belong in `docs/DECISIONS.md`, and reusable engineering procedures belong in `.claude/skills/`.

## 2. Development Principles

1. **Plan before coding.** Review requirements and propose a focused implementation approach before making changes.
2. **Obtain approval.** Do not implement a task until the developer explicitly approves the proposed approach.
3. **Work incrementally.** Complete one small, clearly defined task at a time.
4. **Follow specifications.** Implement approved requirements without inventing additional behavior.
5. **Inspect existing code.** Understand relevant files and conventions before modifying them.
6. **Keep changes focused.** Avoid unrelated features, refactoring, or dependencies.
7. **Verify results.** Execute appropriate tests and checks before marking a task complete.
8. **Document decisions.** Record approved architectural changes and meaningful technical tradeoffs.
9. **Maintain traceability.** Connect tasks to requirements, specifications, and verification evidence.
10. **Stop after each task.** Report results and wait for the next instruction.

Planning approval does not automatically authorize application implementation.

## 3. Existing Repository Structure

The project repository is named `hidden_tennessee`.

The current repository structure is:

```text
hidden_tennessee/
├── CLAUDE.md
├── coordinates/
│   ├── tnarches.gpx
│   ├── tnbalds.gpx
│   ├── tnfalls.gpx
│   ├── tnlakes.gpx
│   ├── tnother.gpx
│   ├── tnpeaks.gpx
│   ├── tnrocks.gpx
│   └── tnsinks.gpx
└── docs/
    ├── DECISIONS.md
    ├── IMPLEMENTATION_PLAN.md
    └── PROJECT_PLAN.md
```

### 3.1 Existing Geographic Data

The `coordinates/` directory contains eight GPX files representing different categories of Tennessee natural landmarks.

| Source File | Landmark Category |
|-------------|-------------------|
| `tnarches.gpx` | Natural arches |
| `tnbalds.gpx` | Mountain balds |
| `tnfalls.gpx` | Waterfalls |
| `tnlakes.gpx` | Lakes |
| `tnother.gpx` | Other natural features |
| `tnpeaks.gpx` | Mountain peaks |
| `tnrocks.gpx` | Rock formations |
| `tnsinks.gpx` | Sinkholes |

These files are the initial source of geographic data for the application.

The internal structures and available metadata of the GPX files have not yet been verified.

Before designing the landmark database or implementing data imports, the files must be inspected to identify:

- GPX elements and structures.
- Coordinate formats.
- Available landmark names and descriptions.
- Additional metadata.
- Missing or invalid coordinates.
- Duplicate or overlapping landmarks.
- Differences between source files.

The original GPX files must be preserved unless the developer explicitly approves modifications.

### 3.2 Planned Repository Expansion

Additional directories will be created as needed and approved:

```text
hidden_tennessee/
├── CLAUDE.md
├── coordinates/
├── docs/
├── specs/
│   └── README.md
├── .claude/
│   └── skills/
├── frontend/
└── backend/
```

This structure is provisional. Application directories and tooling must reflect approved architectural decisions.

Do not create unnecessary directories or placeholder files before they are required.

## 4. Task Status Definitions

| Status | Definition |
|--------|------------|
| Proposed | Task has been identified but its requirements or approach have not been fully approved. |
| Ready | Requirements, specifications, dependencies, and prerequisites have been satisfied. |
| In Progress | Implementation has been explicitly approved and started. |
| Blocked | Work cannot proceed until a dependency, conflict, or decision is resolved. |
| In Review | Implementation is finished but verification or developer review remains. |
| Complete | Acceptance criteria have been verified and the results documented. |
| Deferred | Task has been intentionally postponed. |

A task must not be marked Complete solely because code has been generated.

A task may return to Ready or In Progress if verification reveals defects requiring additional work.

## 5. Task Definition Template

Before implementation, each task should be refined using the following structure.

### TASK-ID: Task Title

**Status:** Proposed

**Related Requirements:** FR-XX

**Dependencies:** None

**Specification:** Pending

**Applicable Skills:** To be identified

**Objective:**

A concise description of the intended outcome.

**Scope:**
- Changes included in the task.
- Explicit exclusions when necessary.

**Acceptance Criteria:**
- [ ] Observable condition that must be satisfied.
- [ ] Required error or edge cases are handled.
- [ ] Relevant verification checks pass.

**Verification:**
- Tests, commands, or manual procedures used to verify the result.

**Verification Results:**
- Not yet executed.

**Notes:**
- Assumptions, risks, limitations, or unresolved questions.

Tasks should reference detailed specifications rather than duplicating them.

## 6. Implementation Milestones

The following milestones define the proposed development sequence.

All tasks are initially Proposed unless explicitly updated.

Milestone completion requires verification of its approved acceptance criteria.

---

## Milestone 00: Project Foundation

**Objective:** Establish the requirements, architecture, development environment, and engineering standards.

### M00-T01: Finalize Project Planning

**Status:** Complete

**Scope:**
- Review and approve `docs/PROJECT_PLAN.md`.
- Review and approve `docs/IMPLEMENTATION_PLAN.md`.
- Document outstanding planning questions.
- Establish the architectural decision process.
- Ensure the project plan recognizes all eight GPX landmark categories.

**Acceptance Criteria:**
- [x] Project scope is approved.
- [x] Implementation roadmap is approved.
- [x] Outstanding questions are documented.
- [x] The documented scope is consistent with the available landmark categories.

**Verification Results:**
- Project scope approved: the developer explicitly confirmed the full in-scope feature set for the final demonstration (2026-10-28).
- Implementation roadmap approved: the developer approved the revised milestone/task structure, including the addition of M00-T06 and M02-T08, and directed prioritization by dependency and risk rather than scope reduction (2026-10-28).
- Outstanding questions documented: see `docs/PROJECT_PLAN.md` Section 10.2, kept current as of 2026-10-28.
- Landmark categories consistent: the eight GPX files in `coordinates/` (tnarches, tnbalds, tnfalls, tnlakes, tnother, tnpeaks, tnrocks, tnsinks) were verified by direct inspection to match the eight categories listed in `docs/PROJECT_PLAN.md` Section 1 and Section 3.1 of this document.

### M00-T02: Define System Architecture

**Status:** Complete

**Dependencies:** M00-T01

**Scope:**
- Evaluate frontend and backend technology options.
- Select the database and geospatial approach.
- Evaluate mapping libraries and data providers.
- Define application module boundaries.
- Evaluate authentication and offline architecture.
- Document approved architectural decisions.

**Acceptance Criteria:**
- [x] Architecture overview is approved.
- [x] Technology choices are documented.
- [x] Important tradeoffs are recorded.
- [x] Initial decisions are entered in `docs/DECISIONS.md`.

**Verification Results:**
- Architecture overview approved: the developer explicitly approved the architecture overview as a whole, including ADR-001 through ADR-009 and the agreed clarifications (Better Auth/Prisma schema ownership, authenticated trip creation, accessibility, PWA routing, deployment) (2026-10-28).
- Technology choices documented: verified directly in `docs/DECISIONS.md` — each of ADR-001 through ADR-009 names specific, accepted technology choices.
- Tradeoffs recorded: verified directly in `docs/DECISIONS.md` — each ADR includes a populated Consequences section (Benefits/Tradeoffs/Risks/Maintenance implications).
- Decisions entered in `docs/DECISIONS.md`: verified directly — all nine ADRs are present with Status: Accepted.

### M00-T03: Establish Specifications and Engineering Skills

**Status:** Proposed

**Dependencies:** M00-T01

**Scope:**
- Create `specs/README.md`.
- Establish a consistent feature specification format.
- Define requirements traceability conventions.
- Create initial reusable skills under `.claude/skills/`.
- Define engineering verification procedures.

**Acceptance Criteria:**
- [ ] Specification structure is documented.
- [ ] Initial engineering skills are available.
- [ ] Claude can locate relevant specifications and skills.
- [ ] Specification approval requirements are documented.

### M00-T04: Initialize Application Repository

**Status:** Complete

**Dependencies:** M00-T02, M00-T03

**Scope:**
- Preserve the existing repository and GPX source files.
- Establish approved application directories.
- Initialize frontend and backend applications.
- Configure dependency management.
- Configure linting, formatting, and type checking.
- Establish environment configuration conventions.

**Acceptance Criteria:**
- [x] Existing source data and documentation are preserved.
- [x] Application projects initialize successfully.
- [x] Development commands execute successfully.
- [x] Configuration contains no committed secrets.
- [x] Project setup is documented.

**Verification Results:**
- npm-workspaces React/TypeScript/Vite frontend and Express/TypeScript backend created per ADR-001/002/008; `npm install`, `npm run typecheck`, `npm run lint`, `npm run build` (both workspaces) all executed successfully.
- Prisma configured against PostgreSQL/PostGIS (ADR-003): verified against current Prisma 7 documentation that `datasource.url` in `schema.prisma` is unsupported (deprecated `postgresqlExtensions` preview feature avoided); `prisma.config.ts` plus the `@prisma/adapter-pg` driver adapter used instead (Prisma's current documented pattern). `prisma generate` executed successfully.
- Local PostgreSQL/PostGIS via `docker-compose.yml` (`postgis/postgis:17-3.5`), confirmed with Docker actually installed: container reaches `healthy`; `landmarks_dev` and `landmarks_test` both created and isolated (verified via `\l` and `\dt` — different extension footprints, not just different names); `PostGIS_Version()` and real spatial queries (`ST_Distance`, `ST_DWithin`) executed successfully in both databases.
- `GET /health`: verified 200 with Postgres reachable and 503 with it stopped (and recovered to 200 after restart), using the backend's real Prisma/adapter-pg connection, not a mock.
- Express routing order (ADR-008): verified directly — unknown `/api/*` (GET and POST) returns the JSON 404 envelope; SPA fallback serves built `index.html`; static assets served correctly.
- No secrets committed: `.env` confirmed gitignored (`git check-ignore`); only `.env.example` (placeholder values) is tracked.
- Setup documented in `README.md`'s Development Setup section.
- Existing `CLAUDE.md`, `docs/`, `specs/`, `.claude/skills/`, and all 8 GPX files confirmed untouched throughout.

### M00-T05: Establish Automated Quality Checks

**Status:** Complete (locally verified; GitHub Actions execution itself remains unverified — see Verification Results)

**Dependencies:** M00-T04

**Scope:**
- Configure initial testing frameworks.
- Establish continuous integration.
- Configure automated linting and type checking.
- Document development and verification commands.

**Acceptance Criteria:**
- [x] Automated checks execute successfully (locally; see Verification Results for what CI execution itself could not be confirmed).
- [x] CI runs the configured checks — workflow authored and reviewed; not yet executed by GitHub Actions (no git history or remote exists in this repository).
- [x] Verification commands are documented.

**Verification Results:**
- Vitest (unit, two workspaces), Supertest (API integration), React Testing Library, and Playwright (Chromium-only smoke, scope limitation recorded) configured per ADR-009 and the testing-and-verification skill.
- `npm audit` surfaced 6 real vulnerabilities (3 moderate, 1 high, 2 critical) in the initially-pinned `vitest@^2.1.8`'s transitive dependencies; verified current stable is `5.0.5` and upgraded to it rather than leaving a stale pin — re-audit showed 0 vulnerabilities.
- **`landmarks_test` safety guard** (`backend/tests/setup/test-db-guard.ts`): validates `DATABASE_URL_TEST` against an explicit host allow-list (`localhost`, `127.0.0.1`) and the exact required database name, then independently confirms via a live `SELECT current_database()` query before any destructive operation — never falls back to `DATABASE_URL`. Implemented via Vitest `setupFiles` rather than `globalSetup`, after confirming via Vitest's own documentation that `globalSetup`'s `process.env` changes are not guaranteed to propagate to test workers, while `setupFiles` runs in the same process before a test file's own imports evaluate. Proven with both a unit-test suite of negative cases (5/5 pass) and two live end-to-end negative runs: the real integration suite and the real Playwright config both refused to proceed when `DATABASE_URL_TEST` was deliberately pointed at `landmarks_dev`, with zero tests executed in either case.
- **Reset helper** (`backend/tests/setup/reset-test-database.ts`): truncates only application-owned tables in `public`, excluding any table with an extension dependency (`pg_depend`) — never PostGIS/tiger/topology tables — plus Prisma's migration-tracking table by name. With no application tables yet, verified it runs as a no-op.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` (both workspaces): all pass.
- `npm run test:unit`: 5 backend + 1 frontend test, all pass.
- `npm run test:integration`: 4 tests pass against `landmarks_test` (real Postgres/PostGIS, not mocked); `landmarks_dev`'s 37 tables confirmed unchanged afterward.
- `npm run test:e2e` (Playwright smoke): initially left an orphaned backend process after the run (`npm run start --workspace=backend` does not reliably forward termination signals to its child `node` process on Windows) — found and fixed by invoking `node backend/dist/server.js` directly in `webServer.command`; re-verified clean teardown (confirmed via `netstat`, no listener left on port 3000).
- **Not verified:** actual GitHub Actions execution. This repository has no commits and no GitHub remote (per your explicit instruction not to initialize git history or push this task). The workflow's steps were verified by running the equivalent commands locally against the same `postgis/postgis:17-3.5` image the workflow's service container uses; the workflow YAML itself has not been executed by GitHub Actions.
- No deployment step exists in the CI workflow; `npm audit` runs as a non-blocking, informational step per ADR-009.
- No development data, Docker volumes, or `landmarks_dev` content were altered at any point.

### M00-T06: Early Offline Map Provider Feasibility Check

**Status:** Complete. FR-14 (offline map downloads) is deferred and remains conditional/unresolved per the developer's explicit decision (2026-10-30), consistent with Specification 6 §9.7 and this document's own Milestone 06 infeasibility provision. Stadia Maps remains a research candidate only — not selected, not contacted. No provider will be contacted, no account created, and no licensing assumption made in place of explicit public-documentation confirmation; if that confirmation cannot be established from public sources, FR-14 stays deferred rather than being pursued further. FR-13 (offline landmark/trip snapshots) is unaffected and remains approved.

**Dependencies:** M00-T02

**Scope:**
- Evaluate at least two candidate tile providers against: licensing terms specific to client-side/offline caching in a web PWA; actual cost at this project's expected scale; permitted caching/download behavior (cache limits, TTLs, redistribution restrictions, rate limits); tile access mechanics (API key provisioning, URL template, zoom restrictions); and browser storage interaction (realistic IndexedDB quota and iOS Safari eviction behavior, per `docs/DECISIONS.md` ADR-007), to confirm whether a real bounded region (e.g., the area around a saved trip at hiking-relevant zoom levels) is storable within realistic device limits.
- Produce a concrete feasibility verdict: feasible, feasible with specific constraints, or not feasible within the targeted timeframe.
- Document the evidence and a recommended provider with its constraints. Do not select or commit to a provider, and do not amend ADR-004, within this task — present the recommendation and request developer approval as a separate, explicit step.
- If feasibility is uncertain or unfavorable, document the specific risk and explicitly request a developer decision immediately, rather than deferring it to Milestone 06.

**Acceptance Criteria:**
- [x] At least two providers are evaluated against licensing, cost, caching/download permissions, tile access mechanics, and browser storage interaction.
- [x] A concrete feasibility verdict is documented.
- [x] Evidence and a recommendation are documented without committing to a provider or amending ADR-004.
- [x] The risk is documented and developer decisions are explicitly requested (see below) before Milestone 01 proceeds substantially.

**Verification Results (2026-10-30):**
- **Scenarios evaluated** (tile counts computed via standard Web Mercator tile math against the real South Cumberland cluster — Grundy/Marion/Franklin counties — from the GPX dataset): Small (5-mi radius, z12–15) = 435 tiles, ~6.4–10.6 MB. Large (25-mi radius, z12–16) = 35,499 tiles, ~520–867 MB.
- **Stadia Maps** (ToS effective 2026-03-18, fetched 2026-10-30): ToS §8(4) explicitly permits "caching small amounts of data for offline use in a mobile application, not to exceed 100MB cached at a time per device." Unconfirmed whether "a mobile application" covers a web PWA. The 100MB cap fits the Small scenario comfortably but is exceeded 5–8× by the Large scenario. Free tier is non-commercial only; Starter tier is $20/month. A new ToS version takes effect 2026-11-09, not yet reviewed.
- **MapTiler** (fetched 2026-10-30): no affirmative offline-download permission found; Cloud Terms §6.3 explicitly prohibits "batch or excessive bulk download of map tiles" with no exception for this use case. Weaker candidate than Stadia Maps for this reason, independent of pricing.
- **Self-hosted Tennessee tiles**: legally the cleanest option (ODbL attribution/share-alike only), but assessed as not realistic to stand up (OSM extract, rendering pipeline, hosting) before the December 1 feature-complete target, given the remaining project workload.
- **Browser storage (cross-cutting)**: current iOS Safari figures are inconsistent even across secondary sources (no official current Apple number found) — roughly ~50MB non-installed, anecdotally "several hundred MB" for an installed PWA, with `QuotaExceededError` beyond that. Independently reinforces that the Small scenario is realistic and the Large scenario is not, regardless of provider.
- **Verdict: feasible with significant constraints**, resolved by the developer as **deferred**. The Small scenario (~5-mi radius, z12–15) was plausibly implementable on licensing/storage grounds; the Large scenario (25-mi radius, z12–16) was not, independent of provider choice. Stadia Maps' offline-caching clause was the stronger of the two candidates examined but only explicitly covers "a mobile application," not confirmed for a web PWA.
- **Developer decision (2026-10-30):** rather than contact Stadia Maps (or any provider) for clarification, or proceed on a licensing assumption, the developer chose to **defer FR-14** for this phase. No provider is selected; Stadia Maps remains a research candidate only. FR-13 is unaffected.

**Notes:**
- This task produced a recommendation only, per its original scope; the developer's deferral decision is recorded above. Any future reconsideration of FR-14 (including contacting a provider or selecting one) requires a new, separate, explicit developer decision, and any resulting amendment to ADR-004 requires its own approval.

---

## Milestone 01: Landmark Data Foundation

**Objective:** Establish reliable storage, validation, import, and retrieval of landmark information from the existing GPX datasets.

**Related Requirements:** FR-01, FR-02, FR-05, FR-06

### M01-T01: Analyze Landmark Dataset

**Status:** Complete

**Dependencies:** M00-T01

**Data Source:** `coordinates/*.gpx`

**Scope:**
- Inspect all eight GPX files in `coordinates/`.
- Identify GPX elements, coordinate formats, and metadata.
- Determine how landmark categories correspond to source files.
- Identify missing, duplicate, and invalid records.
- Evaluate whether additional landmark attributes are available.
- Document differences in structure between GPX files.
- Document data quality issues and import requirements.
- Preserve original source files.

**Acceptance Criteria:**
- [x] All eight GPX files have been inspected.
- [x] Available attributes and coordinate formats are documented.
- [x] Landmark categories are mapped to source files.
- [x] Data quality issues are identified.
- [x] Import requirements are approved (findings below; items genuinely requiring a decision are flagged explicitly, not assumed).
- [x] Original GPX files remain unchanged (SHA-256 checksums identical before and after inspection for all 8 files).

**Verification Results (2026-10-30):**

*Baseline re-confirmed (per-file waypoint counts, 1,693 total, 1,692 unique `<name>` codes, exactly one duplicate `MIF026`) — unchanged from ADR-005/`LANDMARK_DATA_IMPORT_SPEC.md`'s documented baseline. Category-to-file mapping cross-checked against the category letter embedded in every `<name>` code: **zero mismatches across all 1,693 records** — every single record's embedded category letter matches its source file.*

**§8.1 Source-code normalization — resolved.** All 1,693 `<name>` values match `[A-Z]{3}[0-9]{3}` exactly: zero lowercase, zero whitespace, zero other format. Simple case-sensitive exact match after trimming is sufficient; no additional normalization is needed.

**§8.2 County vs. raw description — resolved, with a finding requiring developer awareness.** `<desc>` is populated for all 1,693 records (87 distinct values). 1,690 of 1,693 (99.8%) are genuine Tennessee county names. **3 records (0.18%) are not**: two use `KY` (name codes `KYR001`/`KYR002`, i.e., the source data itself codes these as Kentucky, not Tennessee) and one uses `NC` (`CTF004`, "Elk/Big Falls," which keeps a Carter-County-style name prefix despite being located in North Carolina). **Finding, not a decision**: a strict "Tennessee county" foreign key/enum would fail for these 3 records; `desc` should be modeled as free-text with an allowed out-of-state/unknown case, not a rigid required TN-county reference. The actual column design remains M01-T02's decision.

**§8.3 Raw link/access metadata — resolved (descriptive data, not a decision item).** 1,290 of 1,693 records (76.2%) have a `<link>` element; of those, 867 (67.2%) have an empty `href` and 423 (32.8%) have a real URL. 86 distinct non-empty `<link><text>` values exist, dominated by land-manager/agency codes (`private` ×209, `BSF` ×185, `CNF` ×163, `GSMNP` ×112, `CT` ×82, `state park` ×66) alongside place/trail names and shorter codes. 139 `<text>` elements are present but empty (no label at all). This is real, varied free-text, not a small closed vocabulary, consistent with the spec's existing "unverified metadata" treatment — no further decision needed from this finding alone.

**§8.4 Tier-1 validation dry run — resolved.** Applying the approved validation rules (`LANDMARK_DATA_IMPORT_SPEC.md` §4.2/§6.2) against all 1,693 real records: **zero** would fail — no missing/empty names after trim, no malformed or non-finite coordinates, no globally-invalid WGS84 values. The entire dataset passes Tier-1 validation as currently specified.

**§8.5 Geographic warning envelope — resolved, envelope confirmed well-calibrated.** Checked all 1,693 coordinates against the proposed envelope (34.8–36.7°N, 90.3–81.6°W): **zero records fall outside it**, including the 3 out-of-state (KY/NC) records identified above — the envelope is generous enough to cover legitimate near-border landmarks without flagging them, while remaining a real bounding check. No adjustment to the proposed envelope is needed based on this dataset.

**Exploratory only — `<cmt>` embedded height/dimension patterns by category** (per explicit instruction: no parsing or schema decisions made here; for M01-T02 to use as input):
- **Always a trailing feet value** (`NNN'`): Balds (21/21, 100%), Peaks (13/13, 100%), Sinks (43/43, 100%) — single consistent pattern each.
- **Mostly trailing feet, some absent**: Falls (819/909, 90%), Rocks (38/60, 63%).
- **Mixed**: Arches — mostly `WxH` dimensions like `4x5` (309/369, 84%), a handful with trailing feet (13), the remainder (47) plain names with no measurement.
- **Never has an embedded measurement**: Lakes (258/258, 100% plain names), Other (20/20, 100% plain names).
- Records with "neither pattern" were sampled directly and are simply unmeasured features (e.g., "Calderwood Tunnel," "Rocky Branch Falls") — not a different, unhandled format requiring separate treatment.

**Related documents preserved**: all 8 GPX files' SHA-256 checksums were captured before and after this inspection and are byte-identical; no file was modified.

**Addendum (2026-11-02, recorded during M01-T05 planning housekeeping):** the SHA-256 values below were computed on 2026-11-02, more than two weeks after this task's own 2026-10-30 inspection. They are a **newly established baseline for future comparison**, not a reproduction of this task's original checksums, which were verified at the time but never persisted as literal values — a documentation gap noted here rather than silently filled in retroactively. All 8 files' filesystem `LastWriteTime` (2026-10-28) predates every repository action taken in the session that recorded this addendum, which is corroborating evidence of no intervening change, not a substitute for the missing original values.

| File | SHA-256 |
|---|---|
| `tnarches.gpx` | `CF0D5A7E7A375F2CCA6B98B98462BBF1C78C10CEF467D239CA04B8338BF2AA51` |
| `tnbalds.gpx` | `B264915249FB21FFC1748E3E8F773CAB38AF9303F5033746534DFE4D03FA1DBE` |
| `tnfalls.gpx` | `B0CD56EAAB4E83F5D39808A49825C268C9CBCBD498698F04495C2452B81C3FDF` |
| `tnlakes.gpx` | `6516EEEA680AB56A5EFD97CC2FDDDA7A14FED875C6AACD142036F5B75AB63697` |
| `tnother.gpx` | `A6C43595095E9604025A938768AE2511189E67FABFD8BCDA6E1645BAEB1C381F` |
| `tnpeaks.gpx` | `DC124ED842A8C1029446036E27B44C32FB564AA218FE83CC8504D18B22B38ECC` |
| `tnrocks.gpx` | `E0F82711EEF5AA49105702507FB0F37E8B2349B56EA9A700DE45B94F24D9F3EE` |
| `tnsinks.gpx` | `407757A478E71EB6A359F49F39EB915CCE254F7745DCEFF4178A8ADE77FD45C2` |

**Items requiring a developer decision**: none from this task's own findings — every §8 item above was resolved by evidence. The §8.2 finding (3 non-TN-county records) is flagged for M01-T02's data-model design to account for, not a decision this task makes itself.

### M01-T02: Design Landmark Data Model

**Status:** Complete

**Dependencies:** M00-T02, M01-T01

**Scope:**
- Define landmark entities and attributes.
- Establish required and optional fields.
- Define geographic data representation.
- Establish validation rules, constraints, and indexes.
- Support the eight initial landmark categories.
- Determine how source-file information will be preserved.
- Consider missing or unverified access information.
- Define a surrogate internal primary key, independent of any source identifier (per `docs/DECISIONS.md` ADR-005).
- Define a unique `source_code` column for the GPX `<name>` identifier, plus a `source_file` field for traceability (per ADR-005).
- Define the inactive/retired-landmark mechanism used when a previously-imported record's source code is absent from a re-import (per ADR-005).

**Acceptance Criteria:**
- [x] Landmark data model is approved.
- [x] Geographic representation is documented.
- [x] All initial landmark categories are supported.
- [x] Validation rules and constraints are defined.
- [x] Source data traceability is addressed.
- [x] The surrogate primary key, `source_code` uniqueness, and inactive/retired mechanism are defined, per ADR-005.

**Verification Results (2026-10-30):**

Design approved by the developer across two planning rounds (an initial proposal and a revision addressing three requested refinements).

**Approved fields:** `id` (UUID, database-generated via `gen_random_uuid()`, chosen over an autoincrement integer specifically to resist ID enumeration given the unresolved sensitive-location classification policy); `sourceCode` (`String`, unique, `CHECK`-constrained to `^[A-Z]{3}[0-9]{3}$`, matching the pattern M01-T01 verified with zero exceptions across all 1,693 records); `sourceFile` (Postgres enum, 8 values); `category` (Postgres enum, 8 values, derived from `sourceFile`); `displayName`; `latitude`/`longitude` (`Float`, `CHECK`-constrained to `-90..90`/`-180..180`, remain ordinary Prisma-readable numeric columns); `location` (database-generated `geography(Point,4326)` column derived from `latitude`/`longitude` — see Outstanding Items below); `sourceDescription` (optional, unconstrained free text — deliberately **not** modeled as a Tennessee county field, to avoid misrepresenting the 3 out-of-state records `KYR001`/`KYR002`/`CTF004` identified in M01-T01); `sourceAccessLabel`; `sourceUrl`; `isActive` (`Boolean`, default `true`); `sensitivityStatus` (enum `UNREVIEWED`/`PUBLIC`/`SENSITIVE`, default `UNREVIEWED`); `createdAt`/`updatedAt`.

**Geographic representation:** PostGIS `geography(Point,4326)`, SRID 4326, longitude-first/latitude-second ordering; a GiST spatial index is planned for M01-T03. `latitude`/`longitude` are kept consistent with `location` via a database-generated (`GENERATED ALWAYS AS ... STORED`) column rather than application code or a trigger, so the two representations cannot diverge.

**Categories:** all eight approved categories represented as a Postgres enum, consistent with M01-T01's verified zero-mismatch category/source-file mapping.

**Validation and constraints:** Zod validation at import time (per ADR-005 and the approved import spec) plus database-level `CHECK` constraints for latitude/longitude range and source-code format, as an explicit defense-in-depth addition.

**Source traceability:** `sourceFile`, `sourceDescription`, `sourceAccessLabel`, and `sourceUrl` preserve raw GPX-derived metadata as explicit typed columns, consistent with ADR-005's explicit-typed-mapping rationale; no catch-all JSON blob was introduced.

**Surrogate key, uniqueness, and retirement:** UUID primary key; `source_code` unique and format-constrained; `isActive` boolean distinguishes active/retired landmarks, compatible with ADR-005's upsert-by-`source_code`, never-delete-and-recreate import behavior.

**Sensitive-location safety:** `sensitivityStatus` replaces an earlier `isSensitive` boolean design and defaults to `UNREVIEWED` for every imported record, specifically because a boolean defaulting to "not sensitive" could not distinguish "reviewed and confirmed safe" from "never reviewed" — which would have misrepresented all 1,693 imported records as confirmed-safe. Future public-facing code (M01-T05 onward) must treat `UNREVIEWED` identically to `SENSITIVE` for location and sensitive-metadata redaction, while preserving permitted non-location discovery behavior (e.g., display name and category in text search) — default-deny, not default-allow. The classification criteria and the initial dataset review remain unresolved and release-blocking, unchanged from the existing cross-specification note in `specs/README.md`; this task does not resolve that policy.

**Outstanding before M01-T03 implementation:**
1. Verify against the real PostgreSQL/PostGIS 17-3.5 instance whether the `::geography` cast is accepted inside a `GENERATED ALWAYS AS ... STORED` expression, and whether Prisma's migration-drift detection handles a generated `Unsupported`-typed column correctly across repeated `prisma migrate dev` runs. Per the developer's explicit instruction, if verification fails, implementation must stop and request approval with findings and alternatives — not substitute `geometry` or a trigger automatically.

**Terminology reconciliation — resolved (2026-10-30):** The literal field name `is_sensitive` previously appeared in 10 locations across `specs/TRIP_PLANNING_SPEC.md`, `specs/DEPLOYMENT_TESTING_RELEASE_SPEC.md`, and `specs/RATINGS_REVIEWS_SPEC.md`, plus one in `.claude/skills/postgres-prisma/SKILL.md` — more than originally identified; a complete grep-verified pass found all occurrences before editing. All 11 were updated to `sensitivity_status` (`UNREVIEWED`/`PUBLIC`/`SENSITIVE`), approved by the developer, preserving: the distinction between `UNREVIEWED` and `SENSITIVE` as separate classification states while requiring identical location/sensitive-metadata redaction for both; that GPX re-imports preserve all three states without resetting any of them; and that no classification policy or initial dataset review is approved by this terminology change — both remain unresolved and release-blocking, per `specs/README.md`.

**Notes:**
- No migration exists yet. M01-T03 (Implement Database Schema) remains Proposed and requires separate explicit implementation approval before any migration is created.

### M01-T03: Implement Database Schema

**Status:** Complete

**Dependencies:** M00-T04, M01-T02

**Scope:**
- Create landmark database tables.
- Establish required constraints and indexes.
- Implement database migrations.
- Create database tests.

**Acceptance Criteria:**
- [x] Database migrations execute successfully.
- [x] Schema constraints are verified.
- [x] Database tests pass.

**Verification Results (2026-10-30):**

**Geography-expression verification (performed before any migration was created, per the developer's explicit instruction):** the proposed `GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED` expression was tested in two separate rollback-only transactions against the real `landmarks_test` database (PostGIS 17-3.5), using temporary tables — no schema or data changes were committed. Results: the `::geography` cast is accepted by PostgreSQL inside a generated-column expression; the computed value matches expected WKT with correct longitude-first/latitude-second ordering and SRID 4326; the column recomputes correctly after an `UPDATE` to latitude/longitude; `ST_DWithin` against the generated column returns correct true/false results at different distance thresholds; and PostgreSQL itself rejects any direct `INSERT`/`UPDATE` naming the generated column with a non-DEFAULT value ("cannot insert a non-DEFAULT value into column \"location\" ... generated column"). The expression passed; no fallback to `geometry` or a trigger was needed.

**Schema and migration:** `backend/prisma/schema.prisma` now defines `Landmark` with the approved fields (UUID primary key via `gen_random_uuid()`; `LandmarkCategory`/`LandmarkSourceFile`/`SensitivityReviewStatus` Postgres enums; `sourceCode` unique). Migration `backend/prisma/migrations/20261030181539_init_landmark/` was generated via `prisma migrate dev --create-only` (reviewed before any application) and hand-edited to add: `CREATE EXTENSION IF NOT EXISTS postgis;` before the first `geography` reference; the generated `location` column; three `CHECK` constraints (`latitude_range_check`, `longitude_range_check`, `source_code_format_check` matching `^[A-Z]{3}[0-9]{3}$`); a `GIST` index on `location`; and a partial index on `category WHERE is_active = true`. Applied via `prisma migrate deploy` (not `migrate dev`, to avoid its shadow-database diff logic) to `landmarks_test` first, then to `landmarks_dev`. Confirmed via direct inspection (`\d+ landmarks`, `pg_indexes`/`pg_index`, `pg_constraint`) that all columns, four indexes (all `indisvalid = true`), and three `CHECK` constraints exist exactly as intended in both databases. Confirmed `landmarks_dev` gained only the `landmarks` table and Prisma's `_prisma_migrations` tracking table — no existing data, tables, or Docker volumes were altered or reset.

**Prisma Client bug found and fixed:** the first version of the schema (required `Unsupported` column, no Prisma-visible default) made the Prisma query engine refuse to build *any* `create()` or `update()` for the `Landmark` model at all ("Operation 'createOne' for model 'Landmark' does not match any query") — not a data-validation failure, a hard block affecting every row regardless of validity. This surfaced as 3 of the first 10 integration test runs being false-positive passes (`.rejects.toThrow()` matched the engine error, not the intended `CHECK` constraint violation). Fixed by marking the field `Unsupported("geography(Point,4326)")? @default(dbgenerated())` in `schema.prisma` — a client-type-level annotation only; the real database column is unchanged and still `NOT NULL GENERATED ALWAYS ... STORED`. After the fix, all 10 tests pass for their actual, intended reasons (re-verified individually, not just by suite-level pass count).

**Database tests:** `backend/tests/landmark-schema.integration.test.ts` (new, following the existing `*.integration.test.ts` convention and `tests/setup/` safety guard — no changes were needed to `test-db-guard.ts` or `reset-test-database.ts`, which already discover application tables generically via `pg_catalog` rather than a hardcoded list). 10 tests, all passing against real PostGIS in `landmarks_test`: generated-column computation and post-update consistency, rejection of direct writes to `location`, both `CHECK` constraints, `source_code` uniqueness, `sensitivityStatus`/`isActive` defaults, GiST index validity (`indisvalid`, not planner selection — per the developer's instruction not to require index selection on a tiny dataset), `ST_DWithin` proximity correctness, and `ST_MakeEnvelope` bounding-box correctness. Full existing suites re-run with no regressions: `tsc --noEmit` (0 errors), `eslint .` (0 errors), full integration suite (3 files, 14 tests, all pass), full unit suite (5 tests, all pass).

**Resolved — Prisma migration workflow (2026-10-30):** running `prisma migrate dev --create-only` a second time, with no further schema changes, against the now-applied migration proposed `DROP INDEX "landmarks_location_gist_idx"` and an `ALTER TABLE` on `location` (observed as both `ALTER COLUMN "location" DROP DEFAULT` and, after the Prisma Client fix above, `ALTER COLUMN "location" DROP NOT NULL`) — Prisma's shadow-database diffing failing to correctly understand a hand-written `GENERATED ALWAYS AS ... STORED` column combined with a hand-written index on an `Unsupported`-typed field, not evidence that the actual schema is wrong (directly confirmed correct above). Neither proposed migration was applied; both were generated into throwaway migration folders for inspection and deleted without ever being applied to any database. The developer approved a standing project migration workflow to contain this, recorded as **ADR-010** in `docs/DECISIONS.md` and as an operational guardrail in `.claude/skills/postgres-prisma/SKILL.md`: apply migrations only via `prisma migrate deploy`; never `prisma migrate dev`; author future migrations from reviewed diff output or hand-authored SQL; never auto-accept a change touching `location` or its index; verify against `landmarks_test` before `landmarks_dev`; never reset a database or discard data to resolve apparent drift; stop and request approval if a migration cannot be applied safely.

### M01-T04: Implement GPX Data Import

**Status:** Complete — implemented, verified, and reviewed by the developer. The initial import of the real dataset into `landmarks_dev` is a separate, not-yet-authorized operation (see M01-T04's "Not done in this task, by design" note and the planning proposal below M01-T05).

**Dependencies:** M01-T03

**Data Source:** `coordinates/*.gpx`

**Scope:**
- Implement a repeatable GPX import process.
- Parse supported GPX elements and metadata.
- Map records to the approved landmark data model.
- Assign landmark categories using the approved mapping.
- Validate coordinates and required attributes.
- Handle duplicate and malformed records.
- Report import results and failures.
- Preserve the original GPX files.
- Implement the three-tier failure handling defined in ADR-005 (invalid records; database/transaction failures; unexpected large-scale dataset change requiring developer approval).
- Implement upsert-by-`source_code` behavior; never delete and recreate landmark records (per ADR-005).

**Acceptance Criteria:**
- [x] Valid records from all eight GPX files import successfully.
- [x] Imported landmarks retain the correct categories.
- [x] Invalid records are handled predictably.
- [x] Repeated imports do not create unintended duplicates.
- [x] Import results and failures are reported.
- [x] Original GPX files remain unchanged.
- [x] Import tests pass.
- [x] The three-tier failure handling and upsert-not-delete-recreate behavior from ADR-005 are implemented and tested.

**Verification Results (2026-10-30):**

**Architecture:** standalone CLI (`backend/src/import/cli.ts`, run via `npm run import:gpx`), never an HTTP endpoint, per ADR-005. New dependencies `fast-xml-parser@5.11.2` and `zod@4.6.7` (upgraded from the initially-resolved `zod@^3`, which `npm audit` flagged as high-severity — GHSA-mrhx-c7xc-m3w5 — re-audited clean at `zod@4.6.7`, 0 vulnerabilities). Modules (15 files under `backend/src/import/`): `source-files.ts` (expected filename/category map), `types.ts` (shared types), `gpx-parser.ts` (well-formedness via `XMLValidator`, then `XMLParser`), `validation.ts`, `landmark-mapper.ts`, `duplicates.ts`, `parse-dataset.ts` (orchestrates all 8 files), `fingerprint.ts`, `db-baseline.ts`, `preflight.ts` (diff + thresholds + fingerprints), `preview-file.ts`, `errors.ts`, `apply.ts` (lock + reconciliation + transaction), `preview.ts`, `cli.ts`.

**Real-dataset verification (read-only preflight against the actual `coordinates/*.gpx` and `landmarks_dev`):** reproduced M01-T01's verified baseline exactly — 1,693 total waypoint occurrences, 1 exact duplicate (`MIF026`), 1,692 accepted unique records, 0 rejected records, 0 geographic-envelope warnings. The three out-of-state records (`KYR001`, `KYR002`, `CTF004`) import correctly with `sourceDescription` set verbatim to `KY`/`KY`/`NC`, with no county semantics applied. Because `landmarks_dev` has zero active landmarks, all 1,692 would be insertions, which correctly triggered the zero-baseline insertion approval gate (decision 1). **No `--apply` was run against `landmarks_dev`** — only the read-only preflight — since actually populating the real development database is a deliberate action left for the developer to run when ready, not implied by "implement and verify the tool." SHA-256 of all 8 GPX files confirmed byte-identical before and after this run, and `landmarks_dev` confirmed to still have zero rows and no table changes afterward.

**Decision 3 (import completeness):** implemented exactly as approved — all 8 expected filenames present, readable, and structurally well-formed (validated via `XMLValidator.validate` before parsing); any missing/unreadable/malformed file makes the whole run partial (no retirements at all), independent of any file's individual record-level rejections.

**Requirement 5 (retirement protection), implemented as a three-way classification:** (1) a record with a missing or format-invalid `<name>` is "unidentifiable" and disables retirement for its entire source file this run, since its true identity can't be trusted; (2) a record with a valid-format source code that fails any other Tier-1 rule (e.g., invalid coordinates) is "invalid" and protects only that specific source code from retirement, without affecting the rest of its file; (3) a source code with conflicting attributes across occurrences is excluded from every write (insert/update/reactivate) and also protected from retirement. All three paths are covered by integration tests against real PostGIS, each individually verified by a negative control (temporarily disabling the corresponding code path and confirming the test fails) — not just a single affirmative pass.

**Requirement 4 (preview/apply consistency), implemented via dual fingerprints bound into one hash:** `gpxFingerprint` (canonical hash of every accepted/rejected record and per-file status) and `dbBaselineFingerprint` (canonical hash of every current landmark's source code, active state, and coordinates), combined with the required-approval set into one `previewHash`. `applyImport` always re-parses the GPX files and recomputes the diff fresh inside the transaction — it never trusts the preview file's own stored numbers for the actual write set, only for the staleness comparison. A mismatch in either fingerprint (confirmed independently by two integration tests, each verified via negative control) aborts with no writes.

**Requirement 7 (global transaction):** the entire accepted write set applies inside one `prisma.$transaction` callback. Verified with a dedicated test that performs one successful insert and then deliberately violates the `latitude_range_check` CHECK constraint via raw SQL mid-transaction (a genuine Tier-2 database failure, not an app-level validation gap) — confirmed the first insert does not survive the rollback.

**Requirement 8 (default preview-only CLI):** `npm run import:gpx` with no flags only ever reads from the database and writes a preview JSON artifact to `backend/import-previews/` (gitignored); `--apply --preview=<path>` is required to write, and is refused (`MissingApprovalError`) unless every threshold category the freshly recomputed diff actually requires has its matching `--approve-*` flag — verified by a test expecting zero rows written when approval is withheld.

**Concurrency protection (fail-fast, per decision 2):** `SELECT pg_try_advisory_xact_lock(...)` as the first statement inside the apply transaction. Verified with a test that holds the same advisory lock open on a separate real connection and confirms a concurrent `applyImport` call fails immediately with `ConcurrentImportError` rather than blocking — also confirmed via negative control that without this check, the concurrent write would have proceeded.

**Sensitivity-classification preservation (requirement 6):** inserts never set `sensitivityStatus` (schema default `UNREVIEWED` applies); updates and reactivations never include `sensitivityStatus` in their `SET`/`data` payload. Verified directly: a landmark manually set to `SENSITIVE` remains `SENSITIVE` after being updated by a re-import in the same test.

**Tests:** `backend/tests/gpx-import.test.ts` (20 unit tests including the real-dataset reproduction above, no database) and `backend/tests/gpx-import.integration.test.ts` (10 tests against real `landmarks_test`, using the existing `*.integration.test.ts` convention and `tests/setup/` safety guard unchanged) — covering requirements 9's full list: stale previews (both GPX-changed and DB-changed), malformed/unidentifiable source codes, duplicate conflicts, retirement protection (both the per-file-disable and per-code-protect paths), transaction rollback, and concurrent apply attempts.

**Full regression check:** `tsc --noEmit` (0 errors), `eslint .` (0 errors), `tsc -p tsconfig.json` build (success), full unit suite (20 tests, all pass), full integration suite (4 files, 24 tests, all pass — including the pre-existing health/routing/landmark-schema suites, confirming no regression).

**Not done in this task, by design:** M01-T05 (retrieval API) was not started; no sensitive-location classification policy or criteria were invented; no services were provisioned; the real `landmarks_dev` database was not populated (preview-only verification against it, as above).

### M01-T05: Implement Landmark Retrieval API

**Status:** Complete — implemented, verified, and reviewed by the developer.

**Dependencies:** M01-T03, M01-T04

**Scope:**
- Define landmark retrieval contracts.
- Implement landmark collection retrieval.
- Implement individual landmark retrieval.
- Return approved landmark categories and geographic data.
- Provide consistent error responses.
- Document and test API behavior.
- Implement centralized sensitivity redaction, including a minimal redacted profile for active non-public landmarks (per the `specs/LANDMARK_DISCOVERY_SPEC.md` §9.4a amendment approved during this task's planning).

**Acceptance Criteria:**
- [x] Landmark retrieval endpoints function correctly.
- [x] Imported landmark categories are represented accurately.
- [x] Invalid requests return appropriate errors.
- [x] API tests pass.
- [x] Geographic discovery (`bbox`/`near`) is restricted to active, `PUBLIC` landmarks only.
- [x] Active `UNREVIEWED`/`SENSITIVE` landmarks return the exact §9.4a allowlist on detail; unknown/retired landmarks return the identical generic `404`.
- [x] Plain name/category search surfaces `UNREVIEWED`/`SENSITIVE` landmarks by name/category only, with no coordinates or distance.
- [x] Literal `%`, `_`, and `\` in search input are escaped and matched literally.
- [x] Pagination, `has_more`, and `is_truncated` are correct at the 199/200/201 boundary, for both plain and geographic filters, via one shared WHERE-clause builder.

**Specification amendment (2026-11-02):** `specs/LANDMARK_DISCOVERY_SPEC.md` was amended with developer approval before implementation — added §9.4a ("Minimal Redacted Profile for Active Non-Public Landmarks"), and updated §6, §7.3, §9.5, §10 (AC#12 reworded, AC#25 added), and §11 for internal consistency. The amendment establishes redaction *mechanics* only (the exact allowlist: `id`, `display_name`, `category`, `redacted: true`); the underlying sensitive-location classification criteria and initial dataset review remain unresolved and release-blocking, unchanged by this amendment (§9.5). Full diff reasoning (the exact conflicting provisions identified and the smallest-amendment rationale) is preserved in this conversation's record; see the spec file itself for the applied text.

**Verification Results (2026-11-02):**

**Architecture:** new `backend/src/landmarks/` module — `categories.ts` (the 8 approved slug/label/enum mappings), `like-escape.ts` (ILIKE metacharacter escaping), `query-schema.ts` (hand-written query validation, consistent with the existing precedent in `src/import/validation.ts` rather than Zod chains — a deliberate, documented deviation from the `fullstack-typescript` skill's general Zod guidance, made for simplicity and direct testability), `repository.ts` (all raw, parameterized PostGIS SQL, per ADR-003), `redaction.ts` (the single centralized redaction function for both endpoints), `service.ts`, `router.ts`; plus `backend/src/http/error-envelope.ts` (new shared helper). Mounted into the previously-empty `apiRouter` (`backend/src/routes/index.ts`) — the only existing file touched besides the two documents above.

**Geographic discovery restriction:** `bbox`/`near` queries filter `sensitivity_status = 'PUBLIC'` directly in the SQL `WHERE` clause (not only at response-shaping time), because a bbox match or a `distance_miles` value is itself location information. Verified by a negative-control test: temporarily disabling this filter line made the "excludes a SENSITIVE landmark from bbox results" test fail exactly as expected (a `SENSITIVE` landmark inside the box appeared in results), then the fix was restored and re-verified passing.

**Literal `%`/`_`/`\` escaping:** `escapeLikePattern` escapes backslash first, then `%` and `_`, paired with an explicit `ESCAPE '\'` clause. Verified by a negative-control test: temporarily removing the escaping call made the "escapes literal %, _, and backslash" test fail exactly as expected (an unrelated record was over-matched via the unescaped wildcard), then the fix was restored and re-verified passing.

**Minimal redacted profile (§9.4a) and generic 404 equivalence:** detail-endpoint integration tests assert the exact key set (`Object.keys(...).sort()`) for active `UNREVIEWED`/`SENSITIVE` landmarks — `category`, `display_name`, `id`, `redacted` and nothing else — and assert byte-for-byte identical `404` bodies (`{ error: { code: "NOT_FOUND", message: "Resource not found." } }`) across an unknown UUID, a malformed (non-UUID) ID, a retired `PUBLIC` landmark, and a retired `SENSITIVE` landmark, with an explicit check that none of those four responses contains the real landmarks' display names anywhere in the serialized body.

**Pagination/`is_truncated` boundaries:** tested at exactly 199/200/201 matching rows for both a plain name search and a `bbox` filter (using the identical shared `buildWhereFragments`/`buildOrderBy` functions for both the page query and the bounded-count subquery, by construction — not by convention), plus a 120-row, 3-page cross-page consistency test confirming no overlap/gaps and that concatenated page order matches a single full-limit fetch.

**Tests:** `backend/tests/landmarks.test.ts` (26 new unit tests: categories, like-escape including the escape-ordering edge case, full query-validation coverage, and `toCollectionItem`/`toDetailResult` redaction behavior for every `sensitivityStatus`/`isActive` combination) and `backend/tests/landmarks.integration.test.ts` (18 new tests against real `landmarks_test`, covering every item above plus the `/categories` endpoint and 400 `INVALID_QUERY` responses for an unknown parameter, a malformed/antimeridian-crossing `bbox`, and a `near`+`bbox` conflict).

**Full regression check (2026-11-02):** `tsc --noEmit` (0 errors), `eslint .` (0 errors), `tsc -p tsconfig.json` build (success), full unit suite (3 files, 46 tests, all pass: 15 pre-existing GPX-import tests + 5 pre-existing test-db-guard tests + 26 new landmark tests), full integration suite (5 files, 42 tests, all pass: 24 pre-existing — GPX import, landmark schema, health, routing — + 18 new landmark-API tests), confirming no regression.

**Not done in this task, by design:** M01-T05's own detail-endpoint tests confirm the redaction mechanics, but no landmark's `sensitivityStatus` was changed and no classification policy was invented (all 1,692 imported landmarks remain `UNREVIEWED`); M02 (frontend/map/discovery UI) was not started; the database schema was not modified (no new migration); no new GPX import was run.

**Known, already-flagged consequence for manual testing:** because every real landmark is currently `UNREVIEWED`, hitting `GET /api/v1/landmarks` against `landmarks_dev` today returns names/categories only (no coordinates), `bbox`/`near` queries return empty result sets, and every real landmark's detail route returns the minimal redacted profile rather than a full one — this is the correct, intended behavior given the still-unresolved classification policy, not a bug.

---

## Milestone 02: Landmark Discovery

**Objective:** Allow users to explore and inspect landmarks through an interactive map and searchable interface.

**Related Requirements:** FR-01 through FR-06

### M02-T01: Establish Frontend Application Shell

**Status:** Complete — implemented, verified, and reviewed by the developer.

**Dependencies:** M00-T04

**Scope:**
- Create the primary application layout.
- Establish navigation.
- Implement responsive page structure.
- Define reusable interface conventions.
- Establish client-side routing (`react-router` v7) and a centralized, typed API client, demonstrated end-to-end against the real `GET /api/v1/categories` endpoint.

**Acceptance Criteria:**
- [x] App renders a persistent layout (header/nav/main landmarks) with semantic HTML and a working skip-to-content link.
- [x] Client-side routing exists for `/` (Discovery) and `/landmarks/:id` (Landmark Profile); direct navigation to either route works with no prior client-side navigation.
- [x] Layout is usable at mobile and desktop widths with no horizontal overflow.
- [x] A typed, centralized API client exists, matching the backend's actual implemented response/error contracts, with one working end-to-end call (`GET /api/v1/categories`) proving the fetch → parse → render → loading/error/empty pipeline.
- [x] Shared `LoadingState`/`ErrorState`/`EmptyState` components exist and are exercised by the categories example.
- [x] Unit/component tests cover the layout, routing, shared states, API client, and the categories example's loading/success/empty/error paths.
- [x] `tsc -b`, `eslint .`, `vitest run`, and `vite build` are clean for `frontend/`.

**Verification Results (2026-11-02):**

**Architecture:** `frontend/src/layout/AppLayout.tsx` (+ `AppLayout.module.css`) — header/nav/main landmarks, skip-to-content link, route `<Outlet/>`; `frontend/src/routes/{DiscoveryPage,LandmarkProfilePage,CategoriesPreview}.tsx`; `frontend/src/components/{LoadingState,ErrorState,EmptyState}.tsx`; `frontend/src/api/{client,types,categories}.ts`; `frontend/src/styles/global.css` (reset/typography/focus, not a CSS Module — truly global by design). `App.tsx` now defines the two routes inside the layout; `main.tsx` wraps `App` in `BrowserRouter` and imports the global stylesheet. New dependency: `react-router@^7.18.5` (peer requirement `react>=18`, confirmed compatible with the installed `react@19`, and installed with 0 audit vulnerabilities).

**`CategoriesPreview` is explicitly temporary**, commented as such in its own file and in `DiscoveryPage.tsx`, to be replaced by the real category-filtering UI in M02-T06, which will reuse the same `getCategories()` client function.

**API client contracts:** `frontend/src/api/types.ts` mirrors the backend's actual implemented M01-T05 shapes — `LandmarkCollectionItem`/`LandmarkCollectionResponse`, `LandmarkFullProfile`, `LandmarkMinimalProfile` (the exact §9.4a allowlist, including the `redacted: true` discriminant and an `isMinimalProfile` type guard), `Category`, `ApiErrorBody` — not invented independently of the backend. `client.ts` centralizes `fetch`, JSON parsing, and error-envelope mapping into a single `ApiError` (`status`/`code`/`message`), covering a successful response, a backend error envelope, a malformed error body (safe fallback code), a network failure, and a non-JSON response body.

**Test-infrastructure fix (in scope — needed for this task's own tests to pass correctly):** discovered that `vitest.config.ts` doesn't set `test.globals: true`, so React Testing Library's automatic per-test `cleanup()` never registered, causing DOM nodes to accumulate across `it` blocks within the same test file and producing "multiple elements found" failures as soon as a file had more than one `render()` call (the pre-existing single-test `App.test.tsx` never exercised this). Fixed by adding an explicit `afterEach(cleanup)` to `frontend/src/test/setup.ts` — the documented approach for Vitest without `globals: true`. This also protects every future frontend test file, not only this task's.

**Tests:** `App.test.tsx` (rewritten — layout landmarks/skip link at `/`, direct-navigation to `/landmarks/:id` with the shell still present), `components/SharedStates.test.tsx` (Loading/Error/Empty, including the retry-button present/absent cases), `api/client.test.ts` (5 cases covering the client behaviors above), `routes/CategoriesPreview.test.tsx` (loading → success, error, and empty states, with `getCategories` mocked — real-network calls are a backend integration-test concern, not a frontend unit-test one, per ADR-009). 16 tests total, all pass.

**Full regression check (2026-11-02):** `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (4 files, 16 tests, all pass), `vite build` (succeeds: `dist/index.html`, one CSS and one JS bundle). Re-ran the pre-existing backend `routing.integration.test.ts` (which reads `frontend/dist/index.html`) against the newly rebuilt output — still passes, no regression.

**Read-only smoke check against the running dev backend:** started `backend`'s existing dev server (`tsx --env-file=.env src/server.ts`) against `landmarks_dev`, confirmed `GET /health` → `200 {"status":"ok"}` and `GET /api/v1/categories` → `200` with the same 8 slugs/labels the frontend types expect, then stopped the process (confirmed via the port no longer accepting connections). No data or configuration was changed — both requests are read-only (`GET /categories` serves a static list; `/health` runs `SELECT 1`).

**Not done in this task, by design:** no Leaflet/map, no real landmark markers or profile content, no search/category/geographic filtering logic, no PWA/service worker, no backend or database changes, no other M02 task started.

### M02-T02: Implement Interactive Map

**Status:** Complete — implemented, verified, and reviewed by the developer. One follow-up item remains open (see below).

**Dependencies:** M00-T02, M02-T01

**Scope:**
- Integrate the approved mapping library.
- Display the initial map.
- Support zooming and panning.
- Handle map loading and failure states.
- Use a general-purpose online tile source for initial development and demonstration; the final offline-capable tile provider is a separate decision addressed by M00-T06 and M06-T01 (per ADR-004).

**Acceptance Criteria:**
- [x] `DiscoveryPage` renders a Leaflet map (react-leaflet) centered and fit to a Tennessee-wide extent.
- [x] Pan (mouse drag, verified) and zoom (control buttons, verified) work; Leaflet's `keyboard` option is left enabled in code (confirmed never set to `false`), but interactive keyboard pan/zoom is an open follow-up item — see Verification Results and the Follow-Up Items note below.
- [x] The map has an accessible name identifying it as the Tennessee landmarks map.
- [x] A tile-load failure is detected and surfaced without breaking the rest of the page.
- [x] Layout remains responsive (no horizontal overflow) at mobile and desktop widths, verified in a real browser.
- [x] Unit/component tests cover map configuration, the accessible name, and the tile-error fallback.
- [x] `tsc -b`, `eslint .`, `vitest run`, `vite build` clean for `frontend/`.

**Verification Results (2026-11-02):**

**Architecture:** `frontend/src/map/{tile-config,useTileLoadStatus,LandmarkMap}.ts(x)` + `LandmarkMap.module.css`. `DiscoveryPage.tsx` renders `<LandmarkMap/>` above the existing (still temporary) `<CategoriesPreview/>`. New dependencies: `react-leaflet@5.0.0` (published peer requirement `react@^19.0.0`/`leaflet@^1.9.0`, an exact match to the installed `react@19.0.0`), `leaflet@1.9.4`, `@types/leaflet` (dev) — installed with 0 audit vulnerabilities.

**Bounds/tile config:** `TENNESSEE_BOUNDS` (34.8–36.7°N, -90.3 to -81.6°W) is defined directly in `frontend/src/map/tile-config.ts`, with a comment documenting it mirrors `backend/src/import/validation.ts`'s `TN_WARNING_ENVELOPE` — duplicated, not imported, per the approved refinement (frontend/backend are separate workspaces). Passed to `MapContainer`'s `bounds` prop, which calls Leaflet's `fitBounds` once at creation — not a hard restriction; panning outside Tennessee remains possible (confirmed by panning the map past its initial extent in the browser check below). `scrollWheelZoom={false}`; pinch-zoom, zoom buttons, and Leaflet's native `keyboard` option are all left at their defaults (enabled). The temporary tile URL/attribution constants are isolated in `tile-config.ts` and explicitly commented as temporary/dev-only, cross-referenced to ADR-004's implementation note (added to `docs/DECISIONS.md` alongside this task) recording that the production tile-provider decision remains open.

**Accessibility:** the map wrapper uses `role="region"` with `aria-label="Map of Tennessee natural landmarks"` — a labeled landmark, not `role="application"` (which was deliberately avoided, per your refinement, since it would remove the map from normal document/assistive-technology navigation semantics). Leaflet's native keyboard pan/zoom option was not disabled. Full marker/popup keyboard operability and the formal WCAG 2.2 AA review remain M02-T08's responsibility, per the already-agreed division.

**Tile-failure handling:** `useTileLoadStatus`/`createTileErrorTracker` require 3 tile errors within a 5-second window before flipping `degraded` to `true` (and it never resets once set), avoiding a false positive from a single dropped edge tile and avoiding repeated announcements. The fallback message uses `role="status"` (polite), not `role="alert"`, since a few missing tiles is a nonblocking, low-urgency condition, not a hard failure — the map stays mounted and usable.

**Tests:** `map/useTileLoadStatus.test.ts` (7 tests: the pure tracker's threshold/window logic, and the hook's degraded transition) and `map/LandmarkMap.test.tsx` (3 tests, mocking `react-leaflet`'s `MapContainer`/`TileLayer` — real Leaflet needs actual DOM layout jsdom doesn't provide: asserts the bounds/scrollWheelZoom/tile URL/attribution passed to the mocked components, the accessible region name with no `application` role present, and that the status message appears only after 3 simulated tile errors and is never an `alert`). 23 tests total across the frontend suite, all pass.

**Full regression check (2026-11-02):** `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (6 files, 23 tests, all pass), `vite build` (succeeds). Re-ran backend's `routing.integration.test.ts` against the rebuilt `frontend/dist` — still passes.

**Real-browser smoke check — verified working:** started both the backend dev server and the frontend dev server (new `.claude/launch.json`, added as a reusable dev-server config, not a product change) and opened the app in the browser tool. Confirmed: the map initially renders at a transient default view for a single frame before `fitBounds` applies (expected or client-side timing, not a bug) and then correctly centers on Tennessee with real OpenStreetMap tiles (`a/b/c.tile.openstreetmap.org`) and visible attribution; the live `getCategories()` call also rendered real category names beneath the map, confirming no regression. Mouse drag-pan moved the map (verified via before/after screenshots and a changed map-pane CSS transform). Clicking the zoom-in control genuinely changed the tile zoom level (7→8, confirmed via actual requested tile URLs). At an emulated 375×812 mobile viewport, `document.documentElement.scrollWidth` equaled `clientWidth` exactly (no horizontal overflow), and the layout reflowed sensibly.

**Real-browser smoke check — keyboard panning not confirmed (unresolved, not attributed to a cause):** attempting keyboard arrow-key panning in the browser smoke check did not visibly move the map. The map container did receive genuine DOM focus (confirmed via an independent `focus` listener), and a correctly-formed native `keydown` event (`keyCode: 39`, `key: "ArrowRight"`) reached `document`, but `L.Map.prototype.panBy` (patched to count calls) was never invoked, and the map's own `'focus'` event did not appear to fire through a patched `L.Evented.prototype.fire`. **This is reported as an unresolved observation, not as a diagnosis** — no cause (automated-environment artifact, a real defect, or something else) is established, and none should be assumed. Leaflet's `keyboard` option was never disabled in code. This is **not marked verified**, and is carried forward as an explicit Follow-Up Item (below) rather than closed out.

**Follow-Up Item (open, tracked here — not closed by this task's Complete status):** Confirm whether keyboard arrow-key map panning actually works, via a manual check in an ordinary desktop browser (developer-owned, in progress per developer instruction 2026-11-02). If it does not work there either, investigate the actual cause before M02-T08 (Implement Accessible Non-Map Discovery and Keyboard-Accessible Map Interactions), since that task's acceptance criteria depend on keyboard map operability.

**Not done in this task, by design:** no markers, clustering, landmark API calls, search, filters, geographic discovery, offline tile caching/prefetching/service-worker handling, or sensitivity changes. No backend/database changes. `CategoriesPreview` was kept, per your decision.

### M02-T03: Display Landmark Markers

**Status:** Complete — implemented, verified, and reviewed by the developer. Nonblocking follow-ups recorded below.

**Dependencies:** M01-T05, M02-T02

**Scope:**
- Retrieve imported landmark coordinates.
- Render landmarks as map markers.
- Distinguish the eight initial landmark categories.
- Support marker selection.
- Handle invalid geographic data.
- Paginate through the retrieval API's `bbox` results safely (no silent 200-item cap), with a documented, bounded safety limit and an honest incomplete-results notice if it's reached.

**Acceptance Criteria:**
- [x] Markers render only for landmarks carrying finite `latitude`/`longitude` in the API response (i.e., active `PUBLIC` records).
- [x] Each category has a distinct marker color, and its name is always shown as popup text (not color/shape alone).
- [x] Clicking a marker opens a popup with name, category label, and a working link to its profile route.
- [x] Loading, error, and zero-marker states are shown accessibly, outside the Leaflet map tree, without blocking the map.
- [x] Pagination follows `has_more` up to a documented safety limit (5 pages / up to 1,000 landmarks), deduplicated by `id`, with an honest "incomplete" notice if the limit is reached while more data remains.
- [x] Against the real, current dataset (1,692 `UNREVIEWED`, 0 `PUBLIC`), the map shows zero markers and the explanatory empty state — verified in a real browser against the real API.
- [x] No protected field (coordinates of a non-`PUBLIC` record, `sensitivityStatus`, source metadata) appears in rendered output, under synthetic test fixtures that include such a record.
- [x] `tsc -b`, `eslint .`, `vitest run`, `vite build` clean.

**Verification Results (2026-11-02):**

**Architecture:** `frontend/src/api/landmarks.ts` (`getLandmarkMarkers`, `bbox` mode only — the implementation rule that this module must never be called in plain name/category mode for marker purposes); `frontend/src/map/{useLandmarkMarkers.ts, categoryMarkerStyle.ts, LandmarkMarkersRenderer.tsx}`; `LandmarkMap.tsx` (M02-T02) gained an optional `children` prop as the only change to that existing component. `DiscoveryPage.tsx` now calls `useLandmarkMarkers()` once and renders all status messaging (loading/error/empty/incomplete) as normal page content, siblings of `<LandmarkMap>` — never injected into the Leaflet tree — passing only the validated `markers` array into `<LandmarkMap><LandmarkMarkersRenderer markers={...}/></LandmarkMap>`, which does pure `CircleMarker`/`Popup` rendering and nothing else (no fetching, no status UI).

**Query design:** a single static `bbox` query (`TENNESSEE_BOUNDS` from M02-T02, reused rather than redefined) issued once on mount — not a live viewport-tracking refetch (that remains M02-T07). `bbox` mode is restricted server-side (M01-T05) to active `PUBLIC` landmarks only, so a redacted record cannot appear in this response at all, let alone with coordinates.

**Pagination:** follows `has_more` up to `MAX_MARKER_PAGES = 5` (documented in code, up to 1,000 landmarks at the existing 200-per-page limit), accumulating and deduplicating by `id` across pages (defends against a theoretical concurrent-write race during multi-page fetch, not just a documentation claim — covered by a dedicated test). If the limit is reached while `has_more` is still true, `incomplete: true` is reported and `DiscoveryPage` shows an explicit "more may exist" notice alongside whatever markers were loaded — never silently presented as complete.

**Privacy/validation:** every record is checked for `Number.isFinite(latitude) && Number.isFinite(longitude)` before being treated as a marker — defense-in-depth beyond the `bbox`-mode guarantee. `LandmarkCollectionItem`'s type itself has no `sensitivityStatus` or source-metadata fields, so there is structurally nothing to leak through a marker or popup beyond `id`/`display_name`/`category`. No `console.*` call anywhere in the new modules logs API data.

**Category styling:** an 8-color, colorblind-safe (Okabe–Ito inspired) palette in `categoryMarkerStyle.ts`; the category's human-readable label is always rendered as popup text, never conveyed by color alone (spec §4.2).

**Accessibility boundary (unchanged from M02-T02's agreed division):** markers show a popup on click; full keyboard focus/operability of individual markers and formal ARIA labeling remain M02-T08's responsibility, not introduced here.

**Tests:** `categoryMarkerStyle.test.ts` (3), `useLandmarkMarkers.test.ts` (6 — single-page, multi-page accumulation, safety-limit/incomplete, cross-page deduplication, invalid-coordinate exclusion, error handling), `LandmarkMarkersRenderer.test.tsx` (3 — marker count/position, popup content/link, empty list), `DiscoveryPage.test.tsx` (5 — loading/error/empty/incomplete/normal messaging kept outside the mocked map). 17 new tests; 40 total across the frontend suite, all pass.

**Full regression check (2026-11-02):** `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (10 files, 40 tests, all pass), `vite build` (succeeds). Re-ran backend's `routing.integration.test.ts` against the rebuilt `frontend/dist` — still passes.

**Real-browser verification — real data, not synthetic (honestly distinguished from the mocked component tests):** started both dev servers, confirmed via the actual network request (`GET /api/v1/landmarks?bbox=-90.3,34.8,-81.6,36.7&page=1` → `{"items":[],"page":1,"limit":200,"has_more":false,"is_truncated":false}`) and the DOM (`document.querySelectorAll('.leaflet-interactive').length === 0`) that the real current dataset produces exactly zero markers, with the "No publicly viewable landmarks are available yet." message shown and the map otherwise fully functional. **I did not browser-verify marker rendering, popup content, or profile navigation against real `PUBLIC` data, since none exists yet** — that behavior is covered only by the synthetic-fixture component/unit tests listed above, and is reported as such, not claimed as browser-verified.

**Not done in this task, by design:** no clustering, no live viewport-tracking refetch, no search/filter/geographic-discovery features, no new dependencies, no backend/database changes, no sensitivity classification changes, no synthetic landmarks added to `landmarks_dev` or any database.

**Nonblocking Follow-Ups (recorded 2026-11-02, accepted by the developer, not required before Complete):**
- Frontend marker coordinate validation currently checks `Number.isFinite()` only; add explicit WGS84 range validation (latitude -90..90, longitude -180..180) the next time `useLandmarkMarkers.ts` is modified.
- Revisit the `MAX_MARKER_PAGES = 5` safety limit when implementing M02-T07 (viewport-based geographic discovery), since that task's live refetching may call for a different pagination strategy entirely.

### M02-T04: Implement Landmark Profiles

**Status:** Complete — implemented, verified, and reviewed by the developer. Nonblocking follow-up recorded below.

**Dependencies:** M01-T05, M02-T01

**Scope:**
- Display individual landmark details.
- Handle optional or missing information.
- Provide navigation between the map and profiles.
- Avoid presenting unverified access information as confirmed.
- Validate the actual runtime JSON response against the exact approved full/minimal profile shapes before rendering either variant; fail closed to the generic unavailable UI for anything else.

**Acceptance Criteria:**
- [x] An active, `PUBLIC` landmark ID renders the full profile with all available (non-null) fields, a single-point mini-map, and the public-access/safety disclaimer.
- [x] An active `UNREVIEWED`/`SENSITIVE` landmark ID renders strictly the §9.4a four-field minimal profile, with identical content and no distinguishing hint between the two statuses.
- [x] An unknown, retired, or inactive landmark ID renders the exact generic-unavailable heading/text from spec §9.4.
- [x] A malformed/unexpected response shape fails closed to the same generic-unavailable UI, never a partial render.
- [x] A genuine network/server error shows a real error state with working retry; a 404 does not.
- [x] A visible "Back to Discover" link is always present.
- [x] `tsc -b`, `eslint .`, `vitest run`, `vite build` clean.

**Verification Results (2026-11-02):**

**Architecture:** `frontend/src/api/landmarkProfileValidation.ts` (hand-written runtime validators — Zod is not a frontend dependency and wasn't added, consistent with backend's own `query-schema.ts` precedent; `isValidFullProfile`/`isValidMinimalProfile` each reject any object carrying a key outside their own exact allowlist, so a response mixing shapes, e.g. `redacted: true` plus `latitude`, is rejected outright); `frontend/src/api/landmarks.ts` gained `getLandmarkProfile()` (fetches, then validates via `parseLandmarkProfile`, throwing `MalformedLandmarkProfileError` on any shape mismatch); `frontend/src/routes/useLandmarkProfile.ts` (status machine: `loading`/`full`/`minimal`/`unavailable`/`error`, with retry — a 404 `ApiError` and a `MalformedLandmarkProfileError` both map to the identical `unavailable` status); `frontend/src/map/LandmarkLocationMap.tsx` (new, minimal single-point map, distinct from the Tennessee-wide `LandmarkMap`, mounted only when the page is actually in the `full` status with a validated profile); `frontend/src/routes/LandmarkProfilePage.tsx` rewritten to render exactly one of the five statuses, nothing blended.

**Minimal-profile neutrality:** the exact approved wording "Full details for this landmark are not currently available." is used verbatim for both `UNREVIEWED`- and `SENSITIVE`-shaped fixtures, with tests asserting the word "redacted," "unreviewed," and "sensitive" never appear anywhere in the rendered output for either case.

**`source_url` validation:** re-validated on the frontend (`parseSafeHttpUrl`) independent of the backend's own import-time validation — only `http:`/`https:` URLs render as a clickable link; a non-http(s) scheme (tested with `javascript:`) renders nothing.

**Tests:** `landmarkProfileValidation.test.ts` (16 — full/minimal acceptance, nullable fields, invalid coordinates, missing required fields, rejection of extra/protected fields on a minimal-shaped object, non-object inputs, URL scheme validation), `useLandmarkProfile.test.ts` (7 — full, minimal, 404→unavailable, malformed→unavailable, genuine error, retry, no-id case), `LandmarkLocationMap.test.tsx` (2 — center/zoom, accessible region name), `LandmarkProfilePage.test.tsx` (9 — full profile with all fields, null-field omission, unsafe URL rejection, minimal profile for both UNREVIEWED- and SENSITIVE-shaped fixtures with no distinguishing content, exact unavailable text, real error with working retry, mini-map explicitly absent in every non-full status). 33 new tests; `App.test.tsx`'s direct-navigation test updated to match the real (no-longer-placeholder) loading behavior. **73 total tests across the frontend suite, all pass.**

**Negative control performed and restored:** temporarily removed `isValidMinimalProfile`'s extra-key rejection — the "rejects a minimal-shaped object that also carries protected fields" test correctly failed (a minimal profile with `latitude`/`longitude` attached was wrongly accepted); restored and re-verified passing.

**Full regression check (2026-11-02):** `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (14 files, 73 tests, all pass), `vite build` (succeeds). Re-ran backend's `routing.integration.test.ts` against the rebuilt output — no regression.

**Real-browser verification — real data, honestly distinguished from the mocked tests:** started both dev servers, navigated to a real landmark ID from `landmarks_dev` (`c0990367-3116-4319-b71a-e14ea78e6d71`, "Coal Creek Arches 4x5," confirmed `sensitivity_status = UNREVIEWED` via a read-only `SELECT`) — the page showed exactly the minimal profile (name, category, neutral note, back link), confirmed via both rendered text and the real network response (`GET /api/v1/landmarks/c099...` → `200`). Navigated to an unknown UUID — the page showed the exact generic-unavailable heading/text, confirmed via the real network response (`GET /api/v1/landmarks/0000...` → `404`). **I did not browser-verify the full `PUBLIC` profile or mini-map rendering against real data, since no `PUBLIC` landmark currently exists** — that path is covered only by the synthetic-fixture component tests above, reported as such rather than claimed as browser-verified.

**Not done in this task, by design:** no backend/database changes, no sensitivity classification changes, no search/filters/geographic discovery, no discovery-state-preserving return navigation (a plain `/` link is used — full context preservation depends on state introduced by M02-T05/M02-T07/§9.6, not yet implemented).

**Nonblocking Follow-Up (recorded 2026-11-02, accepted by the developer, not required before Complete):**
- Full `PUBLIC`-profile rendering and the single-point mini-map have been tested with synthetic fixtures only; they have not yet been verified in a real browser against approved `PUBLIC` landmark data, since none currently exists. Revisit once classification produces real `PUBLIC` records.

### M02-T05: Implement Landmark Search

**Status:** Complete — implemented, verified, and reviewed by the developer. A focused verification gap and nonblocking follow-ups recorded below.

**Dependencies:** M01-T05, M02-T01

**Scope:**
- Support searching by landmark name.
- Handle empty and unsuccessful searches.
- Validate search parameters.
- Display matching results.
- A debounced, name-only search against the retrieval API's plain (`q`) mode, with its own paginated results list, deliberately independent of the map's marker set (M02-T03) for this task — see the follow-up below.

**Acceptance Criteria:**
- [x] A labeled search input debounces 300ms before committing a search; Enter submits immediately and cancels the pending debounce; Clear resets immediately to an instructional empty-search state without fetching.
- [x] Results display name and category only — never coordinates — identically for `PUBLIC`, `UNREVIEWED`, and `SENSITIVE`-shaped records, each linking to its profile route.
- [x] Explicit Next/Previous pagination, correctly disabled, always corresponding to the current committed term; changing the term resets to page 1; re-committing the identical term does not.
- [x] Stale (out-of-order) responses never overwrite a newer result; no state update occurs after unmount.
- [x] Loading, error (with retry), and no-matches states are shown accessibly; a truncation notice appears only when the API's `is_truncated` is actually true, independent of `has_more`.
- [x] Literal `%`/`_`/`\` pass through unescaped by the frontend (already handled server-side).
- [x] The map's existing marker set is unaffected by search.
- [x] `tsc -b`, `eslint .`, `vitest run`, `vite build` clean.

**Verification Results (2026-11-02):**

**Architecture:** `frontend/src/api/landmarks.ts` gained `searchLandmarks()` (plain `q` mode, no `bbox`/`near` — the opposite rule from `getLandmarkMarkers`); `frontend/src/routes/useLandmarkSearch.ts` (debounce → committed-query state machine, with page reset handled inside the same state transition that commits the query — not via a separate watching effect, to avoid a stale-page race); `frontend/src/routes/LandmarkSearch.tsx` (new, independent section, mounted in `DiscoveryPage` with zero props — it owns its own state entirely, confirmed by a dedicated `DiscoveryPage` test asserting it receives no data derived from the markers hook).

**Request lifecycle:** stale-response/unmount safety uses the same cancelled-flag idiom already established in `useLandmarkMarkers`/`useLandmarkProfile` (not `AbortController` — consistent with existing project precedent, not a new pattern). Re-submitting an already-committed identical term is a no-op by construction (React's own state-update bail-out on an unchanged primitive prevents a redundant fetch entirely, which was more conservative than originally anticipated and the test suite was adjusted to assert that actual behavior rather than an assumed refetch).

**Privacy:** `searchLandmarks` never applies `bbox`/`near`, matching M01-T05's "permitted non-location discovery" design; the results list renders only `display_name` and category label, confirmed by a dedicated test fixture mixing a coordinate-bearing (`PUBLIC`-shaped) and a coordinate-less item, asserting identical row structure and zero coordinate values anywhere in the rendered output.

**Tests:** `api/landmarks.test.ts` (2 — URL construction via `URLSearchParams`, confirming no custom escaping is added), `useLandmarkSearch.test.ts` (11 — debounce timing including keystroke-reset, Enter-cancels-debounce, trimming/100-char cap, clear-cancels-and-resets, page-reset-on-new-term vs. no-reset-on-identical-term, out-of-order/stale-response discarding, genuine-error + retry, no-update-after-unmount), `LandmarkSearch.test.tsx` (11 — heading/explanatory text, idle/loading/error/empty states, privacy-safe mixed-fixture rendering, `is_truncated` vs `has_more` independence, pagination button disabled states and handlers, input/Enter/Clear wiring, `maxLength`), plus a new `DiscoveryPage` test confirming `LandmarkSearch` receives no props from the markers hook. **25 new tests; 98 total across the frontend suite, all pass.**

**Negative control performed and restored:** temporarily added a coordinate display to a search result row — the "never shows coordinates" test correctly failed (the injected latitude/longitude values were found in the rendered output); reverted and re-verified passing.

**Full regression check (2026-11-02):** `tsc -b --noEmit` (0 errors), `eslint .` (0 errors — one leftover `eslint-disable` comment for an unconfigured rule was caught and removed during this pass), `vitest run` (17 files, 98 tests, all pass), `vite build` (succeeds). Re-ran backend's `routing.integration.test.ts` against the rebuilt output — no regression.

**Real-browser verification — real data:** started both dev servers, typed "Coal" into the real search box, confirmed the real network request (`GET /api/v1/landmarks?q=Coal&page=1&limit=20` → `200`) returned 2 real `UNREVIEWED` landmarks ("Coal Creek Arches 4x5," "Coalfield Falls 15'"), shown as name + category only; the map simultaneously still showed "No publicly viewable landmarks are available yet.," confirming search did not alter it. Clicked through a result and confirmed it correctly navigated to and rendered the real landmark's minimal profile page (reusing M02-T04).

**Not done in this task, by design:** no category filters, no bbox/near tied to search, no "search this area" semantics, no map/list synchronization, no M02-T08 accessible directory, no backend/database/sensitivity changes.

**Retry verification finding (2026-11-02, requested by the developer before Complete):** confirmed by citing existing tests, not newly added. `useLandmarkSearch.test.ts`'s "treats a genuine (non-404-style) failure as an error, with retry re-invoking the same term/page" test calls `retry()` directly with the committed query/page unchanged (`"Coal"`/page 1 both before and after) and asserts a genuine second call (`toHaveBeenCalledTimes(2)`, identical `{q, page, limit}`) — this establishes that the retry *logic* does issue a fresh request even when nothing else changed (it works because `retryToken` is a monotonically-incrementing number, never equal to its previous value, so React's state-update bail-out — the same mechanism that makes re-submitting an identical search term a no-op — never applies here). Separately, `LandmarkSearch.test.tsx`'s "shows a real error state with working retry" test confirms the rendered "Try again" button calls whatever `retry` function it's given. **Gap, flagged rather than silently assumed:** no single test exercises the complete path — a real rendered "Try again" button click, through the real (unmocked) hook, confirmed to issue a genuinely new network call — in one continuous, unmocked chain; the two tests above establish each half separately. No implementation change was made and no new test was added in response to this check, per instruction.

**Nonblocking Follow-Up (recorded 2026-11-02, accepted by the developer, not required before Complete):**
- Name-search results and the map's marker set are deliberately independent in this task (searching does not change what's shown on the map, and vice versa). Reconcile this once M02-T06 (category filtering), M02-T07 (geographic discovery), and M02-T08 (accessible directory) exist together, per spec's eventual "map and list represent the same current result set" requirement.

**Resolved (2026-11-02, closed by M02-T06):** the retry button's complete real-button-click-to-real-refetch path, flagged above as a gap, is now covered by a single unmocked end-to-end test — `LandmarkSearch.realHook.test.tsx`, added in M02-T06 — rather than left open indefinitely.

### M02-T06: Implement Category Filtering

**Status:** Complete — implemented, verified, and reviewed by the developer. Nonblocking follow-up recorded below.

**Dependencies:** M02-T03

**Scope:**
- Support filtering by all eight landmark categories.
- Keep displayed results consistent with selected filters.
- Support clearing filters.
- Handle categories with no matching landmarks.
- Multi-select category checkboxes (fetched live via the existing categories API), combined with the M02-T05 name search via AND semantics, replacing the temporary `CategoriesPreview`.

**Acceptance Criteria:**
- [x] All 8 categories render as accessible checkboxes inside a labeled `fieldset`/`legend`, fetched live, multi-selectable.
- [x] No categories selected means all categories — no dedicated "All" checkbox.
- [x] Category changes commit immediately (no debounce); they also commit whatever text is currently typed, even if its own debounce hasn't fired yet, and cancel that pending debounce.
- [x] Selecting a category alone (no text) produces results; combining with text applies AND semantics.
- [x] A single "Clear all filters" action resets text, categories, and pagination together, back to the idle state.
- [x] Pagination always corresponds to the current committed text+categories combination; changing either resets to page 1.
- [x] Stale responses are discarded after rapid typing, category toggles, paging, clearing, and unmounting.
- [x] Results remain name+category-only, identical for `PUBLIC`/`UNREVIEWED`/`SENSITIVE`.
- [x] The map's existing bbox-based markers are unaffected by category selections.
- [x] `CategoriesPreview` and its test are removed.
- [x] `tsc -b`, `eslint .`, `vitest run`, `vite build` clean.

**Verification Results (2026-11-02):**

**Architecture:** `api/landmarks.ts`'s `searchLandmarks` gained a `categories: string[]` parameter, omitted from the request entirely when empty (an absent param, not an empty value, matching the server's own "no restriction" semantics). `routes/useCategoryOptions.ts` (new) fetches the fixed category list once, independent of `useLandmarkSearch` — a category-list failure never blocks name search. `routes/useLandmarkSearch.ts` extended with `selectedCategories` and `onToggleCategory`: a category toggle cancels the pending text debounce, commits the current (possibly not-yet-debounced) text via the same `inputValueRef` snapshot technique, sets the new category set, and unconditionally resets to page 1 — unlike text commits, there is no "unchanged toggle" case to special-case. The "idle" condition is now "`committedQuery` empty **and** `selectedCategories` empty." `routes/LandmarkSearch.tsx` renders the checkbox group and a single "Clear all filters" button (replacing M02-T05's text-only Clear). `CategoriesPreview.tsx` and its test were deleted; `DiscoveryPage.tsx` no longer references it.

**Privacy:** unchanged from M02-T05 — category-filtered results flow through the identical list-rendering path (name + category label only, for every status). No new privacy surface was introduced.

**Retry verification gap closed:** per your instruction, `LandmarkSearch.realHook.test.tsx` (new) renders the real, unmocked component **and** hook together, mocking only the network layer (`searchLandmarks`, `getCategories`). It clicks the actual rendered "Try again" button after a genuine mocked failure and confirms a second real call with the identical committed term/categories/page — the single continuous path the M02-T05 follow-up noted was missing. Covers both a text-only and a category-only scenario.

**Tests:** `api/landmarks.test.ts` (+3 — categories omitted when empty, comma-joined when present, combined with `q`), `useCategoryOptions.test.ts` (3 — loading/success, loading-not-mistaken-for-empty, error+retry), `useLandmarkSearch.test.ts` (+8 — category-alone fetch, combined AND params, toggle-off keeps others, category change resets page unconditionally, category change during pending text debounce commits both together and cancels the stale debounce, Clear-all resets everything, stale-response discarding for category changes specifically), `LandmarkSearch.test.tsx` (+6 — checkbox rendering/checked state/toggling, category-loading state coexisting with working name search, category-error+retry not blocking name search, category-empty-list state), `LandmarkSearch.realHook.test.tsx` (2 new, described above). **19 new tests; 113 total across the frontend suite, all pass.**

**Negative controls performed and restored:** temporarily disabled the `categories` param entirely — both "omitted when empty"-adjacent tests (`joins multiple categories`, `combines q and categories`) correctly failed; restored and re-verified passing.

**Full regression check (2026-11-02):** `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (18 files, 113 tests, all pass), `vite build` (succeeds). Re-ran backend's `routing.integration.test.ts` against the rebuilt output — no regression.

**Real-browser verification — real data:** started both dev servers. Selected the real "Natural Arch" checkbox alone: confirmed the real request `GET /api/v1/landmarks?q=&page=1&limit=20&categories=arch` → `200`, returning 20 real `UNREVIEWED` "Natural Arch" results (name+category only) with the truncation notice correctly shown (369 real arch records exceed the 200-item threshold). Then typed "Coal" while that category remained selected: confirmed the real combined request `GET /api/v1/landmarks?q=Coal&page=1&limit=20&categories=arch` → `200`, correctly narrowing to the single matching real record ("Coal Creek Arches 4x5"). The map's "No publicly viewable landmarks are available yet." message was unaffected throughout both checks.

**Not done in this task, by design:** no bbox/near tied to filters, no "search this area," no map/list synchronization, no M02-T08 accessible directory, no backend/database/sensitivity changes.

**Nonblocking Follow-Up (recorded 2026-11-02, accepted by the developer, not required before Complete):**
- Category-filtered results and the map's marker set remain deliberately independent, same as M02-T05's search. Reconcile both together once M02-T07 (geographic discovery) and M02-T08 (accessible directory) exist.

### M02-T07: Implement Geographic Discovery

**Status:** Complete — implemented, verified, and accepted by the developer (2026-11-03), including review and acceptance of the final-verification corrections below. Three nonblocking follow-ups recorded and carried forward (see below and §11): keyboard arrow-key map panning, real-`PUBLIC`-data browser verification, and `useLandmarkSearch`'s previous-results retention during loading/errors (deferred to M02-T08).

**Dependencies:** M01-T05, M02-T03

**Scope:**
- Support geographic bounds or proximity queries.
- Validate geographic inputs.
- Test geographic calculations and boundary conditions.
- Distinguish geographic distance from travel distance.
- (Approved during planning review) Shared committed text/category filter state between the map and the results list; pending-vs-committed viewport with an explicit "Search this area" action; map-center and opt-in device-geolocation proximity search with the approved radius choices; single-page (≤200) marker fetch with `is_truncated`-driven messaging, replacing the M02-T03 multi-page safety limit; essential discovery-state restoration (refresh, Back/Forward, profile return) via the existing `react-router` dependency and the native History API wrapper it provides, per spec §9.6; straight-line distance in proximity-mode marker popups.

**Acceptance Criteria:**
- [x] Panning/zooming shows "Search this area" without auto-replacing results; activating it commits the new bounds and refetches markers and (via the shared committed filters) is reflected consistently with the list.
- [x] "Find near map center" and user-initiated-only "Near me" each set a mutually exclusive proximity origin with a selectable radius (5/10/25/50/100 mi); geolocation is never requested except on explicit click.
- [x] Map markers and the list's text/category filters share the same committed `q`/`categories`, combined via the server's existing AND semantics — while keeping their separate, already-approved visibility rules (map: active `PUBLIC` only, with coordinates; list: any status, name/category only, never coordinates).
- [x] Geographic queries (`bbox`/`near`) remain restricted server-side to active `PUBLIC` landmarks; no backend changes were made or needed.
- [x] Markers always fetch a single page (`page=1`, `limit=200`); `is_truncated` (read directly from the response, never inferred from `items.length`) drives a "Showing up to 200 results; zoom in or refine your search" message — replacing M02-T03's silent 5-page auto-accumulation.
- [x] Distance is labeled "straight-line distance" in marker popups, shown only in proximity mode.
- [x] Essential discovery state (`q`, `categories`, `mode`, `bbox` or `near`+`radius`, viewport `lat`/`lng`/`zoom`) restores correctly on refresh, direct link, and Back/Forward, via `react-router`'s `useSearchParams` (no new dependency); debounced text/category commits use `replaceState`, "Search this area"/proximity-mode changes use `pushState`, per spec §9.6. Device-geolocation origins are never written to the URL, browser storage, or logs.
- [x] Profile return navigation uses `navigate(-1)` when reached via an in-app discovery link (closing the M02-T04 follow-up), falling back to the plain discovery route for a direct/external profile visit.
- [x] Malformed/unsupported URL parameters normalize to safe defaults (the Tennessee-wide `bbox`) with an accessible on-page notice, without ever crashing or silently misbehaving.
- [x] `tsc -b`, `eslint .`, `vitest run`, `vite build` clean.
- [ ] Real-browser verification against real `PUBLIC` landmark data — **still blocked** by the pre-existing, unresolved sensitivity-classification gap (0 `PUBLIC` records exist in `landmarks_dev`); verified instead with real `UNREVIEWED` data for the list and structurally/logically for the geographic (`PUBLIC`-only) path. Accepted by the developer as a known, pre-existing limitation that does not block Complete status (consistent with M02-T03/M02-T04). See Verification Results below.

**Verification Results (2026-11-03):**

**Architecture:** `routes/discoveryUrlState.ts` (pure parse/normalize of the canonical URL params) + `routes/useDiscoveryUrlState.ts` (the `useSearchParams`-backed hook: `commitText`/`commitCategories` use `replaceState`, `commitBbox`/`commitNearOrigin`/`exitProximity` use `pushState`, `commitRadius`/`updateViewport` use `replaceState`; its returned actions object is `useMemo`-wrapped so it stays referentially stable — an earlier draft rebuilt it every render, which risked cascading re-render loops in the hooks that depend on "the actions" as a whole, caught before this review). `routes/useDiscoveryFilters.ts` lifts the debounced-text/immediate-category commit logic out of `useLandmarkSearch` (M02-T05/M02-T06) so it can be shared. `routes/useGeographicDiscovery.ts` owns pending-vs-committed bbox, the map-center/device-geolocation proximity origin (the latter held only in local state, never the URL), and radius; `map/MapViewportTracker.tsx` (new, rendered as a `<LandmarkMap>` child) reports the live viewport via Leaflet's own `whenReady` (not a bare mount effect — see the real-browser findings below) plus `moveend`/`zoomend`. `map/useMapMarkers.ts` replaces `useLandmarkMarkers.ts`: single-page `bbox`/`near` fetch, WGS84 range validation (closing the M02-T03 coordinate-validation follow-up), `is_truncated` read directly from the response. `routes/DiscoveryFilters.tsx` (shared text/category UI, rendered once) and `routes/GeoDiscoveryControls.tsx` (Search-this-area/proximity/radius controls) compose with the now-list-only `LandmarkSearch.tsx` in `DiscoveryPage.tsx`. `LandmarkProfilePage.tsx`'s return action is now a button calling `navigate(-1)` when `location.state.fromDiscovery` was set by the originating `Link` (markers/list), else `navigate("/")`.

**Privacy:** unchanged server-side; no backend files were touched. Markers and the list remain two separate requests with their already-approved separate visibility rules — `useMapMarkers`/`getLandmarkGeoMarkers` only ever issue `bbox`/`near` queries (restricted server-side to active `PUBLIC`), `useLandmarkSearch`/`searchLandmarks` only ever issue plain `q`/`categories` queries (never coordinates). Device-geolocation origins are held in `useGeographicDiscovery`'s local state only and are never passed to any URL-writing action, confirmed by a dedicated test (`useGeographicDiscovery.test.ts`: "on success, overrides effectiveGeo locally without ever calling a URL-writing action") and by real-browser inspection of the URL during a "Near me" flow.

**Two real bugs found and fixed during this session's own real-browser verification (not by the test suite, which had mocked the pieces involved):**
1. `useDiscoveryUrlState`'s actions object was rebuilt on every render instead of memoized, which could cascade into unnecessary downstream re-renders in `useDiscoveryFilters`/`useGeographicDiscovery`. Fixed by wrapping it in `useMemo`.
2. `MapViewportTracker` originally reported the initial viewport from a bare mount `useEffect`, which ran before `react-leaflet` finished applying the initial Tennessee-wide `bounds` fit — reading Leaflet's pre-fit default view (world view, zoom 0) and writing it into the URL. Fixed by using Leaflet's `map.whenReady()` instead. A related issue surfaced once that was fixed: Leaflet's real `fitBounds` result is commonly **substantially** different from the exact `DEFAULT_BBOX` constant used to request it (it snaps to the nearest whole zoom level), which made "Search this area" appear immediately on every fresh page load with no actual interaction. Fixed in `useGeographicDiscovery` by comparing `pendingBbox` against a locally observed baseline (the first real viewport report, re-anchored on `onSearchThisArea`/`onExitProximity`) rather than against the raw committed bbox value. Both fixes have dedicated regression tests.

**Tests:** 27 frontend test files, 205 tests, all passing (`geo.test.ts`, `discoveryUrlState.test.ts`, `useDiscoveryUrlState.test.tsx`, `useDiscoveryFilters.test.ts`, `useGeographicDiscovery.test.ts`, `MapViewportTracker.test.tsx`, `useMapMarkers.test.ts`, `GeoDiscoveryControls.test.tsx`, `DiscoveryFilters.test.tsx` + `DiscoveryFilters.realHooks.test.tsx`, plus updates to `useLandmarkSearch.test.ts`, `LandmarkSearch.test.tsx` + `.realHook.test.tsx`, `DiscoveryPage.test.tsx`, `LandmarkMap.test.tsx`, `LandmarkMarkersRenderer.test.tsx`, `LandmarkProfilePage.test.tsx`, `landmarks.test.ts`). Coverage includes: stale-response discarding across every axis of the marker/list composite fetch key; `is_truncated` read directly from the response at representative boundary values (never inferred from `items.length`, including a 200-item response with `is_truncated:false` and a <200-item response with `is_truncated:true`); `pushState`/`replaceState` verified via a real `createMemoryRouter`/`RouterProvider` harness checking `router.state.historyAction` directly, not inferred; URL param normalization/fallback for malformed `bbox`/`near`/`radius`/`mode`/viewport; geolocation success/denial/unavailable, confirming no URL-writing action is ever called for a device origin; a real-hooks integration test (`DiscoveryFilters.realHooks.test.tsx`) proving the shared-filter architecture is actually wired together (not just two independently mocked halves) including refresh-restoration and Clear-all; privacy regression coverage extended to WGS84-range (not just finite) coordinate exclusion for markers.

**Full regression check (2026-11-03):** `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (27 files, 205 tests, all pass), `vite build` (succeeds). An initial full-suite run showed a worker crash and one flaky failure; both were traced to two full `vitest` suites accidentally running concurrently on this machine (resource contention), not a real defect — a clean, single re-run passed in 6.3s with no failures, and was re-confirmed clean after each subsequent fix.

**Real-browser verification performed:** started both dev servers against the real `landmarks_dev` database (1,692 real records, all `UNREVIEWED`/0 `PUBLIC`). Confirmed: initial load shows the Tennessee-wide view with no false "Search this area" prompt; panning shows the prompt, and clicking it issues a real `GET /api/v1/landmarks?bbox=...` request with the panned bounds and clears the prompt; "Find near map center" issues a real `near`+`radius` request matching the exact map center, shows the radius selector and "Back to area search," and changing the radius issues a new real request; "Back to area search" returns to `bbox` mode using the preserved committed bbox without the prompt reappearing; typing "Falls" and checking the "Waterfall" category issues real combined `q`+`categories` requests to **both** the plain list endpoint and the geographic marker endpoint with the same committed filters, surfacing 20 real `UNREVIEWED` waterfall records (name+category only, no coordinates anywhere in the rendered output) with the truncation notice shown; opening a result's profile correctly renders the exact §9.4a minimal redacted profile; "Back to Discover" from that profile restores the **exact** prior discovery URL (`q`, `categories`, `mode`, `bbox`, `near`, `radius` all intact) via `navigate(-1)`; a full page reload at that same URL correctly restores the text input value and the checked category checkbox from the URL alone. Checked the browser console after each step in a fresh tab: no errors or warnings.

**Real-PUBLIC-data verification — still blocked, as expected and previously accepted:** `landmarks_dev` has 0 `PUBLIC` records, so the map's "no publicly viewable landmarks" empty state was the only marker-rendering outcome observable; this is the same pre-existing, unresolved classification-policy gap recorded under M02-T03/M02-T04, not something this task can close. No sensitivity classifications were modified to work around this.

**Final-verification corrections (2026-11-03), after developer review of the first implementation report:** a focused audit against the approved acceptance criteria found two real gaps, both corrected:
1. `useMapMarkers` was clearing markers to blank on every loading/error state (including from a live refetch), contrary to the approved plan's "retain the last good markers" requirement. Fixed: `MapMarkersStatus`'s `loading`/`error` variants now carry an optional `previous: {markers, isTruncated}`, populated from the last successful fetch (held in a ref, not component state) and never present on `success` — a new success always replaces it outright, including an empty one. `DiscoveryPage` renders `previous`'s markers with an explicit "Showing landmarks from your previous search... these may not match your current filters or area" notice (worded differently for a failed vs. an in-flight refetch), so retained markers are never presented as confirmed matches for the current query. No new privacy surface: `previous` only ever holds an already-validated `PUBLIC` marker set from a prior successful response.
2. There was no real-hook-plus-real-component retry test for the marker/geographic path (only the pre-existing list-side one). Added `DiscoveryPage.realHooks.test.tsx`: real `useDiscoveryUrlState`/`useGeographicDiscovery`/`useMapMarkers`/`DiscoveryPage`, mocking only the network boundary and `react-leaflet` (the unavoidable Leaflet dependency, per the established M02-T02 pattern). It drives a real pan, a real "Search this area" click, a real failed fetch, confirms the real "Try again" button re-issues the identical committed geographic+filter parameters, and confirms a successful retry replaces the retained markers.
3. Added a regression test for restoring a non-default committed bbox (e.g., after a refresh following a prior "Search this area") not falsely flagging a pending change — closing a minor coverage gap in the baseline-ref fix (the existing regression test only used the default bbox as the baseline scenario).

**`useLandmarkSearch` (list) still clears to blank on loading/error — recorded, not fixed, per explicit developer instruction:** this is the original M02-T05 behavior, predates M02-T07, and was deliberately left alone to avoid unrequested scope expansion. See the new Nonblocking Follow-Up Item below.

**Verification after corrections:** `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (28 files, 218 tests, all pass — re-run twice for confidence after an unrelated pre-existing flaky test was found and fixed, see below), `vite build` (succeeds). Backend `landmarks.integration.test.ts` re-run: 42/42 passing, confirming the privacy/boundary behavior relevant to this review is unaffected (no backend files were touched). Real-browser verification: with the real `landmarks_dev` database (0 `PUBLIC` records), every real marker fetch necessarily returns empty, so the "retained non-empty previous markers" visual itself could not be exercised live against real data — instead confirmed live that a genuine backend-down failure (stopped the dev server mid-session) produces the real error alert with a working "Try again," and that clicking it re-issues the identical request and succeeds once the backend is back (`500` then `200` on the identical `bbox` query, confirmed via network inspection). The "markers remain visible, labeled as previous" visual itself is covered by the new `DiscoveryPage.realHooks.test.tsx` real-hook test instead. Along the way, found and fixed one unrelated regression from this correction's own first draft (success with zero markers stopped mounting `LandmarkMarkersRenderer`, breaking an existing test) and one genuine pre-existing flaky test unrelated to this task (`useLandmarkSearch.test.ts` asserted on hook state immediately after a `waitFor` on call count alone, racing the mock's own promise resolution — fixed by waiting for the resolved state directly).

**Developer acceptance (2026-11-03):** the developer reviewed this final-verification report and the corrections above and accepted M02-T07 as Complete, with the three follow-ups below explicitly preserved (not resolved by this task) and the real-`PUBLIC`-data verification limitation explicitly accepted as non-blocking.

**Not done in this task, by design:** no backend/database changes, no sensitivity-classification changes, no M02-T08 accessible-list/keyboard-map work, no new dependencies (URL-state restoration uses the already-approved `react-router`), no `pushState`/`replaceState` granularity polish beyond what spec §9.6 calls for.

**Nonblocking Follow-Up Items carried forward (not resolved by this task):**
- Keyboard arrow-key map panning (from M02-T02): still unconfirmed; unrelated to this task's scope, remains for M02-T08.
- Real-`PUBLIC`-data browser verification (from M02-T03/M02-T04, now also applying to geographic discovery): still blocked by the unresolved sensitivity-classification policy (§9.5).

**Follow-ups closed by this task:**
- Marker coordinate validation (M02-T03): WGS84 range validation added to `useMapMarkers.ts`, not just `Number.isFinite`.
- The `MAX_MARKER_PAGES = 5` safety limit (M02-T03): replaced by the single-page/`is_truncated` design approved during M02-T07 planning.
- Profile return navigation (M02-T04): now `navigate(-1)`-based, preserving full discovery state when reached in-app.
- Name-search/category-filtered results vs. the map's marker set (M02-T05/M02-T06): reconciled via the shared `useDiscoveryFilters` committed state, while preserving their separate visibility rules.

### M02-T08: Implement Accessible Non-Map Discovery and Keyboard-Accessible Map Interactions

**Status:** Complete — implemented in increments 1–4 and 5a–5d (each verified and accepted by the developer, 2026-11-04/05), manually verified by the developer with a physical keyboard in a foreground browser (2026-11-07), and **accepted as complete by the developer 2026-11-07** subject to the documentation and task-closure checks recorded below. Deferred follow-ups and limitations preserved (see the closure record and §11). Nothing committed yet.

**Dependencies:** M02-T03, M02-T05, M02-T06

**Scope:**
- Provide a non-map, list/table-based view of landmarks with the same search and category-filtering capability as the map view.
- Implement keyboard-accessible interaction with the map (navigation, marker selection, popup content) and appropriate ARIA labeling.
- Review against WCAG 2.2 Level AA criteria relevant to discovery workflows.

**Approved planning refinements (2026-11-04, kept here rather than rewriting the original scope/acceptance criteria above):** two always-visible, separately-labeled discovery lists (existing `LandmarkSearch` for plain name/category results; new `GeographicResultsList` for the same `PUBLIC`-only geographic result set already shown on the map — no new network requests, no Map/List toggle, no per-item duplicate-landmark indicator); replace `CircleMarker` with `Marker`+`DivIcon` for native Leaflet keyboard support, preserving current appearance; enlarge marker hit/focus areas where practical; add `@axe-core/playwright` as a dev dependency; investigate and resolve the M02-T02 keyboard-panning follow-up with real-browser verification plus new Playwright regression coverage; address `useLandmarkSearch`'s previous-results retention early. Serious/critical axe findings, and any confirmed-applicable WCAG 2.2 AA violation regardless of severity, block Complete; minor/moderate axe findings are triaged; real screen-reader and Firefox/Safari verification are documented open follow-ups, not blockers. Real-`PUBLIC`-data browser verification remains open, unchanged. No backend/database/sensitivity-classification changes.

**Acceptance Criteria:**
- [x] A non-map list/table view supports the same search and filtering as the map — `LandmarkSearch` (name/category results, any status, with previous-results retention from Increment 1) and `GeographicResultsList` (Increment 2: the map's exact geographic result set, driven by the same committed `q`/`categories`/viewport state, with no new requests or privacy surface); both accepted 2026-11-04.
- [x] Map markers and popups are reachable and operable via keyboard — `Marker`+`DivIcon` with accessible names, Enter/Space/Escape, popup focus entry and restoration, Shift+Tab return to the originating marker, and focus recovery when a focused marker is removed (Increments 3, 5a, 5c); verified with real Leaflet component tests, production-build Playwright with trusted input, and the developer's manual physical-keyboard pass (2026-11-07).
- [x] Discovery workflows are usable without relying on pointer-only map interaction — skip links bypass the map and markers, arrow-key panning works from the focused container, a visible keyboard instruction is the container's accessible description, and both results lists are reachable and operable by keyboard alone (`e2e/keyboard-workflow.spec.ts`; manual pass 2026-11-07). The approved blocking conditions hold: six axe scan states at 0 violations with no exclusions, and no confirmed-applicable WCAG 2.2 AA violation found. This is **not** a claim of complete WCAG 2.2 AA conformance (see the preserved follow-ups).

**Increment 1 Verification Results (2026-11-04) — `useLandmarkSearch` previous-results retention, closing the M02-T07 follow-up:**

**Changed files:** `frontend/src/routes/useLandmarkSearch.ts` (new `PreviousSearchResult` type; `loading`/`error` statuses carry an optional `previous`, populated from a `lastGoodRef` ref — the exact pattern already proven in `useMapMarkers`, M02-T07), `frontend/src/routes/LandmarkSearch.tsx` (renders retained items with an explicit "Showing results from your previous search while the update loads/failed — these may not match your current search or filters" notice; Previous/Next reflect the retained page's own pagination state), `frontend/src/routes/DiscoveryPage.tsx` (docstring cross-reference updated only, no behavior change).

**Design notes:** `previous` is deliberately absent from `idle` — clearing filters is a deliberate reset to "no query," not a transient hiccup, so showing stale results there would mislead rather than help; `lastGoodRef` is explicitly cleared on the idle transition so a fresh search afterward starts with no stale carryover. A new `success` always replaces `previous` outright, including with an empty page, consistent with `useMapMarkers`.

**Tests:** 28 files, **230 tests, all passing** (12 new: 5 in `useLandmarkSearch.test.ts` — no previous on first-ever loading; previous retained during loading; previous retained during error; empty success replaces previous outright; clearing to idle discards previous and a fresh search starts clean — and 7 in `LandmarkSearch.test.tsx` covering the same states at the rendering layer, plus pagination controls reflecting the retained page). Re-run twice for confidence; both clean.

**Full regression check:** `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (230/230, twice), `vite build` (succeeds).

**Real-browser verification (real `UNREVIEWED` data — meaningfully stronger evidence here than for the earlier marker-retention work, since plain-mode results are non-empty against the real `landmarks_dev` data):** searched "Falls" → 20 real results. Stopped the backend mid-session, changed the search to "Arch" → confirmed the real error alert and "Try again" button **alongside** the retained "Abraham Falls / Abrams Falls 25' / Ace Falls 15'..." results and the exact "Showing results from your previous search while the update failed..." notice. Restarted the backend, clicked the real "Try again" → confirmed the retained results were replaced outright by real "Arch" results ("Adjoin Double Arch", "Allan's Arch 75x8", ...) with the notice gone. Checked console in a fresh tab afterward: no errors.

**Unresolved issues from this increment:** none found.

**Increment 2 Verification Results (2026-11-04) — `GeographicResultsList` (accessible non-map rendering of the map's geographic result set):**

**Changed files:** `frontend/src/routes/GeographicResultsList.tsx` (new — consumes `useMapMarkers`'s `MapMarkersStatus` directly, no fetch of its own; renders name/category/profile-link per marker, straight-line distance when present, loading/error/empty/truncation/previous-results states using plain, non-live text rather than the shared `LoadingState`/`ErrorState` components, specifically to avoid duplicating the live announcements `DiscoveryPage` already makes for this same status above the map), `frontend/src/routes/GeographicResultsList.test.tsx` (new), `frontend/src/routes/DiscoveryPage.tsx` (renders `<GeographicResultsList>` after `<GeoDiscoveryControls>`; adds two visually-hidden-until-focused skip links extending `AppLayout`'s existing pattern; revises the intro paragraph to explain that a landmark can legitimately appear in both lists), `frontend/src/routes/DiscoveryPage.module.css` (new — the skip-link CSS, copied from `AppLayout.module.css`'s established pattern), `frontend/src/routes/LandmarkSearch.tsx` (its heading gains `tabIndex={-1}` to become the second skip-link's target), `frontend/src/routes/DiscoveryPage.test.tsx` and `LandmarkSearch.test.tsx` (new tests), `frontend/src/routes/DiscoveryPage.realHooks.test.tsx` (existing M02-T07 assertions updated from `getByText` to `getAllByText` where a marker/notice/button now legitimately appears twice — once on the map, once in the new list).

**Design notes:** `GeographicResultsList` is a second presentation of already-fetched data — zero new network requests, zero new privacy surface, the server-side `PUBLIC`-only restriction on `bbox`/`near` is untouched. It is deliberately kept separate from `LandmarkSearch` rather than merged (different privacy-scoped queries), per the approved plan. Its own loading/error/previous-results text is intentionally **not** marked `role="status"`/`role="alert"` — `DiscoveryPage` already renders a live-announcing equivalent for the same `markerStatus` above the map; using live roles in both places would double-announce the same event to screen-reader users. `EmptyState` (which has no live role to begin with) is still reused as-is. No pagination, matching the map's single-page design. Skip links target each section's heading directly (`tabIndex={-1}`), reusing `AppLayout`'s exact established skip-link pattern rather than inventing a new mechanism.

**Tests:** 29 files, **248 tests, all passing** (18 new: 13 in `GeographicResultsList.test.tsx` covering heading/skip-target structure, loading/error/empty/success/truncation/previous-results states, the no-live-role assertion, profile-link `fromDiscovery` state, distance display, and absence of pagination controls; 3 in `DiscoveryPage.test.tsx` confirming `GeographicResultsList` receives the exact same `markerStatus` object reference passed to `useMapMarkers`, the two skip links' hrefs, and the duplicate-landmark explanatory copy; 1 in `LandmarkSearch.test.tsx` for its heading's new skip-link-target attributes; existing M02-T07 real-hook assertions updated, not added). Re-run twice for confidence; both clean.

**Full regression check:** `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (248/248, twice), `vite build` (succeeds).

**Real-browser verification, including genuine keyboard-only navigation:** confirmed the page renders both lists in the intended order with the intended copy. Performed a real keyboard-only pass from a freshly loaded page: pressed Tab three times (landing on the global "Skip to content," then "Discover" nav, then "Skip to landmarks on the map") and pressed Enter — confirmed via `document.activeElement` that focus moved to exactly `<h3 id="geo-results-heading">`. Repeated for the fourth Tab stop ("Skip to name search results") — confirmed focus moved to exactly `<h3 id="search-heading">`. Checked console in a fresh tab: no errors. Real-`PUBLIC`-data content verification (non-empty geographic list items, overlap with a real duplicate-landmark case) remains blocked by the same pre-existing 0-`PUBLIC`-records limitation as every prior task; the empty-state path was confirmed instead.

**Unresolved issues from this increment:** none found. Real-`PUBLIC`-data verification remains the same pre-existing, accepted open limitation (not new to this increment).

**Increment 3 Verification Results (2026-11-04) — `Marker`+`DivIcon` conversion and keyboard-accessible marker/popup interactions (implemented; awaiting developer review):**

**Changed files:** `frontend/src/map/LandmarkMarkersRenderer.tsx` (rewritten: `CircleMarker` → `Marker`+`DivIcon`; per-marker `AccessibleLandmarkMarker` and `LandmarkPopupContent` components), `frontend/src/map/LandmarkMarkersRenderer.module.css` (new — icon/dot/focus-ring styles), `frontend/src/map/markerAccessibleName.ts` (new — builds the marker's accessible name from the approved public fields only), `frontend/src/map/markerAccessibleName.test.ts` (new), `frontend/src/map/LandmarkMarkersRenderer.leaflet.test.tsx` (new — real Leaflet + real react-leaflet in jsdom, nothing mocked), `frontend/src/map/LandmarkMarkersRenderer.test.tsx` (mock updated from `CircleMarker` to `Marker`/`Popup`/`useMap`; new icon/handler/group assertions), `frontend/src/routes/DiscoveryPage.realHooks.test.tsx` (mock key renamed `CircleMarker` → `Marker` only). No backend, database, sensitivity-classification, dependency, or spec changes. `LandmarkLocationMap.tsx` (the M02-T04 single-point profile mini-map) still uses a non-interactive `CircleMarker` with no popup and was deliberately left untouched — it is outside this increment's discovery-marker scope.

**Design, as verified against the installed Leaflet 1.9.4 / react-leaflet 5.0.0 sources rather than assumed:**
- Leaflet's `Marker` (default `keyboard: true`) itself sets `tabindex="0"` and `role="button"` on the icon element — for a `DivIcon`, the `<div>` it creates. Leaflet's `alt` option applies only to `<img>` icons, so the accessible name is applied by this code as `aria-label` on that same focusable element (never on nested icon HTML). The name is `display_name, category label[, approx. N.N mi straight-line distance]` — the same approved public fields the popup shows, nothing more. The browser's accessibility tree exposes each marker as `button "Synthetic Falls A, Waterfall"` (confirmed via the in-app browser's accessibility query).
- Icon HTML is assembled only from this module's own CSS-module class names and the fixed category palette; no landmark field is ever interpolated into icon HTML (asserted by test).
- Appearance preserved: 16px dot, `#1f2937` 1px outline, 0.85 opacity, same category colors. The outer focusable element is 24×24px (enlarged hit/focus target, transparent, centre-anchored); the popup tip is anchored just above the dot. Leaflet's default `.leaflet-div-icon` white box is replaced by the module class.
- Enter: Leaflet's own `keypress keyCode===13` → `togglePopup` (confirmed in the real browser; not re-implemented, to avoid double-toggling). Space: Leaflet ignores it, so a `keydown` handler toggles the popup and calls `preventDefault()` — page `scrollY` confirmed unchanged across a Space activation in the real browser. Escape: Leaflet's built-in Escape handling only runs while the map *container* is focused, so it never applies to a focused marker or popup; this code closes the map's open popup on Escape from a focused marker (including when the open popup belongs to a *different* marker — the same "dismiss whatever is open" semantics Leaflet gives the container) and from anywhere inside the popup element (content, profile link, or Leaflet's own close button), via a listener attached on `popupopen`/detached on `popupclose`.
- Popup focus entry: the popup content is wrapped in a `role="group"` named "`<name> details`" with `tabindex="-1"` and receives focus on open, so the profile link is one Tab away and Leaflet's close button one more. react-leaflet mounts popup children only on the first open and keeps them mounted (detached) across later opens, so first-open focus uses the mount effect and later opens subscribe to the marker's `popupopen` event (covered by a dedicated "second open" test).
- Focus restoration: on `popupclose`, focus returns to the owning marker only if focus was actually lost (on `<body>`, or still inside the fading popup element) — it never steals focus from an element the user moved to (another marker, the map, a control). Verified for Escape, the close button via keyboard, and the close button via mouse.
- Stacking: `focus` → `setZIndexOffset(1000)`, `blur` → `setZIndexOffset(0)` (the real `Marker` API; `bringToFront` exists only on `Path`/`CircleMarker`). Verified in the real browser with two fixtures at identical coordinates: the focused one's z-index rose by exactly 1000 over its twin and fell back on blur.
- Focus indicator: `:focus-visible` outline (3px `#1a5fb4`, the project's existing global ring) plus a white/blue box-shadow halo so the ring stays visible on busy tiles; the outline remains for Windows High Contrast mode (which drops box-shadow). Screenshot-confirmed on the overlapping pair.
- Skip-link bypass preserved: from a fresh load, Tab → "Skip to landmarks on the map" → Enter moved focus straight to `#geo-results-heading`, bypassing all markers (re-verified).

**Automated tests (all executed):** `vitest run` — 31 files, **268 tests, all passing** (20 new: 14 in `LandmarkMarkersRenderer.leaflet.test.tsx` against REAL Leaflet in jsdom — focusable element attributes and accessible names, 24px/centre-anchor icon styles, Enter opens + focus enters popup + link reachable, Space toggles + `defaultPrevented`, Escape from content / from the marker / from a different marker / from Leaflet's close button, close-button activation restores focus, no focus theft when another popup opens, re-focus on second open, z-index raise/restore on overlapping markers, clean removal when a marker leaves the result set; 3 in `markerAccessibleName.test.ts`; 3 new in the mocked `LandmarkMarkersRenderer.test.tsx`). **Negative control:** temporarily disabling the `aria-label` assignment, the Space `preventDefault`, and the `popupclose` focus restoration made exactly the tests covering them fail (5 failures), then passed again once restored. One harness limitation found and documented in the test file: user-event's synthetic Enter `keypress` sets `charCode` but not `keyCode`, while Leaflet checks `keyCode === 13`; the Enter path therefore dispatches a browser-accurate `keypress` via `fireEvent`, and native Enter was confirmed separately in the real browser (below). `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `prettier --check` on the changed files, `vite build` (succeeds). Note: `npm run <script>` wrappers are blocked by group policy on this machine (`.cmd` shims), so each check was run via `node` against the same binaries (`node_modules/typescript/bin/tsc`, `eslint/bin/eslint.js`, `vitest/vitest.mjs`, `vite/bin/vite.js`).

**Real-browser verification (real Leaflet in the in-app Chromium browser, Vite dev server, against a throwaway mock API process serving five synthetic `PUBLIC` fixtures — three separated, two at identical coordinates — on the dev proxy port; the real backend was not running, `landmarks_dev` and real classifications were untouched):** fresh load renders the five markers with the previous appearance. Keyboard-only, from the page start: Tab order is skip links → map container → each marker in order → zoom controls (no trap). On a focused marker: Enter opened the popup and `document.activeElement` became the "`<name> details`" group; Tab reached "View profile", Tab again reached Leaflet's "Close popup" button; Enter on the close button closed the popup and returned focus to the originating marker; Escape from the content group, from the close button, and from the marker itself each closed the popup and left focus on the marker; Space opened/closed the popup with `scrollY` unchanged; with one marker's popup open, tabbing to a *different* marker and pressing Escape closed it without moving focus. Overlapping pair: focusing either raised its z-index by 1000 over its twin and restored on blur, with the focus ring visible (screenshot). Enter → Tab → Enter on "View profile" navigated to the synthetic profile route (`/landmarks/<id>`, heading rendered), and "Back to Discover" restored the exact discovery URL (`lat`/`lng`/`zoom`) with all five markers and no popup. Mouse: clicking a marker opened its popup and moved focus into the content group; clicking the close button closed it and returned focus to the marker. Console after a final fresh load and full keyboard cycle: no runtime errors or React warnings — the only logged errors were one transient Vite HMR 500 at 10:12:05 while the renderer file was mid-edit (a momentary syntax state between two edits, long since reloaded), not from the finished code.

**Deviations from the approved design / design notes for review:** (1) Escape on a focused marker now closes *any* open map popup, not only that marker's own — chosen during real-browser verification after observing that otherwise a keyboard user who tabbed away from an open popup had no way to dismiss it without opening another; (2) Escape handling was moved from the React content wrapper to the whole popup element after real-browser verification found Leaflet's close button (a sibling of the content node) was not covered — the initial jsdom tests had passed without that case, so a test for it was added; (3) the popup anchor moved from the dot's centre to just above it (a `Marker` popup is positioned by `popupAnchor`; previously `CircleMarker` opened at the point). (4) Shift+Tab from inside a popup lands on the last marker in the marker pane rather than the originating marker, because Leaflet renders popups in a separate pane after all markers in DOM order; this is not a trap (Escape returns focus to the owner) but is recorded as a known limitation. (5) If a marker whose popup is open is removed from the map by a new result set while focus is inside its popup, focus falls to `<body>` (the marker element no longer exists to restore to); the jsdom removal test covers the clean teardown but no special refocus was added. (6) Observed once, not caused by this increment: the very first load in the in-app browser pane, before the pane had a drawn size, wrote `zoom=0` (world view) into the URL; a plain reload immediately produced the normal Tennessee-wide `zoom=7` view and it did not recur — consistent with Leaflet fitting bounds in a zero-size container, not with any marker change here.

**Not done in this increment, by design:** no keyboard-panning investigation or fix (the M02-T02 follow-up remains open and its root-cause trail still needs to be re-established in this document — see §11), no `@axe-core/playwright` integration, no Playwright keyboard-interaction coverage, no change to `LandmarkLocationMap`, no backend/database/classification changes, no new dependencies.

**Unresolved issues from this increment:** none blocking. Known limitations (4)–(5) above are recorded for developer judgment. Real-`PUBLIC`-data verification remains the same pre-existing, accepted open limitation; this increment used synthetic fixtures through a mock API precisely because `landmarks_dev` still has 0 `PUBLIC` records.

**Developer acceptance (2026-11-04):** Increment 3 accepted as meeting the approved scope, explicitly including both Escape-handling deviations: (1) Escape on a focused marker may dismiss the currently open popup, and (2) Escape handling on the entire popup element is appropriate to cover its interactive controls. M02-T08 remains In Progress. The developer directed that known limitations (4) and (5) be preserved as **open M02-T08 accessibility follow-ups for final M02-T08 verification**, not treated as resolved:

- **Shift+Tab from popup content** lands on the last marker in the marker pane rather than the originating marker. To evaluate at final verification whether this is a significant usability problem; prefer predictable focus behavior without introducing a keyboard trap or fragile DOM manipulation. **No speculative fix is to be implemented yet.**
- **Focus loss when a focused marker is removed** by a results update (focus falls to `<body>`). **Treated as a potential M02-T08 completion blocker.** To investigate and correct with a stable, accessible focus destination such as the geographic-results heading or another appropriate discovery control, verified with real Leaflet and a changing result set.

Both are also listed under §11 Open Follow-Up Items.

**Increment 4 Verification Results (2026-11-04) — keyboard-panning investigation and Playwright regression coverage (implemented; awaiting developer review):**

**Changed files:** `e2e/keyboard-panning.spec.ts` (new — 2 Playwright tests). **No production code was changed**: the investigation found no application defect to fix (below). `frontend/src/map/LandmarkMap.tsx` was edited twice only as temporary negative controls and restored byte-for-byte (verified: no `keyboard` props present afterward, exactly as before). All diagnostic instrumentation (a Playwright harness, a standalone Leaflet control page served by a throwaway mock process, and in-page probes) lived in the session scratchpad and was never committed. No dependencies added; no backend/database changes.

**Root-cause trail, re-established from Leaflet 1.9.4's own source (`src/map/handler/Map.Keyboard.js`):** the keyboard handler attaches its `document` `keydown` listener only while its private `_focused` flag is true; that flag is set solely by a `focus` DOM event on the map *container element* (and cleared on `blur`). `_onKeyDown` additionally ignores arrow keys while `map._panAnim._inProgress` is true, and calls `DomEvent.stop` (preventDefault + stopPropagation) only for keys it actually handles. Three consequences follow directly: (a) if the container becomes `document.activeElement` *without* a `focus` event — which browsers do when the window itself is not focused — the handler never activates and arrow keys do nothing even though the map "has focus"; (b) a focused *child* of the container (now: any marker, since Increment 3) does not activate the handler either, because `focus` does not bubble; (c) a stuck pan animation would also silently swallow arrows.

**Instrumented real-browser investigation (trusted CDP keyboard input; never synthetic `KeyboardEvent` dispatch):** each probe recorded `document.hasFocus()`, `document.activeElement`, keydown delivery (window capture phase → key/keyCode; window bubble phase → whether Leaflet stopped it), the handler's `enabled()`/`_focused` state, `_panAnim._inProgress`, and *actual* centre movement via Leaflet's own `moveend`. The map instance was reached through react-leaflet's `MapContainer` state in the React fiber tree (diagnostic only). Tile requests were served a stub so no public tile server was contacted.

| Path (Playwright headless Chromium, Vite dev build) | App (React + react-leaflet) | Standalone Leaflet (no React, same options) |
|---|---|---|
| Tab to the container (5 presses from page start), ArrowRight → ArrowDown | pans: centre `35.7557,-85.9500` → `35.7554,-85.0671` → `35.0390,-85.0671`; URL updated both times | pans identically |
| Programmatic `container.focus()` (window focused), ArrowLeft | pans: lng `-85.9500` → `-86.8250` | pans identically |
| Mouse click inside the map, ArrowUp | pans (focus event fired on mousedown via Leaflet's own `_onMouseDown`) | pans: lat `35.7557` → `36.4655` |
| A **marker** focused, ArrowRight | **no pan** — handler `_focused` false, keydown reached window un-stopped (consequence b) | n/a |

Same results were reproduced independently in the in-app Chromium pane (Tab, programmatic focus, Shift+Tab back from a marker, and the real-browser URL updates). In every panning case: `keyCode` 37–40 delivered to the container, `_focused` true, `_panAnim` not in progress, Leaflet stopped the event (it never reached the window bubble listener), and `moveend` fired with the new centre. **Verdict: no application defect. Keyboard panning works in the app exactly as in standalone Leaflet under real input, in both the dev build (harness) and the production build (Playwright e2e below).**

**The automation-focus artifact, captured directly:** on a fresh load in the in-app pane *before any real input*, `document.hasFocus()` was `false`; calling `container.focus()` then made the container `document.activeElement` but fired **no** `focus` event and left the handler's `_focused` flag unset — exactly consequence (a). The first real key press re-focused the window and everything worked from then on. This is the most likely explanation for the earlier "confirmed broken" reproduction (which was never documented and cannot be re-examined): checking `activeElement` alone, or focusing programmatically from an unfocused window, produces a map that looks focused but has no active keyboard handler. In Playwright headless, disabling CDP focus emulation did *not* reproduce it (`hasFocus()` stayed `true` there), so this artifact was demonstrated only in the in-app pane, where it occurred reproducibly on two fresh loads. Per the developer's instruction, neither `hasFocus()` nor `defaultPrevented` was treated as proof on its own; the conclusion rests on the correlated handler-flag, event-delivery, and centre-movement observations above.

**One harness mistake, found and corrected, recorded for honesty:** an early app-only "click then arrow does nothing" result turned out to be a click placed below the 768px viewport fold (the map extends past it; `elementFromPoint` returned `null`), not a difference from standalone Leaflet. Re-probing at in-viewport positions showed the click path behaving identically in both.

**Playwright regression test (`e2e/keyboard-panning.spec.ts`), against the existing test environment (real production build served by the real backend on the `landmarks_test` database; Chromium):** (1) stubs every tile request with a 1×1 PNG (no external tile-server traffic, no tile-error state); (2) waits for the app to write the initial viewport into the URL; (3) reaches the map by pressing Tab in a bounded loop until `.leaflet-container` is the active element — realistic keyboard entry, not a hardcoded press count; (4) asserts the container is focused; (5) ArrowRight → polls (no fixed delay) until the URL `lng` increases *and* Leaflet's own `.leaflet-map-pane` transform shifts negative-x, with `lat` unchanged; ArrowDown → polls until `lat` decreases *and* the pane shifts negative-y, with `lng` unchanged; asserts the map is still focused; (6) a second test focuses a neutral control outside the map ("Find near map center"), presses both arrows, and after a bounded 750 ms settle window (longer than Leaflet's 0.25 s pan animation) asserts the URL centre and pane transform are unchanged and the map is not focused. Needs no `PUBLIC` landmark data and exposes no production API for the map instance.

**Results (all executed):** `playwright test` (both specs): **3 passed** (smoke + 2 new), repeated after each negative control; clean teardown confirmed (no listener left on port 3000). **Negative controls, each via a temporary production edit, rebuild, run, revert, rebuild, re-run:** with Leaflet's keyboard handler disabled (`keyboard={false}`) the positive test failed at the Tab step ("Could not reach the map container") — correct, since the handler is what makes the container tabbable; with the handler enabled but `keyboardPanDelta={0}` (focusable, arrows pan by zero) the positive test failed exactly on the movement assertion (`Expected: > -85.95, Received: -85.95`) while the negative-control test still passed — proving the movement assertions, not just focus, are what the test checks. `eslint e2e playwright.config.ts` (0 errors), `prettier --check` on the spec (clean). Frontend `tsc`/`eslint`/`vitest`/`vite build` were not re-run for this increment beyond the rebuilds above, because no frontend source changed. Note: `npm run` wrappers are blocked by group policy on this machine, so Playwright ran as `node node_modules/@playwright/test/cli.js test` with `DATABASE_URL_TEST` set explicitly to the documented local test database.

**Observation for developer decision (not changed):** arrow keys do not pan while a *marker* has focus, by Leaflet's design (the handler only listens when the container itself is focused). This path only became reachable in Increment 3, when markers became focusable. A keyboard user can Shift+Tab back to the container to pan. Whether arrows should also pan from a focused marker is a UX choice outside this increment's scope; recorded here rather than implemented.

**Environmental limitations:** real human keyboard input in a normal, foreground browser window was not exercised by this session (the evidence is trusted CDP input in headless Chromium and the in-app pane). The in-app pane stopped accepting input part-way through (the app window was behind another window), so the later probes were completed in Playwright instead. Firefox/Safari were not covered (the e2e project remains Chromium-only, per its recorded scope).

**Developer acceptance and resolution (2026-11-04):** Increment 4 accepted. The M02-T02 keyboard-panning follow-up is **closed as resolved through verification, with no production fix required**, recorded on these exact terms:
- Keyboard panning works when the Leaflet map container receives normal browser focus.
- The earlier failure is most likely attributable to the in-app browser's focus/input behavior, but this explanation is **not conclusively proven for every earlier observation** (the original reproduction was never documented).
- Real-browser Playwright verification confirms ArrowRight and ArrowDown pan the map.
- All 3 e2e tests pass, including the negative check for arrow keys outside the map.
- Negative controls demonstrate that the regression tests detect disabled keyboard support and missing pan movement.
- No production application changes were required.
- **Human foreground-window keyboard verification remains unperformed** and is to be included in the final manual accessibility verification.

**Preserved for final accessibility review (per developer instruction):**
1. Arrow keys do not pan while an individual marker has focus; Shift+Tab returns focus to the map container. Evaluate whether brief on-page keyboard instructions would improve discoverability.
2. The Playwright `.leaflet-map-pane` transform assertion is acceptable for now but should be reconsidered if it becomes brittle.

**Increment 5a Verification Results (2026-11-04) — focus loss when a focused marker is removed by a results update (the potential completion blocker; implemented, awaiting developer review):**

**Changed files:** `frontend/src/map/LandmarkMarkersRenderer.tsx` (new optional `onFocusLost` prop; two-phase detection/report in `AccessibleLandmarkMarker`), `frontend/src/routes/GeographicResultsList.tsx` (exports `GEO_RESULTS_HEADING_ID`; heading/section now use the constant — no markup change), `frontend/src/routes/DiscoveryPage.tsx` (wires `onFocusLost` to focus the geographic-results heading; skip-link href uses the constant), `frontend/src/map/LandmarkMarkersRenderer.focusLoss.leaflet.test.tsx` (new, real Leaflet), `frontend/src/routes/DiscoveryPage.realLeaflet.test.tsx` (new, whole page with real Leaflet), `frontend/src/routes/DiscoveryPage.test.tsx` (mocks extended; one wiring test added), `e2e/marker-focus-on-results-update.spec.ts` (new, 5 Playwright tests). No backend, database, sensitivity-classification, dependency, or unrelated UI changes; marker/popup keyboard interactions, skip links, accessible names, and the `PUBLIC`-only privacy boundaries are untouched (all prior tests still pass unchanged).

**Observed cleanup sequence (investigated first, per the approved refinement, with a temporary instrumented experiment against real React 19 + react-leaflet 5 in jsdom — deleted, never committed):** when a marker component is removed, (1) its **layout-effect cleanup** runs with the Leaflet marker ref still set, the icon element still in the DOM, the popup element and its React-portal content still attached, and `document.activeElement` still on the icon or the popup content; (2) its **passive-effect cleanup** runs with the ref already detached (`useImperativeHandle` cleanup), the popup's portal content already removed by React, and focus already on `<body>` when it had been inside the popup — but with the icon still in the DOM, because react-leaflet removes the Leaflet layer only in its own (child) passive cleanup, which runs after the parent's. So focus ownership is reliably identifiable at the layout cleanup only.

**A second, non-obvious finding (caught by the page-level and Playwright tests, not by the renderer-level tests):** the first implementation both detected and *moved* focus in the layout cleanup. That works for the popup case but silently fails for the focused-icon case: React records the focused element before each commit and, at the end of the commit (`flushMutationEffects`), re-focuses it if it is still in the document — and the Leaflet icon still is at that point. The heading was focused, React re-focused the icon, Leaflet then removed the icon, and focus fell to `<body>`. Confirmed by a captured blur stack trace. The popup case only worked because the popup content is a React node already removed during mutations. **Final design is therefore two-phase:** detect ownership at the layout cleanup (recording the icon and popup elements), then report via `onFocusLost` at the passive cleanup — after React's restoration and before react-leaflet removes the layer — and only if focus is still stranded on the doomed icon/popup or already on `<body>`, never if something else took focus in between. `DiscoveryPage` answers the report by focusing the geographic-results heading (`tabIndex={-1}`, the existing skip-link target and the accessible list of exactly the markers now shown). No steal: the callback is never invoked when the removed marker did not own focus (focus on a surviving marker, the search box, any other control, or a marker that survives the update by id).

**Automated tests (all executed):** `vitest run` — 33 files, **287 tests, all passing** (19 new: 13 in `LandmarkMarkersRenderer.focusLoss.leaflet.test.tsx` — fires once for a removed focused icon with populated and with empty replacements and when several markers go at once, fires for focus on the popup content group and on the profile link, three "the focus move actually STICKS" cases that drive a real `focus()` from the callback through React's restoration and Leaflet's removal, and five no-fire cases; 5 in `DiscoveryPage.realLeaflet.test.tsx` — the whole page with real Leaflet and real hooks, a real debounced text-filter commit producing a real second marker fetch while focus sits on a marker or inside its popup, asserting focus lands on the heading (populated and empty replacement, with the empty state shown), and two no-steal cases; 1 wiring test in `DiscoveryPage.test.tsx`). **Negative control:** the first (layout-only) implementation passed all 13 renderer-level tests yet failed the two page-level icon cases and the two matching Playwright cases exactly as described above — demonstrating those tests detect a fix that does not stick. `tsc -b --noEmit` (0 errors), `eslint .` and `eslint e2e` (0 errors), `prettier --check` on all changed files (clean), `vite build` (succeeds).

**Real-browser verification (Playwright, real production build served by the real backend on `landmarks_test`, real Chromium, trusted keyboard input; the discovery API intercepted at the network layer with changing synthetic `PUBLIC` fixtures — 3 → 2, 2 → 0, 2 → 1 — and tile requests stubbed; the real database and classifications untouched):** `e2e/marker-focus-on-results-update.spec.ts`, **5/5 passing**, in a full-suite run of **8/8** with clean teardown. Each scenario types into the search box (starting the real 300 ms debounce), Shift+Tabs — in a bounded loop, no hardcoded count — onto the target marker before the deliberately delayed (2.5 s) replacement response arrives, asserts the marker (or, after Enter, its popup content group) is focused, waits for the marker count to change, and asserts: focused marker removed with populated replacement → results heading focused; with empty replacement → heading focused and the empty state visible; focus inside the removed marker's open popup → heading focused and no popup; focus kept on the search box → not moved; focus on a surviving marker → stays there.

**Limitations:** verified in Chromium only (the e2e project's recorded scope); no human physical-keyboard pass (deferred to 5d's manual checklist). The fallback destination is the geographic-results heading only; no announcement beyond the heading's own name and the page's existing live status/empty-state messaging was added. The behaviour depends on React's documented commit/effect ordering as measured here (React 19.x, react-leaflet 5.0); the "sticks" tests exist precisely to catch a change in that ordering.

**Developer acceptance (2026-11-04):** Increment 5a accepted — the two-phase cleanup approach accepted on the observed React/react-leaflet lifecycle behaviour and the page-level and real-browser verification. The marker-removal focus-loss follow-up is **resolved**; its implementation rationale (above) and regression tests (`LandmarkMarkersRenderer.focusLoss.leaflet.test.tsx`, `DiscoveryPage.realLeaflet.test.tsx`, `e2e/marker-focus-on-results-update.spec.ts`) are preserved. M02-T08 remains In Progress.

**Increment 5b Verification Results (2026-11-04) — `@axe-core/playwright` integration (implemented; awaiting developer review):**

**Dependency and file changes:** `@axe-core/playwright@^4.14.0` (resolves 4.14.0, depends only on `axe-core@4.14.0`; sole peer requirement `playwright-core >= 1.0.0`, satisfied by the installed Playwright 1.64.1) added as a **root** devDependency beside `@playwright/test` — `package.json` and `package-lock.json` updated; no other dependency added or changed. New `e2e/accessibility.spec.ts` (6 tests). **No application code changed.** `npm audit` after installation: 0 findings involve `axe-core`/`@axe-core/playwright`; the 10 moderate findings present are all pre-existing, dev-only lint-toolchain items (`minimatch` reached only through `eslint`/`@eslint/config-array`/`typescript-eslint`), left for triage per ADR-009's audit policy and outside this increment's scope.

**Scan design:** real Chromium against the real production build served by the real backend (the existing Playwright webServer on `landmarks_test`). Rule tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` (WCAG 2.0/2.1/2.2 A+AA), whole page, **no rule, element, or Leaflet-markup exclusions**. The discovery/profile APIs are intercepted at the browser network layer with synthetic `PUBLIC` fixtures and tile requests are stubbed with a 1×1 PNG (no external tile traffic; no database or classification changes). Every scan first waits for the intended state (marker count, focused popup group, result link, alert, profile heading/region) **and for no "loading/updating" text to remain**, so transient states are never scanned. Serious/critical violations fail the test; the full axe result (violations, incomplete, pass count) is attached to each test as JSON and a one-line summary is printed, so minor/moderate findings and needs-review checks are always recorded, never silently passed.

**States scanned (6/6) and results — `playwright test`: 14/14 passing (6 accessibility + 5 focus-on-update + 2 keyboard-panning + 1 smoke), clean teardown:**

| State | Violations (any severity) | Rules passed | Needs-review ("incomplete") checks |
|---|---|---|---|
| Discovery, initial load (3 markers) | **0** | 29 | 3 rules / 4 nodes (see below) |
| Discovery, marker popup open (focus in the popup group) | **0** | 29 | same 3 rules / 4 nodes |
| Name search populated ("Falls" → list link + 1 marker) | **0** | 28 | same 3 rules / 4 nodes |
| Discovery error state (API 500 → alert + "Try again") | **0** | 25 | same 3 rules / 4 nodes |
| Full `PUBLIC` profile (heading, mini-map region, source link) | **0** | 23 | 2 rules / 7 nodes (see below) |
| Redacted (§9.4a) profile | **0** | 17 | **0** |

**Violations grouped by severity:** critical 0, serious 0, moderate 0, minor 0 — in every state. Nothing to triage as a violation; nothing blocks on axe severity.

**Needs-review checks (axe "incomplete" — inconclusive, NOT violations), reviewed individually:**
1. `aria-prohibited-attr` — `div[aria-label="Geographic discovery controls"]` in `frontend/src/routes/GeoDiscoveryControls.tsx` (all four discovery states). axe: *"aria-label attribute is not well supported on 'div' elements with no valid role attribute."* **Assessment: a genuine, app-side ARIA defect** — ARIA 1.2 prohibits `aria-label` on the implicit `generic` role, so the intended group name is not reliably exposed to assistive technology (relevant to WCAG 1.3.1 / 4.1.2, though it does not itself make any control unnamed — every control inside has its own name). **Proposed focused remediation (not applied — approval requested):** give the wrapper an explicit grouping role, e.g. `role="group"` on that `div`, or convert it to a `<section>` labelled by a heading like the page's other sections; one-line change plus any test that queries that wrapper. Recommended to land before M02-T08 is marked Complete.
2. `label-content-name-mismatch` — Leaflet's own zoom controls `.leaflet-control-zoom-in` / `.leaflet-control-zoom-out` (all map-bearing states). axe: *"Unable to determine if the visible text is part of the accessible name."* **Assessment: not applicable.** The visible content is a symbol-only glyph (`+`/`−`, itself `aria-hidden`) and the accessible name is "Zoom in"/"Zoom out"; WCAG 2.5.3 Label in Name applies to text labels, and symbols are not text. Leaflet-generated; **no exclusion added** — remains recorded for the manual confirmation in 5d.
3. `color-contrast` — `.leaflet-control-zoom-out > span` (all map-bearing states): *"Element content contains only non-text characters"* — same symbol-only glyph; not a contrast measurement at all. **On the full profile only:** `.leaflet-control-attribution` and its two links *"background color could not be determined because element contains an image node"* (the Ukraine-flag image Leaflet 1.9 places in its attribution), and `p:nth-child(4)` (the paragraph immediately after the mini-map) *"background color could not be determined because it is overlapped by another element."* **Assessment: inconclusive, needs a human look in 5d** — particularly the overlapped paragraph, which should be checked visually for any Leaflet layer bleeding over the text below the mini-map; the attribution-link contrast should be checked against Leaflet's default `rgba(255,255,255,0.8)` background. No exclusion added.

**Confirmed applicable WCAG 2.2 AA violations found:** none confirmed by this increment. Item 1 is a real ARIA defect (names not exposed on a generic element) and is flagged as a recommended pre-Complete fix; whether it is treated as a blocking 4.1.2 failure is the developer's call on review.

**Other verification (all executed):** `prettier --check` and `eslint e2e` on the new spec (clean); frontend `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (33 files, 287 tests, all pass — unchanged, no frontend source touched), `vite build` (succeeds). Existing Playwright regression specs all still pass in the same 14/14 run.

**CI:** the existing workflow runs `npm ci` then `npm run test:e2e` (`playwright test`), which discovers every spec under `e2e/` — the accessibility scans therefore run in the existing PR-blocking e2e step with **no workflow change**, and the lockfile carries the new devDependency for `npm ci`. Actual GitHub Actions execution remains unverified (no remote yet; pre-existing M00-T05 limitation).

**Limitations:** automated scans do not establish WCAG conformance (approved scope); Chromium only; the scanned states are the six approved ones (not every UI state); needs-review items 2–3 and the human physical-keyboard pass are carried to 5d; item 1 awaits a decision.

**Developer acceptance and focused ARIA correction (2026-11-04):** Increment 5b accepted (zero violations, no exclusions, complete state coverage, 14/14 Playwright). The developer authorized the focused correction for needs-review item 1, applied as follows: `frontend/src/routes/GeoDiscoveryControls.tsx` — the wrapper `<div aria-label="Geographic discovery controls">` now carries `role="group"`; accessible name unchanged, no other markup, styling, or behaviour change. `frontend/src/routes/GeoDiscoveryControls.test.tsx` — one new test asserts the wrapper is exposed as a group named "Geographic discovery controls" containing the proximity buttons. **Verification after the correction (all executed):** `prettier --check` (clean), `tsc -b --noEmit` (0 errors), `eslint .` (0 errors), `vitest run` (33 files, **288 tests**, all pass), `vite build` (succeeds), `playwright test` (**14/14**, clean teardown); all **six axe states still report 0 violations**, the `aria-prohibited-attr` needs-review item is **gone from every state**, and the spec contains **no rule or element exclusions** (checked by grep for `disableRules`/`exclude`/`withRules`: none).

**Carried to Increment 5d (per developer instruction):** Leaflet zoom-button label-in-name manual review; Leaflet attribution contrast checks axe could not complete (image node in the attribution); potential overlap involving the text paragraph directly below the profile mini-map; human foreground-window keyboard verification; Chromium-only coverage; GitHub Actions execution not yet verified.

**Dependency security (recorded, not acted on here):** the 10 moderate `npm audit` findings are pre-existing, development-only lint-toolchain items (`minimatch` via `eslint`/`@eslint/config-array`/`typescript-eslint`), unrelated to axe, held for separate dependency-security triage per ADR-009; this accessibility increment was deliberately not expanded into dependency upgrades.

**Increment 5c Investigation (2026-11-04) — Shift+Tab from inside a marker popup (findings only; no keyboard behaviour changed; awaiting developer decision):**

**Method:** production build served by the real backend, real Chromium with trusted keyboard input (a scratchpad Playwright harness, not committed), three synthetic `PUBLIC` markers in result order Alpha Falls → Bravo Peak → Charlie Arch, tiles stubbed. The popup of the FIRST marker (Alpha) was opened with Enter so that "the last marker in the pane" is unmistakably not the originating marker. The active element was recorded after each key press.

**Observed sequences (popup of Alpha Falls open throughout):**

| Start | Shift+Tab 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Content group (`role=group`, focused on open) | Charlie Arch marker | Bravo Peak marker | Alpha Falls marker (originator) | map container | "Skip to name search results" |
| "View profile" link | Charlie Arch marker | Bravo Peak marker | Alpha Falls marker | map container | skip link |
| Leaflet "Close popup" button | "View profile" link | Charlie Arch marker | Bravo Peak marker | Alpha Falls marker | map container |

Forward from the close button: Zoom in → Zoom out → Leaflet attribution link → OpenStreetMap link (then on out of the map). The popup stays open throughout every sequence. Cause, confirmed from the DOM: inside the map container the focusable order is *all marker icons* → *the popup* (content group, profile link, close button) → *Leaflet controls*, because Leaflet renders popups in a separate pane after the marker pane; the content group (`tabindex="-1"`) is not itself a Tab stop, so the popup's first/last Tab stops are the profile link and the close button.

**Assessment:** (1) **No keyboard trap** — every sequence is reversible, Tab/Shift+Tab always leave the popup, and Escape returns focus directly to the originating marker (Increment 3). (2) **It is a genuine focus-order problem for keyboard users, proportional to the marker count:** backward navigation from the popup lands on an unrelated marker (the last in result order) while the popup is still open, which is not a meaningful sequence relative to the popup the user is in (WCAG 2.4.3 Focus Order is the relevant criterion; the forward order and Escape path keep this from being an outright failure, but with up to 200 markers a user who backs out of a popup may be ~199 Shift+Tabs from where they came, and screen-reader users hear an unrelated landmark name). Judged **moderate: worth fixing, not a release blocker on its own.**

**Options:**
- **A — Intercept (recommended):** in the per-open popup `keydown` listener that already handles Escape, when `Shift+Tab` is pressed while the active element is the content group or the popup's first Tab stop (the profile link), `preventDefault()` and focus the owning marker. From the marker, further Shift+Tab continues naturally (previous marker → map container), Tab goes forward as today, Escape is unchanged, and the close button's own Shift+Tab (→ profile link) is untouched. No DOM manipulation, no new element, no trap: it only redirects the single backward *exit* from the popup to the element the user came from. Verifiable with real Leaflet in jsdom and in Playwright; a focused, ~15-line change in `LandmarkMarkersRenderer.tsx` plus tests.
- **B — Leave as is, document:** rely on Escape as the documented way back and add a brief on-page keyboard hint (overlaps the 5d "keyboard instructions" evaluation). Cheapest, but the backward sequence stays non-meaningful.
- **C — Close the popup on backward exit** (Shift+Tab out of the popup also closes it and restores focus): more "modal-like"; rejected as a recommendation because it changes the non-modal popup semantics already accepted in Increment 3 and makes Shift+Tab destructive.

**Recommendation:** Option A, as a small follow-up increment with explicit approval, verified by real-Leaflet component tests and a Playwright test covering all three start points and the no-trap property.

**Increment 5c Implementation and Verification Results (2026-11-04) — Option A approved by the developer and implemented (awaiting developer review):**

**Changed files:** `frontend/src/map/LandmarkMarkersRenderer.tsx` (the per-open popup `keydown` listener that already handled Escape now also handles the backward boundary; one new module constant naming the popup's real Tab stops), `frontend/src/map/LandmarkMarkersRenderer.shiftTab.leaflet.test.tsx` (new, real Leaflet, 8 tests), `e2e/popup-backward-navigation.spec.ts` (new, 3 Playwright tests). No other application, markup, styling, backend, database, or classification change.

**Implementation (smallest reliable change):** on `keydown` inside the popup element, if the key is `Tab` with Shift and no other modifier, and the active element is inside the popup and is either (a) the popup's first real Tab stop (its first `a[href]`/button/input/select/textarea/positive-tabindex element — the "View profile" link) or (b) a programmatically focused element with `tabIndex < 0` (the content group), then `preventDefault()` and focus the owning marker. The popup is left open. Everything else — Shift+Tab from the close button (→ profile link), forward Tab, Escape, Space/Enter on markers, the `popupclose` focus-restoration, and all non-matching keys — is untouched, so nothing unrelated is intercepted and no trap exists. Accessible names, focus indicators, the `PUBLIC`-only privacy boundaries, and geographic discovery behaviour are unchanged (no test touching them changed).

**Automated tests (all executed):** `vitest run` — 34 files, **296 tests, all passing** (8 new, real Leaflet in jsdom; user-event moves focus for Tab/Shift+Tab in DOM order only when the keydown was not default-prevented, so the tests exercise exactly the interception boundary): from the content group → originating marker, popup open; from the profile link → originating marker, popup open; from the close button → profile link (unchanged); after returning to the marker, Shift+Tab → previous marker and Tab → next marker (natural order, no trap); after returning, Escape closes the popup with focus staying on the marker; forward Tab group → link → close button → out of the popup (never intercepted); Escape from inside the popup unchanged; Shift+ArrowLeft and Ctrl+Shift+Tab not intercepted (default not prevented, focus unchanged). **Negative control:** with the interception temporarily disabled, exactly the four tests that depend on it failed and the four natural-order tests still passed; restored and re-verified green. `prettier --check` (clean), `tsc -b --noEmit` (0 errors), `eslint .` and `eslint e2e` (0 errors), `vite build` (succeeds).

**Real-browser verification (Playwright, production build served by the real backend on `landmarks_test`, real Chromium, trusted keyboard input, synthetic `PUBLIC` fixtures via route mocking, tiles stubbed):** `playwright test` — **17/17 passing**, clean teardown. The three new tests open the MIDDLE marker's (Bravo's) popup by keyboard so both neighbours exist, and confirm: from the content group, Shift+Tab → Bravo marker with the popup still open, then Shift+Tab → Alpha, Tab → Bravo, Tab → Charlie (natural order), then back on Bravo, Escape closes the popup with focus staying on Bravo; from the profile link, Shift+Tab → Bravo marker, popup open; from the close button, Shift+Tab → profile link, Tab → close button, Tab → Leaflet's "Zoom in" (forward exit unchanged). **All six axe scan states still report 0 violations** in the same run, with no exclusions.

**Limitations:** Chromium only; no human physical-keyboard pass yet (5d). The boundary rule relies on the popup's content group being the only `tabindex="-1"` element inside the popup and the profile link being its first Tab stop — both are this project's own popup markup, covered by the tests above.

**Developer acceptance (2026-11-04):** Increment 5c accepted; the Shift+Tab focus-order follow-up is **resolved**, with its rationale and regression coverage preserved above. M02-T08 remains In Progress.

**Increment 5d Verification Results (2026-11-04) — final accessibility verification (automated portion complete; the developer's manual physical-keyboard pass is PENDING; awaiting developer review):**

**Changed files:** `e2e/keyboard-workflow.spec.ts` (new — 5 Playwright tests), `docs/M02-T08_MANUAL_KEYBOARD_CHECKLIST.md` (new — the developer's manual checklist). **No application code changed** in this increment. Nothing committed.

**1. Production-build keyboard verification (automated — real Chromium, trusted CDP keyboard input, production build served by the real backend on `landmarks_test`, synthetic `PUBLIC` fixtures via route mocking, tiles stubbed, bounded Tab loops keyed on the destination rather than hardcoded counts):** `playwright test` — **22/22 passing, run twice back-to-back** (clean teardown both times). The new `keyboard-workflow` spec covers: both skip links move focus to their results heading and the next Tab continues *into* that list, not back to the markers; the map container is reachable by Tab and ArrowLeft/ArrowUp pan it (URL `lng` decreases / `lat` increases) while focus stays on the container; Tab reaches every marker in result order with `role="button"`, the expected accessible names, and a measured visible focus indicator (`:focus-visible` true, outline ≥ 3px, box-shadow present); Enter opens a popup with focus in the content group, Tab reaches "View profile" then "Close popup", Escape from the close button closes and restores focus to the marker, Space opens without scrolling the page and Escape on the marker closes, and activating the close button by keyboard restores focus to the marker; both non-map lists are reachable and operable by keyboard alone (geographic results links; typing in the search box then tabbing to a name-search result and opening its profile). The already-accepted specs cover the rest of the requested workflow in the same run: arrow panning with a neutral-control negative check (`keyboard-panning`), Shift+Tab at the popup's backward boundary from all three start points (`popup-backward-navigation`), and focus restoration when a focused marker or open popup is removed by a results update (`marker-focus-on-results-update`). Two test-harness bugs in the new spec (a predicate that matched the page's own skip link, and tabbing before the debounced search results had rendered) were found by the first runs and fixed; neither was an application defect. Real landmark classifications and the development database were not touched.

**2. Remaining Leaflet findings — measured in real Chromium (production build), with verdicts:**
- **Zoom buttons, names and symbols (WCAG 2.5.3):** each is an `<a role="button">` with `aria-label` and `title` "Zoom in"/"Zoom out", 30×30px, whose only visible content is a single symbol glyph (`+`/`−`) in an `aria-hidden` span. **Verdict: not an applicable 2.5.3 failure** — the W3C Understanding guidance treats symbolic characters as icons rather than text labels, and the accessible name fully describes the function; axe's "unable to determine" is inconclusive by design here. Recorded; nothing to fix.
- **Zoom-control contrast and focus visibility:** glyph `rgb(0,0,0)` on `rgb(255,255,255)` = **21:1** (and 19.09:1 on the `#f4f4f4` hover/active background), 22px bold — passes 1.4.3 and 1.4.11 with large margin. The disabled state (`.leaflet-disabled`, grey on light grey, seen only at the minimum zoom) is an inactive component, exempt under 1.4.3/1.4.11. Keyboard focus on each zoom control shows the app's global ring: `outline: solid 3px rgb(26,95,180)`, 2px offset, `:focus-visible` true — passes 2.4.7; ring-to-white contrast ≈ 6.5:1 (≥ 3:1). **Verdict: no defect.**
- **Attribution-link contrast:** text `#333` on the control's `rgba(255,255,255,0.8)` background = 12.6:1 over white and 10.1:1 over mid-grey tiles — passes. Links are `rgb(0,120,168)` at 12px (small text, 4.5:1 required): **4.94:1 over white tiles (passes), 3.96:1 over a mid-grey tile, 3.47:1 over a dark tile** (would fail). The standard OpenStreetMap style is light almost everywhere (water, forest, built-up areas are all pale), so the links very likely pass in practice, but the 20% translucency makes it **inconclusive rather than proven** — exactly what axe reported (it stopped at the Leaflet flag image, which is `aria-hidden`). **Verdict: inconclusive, not a confirmed violation.** A deterministic fix exists and is trivial (one CSS rule making `.leaflet-control-attribution` opaque white → 4.94:1 guaranteed), but it overrides a third-party control's styling and the dev-only tile provider/attribution is itself slated to change when the production provider is chosen (ADR-004, M06-T01). **Not applied; developer decision requested:** apply the one-rule override now, or defer to the provider decision.
- **Text below the profile mini-map ("overlapped by another element"):** measured on the full-profile page: every paragraph's bounding box lies entirely below the map container's bottom edge, the map container has `overflow: hidden`, and `elementsFromPoint` at the centre of each paragraph returns the paragraph itself (or its own link/button) as the topmost element. **Verdict: false positive** — axe sees Leaflet's absolutely positioned panes, which are clipped by the container, as potential overlap; nothing actually covers the text. No defect.
- **Needs-review counts vary between runs:** across the full-suite runs the `color-contrast` incomplete count for a state ranged from 1 to 11 nodes (e.g. attribution links or text momentarily "overlapped" while Leaflet's tile fade-in/popup fade/pan animations were mid-flight at scan time). Every one was an *inconclusive* check; **violations were 0 in all eight full-suite runs this session**. Recorded as a known characteristic; a future hardening could wait for Leaflet's fade animations to settle before scanning (not changed now — the spec is stable and no exclusion is involved).

**Confirmed applicable WCAG 2.2 AA violations found in 5d: none.**

**3. Keyboard instructions — evaluation and recommendation:** the one behaviour a keyboard user cannot infer is that arrow keys pan only while the *map container* is focused (not a focused marker — Leaflet's keyboard handler listens only when the container itself has focus, confirmed in Increment 4), and that markers open with Enter/Space and close with Escape. Nothing on the page says so today. **Recommendation (not implemented; approval requested): add one short, always-visible sentence immediately before the map** — e.g. "Keyboard: Tab to the map and use the arrow keys to pan and + / − to zoom; Tab again to reach each landmark, then Enter or Space to open its details and Escape to close." — as plain text in the existing intro area, not a live region and not inside the map. Rationale: it improves discoverability for everyone (sighted keyboard users and screen-reader users alike), costs one paragraph, adds no interaction, and avoids `aria-describedby` on the Leaflet container (which would be announced on every focus of the map). Its necessity should be confirmed by the developer's manual pass (checklist step B5 asks whether the arrow-key limitation was surprising).

**4. Regression and accessibility checks (all executed):** `prettier --check` on every file touched in M02-T08 (clean); `tsc -b --noEmit` (0 errors); `eslint .` and `eslint e2e` (0 errors); `vitest run` (34 files, **296 tests**, all pass); `vite build` (succeeds); `playwright test` (**22/22**, twice); all six axe states **0 violations**, with **no rule or element exclusions** (grep for `disableRules`/`exclude`/`withRules`/`include`: none). **Map-pane transform assertion review:** the `keyboard-panning` spec passed in every full-suite run this session (10 runs including both negative-control rebuilds; 0 failures, 0 flaky retries, no retries configured) — no brittleness observed; the test is left unchanged, per the instruction not to change a stable test without evidence. **Pre-existing finding, out of scope, recorded:** the root `prettier --check .` reports **52 files** with formatting drift (all unmodified by M02-T08 — e.g. `geo.ts`, `useMapMarkers.ts`, `LandmarkMap.tsx`; line-wrapping at the project's `printWidth: 100`, not line endings). Every file this task touched is Prettier-clean. Not reformatted here (unrelated-change boundary); listed as a follow-up for a separate housekeeping pass.

**5. Manual physical-keyboard checklist:** `docs/M02-T08_MANUAL_KEYBOARD_CHECKLIST.md` — step-by-step with expected outcomes for map panning, marker focus and activation, popup navigation and dismissal, Shift+Tab behaviour, focus restoration after geographic result changes, and skip-link navigation; it states how to obtain synthetic `PUBLIC` fixtures without touching real data, and where to record results. **Status: PENDING until the developer executes it in a foreground browser window; the automated Chromium verification above does not substitute for it.**

**6. Scope statement on conformance:** this increment establishes zero axe violations across the approved states and passing automated keyboard journeys in Chromium. It does **not** claim complete WCAG 2.2 AA conformance: automated tooling covers a minority of criteria, only Chromium was exercised, and the human checks remain pending.

**Preserved follow-ups (unchanged or added here):** screen-reader testing (NVDA/JAWS/VoiceOver); Firefox/Safari verification (the e2e project is Chromium-only); actual GitHub Actions execution (no remote yet); the attribution-link contrast decision (override now vs. defer to the provider decision) and any other manual contrast/visual checks from the developer's pass; the keyboard-instruction decision; the 10 moderate `npm audit` findings held for separate dependency-security triage; the 52-file pre-existing Prettier drift for a separate housekeeping pass.

**Increment 5d — the two approved corrections (2026-11-04; implemented and verified; accepted by the developer 2026-11-05):**

**Decision 1 — attribution contrast (approved: apply the minimal opaque-background override).** New `frontend/src/map/leaflet-overrides.css` holding one rule, `.leaflet-container .leaflet-control-attribution { background: #fff; }`, imported immediately after `leaflet/dist/leaflet.css` in both `LandmarkMap.tsx` (discovery map) and `LandmarkLocationMap.tsx` (profile mini-map) — the project's existing pattern of per-component stylesheet imports, kept global only because the target class is Leaflet's own; nothing else of Leaflet's styling is overridden. **Real-browser verification (production build, real Chromium; tiles stubbed first with a white 1×1 PNG, then with a black one):** on both maps and under both tile colours the control's computed background is `rgb(255,255,255)` (opaque), attribution text contrast 12.63:1, both links ("Leaflet", "OpenStreetMap") **4.94:1 regardless of the tiles underneath** (previously 3.47–4.94:1 depending on tile darkness), the control visible (234×17px), links unchanged (same hrefs/names) and **reachable by Tab**. Axe's attribution needs-review nodes ("background could not be determined because element contains an image node") disappeared from the full-profile scan after the change (its `color-contrast` incomplete count fell from 5 to 2: the zoom glyph and the already-explained false-positive paragraph).

**Decision 2 — keyboard instruction (approved text).** `DiscoveryPage.tsx` now renders, immediately before the map, the exact paragraph "Keyboard controls: Use arrow keys to pan the focused map. Press Tab to move between markers, Enter or Space to open a marker, and Escape to close its popup." as plain `<p id="map-keyboard-help">` — no role, no live region, not focusable, same typography as the page's intro text (verified: same font family/size/colour as the intro paragraph), no modal/tooltip/help panel. **Accessible association:** `LandmarkMap` gains an optional `describedById` prop; a small child component applies `aria-describedby` to Leaflet's own focusable container (react-leaflet forwards only `className`/`id`/`style` to that element, so the attribute is applied through the map instance and removed on cleanup). The description is therefore attached to the element a keyboard user actually lands on and is announced once, on focusing the map — not on the wrapper region (whose name "Map of Tennessee natural landmarks" is unchanged), not on markers or popups, and with no live region, so there are no duplicate or repeated announcements (verified: zero `aria-live`/`status`/`alert` elements present in the idle state). **Non-interference:** the first Tab stops on the page are unchanged (skip links → nav → skip links → map container → markers → zoom controls); the instruction never appears in the Tab order; the production-build `keyboard-workflow` spec's map test — Tab to the container, ArrowLeft/ArrowUp pan — passes on this build, now additionally asserting that the focused container's `aria-describedby` resolves to the exact instruction text on a non-focusable `<p>`.

**Tests added/updated:** `frontend/src/map/LandmarkMap.leaflet.test.tsx` (new, real Leaflet: `aria-describedby` lands on `.leaflet-container` while the region keeps its name and gets no description; absent without the prop; removed when the prop is withdrawn), `frontend/src/routes/DiscoveryPage.test.tsx` (2 new: the exact visible instruction as plain non-live non-focusable `<p>` preceding the map; the map receives the instruction's id as `describedById`), `frontend/src/routes/DiscoveryPage.realHooks.test.tsx` (mock gains `getContainer`), `e2e/keyboard-workflow.spec.ts` (association + non-focusability assertions added to the map test).

**Verification (all executed after the final change):** `prettier --check` on every touched file (clean); `tsc -b --noEmit` (0 errors); `eslint .` and `eslint e2e` (0 errors); `vitest run` (35 files, **301 tests**, all pass); `vite build` (succeeds); `playwright test` (**22/22**, clean teardown); **all six axe scan states 0 violations**, no rule or element exclusions. One harness-only artefact noted for honesty: the ad-hoc verification script's last step pressed its arrow key after it had already tabbed past the map container, so its "pan" reading was meaningless — the committed e2e test is the evidence for arrow panning with the instruction present.

**Status:** both decisions implemented and verified; **accepted by the developer 2026-11-05** ("the implementation and verification satisfy the approved requirements"): (1) the opaque Leaflet attribution background applied consistently to the discovery map and the profile mini-map, and (2) the visible keyboard instructions associated with the map container through `aria-describedby`. The attribution-contrast and keyboard-instruction items are removed from the open-decisions list; the remaining follow-ups (screen readers, Firefox/Safari, GitHub Actions execution, dependency-security triage, unrelated Prettier housekeeping) are preserved unchanged. **Remaining acceptance step for M02-T08:** the developer's execution of `docs/M02-T08_MANUAL_KEYBOARD_CHECKLIST.md` in a normal foreground browser — **executed 2026-11-07; results below.**

**Manual physical-keyboard verification results (developer-executed, 2026-11-07; recorded as reported):**

Setup: Vite dev server on port 5173 proxying to the synthetic-fixture mock API on port 3000 (synthetic `PUBLIC` fixtures only; the development database and real classifications untouched; no backend or Docker running). Browser: Chrome or Edge per the checklist's instruction; the specific browser and version were not reported. Results as the developer reported them:

| Checklist area | Result |
|---|---|
| B — Arrow-key map panning | **Passed** |
| C — Marker keyboard focus and Enter activation | **Passed** |
| D/E — Popup navigation, Shift+Tab, and Escape | **Passed** |
| C5 — Space activation without page scrolling | **Passed** |
| A — Both skip links | **Passed** |
| Keyboard instructions (5d correction 2) | **Clear and usable** |
| F — Focus restoration when a focused marker disappears | **Not manually tested** — remains verified by the automated real-Leaflet component tests (`LandmarkMarkersRenderer.focusLoss.leaflet.test.tsx`) and production-build Playwright (`e2e/marker-focus-on-results-update.spec.ts`) only |
| G — Non-map results | Not separately reported; covered by `e2e/keyboard-workflow.spec.ts` and the Increment 2 real-browser pass |

No unexpected behaviour, visual glitch, or difference from the automated results was reported. This closes the human foreground-window keyboard verification that Increment 4's acceptance deferred to the final manual pass, and resolves the earlier "arrows do not pan from a focused marker" observation through the keyboard instruction (reported as clear and usable). The checklist file's own status line is updated to reference this record.

**Developer acceptance and task closure (2026-11-07):** the developer accepted M02-T08 as complete subject to the documentation and task-closure checks. Closure checks performed: all three acceptance criteria verified and ticked above with their evidence; the approved blocking conditions (no serious/critical axe findings, no confirmed-applicable WCAG 2.2 AA violation) hold on the final build (six states at 0 violations, no exclusions); the final automated state is 301 frontend tests, 22/22 Playwright, clean `tsc`/`eslint`/`vite build`; no backend, database, sensitivity-classification, or specification changes were made; the one dependency added (`@axe-core/playwright`, root devDependency) was explicitly approved. **Preserved follow-ups and limitations (not blockers, carried in §11):** screen-reader testing (NVDA/JAWS/VoiceOver); Firefox/Safari verification (e2e is Chromium-only); actual GitHub Actions execution (no remote yet); separate dependency-security triage of the 10 pre-existing moderate `npm audit` findings; separate Prettier housekeeping of 52 pre-existing files; real-`PUBLIC`-data browser verification (blocked by the unresolved classification policy); focus restoration after marker removal verified by automation only; no claim of complete WCAG 2.2 AA conformance. **Nothing has been committed** — M02-T08's changes remain uncommitted in the working tree alongside all prior work.

### Milestone 02 Completion Criteria

- [ ] Users can browse landmarks on the map.
- [ ] All supported landmark categories are represented.
- [ ] Landmark profiles display available information.
- [ ] Search and category filtering function correctly.
- [ ] Geographic discovery satisfies its specification.
- [ ] Relevant automated tests pass.
- [ ] Primary discovery workflows are usable on mobile devices.
- [ ] A non-map, accessible alternative to map-based discovery is available, per NFR 7.2.

---

## Milestone 03: User Accounts and Favorites

**Objective:** Establish secure authentication and personalized landmark collections.

**Related Requirements:** FR-07, FR-08

### M03-T01: Design User Data Model

**Status:** Proposed

**Dependencies:** M00-T02

**Scope:**
- Define user entities and relationships.
- Establish account constraints.
- Document data protection requirements.
- Resolve the `users` schema against Prisma/Better Auth schema ownership: Prisma is the sole schema/migration authority, including Better Auth's required tables, accessed via Better Auth's supported Prisma adapter; no redundant, independent user table is introduced (per `docs/DECISIONS.md` ADR-006).

### M03-T02: Implement Authentication Backend

**Status:** Proposed

**Dependencies:** M00-T04, M03-T01

**Scope:**
- Implement the approved authentication approach.
- Protect authentication endpoints.
- Establish session or token handling.
- Implement appropriate authentication error handling.
- Define and implement the CSRF protection strategy (origin/referer validation and/or tokens, per ADR-006).
- Implement authentication rate-limiting and brute-force protection on login/registration endpoints.
- Integrate Better Auth via its supported Prisma adapter, consistent with ADR-006's schema-ownership clarification.

### M03-T03: Implement Authentication Interface

**Status:** Proposed

**Dependencies:** M02-T01, M03-T02

**Scope:**
- Create registration and login interfaces.
- Provide validation and error feedback.
- Support the approved sign-out behavior.

### M03-T04: Implement Authorization

**Status:** Proposed

**Dependencies:** M03-T02

**Scope:**
- Enforce ownership and access rules.
- Protect authenticated operations.
- Test unauthorized access attempts.

### M03-T05: Implement Favorites Data Model and API

**Status:** Proposed

**Dependencies:** M01-T03, M03-T01, M03-T04

**Scope:**
- Establish user-to-landmark favorite relationships.
- Support adding, retrieving, and removing favorites.
- Prevent unintended duplicate favorites.
- Enforce user ownership.

### M03-T06: Implement Favorites Interface

**Status:** Proposed

**Dependencies:** M02-T04, M03-T03, M03-T05

**Scope:**
- Allow authenticated users to manage favorites.
- Display saved landmarks.
- Handle authentication and request failures.

### Milestone 03 Completion Criteria

- [ ] Users can register and authenticate securely.
- [ ] Protected operations enforce authorization.
- [ ] Favorites can be saved and removed.
- [ ] User data remains appropriately isolated.
- [ ] Authentication and authorization tests pass.

---

## Milestone 04: Ratings and Reviews

**Objective:** Allow authenticated users to contribute and manage landmark feedback.

**Related Requirements:** FR-09, FR-10

### M04-T01: Design Ratings and Reviews Model

**Status:** Proposed

**Dependencies:** M01-T03, M03-T01

**Scope:**
- Define review entities and relationships.
- Establish rating validation rules.
- Define review ownership.
- Establish moderation requirements.

### M04-T02: Implement Reviews API

**Status:** Proposed

**Dependencies:** M03-T04, M04-T01

**Scope:**
- Support creating and retrieving reviews.
- Support authorized review modification and deletion.
- Validate review content and ratings.
- Return appropriate error responses.

### M04-T03: Implement Reviews Interface

**Status:** Proposed

**Dependencies:** M02-T04, M03-T03, M04-T02

**Scope:**
- Display landmark ratings and reviews.
- Allow authenticated users to submit feedback.
- Provide validation and error states.
- Support authorized review management.

### M04-T04: Implement Review Protection and Moderation

**Status:** Proposed

**Dependencies:** M04-T02

**Scope:**
- Apply the approved moderation approach.
- Protect against unauthorized modification.
- Test malicious and invalid inputs.
- Verify relevant abuse protections.

### Milestone 04 Completion Criteria

- [ ] Users can submit valid ratings and reviews.
- [ ] Reviews are associated with the correct users and landmarks.
- [ ] Ownership rules are enforced.
- [ ] Invalid and unsafe inputs are handled.
- [ ] Relevant tests pass.

---

## Milestone 05: Trip Planning

**Objective:** Allow users to organize multiple landmarks into saved geographic itineraries.

**Related Requirements:** FR-06, FR-11, FR-12

### M05-T01: Define Trip Planning Behavior

**Status:** Proposed

**Dependencies:** M00-T01

**Scope:**
- Establish itinerary requirements.
- Define stop ordering and trip ownership.
- Clarify geographic distance calculations.
- Define expected map interactions.
- Exclude unsupported trail navigation assumptions.

### M05-T02: Design Trip Data Model

**Status:** Proposed

**Dependencies:** M03-T01, M05-T01

**Scope:**
- Define trips and ordered trip stops.
- Establish relationships and constraints.
- Define ownership and modification rules.

### M05-T03: Implement Trip Management API

**Status:** Proposed

**Dependencies:** M03-T04, M05-T02

**Scope:**
- Support creating, retrieving, updating, and deleting trips.
- Support adding, removing, and reordering stops.
- Enforce authorization.
- Validate trip data.

### M05-T04: Implement Trip Planning Interface

**Status:** Proposed

**Dependencies:** M02-T03, M05-T01

**Scope:**
- Allow users to select multiple landmarks.
- Display selected stops on a map.
- Support organizing an itinerary.
- Provide appropriate error and empty states.

### M05-T05: Implement Nearby Landmark Discovery

**Status:** Proposed

**Dependencies:** M02-T07, M05-T04

**Scope:**
- Identify landmarks near selected destinations.
- Display relevant geographic results.
- Distinguish geographic proximity from navigable travel distance.

### M05-T06: Implement Saved Trips

**Status:** Proposed

**Dependencies:** M03-T03, M05-T03, M05-T04

**Scope:**
- Allow authenticated users to save itineraries.
- Retrieve and edit existing trips.
- Handle invalid or unavailable landmarks.
- Enforce ownership rules.

### Milestone 05 Completion Criteria

- [ ] Users can build multi-stop itineraries.
- [ ] Authenticated users can manage saved trips.
- [ ] Trip ownership is enforced.
- [ ] Geographic information is presented accurately.
- [ ] Trip planning tests pass.

---

## Milestone 06: Offline Access

**Objective:** Provide approved offline access to landmark information and supported geographic map regions.

**Related Requirements:** FR-13, FR-14

### M06-T01: Define Offline Requirements and Constraints

**Status:** Proposed

**Dependencies:** M00-T02

**Scope:**
- Identify functionality required offline.
- Evaluate mapping provider licensing.
- Define download boundaries and storage limits.
- Establish offline data freshness requirements.
- Document technical feasibility.

**Acceptance Criteria:**
- [ ] Offline requirements are approved.
- [ ] Provider restrictions are documented.
- [ ] Storage and update behavior are defined.
- [ ] Technical feasibility is established.

### M06-T02: Establish Offline Application Support

**Status:** Proposed

**Dependencies:** M02-T01, M06-T01

**Scope:**
- Implement the approved offline application approach.
- Define caching boundaries.
- Provide offline availability indicators.
- Handle connectivity changes.

### M06-T03: Implement Offline Landmark Data

**Status:** Proposed

**Dependencies:** M01-T05, M06-T02

**Scope:**
- Support saving selected landmark information locally.
- Retrieve downloaded information without connectivity.
- Handle missing and outdated local data.
- Respect local storage constraints.

### M06-T04: Implement Offline Map Regions

**Status:** Proposed

**Dependencies:** M02-T02, M06-T01, M06-T02

**Scope:**
- Implement only the approved map downloading approach.
- Respect mapping provider licensing and storage restrictions.
- Handle incomplete downloads.
- Handle storage limitations and unavailable map data.

### M06-T05: Verify Offline Behavior

**Status:** Proposed

**Dependencies:** M06-T03, M06-T04

**Scope:**
- Test supported workflows without connectivity.
- Test interrupted downloads and recovery.
- Verify online-only features fail gracefully.
- Verify offline availability indicators.

### Milestone 06 Completion Criteria

- [ ] Approved landmark information is accessible offline.
- [ ] Supported offline map functionality is demonstrated.
- [ ] Offline availability is clearly communicated.
- [ ] Offline failure scenarios are tested.
- [ ] Any approved feasibility limitations are documented.

If offline map downloading proves infeasible under the selected provider's restrictions, the developer must approve a scope or implementation adjustment before the affected task is marked Complete.

---

## Milestone 07: Release Readiness

**Objective:** Verify the integrated application and prepare a reproducible final-project demonstration.

### M07-T01: Perform Integration and Regression Testing

**Status:** Proposed

**Scope:**
- Verify major workflows across application modules.
- Test interactions between map, accounts, reviews, trips, and offline functionality.
- Address identified regressions.
- Document remaining defects.

### M07-T02: Perform Security Review

**Status:** Proposed

**Scope:**
- Review authentication and authorization.
- Verify input validation and data protection.
- Review dependencies and configuration.
- Address identified high-priority vulnerabilities.

### M07-T03: Perform Accessibility and Usability Review

**Status:** Proposed

**Scope:**
- Evaluate keyboard navigation.
- Evaluate semantic structure and accessible labels.
- Test responsive layouts.
- Verify non-map alternatives for essential workflows.
- Review against the approved accessibility criteria.

### M07-T04: Perform Performance Review

**Status:** Proposed

**Scope:**
- Evaluate landmark retrieval performance.
- Evaluate map rendering with the expected dataset.
- Identify unnecessary requests or inefficient queries.
- Address significant bottlenecks.

### M07-T05: Prepare Deployment

**Status:** Proposed

**Scope:**
- Configure the approved deployment environment.
- Document environment requirements.
- Establish deployment and recovery procedures.
- Verify application startup and connectivity.

### M07-T06: Finalize Documentation

**Status:** Proposed

**Scope:**
- Update the project README.
- Review architecture and API documentation.
- Update requirements traceability.
- Record known limitations.
- Document AI-assisted development and verification activities.

### M07-T07: Prepare Final Demonstration

**Status:** Proposed

**Scope:**
- Define representative user workflows.
- Ensure representative workflows cover the full confirmed demonstration scope: landmark discovery, authentication, favorites, ratings/reviews, trip planning, offline landmark/trip data, and offline map-region downloads (subject to the feasibility contingency in Milestone 06).
- Prepare a repeatable demonstration scenario.
- Verify the deployed or locally hosted application.
- Summarize engineering decisions.
- Demonstrate the AI-assisted development process.

### Milestone 07 Completion Criteria

- [ ] Approved functionality is demonstrated.
- [ ] Critical workflows pass verification.
- [ ] High-priority defects are resolved or explicitly documented.
- [ ] Setup and deployment instructions are reproducible.
- [ ] Required project artifacts are complete.

---

## 7. Requirements Traceability

Every implementation task must reference the requirements it satisfies.

Detailed traceability will be maintained as feature specifications and tests are created.

| Requirement | Primary Milestone |
|-------------|-------------------|
| FR-01: Landmark Visualization | M02 |
| FR-02: Landmark Classification | M01, M02 |
| FR-03: Landmark Search | M02 |
| FR-04: Landmark Filtering | M02 |
| FR-05: Landmark Profiles | M02 |
| FR-06: Geographic Discovery | M02, M05 |
| FR-07: User Authentication | M03 |
| FR-08: Favorites | M03 |
| FR-09: Ratings and Reviews | M04 |
| FR-10: Review Management | M04 |
| FR-11: Trip Creation | M05 |
| FR-12: Trip Management | M05 |
| FR-13: Offline Landmark Information | M06 |
| FR-14: Offline Maps | M06 |

Requirement identifiers must remain consistent with `docs/PROJECT_PLAN.md`.

## 8. Task Execution Protocol

When the developer selects an implementation task, Claude must:

1. Read `CLAUDE.md`.
2. Review the relevant portions of this implementation plan.
3. Read the applicable approved feature specification.
4. Identify and read applicable engineering skills.
5. Inspect relevant existing code and conventions.
6. Identify dependencies, risks, assumptions, and conflicts.
7. Present a focused implementation plan.
8. List files expected to be created or modified.
9. Define observable acceptance criteria and verification steps.
10. Stop and wait for explicit developer approval.
11. Implement only the approved changes.
12. Execute relevant verification steps.
13. Report actual results, including failures and unverified behavior.
14. Update task status and relevant documentation.
15. Stop and wait for the next instruction.

If prerequisites are missing, Claude must identify the blocker rather than inventing requirements or proceeding with unsupported assumptions.

## 9. Plan Maintenance Rules

This document is the authoritative record of implementation progress.

### 9.1 Task Updates

1. Update task statuses as work progresses.
2. Refine task descriptions and acceptance criteria before implementation.
3. Reference approved specifications rather than duplicating detailed requirements.
4. Record dependencies and blockers as they are identified.
5. Mark acceptance criteria complete only after successful verification.
6. Do not change approved project scope without explicit developer approval.
7. Do not remove completed tasks or their verification history.
8. Keep future tasks at a high level until they are ready for refinement.
9. Update this document after each completed implementation task.
10. Stop and request clarification when a proposed change conflicts with approved requirements or architectural decisions.

### 9.2 Task Refinement

Before a task moves from Proposed to Ready:

- Confirm that relevant requirements are approved.
- Identify the applicable specification.
- Verify that required architectural decisions are recorded.
- Identify relevant engineering skills.
- Confirm dependencies are satisfied.
- Define task-specific acceptance criteria.
- Define verification methods.
- Identify unresolved assumptions or risks.

A task must not be marked Ready if a blocking prerequisite remains unresolved.

### 9.3 Completion and Verification

After implementing an approved task:

1. Execute the relevant verification procedures.
2. Compare observed results with acceptance criteria.
3. Record which checks passed, failed, or were not executed.
4. Update the task status based on verified results.
5. Document relevant limitations and follow-up work.
6. Update dependent tasks when necessary.
7. Stop and wait for developer review or the next instruction.

Do not mark unverified acceptance criteria as satisfied.

### 9.4 Scope and Architecture Changes

Changes affecting approved scope, requirements, or architecture must receive explicit developer approval.

When a change is proposed:

1. Identify the affected requirements and tasks.
2. Explain the reason for the change.
3. Describe the impact on dependencies and milestones.
4. Present alternatives and tradeoffs where appropriate.
5. Wait for approval before updating affected approved documents or implementing the change.
6. Record approved architectural decisions in `docs/DECISIONS.md`.

Routine task-status updates and documentation of actual verification results do not require separate scope-change approval.

### 9.5 Progress Tracking

Maintain the following information for active and completed tasks:

- Task identifier and title.
- Current status.
- Related requirements and specifications.
- Dependencies and blockers.
- Approved scope.
- Acceptance criteria.
- Verification results.
- Relevant limitations or follow-up work.

Preserve enough history to explain how the project progressed from planning to verified implementation.

## 10. Change Management

The implementation roadmap may evolve as the project progresses.

Changes must:

- Remain consistent with the approved project scope.
- Reference applicable requirements and specifications.
- Identify affected dependencies.
- Be reviewed before implementation.
- Be documented when approved.

New features must not be introduced solely because they are technically convenient or suggested by an AI assistant.

If a conflict exists between this plan and another approved project document, follow the conflict escalation procedure in `CLAUDE.md`.

## 11. Current Project Status

**Project Phase:** Planning

**Current Milestone:** M01 — Landmark Data Foundation is **Complete**. M02 — Landmark Discovery: all eight tasks (M02-T01 through M02-T08) are **Complete**; the milestone's own completion criteria (below M02-T08) have **not yet been formally reviewed and ticked** — in particular "Primary discovery workflows are usable on mobile devices" has only mobile-*width* layout evidence (M02-T01/M02-T02), not touch-device verification, and "Geographic discovery satisfies its specification" and the real-`PUBLIC`-data items depend on the unresolved classification policy. Milestone closure is a developer decision to be taken explicitly. M03 — User Accounts and Favorites has not started.

**Current Task:** none in progress. M02-T08 (Implement Accessible Non-Map Discovery and Keyboard-Accessible Map Interactions) was **marked Complete 2026-11-07** after the developer's manual physical-keyboard verification and acceptance (full increment history, verification evidence, manual results, and preserved follow-ups are in the M02-T08 record). **Task count: 19 of 47 planned tasks Complete** (M00: 6 of 6; M01: 5 of 5; M02: 8 of 8; M03–M07: 0 of 28). **Next planned task: M03-T01 — Design User Data Model** (status Proposed; dependency M00-T02 satisfied), which starts only on the developer's explicit go-ahead and begins with a plan, not implementation. Before or alongside it the developer may wish to decide Milestone 02 closure (see Current Milestone) and the still-unresolved, release-blocking sensitive-location classification policy, which M03 does not depend on but which continues to block real-`PUBLIC`-data verification across M02. Nothing is committed: every file in the repository, M00 through M02-T08 inclusive, is still untracked in git.

**Session Handoff (2026-11-07) — resuming in a new session:** M02-T08 is Complete and developer-accepted; no task is in progress. The repository's verified state: `tsc -b --noEmit` 0 errors, `eslint .` 0 errors, `vitest run` 35 files / 301 tests, `vite build` succeeds, Playwright 22/22 (Chromium, production build against `landmarks_test`), six axe states at 0 violations. On this machine `npm run <script>` wrappers are blocked by group policy, so checks run via `node` against the binaries directly (see M02-T08's Increment 3 record for the exact commands); Playwright reuses any server answering `/health` on port 3000, so stop any scratch mock API before e2e. **Next step: M03-T01 (Design User Data Model), only on explicit developer go-ahead**, starting from `specs/` (locate or request its specification), ADR-006 in `docs/DECISIONS.md` (Prisma as sole schema authority, Better Auth via its Prisma adapter), and the `postgres-prisma`/`spec-driven-development` skills — plan first, then stop for approval. Open developer decisions that are not tasks: Milestone 02 formal closure; the sensitive-location classification policy; whether and when to make the first git commit of the untracked repository. Continue the established workflow unchanged: plan → explicit approval → small implementation increments → verification → review → acceptance, one increment at a time, stopping for developer review after each.

**Implementation Authorization:** M00-T01 through M00-T06 are complete and verified. M00-T05's GitHub Actions execution itself remains unverified (no git history or remote exists in this repository) — see M00-T05's Verification Results. M01 (Landmark Data Foundation) is Complete in full, including the initial `landmarks_dev` import. M02-T01 through M02-T08 are Complete (M02-T08 accepted 2026-11-07). No task is currently authorized or in progress: M03-T01 and all subsequent tasks await explicit developer go-ahead before any work begins; the sensitive-location classification policy remains unresolved and release-blocking throughout.

**Open Follow-Up Items:**
- Keyboard arrow-key map panning (from M02-T02): previously recorded as "confirmed still broken" during M02-T08 planning, but that reproduction was never documented (the handoff note referred to a root-cause trail that did not exist in this file). **Re-investigated in M02-T08 Increment 4 (2026-11-04)** with instrumented real-browser input against both the app and standalone Leaflet: **no application defect found** — panning works via Tab, programmatic focus, and mouse-click focus in dev and production builds, and `e2e/keyboard-panning.spec.ts` now guards it. The earlier "broken" result is most consistent with an automation-focus artifact (container made `activeElement` without a `focus` event in an unfocused window, so Leaflet's handler never activates), which was captured directly in the in-app pane. Full trail in M02-T08's Increment 4 Verification Results. **Closed 2026-11-04 by developer acceptance: resolved through verification, no production fix required**, with the explicit caveat that the automation-focus explanation is not conclusively proven for every earlier observation, and with human foreground-window keyboard verification deferred to the final manual accessibility pass. Two related observations are preserved there for final accessibility review (arrows do not pan while a marker has focus — consider brief keyboard instructions; the map-pane transform assertion may need revisiting if brittle).
- **M02-T08 accessibility follow-up — Shift+Tab from popup content** (recorded at Increment 3 acceptance): **resolved — investigated and fixed in Increment 5c (Option A), accepted by the developer 2026-11-04.** Shift+Tab at the popup's backward boundary now returns to the originating marker with the popup open; rationale and regression coverage (`LandmarkMarkersRenderer.shiftTab.leaflet.test.tsx`, `e2e/popup-backward-navigation.spec.ts`) preserved in M02-T08's Increment 5c records.
- **M02-T08 accessibility follow-up — focus loss when a focused marker is removed** (recorded at Increment 3 acceptance; was a potential completion blocker): **resolved — fixed in Increment 5a and accepted by the developer 2026-11-04.** Focus now moves to the geographic-results heading when the focused marker or its open popup is removed by a results update, with no steal otherwise; verified with real Leaflet in component tests and real-browser Playwright with changing synthetic `PUBLIC` results. Rationale and regression tests preserved in M02-T08's Increment 5a Verification Results.
- **M02-T08 deferred follow-ups (recorded 2026-11-04 at Increment 5d; confirmed at task closure 2026-11-07; none blocked Complete):** screen-reader testing (NVDA/JAWS/VoiceOver); Firefox/Safari verification (the Playwright project is Chromium-only; the manual checklist is reusable for this); actual GitHub Actions execution (no remote yet); separate dependency-security triage of the 10 pre-existing moderate `npm audit` findings (dev-only, `minimatch` via eslint/typescript-eslint); separate housekeeping pass for 52 pre-existing files failing root `prettier --check .` (none touched by M02-T08); focus restoration after a focused marker is removed was verified by automation only (the developer did not manually test checklist section F). The natural home for the accessibility items is M07-T03 (Accessibility and Usability Review) unless the developer schedules them earlier. *(The manual physical-keyboard pass was executed 2026-11-07 — results in the M02-T08 record; the attribution-contrast and keyboard-instruction decisions were approved and implemented 2026-11-04 — neither is open.)*
- Marker rendering against real `PUBLIC` data (from M02-T03, now also applying to M02-T07/M02-T08's geographic discovery) has not been browser-verified, since no `PUBLIC` landmark currently exists — only synthetic-fixture tests and the real-`UNREVIEWED`-data checks recorded under M02-T07 cover this. Revisit once classification produces real `PUBLIC` records.
- Full `PUBLIC` profile and mini-map rendering (from M02-T04) has not been browser-verified against real data, since no `PUBLIC` landmark currently exists — only synthetic-fixture tests cover this. Revisit once classification produces real `PUBLIC` records.

*(The search Retry button's real-click-to-real-refetch path, previously an open item, was closed in M02-T06 by `LandmarkSearch.realHook.test.tsx` — see M02-T05's and M02-T06's Verification Results for the full history; not repeated here as it's no longer open. Likewise, M02-T03's marker coordinate-validation and `MAX_MARKER_PAGES` follow-ups, and M02-T04's profile-return-navigation follow-up, and M02-T05/M02-T06's map/list-reconciliation follow-up were all closed by M02-T07. `useLandmarkSearch`'s previous-results retention follow-up, recorded during M02-T07's final verification, was closed by M02-T08's increment 1 — see M02-T08's Increment 1 Verification Results for the full history.)*

**Next Planned Activities:**

1. **M02-T08 closed Complete 2026-11-07.** Increment acceptance trail: 3 (marker accessibility, incl. both Escape deviations), 4 (keyboard-panning resolved through verification; `e2e/keyboard-panning.spec.ts`), 5a (focus-loss fix), 5b (`@axe-core/playwright` + `role="group"` correction), 5c (Shift+Tab Option A) all accepted 2026-11-04; 5d's automated verification and its two corrections accepted 2026-11-05; the developer's manual physical-keyboard pass executed 2026-11-07 (A–E passed, keyboard instruction clear and usable, F not manually tested). Final state 301 frontend tests, 22/22 Playwright, six axe states at 0 violations, no exclusions.
2. **Next planned task: M03-T01 — Design User Data Model** (Proposed). Scope as planned: define user entities and relationships, establish account constraints, document data-protection requirements, and resolve the `users` schema against Prisma/Better Auth ownership per ADR-006 (Prisma sole schema/migration authority, Better Auth via its Prisma adapter, no redundant user table). It is a design task: its deliverable is an approved data model and decision record, not application code. **Not started; awaits explicit developer go-ahead**, then begins with Phase 1 (specification lookup under `specs/`, ADR-006, applicable skills) and a plan for approval.
3. Developer decisions pending that are not tasks: formal Milestone 02 closure against its completion criteria (mobile-device usability has width-only evidence); the sensitive-location classification policy (release-blocking; also gates real-`PUBLIC`-data verification); the first git commit of the still-untracked repository.
4. Once a git remote exists, confirm the CI workflow actually runs successfully on GitHub Actions (currently unverified).

No application feature implementation tasks beyond what is explicitly approved are authorized at this stage.
