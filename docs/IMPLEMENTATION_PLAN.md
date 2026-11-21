
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

**Status:** Complete (locally verified at the time; GitHub Actions execution itself was first verified on 2026-11-17 — run #14 on `6c7dccf`, both jobs green, after two ordering corrections to the workflow recorded in §11; see Verification Results for the original limitation)

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

**Open defect (found 2026-11-20 during M03-T05 Increment 4; accepted by the developer as a defect requiring a separately planned and approved correction):** a metadata-only change to an existing active landmark (same coordinates and `source_file`) is classified `unchanged` by preflight and not written by `applyImport`, so display-name, description, and potentially other metadata changes are not persisted, contrary to `specs/LANDMARK_DATA_IMPORT_SPEC.md` §5.1. Full description and impact in the M03-T05 record's follow-ups.

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

**Status:** Complete — implemented in increments 1–4 and 5a–5d (each verified and accepted by the developer, 2026-11-04/05), manually verified by the developer with a physical keyboard in a foreground browser (2026-11-07), and **accepted as complete by the developer 2026-11-07** subject to the documentation and task-closure checks recorded below. Deferred follow-ups and limitations preserved (see the closure record and §11). Committed and pushed by the developer 2026-11-07 (commit `6ba9ff9`, "M02 complete", 178 files, `origin/main`).

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

**Developer acceptance and task closure (2026-11-07):** the developer accepted M02-T08 as complete subject to the documentation and task-closure checks. Closure checks performed: all three acceptance criteria verified and ticked above with their evidence; the approved blocking conditions (no serious/critical axe findings, no confirmed-applicable WCAG 2.2 AA violation) hold on the final build (six states at 0 violations, no exclusions); the final automated state is 301 frontend tests, 22/22 Playwright, clean `tsc`/`eslint`/`vite build`; no backend, database, sensitivity-classification, or specification changes were made; the one dependency added (`@axe-core/playwright`, root devDependency) was explicitly approved. **Preserved follow-ups and limitations (not blockers, carried in §11):** screen-reader testing (NVDA/JAWS/VoiceOver); Firefox/Safari verification (e2e is Chromium-only); actual GitHub Actions execution (**triggered by the push but not executed** — see the commit-state note below); separate dependency-security triage of the 10 pre-existing moderate `npm audit` findings; separate Prettier housekeeping of 52 pre-existing files; real-`PUBLIC`-data browser verification (blocked by the unresolved classification policy); focus restoration after marker removal verified by automation only; no claim of complete WCAG 2.2 AA conformance. **Commit state (observed 2026-11-07, after the closure record was written):** the developer committed the entire repository as `6ba9ff9` "M02 complete" (178 files) and pushed it to `origin/main` at `https://github.com/tpalme14/hidden_tennessee.git`; This was the first commit in the repository's history. **GitHub Actions result (read from the public Actions page and API, 2026-11-07):** the push triggered workflow run #1 (`CI`, run id 42416232093) and both jobs (`quality`, `regression`) concluded **failure with zero steps executed** — the job annotation reads "The job was not started because your account is locked due to a billing issue." No checkout, install, lint, test, or build ran, so CI has still **never exercised this code**; the M00-T05 follow-up stays open and now requires a developer action (resolve the GitHub account/billing status, then re-run the workflow) before it can be verified. Dependabot is active on the remote and opened seven PRs (actions/checkout 7, actions/setup-node 7, vite 8.3.5, react-router 8.5.1, jsdom 30.1.3, `@testing-library/jest-dom` 7.0.1, concurrently 10.0.6), each with the same not-started CI failure; several are major-version bumps and must be triaged, not merged on green — recorded under the dependency-security follow-up.

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

**Status:** Complete — design task; planning authorized 2026-11-07, an initial plan and a focused revision were reviewed, and the **final design was approved by the developer 2026-11-07** with six recorded decisions (below). This closure record and ADR-011 in `docs/DECISIONS.md` were both accepted by the developer on 2026-11-07 (ADR-011 status: Accepted). No application code, Prisma schema, migration, dependency, or database change was made or is authorized by this task; the identity tables are implemented in M03-T02 and the favorites table in M03-T05, each requiring its own go-ahead.

**Dependencies:** M00-T02

**Scope:**
- Define user entities and relationships.
- Establish account constraints.
- Document data protection requirements.
- Resolve the `users` schema against Prisma/Better Auth schema ownership: Prisma is the sole schema/migration authority, including Better Auth's required tables, accessed via Better Auth's supported Prisma adapter; no redundant, independent user table is introduced (per `docs/DECISIONS.md` ADR-006).

**Acceptance Criteria:**
- [x] User entities and relationships are defined and approved (four Prisma-managed identity models plus the favorites relationship; reviews/trips attach by the same pattern later).
- [x] Prisma remains the sole schema/migration authority; Better Auth uses its Prisma adapter against the shared `User` model; no redundant user table exists.
- [x] Account uniqueness and integrity constraints are defined (email uniqueness incl. case-insensitive safeguard; one credential account per user; UUID-typed foreign keys; RESTRICT on application relationships).
- [x] Data-protection and account-deletion requirements are documented (minimal collection, no secrets in responses/logs, retention, deletion out of scope and made non-accidental).
- [x] Every design decision is traceable to the specification, an ADR, or a verified Better Auth 1.7.18 source fact; unresolved items are recorded as explicit M03-T02 verification requirements, not assumed.

**Verification Results (2026-11-07) — design approved by the developer across two planning rounds:**

**Sources.** `specs/AUTHENTICATION_FAVORITES_SPEC.md` v0.3 (§§2–3, 6, 9–10); ADR-006 (Better Auth, Prisma ownership, authorization model), ADR-007 (offline account data), ADR-010 (migration workflow); the Reviews and Trips specifications where they reference the user model; the current `backend/prisma/schema.prisma` and initial migration (conventions); Better Auth **1.7.18** (latest on npm at review time; peer range accepts the installed Prisma 7.10.1) — read from its source at the `v1.7.18` tag (`packages/core/src/db/get-tables.ts`, `packages/core/src/types/init-options.ts`, `packages/core/src/db/adapter/get-id-field.ts`, `packages/prisma-adapter/src/prisma-adapter.ts`, `packages/better-auth/src/api/routes/sign-up.ts`, `sign-in.ts`, `password.ts`, `packages/better-auth/src/db/internal-adapter.ts`, `with-hooks.ts`, `packages/core/src/utils/ip.ts`) and its docs for that tag. Better Auth was **not** installed.

**Approved user entities (all Prisma-managed, in the same `schema.prisma` as `Landmark`; project conventions apply unchanged — snake_case columns via `@map`, plural snake_case tables via `@@map`, UUID primary keys via `gen_random_uuid()`, `TIMESTAMP(3)` timestamps — because the Prisma adapter addresses Prisma *models and fields*, not table/column names, so no Better Auth `modelName`/`fields` remapping is needed):**

| Prisma model | Table | Fields beyond `id`, `created_at`, `updated_at` | Integrity |
|---|---|---|---|
| `User` | `users` | `name` (required by Better Auth; server-forced to `""`), `email` (required), `email_verified` (default false), `image` (nullable, never populated) | unique `email`; **hand-written unique index on `lower(email)`** |
| `Session` | `sessions` | `token`, `expires_at`, `ip_address` (nullable, blanked), `user_agent` (nullable, blanked), `user_id` | unique `token`; index `user_id`; FK → `users` **cascade** (Better Auth's own identity semantics) |
| `Account` | `accounts` | `account_id`, `provider_id`, `user_id`, `password` (nullable scrypt hash), `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope` (all nullable, never populated — no OAuth providers) | index `user_id`; **declarative unique `(provider_id, account_id)`**; **hand-written partial unique index on `user_id` WHERE `provider_id = 'credential'`**; FK → `users` **cascade** |
| `Verification` | `verifications` | `identifier`, `value`, `expires_at` | index `identifier` |
| `Favorite` (spec §6.1; implemented in M03-T05) | `favorites` | `user_id`, `landmark_id` | **unique `(user_id, landmark_id)`**; FK → `users` **RESTRICT**; FK → `landmarks` **RESTRICT** (retirement keeps favorites); index `(user_id, created_at DESC, id)` for the newest-first paginated listing with stable tie-break; references the internal landmark UUID, never `source_code` |

The password hash lives only in `accounts.password` with `provider_id = 'credential'` and `account_id = user id` (verified in `sign-up.ts`), never on `users`. The unused OAuth columns remain in the schema because Better Auth validates its full core schema at startup (`advanced.database.validateSchema`, default true). Cascade is confined to Better Auth's two identity tables; every application table (favorites now; reviews and trips later, by the same `user_id` UUID FK) uses RESTRICT, so no user deletion can silently remove application data (spec §10.2.6).

**The six approved decisions (developer, 2026-11-07):**
1. **Required `name`.** Verified: the sign-up body schema declares `name` as `z.string()` with no minimum, so an empty string passes; nothing downstream rejects it. Decision: keep the column; enforce `name = ""` on every user creation through Better Auth's `databaseHooks.user.create.before` hook (its returned `data` is merged over the incoming payload, so a client-supplied name is overridden); registration stays email + password only. Verify in M03-T02 (register with no name and with an injected name; assert the stored value is empty).
2. **UUID generation.** Verified: with `advanced.database.generateId: false` the `id` key is omitted from the insert, the Prisma adapter calls `prisma[model].create` and returns the full row, so the database default fills the id; a caller-supplied id is ignored with a logged warning. Decision: PostgreSQL-generated UUIDs (`@default(dbgenerated("gen_random_uuid()")) @db.Uuid`, as `landmarks`) with `generateId: false`. M03-T02 checks: a registered user's id is a valid UUID; startup schema validation passes; no "id will be ignored" warning is logged. **Fallback** if any check fails: `generateId: "uuid"` (library-generated UUID into the same column; no schema change).
3. **Session metadata.** Verified: `ip_address`/`user_agent` are always populated at session creation; `advanced.ipAddress.disableIpTracking` exists but disables IP resolution globally, including for the rate limiter (its own doc comment warns of abuse exposure); no option disables user-agent storage; `databaseHooks.session.create.before` is generic and can blank either field. Decision: keep both nullable columns for schema compatibility; **do not persist IP addresses or user agents in session records** unless a demonstrated security requirement makes it necessary — blank both in the session-creation hook while leaving IP tracking enabled so IP-based rate limiting still works. Verify in M03-T02 (stored session rows carry empty/null values; throttling still keys by IP).
4. **Rate limiting.** Verified: enabled only in production by default; memory storage by default; counted per client IP read from `X-Forwarded-For` unless `ipAddressHeaders`/`trustedProxies` are configured; a built-in rule exists only for `/sign-in/email` (3 per 10 s); registration and reset-request paths have no default rule; `"database"` storage adds a `rateLimit` table (unique `key`, `count`, `lastRequest`). Implications: memory counters are per process (reset on every Render deploy/restart; not shared across instances — acceptable under ADR-006's single instance but gives a free window after restarts); database storage survives restarts at the cost of a write per limited request and a Prisma-owned table under ADR-010. Decision: **no rate-limit table in M03-T01**; M03-T02 must, before authentication acceptance, explicitly choose memory or database storage, add custom rules for registration and password-reset endpoints, source client IPs from a trusted proxy configuration (never arbitrary forwarded headers), enable the limiter in the test environment, and prove throttling by integration test.
5. **Email handling.** Verified: sign-up lowercases before the existence check and storage; sign-in lowercases before lookup; `findUserByEmail` additionally NFC-normalizes and rejects near-matches; format validated by `z.email()` in both routes; a duplicate registration returns HTTP 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` unless `autoSignIn` is false or email verification is required, in which case a generic success-shaped response is returned. Decision: retain the `lower(email)` unique index as defense in depth (also guards writes that bypass Better Auth); **prefer `autoSignIn: false`** to reduce account enumeration, with a consistent registration confirmation followed by a **user-initiated** sign-in (no automatic sign-in after registration). M03-T02 verification: register with a mixed-case address and assert lowercase storage; sign in with lower/upper/mixed case and assert success; register the same address in a different case and assert the generic response; insert an uppercase duplicate directly into the test database and assert the unique index rejects it; confirm registration and reset responses do not reveal account existence.
6. **Credential-account uniqueness.** Verified: credential accounts are created with `providerId: "credential"` and `accountId: <user id>`; sign-in, `findCredentialAccount`, and `updatePassword` filter on user id + provider + account id and take the first match (or update all matches); nothing in the library prevents a second credential row. Assessment: unique `(provider_id, account_id)` enforces one credential row per user only via the library's account-id-equals-user-id convention. Decision: keep **both** the declarative composite unique `(provider_id, account_id)` (general identity integrity for any provider) and the hand-written partial unique index on `user_id` WHERE `provider_id = 'credential'` (states the intended rule directly). M03-T02 proves the partial index by attempting a second credential insert in the test database.

**Account uniqueness and integrity constraints (summary):** one account per email at the database level (Better Auth's unique on `email` plus the `lower(email)` index); one credential account per user (two constraints above); all `user_id`/`landmark_id` foreign keys typed `@db.Uuid` so malformed IDs fail at the database as well as in Zod; password length 8–128 enforced by Zod and by Better Auth's `minPasswordLength`/`maxPasswordLength`, whose defaults already match the spec.

**Data protection and account deletion:** collected data is limited to email, a scrypt password hash, session token and timestamps — IP address and user agent are not persisted (decision 3). Password hashes, session tokens, verification values, and raw user UUIDs are never exposed in API responses or logs (the Reviews spec already forbids raw UUIDs publicly; the existing error-envelope pattern applies). Retention: sessions expire (30-day renewable policy) and are revoked on sign-out and on password reset; Better Auth does not purge expired `sessions`/`verifications` rows automatically — periodic cleanup is a recorded follow-up, not designed here. Account deletion is out of scope (spec §1, §10.2.6): Better Auth's `user.deleteUser` stays disabled and every application table uses RESTRICT, so deletion cannot happen by accident; a future deletion/anonymization policy needs its own approval and migration. Offline account data is governed by ADR-007; nothing in this schema stores account data client-side.

**Installation-time verification requirements carried to M03-T02 (cannot be settled without installing the package):** the correct adapter import (docs name both `better-auth/adapters/prisma` and the `@better-auth/prisma-adapter` package, both published at 1.7.18); startup schema validation passing against the hand-authored models with `@map`/`@@map` conventions; whether reset tokens are stored hashed in `verifications`; the session option values implementing the 30-day renewable policy (expected `expiresIn` 30 days with `updateAge` 23 days, since Better Auth renews once `updateAge` has elapsed since the last renewal — confirmed by a time-controlled test); `resetPasswordTokenExpiresIn` overridden to 1800 s and `revokeSessionsOnPasswordReset: true` behaving as specified; the trusted client-IP header on Render; plus the per-decision checks listed above. The Better Auth CLI's generated Prisma models are reference only — the models are hand-authored and the migration applied via `prisma migrate deploy` per ADR-010, never `migrate dev`.

**Tensions resolved during planning (no spec/ADR conflict required escalation):** Better Auth's required `name` vs. the spec's email-and-password form (decision 1; spec §4.1 anticipated a library-required contract); Better Auth's `migrate dev` guidance vs. ADR-010 (ADR-010 governs); the spec's "renew within seven days of expiry" vs. Better Auth's `updateAge` semantics (mapped, to be verified); spec §10.2.6's no-cascade rule vs. Better Auth's own session/account cascades (confined to identity tables); the docs' inconsistent adapter package naming (verified at install).

**Not done in this task, by design:** no `schema.prisma` edit, no migration, no dependency installation, no database change, no rate-limit table, no email-provider selection (spec §10.3, before deployment), no classification decision. ADR-011 drafted in `docs/DECISIONS.md` to capture the identity-schema conventions and **accepted by the developer 2026-11-07**.

### M03-T02: Implement Authentication Backend

**Status:** Complete — closed 2026-11-13 on the developer's acceptance of Increment 7 and approval of the task-level completion review; all seven increments accepted, the specification requirements this task owns (§§2–4 and 9 of `specs/AUTHENTICATION_FAVORITES_SPEC.md` v0.3) satisfied per the reconciliation in the Increment 7 record, and the final local verification results approved. The deployment blockers and follow-ups listed in that record remain open and are carried forward in §11. History: the developer authorized the planning phase 2026-11-07; an implementation plan (scope, increments, Better Auth 1.7.18 integration, security requirements, ADR-010 migration/rollback procedure, per-increment tests, unresolved decisions) was prepared from the spec v0.3, ADR-006/010/011, the M03-T01 record, the existing backend/test conventions, and Better Auth's `v1.7.18` source/docs, and presented for review. **The seven-increment structure and the recommended decisions were approved in direction by the developer 2026-11-07** (database-backed rate limiting with a Prisma-managed table and an ADR-011 amendment; Nodemailer behind a `MailTransport` abstraction; native Better Auth error responses on `/api/auth/*`; test-only Express app for middleware tests; Better Auth validation on its endpoints and Zod on application-owned ones; trusted-proxy configuration with deployment-time verification; CI workflow updates in the final increment recorded as unverified), with six refinements requested (uniform password-reset unavailability response and log hygiene; time-controlled session-renewal test; CSRF handling of missing/null Origin and Referer, authenticated vs. unauthenticated requests, and dev-proxy/production compatibility; destructive rollback permitted only while the identity tables hold no user data; adapter install/import confirmation at the install increment; rate-limit table under ADR-010 with retention implications). This is approval of the plan's direction only — no dependency installation, application-code change, migration, database change, or implementation was authorized by that approval. The revised plan was then approved and **Increment 1 authorized 2026-11-07**; Increment 1 is implemented, verified, and **accepted by the developer 2026-11-07** (record below). **Increment 2 (Better Auth instance and Express mount): plan and the single `better-auth@1.7.18` dependency approved and implementation authorized by the developer 2026-11-09; implemented, locally verified, and accepted by the developer 2026-11-09** (record below). **Increment 3 (session policy and authentication middleware): plan approved with three refinements and implementation authorized by the developer 2026-11-09; implemented, locally verified, and accepted by the developer 2026-11-09** (record below). **Increment 4 (CSRF and cookie security): plan approved in principle 2026-11-09, three refinements verified, implementation authorized 2026-11-09; implemented, locally verified, and accepted by the developer 2026-11-10** (record below). **Increment 5 (database-backed rate limiting): thresholds and approach approved, three refinements verified, implementation authorized with the 503 wrapper 2026-11-10; implemented, locally verified, and accepted by the developer 2026-11-10** (record below). **Increment 6 (password reset): architecture and `nodemailer@10.5.0` approved, three refinements verified, implementation authorized 2026-11-10; implemented, locally verified, and accepted by the developer 2026-11-10** (record below). **Increment 7 (final closure and documentation): authorized 2026-11-10 after the task-level completion review; implemented and locally verified 2026-11-10, accepted by the developer 2026-11-13** (record and the final acceptance-criteria reconciliation below). GitHub Actions was unavailable throughout the task (account billing restriction, external to the application), so each increment was verified locally; the CI follow-up was closed on 2026-11-17 when run #14 on `6c7dccf` passed both jobs (see §11).

**Dependencies:** M00-T04, M03-T01

**Scope:**
- Implement the approved authentication approach.
- Protect authentication endpoints.
- Establish session or token handling.
- Implement appropriate authentication error handling.
- Define and implement the CSRF protection strategy (origin/referer validation and/or tokens, per ADR-006).
- Implement authentication rate-limiting and brute-force protection on login/registration endpoints.
- Integrate Better Auth via its supported Prisma adapter, consistent with ADR-006's schema-ownership clarification.

**Approved increments (2026-11-07):** 1 — identity and rate-limit schema with its ADR-010 migration; 2 — Better Auth 1.7.18 instance, hooks, and Express mount (dependency approval at that increment; adapter import path confirmed from registry metadata before any code); 3 — session policy (30-day renewable, 23-day `updateAge`; time-controlled test faking only `Date`) and `requireSession` middleware tested on a test-only Express app; 4 — CSRF (Better Auth's own origin check on `/api/auth/*`; application middleware on state-changing `/api/v1` requests that carry a session cookie: exact Origin match against the configured canonical origins, Referer-origin fallback only when Origin is absent, 403 for null/missing evidence; requests without a session cookie pass to the route's own 401; the Vite dev origin trusted only in development) and cookie attributes; 5 — database-backed rate limiting with rules for sign-in, registration, reset request, and reset completion, trusted-proxy IP sourcing, limiter enabled explicitly in its test; 6 — password reset behind a `MailTransport` abstraction (readiness check in a before-hook returning a uniform 503 to every caller before any account lookup; non-awaited delivery with failures logged as event codes only; Nodemailer SMTP transport as the second dependency request; Better Auth logger at warn level or above because the library logs the submitted email at info level on duplicate sign-up; hashed verification-identifier storage enabled if supported, else plaintext recorded as accepted); 7 — closure (env example, README, CI workflow variables recorded as unverified while GitHub Actions is unavailable, full local check sequence, record). Approved decisions: native Better Auth error shape on `/api/auth/*` with the project envelope on application routes; Better Auth validation on its endpoints and Zod on application-owned ones; destructive rollback permitted only while the identity tables hold no user data.

**Increment 1 Verification Results (2026-11-07) — identity and rate-limit schema — ACCEPTED by the developer 2026-11-07** (the migration to both databases, the ten schema integration tests, the preservation of all existing `landmarks` data and schema objects, the Prisma drift caveat for the hand-written indexes and the PostGIS generated column, and the local verification results below satisfy the approved acceptance criteria; the GitHub Actions follow-up continues — CI has still not executed this or any code because of the external account billing restriction, so all verification remains local):

**Changed files:** `backend/prisma/schema.prisma` (five new models `User`, `Session`, `Account`, `Verification`, `RateLimit` with design comments; `prisma format` also re-aligned whitespace inside the existing `Landmark` block — whitespace only, no semantic change), `backend/prisma/migrations/20261107230000_identity_schema/migration.sql` (new), `backend/prisma/migrations/20261107230000_identity_schema/down.sql` (new — recovery artifact, never executed), `backend/tests/identity-schema.integration.test.ts` (new — 10 tests), `docs/DECISIONS.md` (ADR-011 decision 9 amended), this file. No dependency installed; no application code under `backend/src` changed; no Better Auth code.

**Safeguard 1 — baseline verified before migrating:** `prisma migrate status` reported both `landmarks_test` and `landmarks_dev` at exactly the single `20261030181539_init_landmark` migration ("Database schema is up to date!"), and a read-only snapshot script recorded each database's full public-schema object list, enum definitions, extension list, and the `landmarks` table's columns (incl. generation expression), constraints, indexes, triggers, row count, and a row-content checksum (`landmarks_dev`: 1,692 rows; `landmarks_test`: 0 rows). No unexpected drift or history.

**Migration authoring (ADR-010):** candidate SQL generated non-interactively with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` against `landmarks_test` (Prisma 7.10 removed `--from-url`). As ADR-010 predicts, the tool proposed two statements against `landmarks` — `DROP INDEX "landmarks_location_gist_idx"` and `ALTER TABLE "landmarks" ALTER COLUMN "location" DROP NOT NULL` — the known shadow-diff artefact of the hand-written GENERATED column; **both were discarded**. The remaining output (five `CREATE TABLE`s, seven indexes, two foreign keys) was kept unmodified and hand-finished with the two ADR-011 indexes: `users_email_lower_key` UNIQUE on `lower("email")`, and `accounts_credential_user_key` UNIQUE on `("user_id") WHERE "provider_id" = 'credential'`. Foreign keys from `sessions`/`accounts` to `users` cascade (Better Auth's own identity tables only). Neither `prisma migrate dev`, `db push`, nor any reset command was used.

**Safeguard 2 — preservation verified after migrating:** applied via `prisma migrate deploy` to `landmarks_test` first, then (after all checks passed) to `landmarks_dev`; `migrate status` clean on both ("2 migrations found … Database schema is up to date!"). The before/after snapshots are **identical** on both databases for `landmarks` columns, constraints, indexes, triggers, enums, extensions, row count, and row checksum (`landmarks_dev` still 1,692 rows, same checksum). Direct inspection of `landmarks_dev` after migration lists the fourteen expected indexes on the five new tables (including the two hand-written ones), the two cascade foreign keys, and zero rows in every new table.

**Safeguard 3 — `down.sql`:** present beside the migration, never executed, with a leading `DO` block that raises an exception if any identity table contains data, and header rules stating that destructive rollback is prohibited once real identity data exists without a separately approved data-preservation strategy and that the `_prisma_migrations` row must then be removed by hand.

**Constraint verification (`backend/tests/identity-schema.integration.test.ts`, 10 tests, real `landmarks_test`):** database-generated v4 UUID ids with `name`/`email_verified`/`image` defaults; exact duplicate email rejected (P2002); email differing only by case rejected twice and a different address accepted (proves the `lower(email)` index); a second credential account with a *different* `account_id` rejected — which only the partial index can stop — while two `other`-provider rows for the same user are accepted (proves the partial index's scope); duplicate `(provider_id, account_id)` across two users rejected; deleting a user cascades its sessions and accounts; duplicate session token rejected and a session for an unknown user rejected (P2003); verification row stored; rate-limit key unique with BigInt epoch-ms round-trip; `landmarks.location` still `NOT NULL`, `GENERATED ALWAYS`, `geography`, and the four `landmarks` indexes (incl. GiST) intact; the migration SQL's non-comment statements contain no `landmarks`, `"location"`, or `gist` reference.

**Checks executed (all after the final change, via `node` against the binaries as before):** `prisma validate` (valid), `prisma format` (applied), `tsc --noEmit` (0 errors), `eslint .` (0 errors), `prettier --check` on the test file (clean; `.prisma`/`.sql` are not Prettier targets), backend unit `vitest run` (3 files, 46 tests, pass), backend integration `vitest run` (6 files, **52 tests**, pass — 42 existing + 10 new), backend `tsc -p tsconfig.json` build (ok), Playwright e2e against the production build on `landmarks_test` (**22/22** pass).

**Deviations / notes:** none from the approved scope. The migration folder timestamp `20261107230000` was chosen to sort after the landmarks migration and is not a precise clock reading. Prisma may report the two hand-written indexes as drift in future `migrate diff` output — the same known tooling limitation as the `location` column; discard, never apply. Docker Desktop was started for this verification and the Postgres container is left running. Nothing committed or pushed.

**Increment 2 Verification Results (2026-11-09) — Better Auth instance and Express mount — ACCEPTED by the developer 2026-11-09** (acceptance covers all three configuration additions — `customSyntheticUser`, `advanced.disableOriginCheck: false`, and the `user.update.before` hook — the 13 new integration tests, the successful local checks, the absence of new dependency-audit findings, and the continuing GitHub Actions limitation; **preserved follow-ups:** (1) a later security-verification increment must confirm synthetic and real registration responses have indistinguishable id and timestamp formats and assess meaningful timing differences without weakening the privacy requirement; (2) Increment 4 must review `/update-user`, `/change-email`, and `/change-password` against the specification and restrict or disable unauthorized functionality, including profile-image updates; (3) Increment 4 must verify attacker-controlled `Origin` values cannot produce unsafe or excessive log output; (4) the dependency-audit, Prettier, and GitHub Actions follow-ups stay open). The developer approved the Increment 2 plan and the dependency on 2026-11-09 with eight additional requirements (registration contract with `name: ""`; account-enumeration parity test with stop-and-report on failure; cookie attributes and no credentials in responses or logs; explicit secret in every environment, kept only in the ignored `.env`; CI workflow may carry test-only values, recorded as unverified; compatibility verification against the installed version with stop-and-report on incompatibility; `npm audit` after install with no unrelated upgrades; the full local check sequence). All eight are addressed below.

**Changed files:** `backend/package.json` (+ `"better-auth": "1.7.18"`, exact pin) and `package-lock.json`; `backend/src/auth/auth.ts` (new — the instance), `backend/src/auth/hooks.ts` (new — database hooks); `backend/src/config/env.ts` (`auth.secret` from `BETTER_AUTH_SECRET` and `auth.baseUrl` from `BETTER_AUTH_URL`, both **required in every environment**, plus `auth.trustedOrigins` = the Vite dev origin `http://localhost:5173` in development only); `backend/src/app.ts` (mount); `backend/src/routes/index.ts` (comment corrected — the auth mount is top-level, not under `/api/v1`); `backend/.env.example` (the three new variable names with a placeholder/generation hint, `BETTER_AUTH_URL=http://localhost:3000`, `BETTER_AUTH_TELEMETRY=0`); `backend/tests/setup/vitest.setup.integration.ts` (test-only values set unconditionally so a test run never reads a developer's real secret); `backend/tests/auth.integration.test.ts` (new — 13 tests); `playwright.config.ts` and `.github/workflows/ci.yml` (the same test-only values for the spawned production-mode server and both CI jobs). Local only, git-ignored, never displayed: `backend/.env` gained a freshly generated 32-byte base64url `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `BETTER_AUTH_TELEMETRY=0`. `git diff` was scanned: the only `BETTER_AUTH_SECRET` values in tracked changes are the empty placeholder and the literal string `test-only-better-auth-secret-not-for-production-0123456789abcdef`.

**Dependency installation:** `npm install better-auth@1.7.18 --save-exact --workspace=backend` added 19 packages (`better-auth`, `@better-auth/{core,prisma-adapter,kysely-adapter,memory-adapter,mongo-adapter,telemetry,utils}`, `better-call`, `kysely`, `jose`, `nanostores`, `rou3`, `@better-fetch/fetch`, `@noble/ciphers`, plus nested `@noble/hashes` and `set-cookie-parser`). The package resolved into `backend/node_modules/better-auth` (not hoisted) — normal workspace behaviour, no action needed. Import paths confirmed from the installed export map and used in code: `betterAuth` from `better-auth`, `prismaAdapter` from `better-auth/adapters/prisma` (re-exports `@better-auth/prisma-adapter@1.7.18`), `toNodeHandler` from `better-auth/node`. **`npm audit`: 10 moderate, 0 high/critical — all ten pre-existing** (the `minimatch` "globparts amplification" advisory reached through `eslint`/`@eslint/*`/`typescript-eslint`, dev-only; `minimatch@10.2.6` is already in the committed lockfile at `6ba9ff9`). **Zero findings introduced by `better-auth` or its dependencies.** Nothing upgraded; the findings stay in the dependency-security triage follow-up.

**Configuration (`backend/src/auth/auth.ts`):** Prisma adapter on the shared client (`provider: "postgresql"`); `baseURL`/`secret`/`trustedOrigins` from `env`; `emailAndPassword { enabled, autoSignIn: false, minPasswordLength: 8, maxPasswordLength: 128, customSyntheticUser }`; `session { expiresIn: 30 days, updateAge: 23 days }` (behaviour verified in Increment 3); `user.deleteUser.enabled: false`; `advanced.database.generateId: false`; `advanced.disableOriginCheck: false`; `databaseHooks`; `logger.level: "warn"`; `telemetry.enabled: false`. Rate limiting (Increment 5) and reset mail (Increment 6) untouched. **Hooks (`hooks.ts`):** `user.create.before` and `user.update.before` each return `{ data: { name: "" } }`; `session.create.before` returns `{ data: { ipAddress: null, userAgent: null } }`. Verified in the installed `createWithHooks`: a returned `data` object is shallow-merged over the pending row, so these values always win. **Mount (`app.ts`):** `app.all("/api/auth/*", toNodeHandler(auth))` registered before `express.json()`; all other middleware order unchanged.

**Compatibility verification against the installed 1.7.18 (developer requirement 6) — all passed, no incompatibility:** the Prisma adapter's startup schema check ran against the generated client's data model and raised nothing for the hand-authored `@map`ped models; `generateId: false` yields database `gen_random_uuid()` v4 UUIDs for users, accounts, and sessions with no "ignored id" warning; the session hook's `null` values are accepted by the library's schema (`z.string().nullish()`) and stored as SQL NULL; the mount reads request bodies correctly ahead of `express.json()`. Two installed-version facts corrected earlier assumptions and were handled by configuration, not code replacement: (a) the generic duplicate-sign-up response is built from a **synthetic user** whose `id` would be a random 32-character string (not a UUID) and whose `name` would echo the client's submission — a distinguishable response — so the documented `emailAndPassword.customSyntheticUser` option returns `{ ...coreFields, name: "", id: randomUUID() }`, making both responses identical in shape and values; (b) the library **skips its Origin/Referer check whenever `NODE_ENV=test`** (`skipOriginCheck` defaults to `isTest()`), which would have left the real CSRF path untested, so `advanced.disableOriginCheck: false` keeps it on everywhere. Also observed: the library already stores `""` (not NULL) for unknown IP/user-agent, falls back to `127.0.0.1` as the IP in development/test, validates the secret only outside test (missing → throws; <32 chars or low entropy → warning), and logs via `console.*`.

**Tests (`backend/tests/auth.integration.test.ts`, 13 tests, real Express app + `landmarks_test`):** registration → 200 `{ token: null, user }` with UUID id, `name: ""`, lowercase email, `emailVerified: false`, exactly one user row and one `credential` account whose `password` is a scrypt `salt:key` hex hash not containing the submitted value, zero sessions, no `Set-Cookie`, and **nothing logged at warn or above**; client-supplied name stored as `""` (create hook); name stays `""` through the library's own `/update-user` endpoint (update hook); mixed-case email stored lowercase and sign-in succeeds with lower, upper, and original casing; **duplicate registration (different casing, name, and password) returns the same status, the same keys in the same order, identical values for every field except id/timestamps, UUID ids and `createdAt === updatedAt` in both, no cookie in either, still one user and one account, and the address never appears in the logs** (requirement 2 satisfied — no conflict to report); 7-char, 129-char, and malformed-email registrations → 400 (`PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `VALIDATION_ERROR`) with no rows; sign-in → exactly one cookie matching `better-auth.session_token=…; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax`, no `Secure` over plain http, session row with UUID id, `token` equal to the body token, **`ipAddress` and `userAgent` NULL despite `User-Agent` and `X-Forwarded-For` request headers**, `expiresAt` ≈ now + 30 days, no `password` string in the body, nothing logged; wrong password vs unknown email → byte-identical `401 { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }`, no cookie, no session, neither address nor password logged; `GET /get-session` with cookie → `{ session, user }` with exact shapes (the documented contract includes the caller's own `token`; `ipAddress`/`userAgent` null) and no `password`; without cookie → `null`; sign-out with trusted `Origin` → `{ success: true }`, session row deleted, `better-auth.session_token=; Max-Age=0; …` cleared, later `get-session` → `null`; **cookie-bearing sign-out without `Origin` → 403 `MISSING_OR_NULL_ORIGIN`, with `Origin: https://attacker.example` → 403 `INVALID_ORIGIN`, session untouched**; unknown `/api/auth/*` path → Better Auth's own bare 404 while `/api/v1/*` keeps the application envelope. Every test captures `console.log/info/warn/error` and asserts no email, password, or hash was logged.

**Checks executed (all after the final change, via `node` against the binaries):** backend `tsc --noEmit` 0 errors; frontend `tsc -b --noEmit` 0 errors; `eslint .` 0 errors; `prettier --check` — **every file touched by this increment is clean**; the root check still fails on the known pre-existing 50 untouched files (housekeeping follow-up); backend unit `vitest run` 3 files / 46 tests pass; frontend unit 35 files / 301 tests pass; backend integration `vitest run` 7 files / **65 tests** pass (52 existing + 13 new); backend `tsc -p` build ok; `vite build` ok; Playwright **22/22** against a freshly spawned (`CI=1`, no server reuse) production-mode server that started with the new required variables; the built server in production mode **exits with `Missing required environment variable: BETTER_AUTH_SECRET` when the secret is absent** and starts with no Better Auth warnings when the test-only value is supplied.

**Deviations from the approved Increment 2 plan (all configuration within the approved library, reported for acceptance):** (1) `customSyntheticUser` added — without it the approved enumeration requirement would have failed on id format and name echo; (2) `advanced.disableOriginCheck: false` added so tests exercise the real origin check; (3) a `user.update.before` hook added beside the planned create hook because the library's `/update-user` endpoint is enabled by default and would otherwise let a signed-in client store a name; (4) the CI workflow variables were added now rather than in Increment 7, as the developer permitted; (5) the planned `fromNodeHeaders` import is not needed until Increment 3 and was not added. No endpoint was replaced or wrapped; no application-route middleware, CSRF middleware, rate-limit configuration, or password reset was implemented.

**Remaining risks / notes for later increments:** the `Secure` cookie attribute is set only when `BETTER_AUTH_URL` is https (or `useSecureCookies`) — to be verified under production configuration in Increment 4; Better Auth's **in-memory** default rate limiter is active whenever `NODE_ENV=production` (including the Playwright server) until Increment 5 replaces it with the database store; the library enables `/update-user`, `/change-email`, and `/change-password` by default — `name` is now neutralised, but `image` is still client-settable through `/update-user` and these endpoints need an explicit review in Increment 4; `get-session` returns the caller's own session token in the body per the documented contract (not a leak, but the frontend must never persist it elsewhere); the frontend (M03-T03) must send `name: ""` on sign-up because the endpoint requires the field; warn-level library lines (`Password is too short`, `Invalid password`, `User not found`, `Missing or null Origin`, `Invalid origin: <origin>`) carry no identifiers — the attacker-supplied Origin value is logged on CSRF rejection; `.github/workflows/ci.yml` remains **unverified** until GitHub Actions is available; `npm audit`'s 10 pre-existing moderate findings and the 50-file Prettier drift stay in their follow-ups. Nothing committed or pushed.

**Increment 3 Verification Results (2026-11-09) — session policy and `requireSession` middleware — ACCEPTED by the developer 2026-11-09** (acceptance covers the 15 new integration tests, the successful local verification, and the continuing CI limitation; **preserved follow-up:** before any production application route depends on `requireSession`, verify that it maps genuine authentication failures to the `UNAUTHENTICATED` envelope but does **not** convert unexpected infrastructure or library failures — database outages, adapter errors, 5xx library errors — into 401 responses). The developer approved the plan 2026-11-09 with three refinements (renewal verified through both the native endpoint and the middleware, with renewed `Set-Cookie` headers reaching the browser without duplication or overwriting other headers; an expiration-without-use test independent of the renewal tests; forged-cookie cases built only after verifying the installed signing scheme) and the standing requirements (30-day/23-day configuration preserved; one identical `UNAUTHENTICATED` envelope; `req.auth` attached only after successful validation; a test-only probe route and no change to application routes; no Increment 4+ work; no new dependencies). All are met; no new dependency was needed.

**Changed files:** `backend/src/auth/require-session.ts` (new — the middleware, plus the Express `Request.auth?` type augmentation in the same module), `backend/src/http/error-envelope.ts` (`unauthenticatedEnvelope()` → `{ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }`), `backend/tests/session-policy.integration.test.ts` (new — 5 tests on the real app), `backend/tests/require-session.integration.test.ts` (new — 10 tests on a test-only Express app), this file. **Unchanged:** `auth.ts` (the Increment 2 values `expiresIn` 30 days / `updateAge` 23 days are what this increment verifies), `app.ts`, every application route, dependencies.

**Installed-library facts verified before writing code:** the refresh rule is `expiresAt − expiresIn + updateAge ≤ now`, so 30/23 days means "renew when fewer than seven days remain", a renewal writes `expiresAt = now + 30 days` and re-issues the same token with `Max-Age=2592000`; the cookie cache is disabled whenever a database is configured, so every read is authoritative; an expired session presented to the endpoint is deleted and its cookie cleared; the session cookie value is `<token>.<signature>` where the signature is base64 HMAC-SHA256 over the token with the secret (better-call 1.4.5 `crypto.mjs`), `getSignedCookie` returns no session for a missing separator, a malformed signature, or a verification failure, and a correctly signed token absent from the database also yields no session; a server-side `auth.api.getSession({ headers, returnHeaders: true })` returns `{ headers, response }` with the library's `Set-Cookie` values in a web `Headers` object.

**Middleware (`require-session.ts`):** calls the library's own session endpoint server-side with `fromNodeHeaders(req.headers)` and `returnHeaders: true`; appends each `headers.getSetCookie()` value to the Express response with `res.append("Set-Cookie", …)` (never `set`, so earlier cookies and all other headers are untouched); on `null` responds 401 with the envelope and returns; otherwise sets `req.auth = { user, session }` and calls `next()`. A 4xx `APIError` from the library (e.g. a renewal racing a deletion) maps to the same 401; anything else goes to `next(err)`. Nothing is attached before validation succeeds.

**Tests — session policy (5, native endpoint, real app, `vi.useFakeTimers({ toFake: ["Date"] })`):** a new session expires 30 days after sign-in; a read at day 22 returns the session with `expiresAt` unchanged and no `Set-Cookie`; a read at day 23 + 1 min renews to now + 30 days with the same token, exactly one re-issued `better-auth.session_token` cookie with `Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax`, the database row updated to match, still one row — and a second read 23 days after that renews again (renewable interval, not a cap); **independently**, a fresh session left unused for 30 days + 1 min returns `null`, clears the cookie (`Max-Age=0`), and the row is deleted; two sign-ins for one account create two rows, sign-out with device A's cookie deletes only A's row, A's cookie then yields `null` while B's still returns its session, and user/account rows are untouched. **Tests — `requireSession` (10, test-only app mounting the real auth handler and `GET /probe` guarded by a header-setting pre-middleware → `requireSession` → a `vi.fn` handler):** a self-built HMAC cookie equals the library's own cookie (sanity check of the forged-case construction); a valid session reaches the handler with `req.auth.user.id`/`session.id` matching the row, no `password` in `req.auth`, the pre-middleware's `X-Probe` header overwritten only by the handler and its `probe_marker` cookie preserved, and no session cookie re-issued before renewal is due; **renewal through the middleware** at day 23 + 1 min reaches the handler and forwards exactly one renewed session cookie (same token and signature) after the pre-existing cookie, with the row's `expiresAt` moved to now + 30 days and `req.auth.session.expiresAt` equal to it; rejections — missing cookie; malformed cookie without a signature separator; a real token with one signature character flipped; a correctly signed cookie for an unknown 32-character token; an expired session (401 that also carries the cookie-clearing `Set-Cookie`, row deleted); a session revoked by sign-out on that device while the other device's session still passes, then the other device's row deleted server-side (the Increment 6 reset case) and rejected too; and the response bodies of four different rejection causes are byte-identical. Every rejection asserts the handler was never called and `req.auth` stayed undefined; other users' session rows are never touched by a rejected request.

**Checks executed (all after the final change, via `node` against the binaries):** backend `tsc --noEmit` 0 errors; frontend `tsc -b --noEmit` 0 errors; `eslint .` 0 errors; `prettier --check` clean on all four touched files (root still 50 pre-existing files); backend unit 46 pass; frontend unit 35 files / 301 pass; backend integration 9 files / **80 tests** pass (65 existing + 15 new); backend and frontend builds ok; Playwright **22/22** against a freshly spawned production-mode server.

**Deviations:** none from the approved plan. Two design details decided during implementation: the `Request.auth` augmentation lives inside `require-session.ts` rather than a separate `types/express.d.ts` (one module, no global `.d.ts` to wire into the build); the middleware maps a 4xx library `APIError` to the same 401 envelope so the "one identical response" rule holds even on the library's own validation errors.

**Remaining risks / notes:** the middleware protects nothing until M03-T05 mounts it on favorites; the test clock fakes only `Date`, so row `createdAt`/`updatedAt` values are real-time while `expiresAt` and cookies follow the faked clock (assertions use only the latter); expired rows are deleted only when presented — the cleanup follow-up stands; the library's `freshAge` (1 day) gate on its list/revoke endpoints and the enabled `/update-user`, `/change-email`, `/change-password` endpoints remain for the Increment 4 review (preserved follow-up 2); the renewed cookie carries no `Secure` attribute over plain http, as in Increment 2 (Increment 4). Nothing committed or pushed.

**Increment 4 Verification Results (2026-11-10) — CSRF and cookie security — ACCEPTED by the developer 2026-11-10, including the `onAPIError` hook** (acceptance covers the CSRF middleware and structural route-protection tests, the verification of both session-cookie names, the restriction of 20 unapproved Better Auth endpoints, the production-https cookie verification, the `onAPIError` logging fix and its regression tests, the successful local verification, the continuing CI limitation, and the preserved security follow-ups — the `requireSession` 5xx-mapping check and the synthetic-response timing limitation). Approved scope: `requireTrustedOrigin` for state-changing `/api/v1` requests with the approved Origin/Referer/cookie-presence rules; structural and behavioural tests enforcing the authentication boundary; Better Auth `disabledPaths` for endpoints outside the specification (change-password included); production-https cookie verification; sanitised Better Auth logging bounding the complete entry; synthetic-registration format parity; two implementation requirements (the route-inspection test must detect a deliberately unprotected test-only POST route, including in nested routers, and must require `requireSession` before the handler; the whole formatted log entry must be bounded while keeping severity and diagnostics and excluding stacks, credentials, and database query details). No dependency added; 30-day/23-day session values unchanged; empty-name hooks retained.

**Changed files:** `backend/src/auth/require-trusted-origin.ts` (new — the middleware, `createRequireTrustedOrigin(allowedOrigins)`, `hasSessionCookie`, `SESSION_COOKIE_NAMES`, and the SECURITY BOUNDARY note), `backend/src/auth/log-sanitizer.ts` (new — `sanitizeText`, `describeLogArgument`, `formatLogEntry`, `safeAuthLog`), `backend/src/auth/auth-options.ts` (new — `buildAuthOptions(config)` extracted from `auth.ts` as a pure function so a test can build an https-shaped instance; `DISABLED_AUTH_PATHS`; the `logger.log` callback; the `onAPIError.onError` hook), `backend/src/auth/auth.ts` (now just `betterAuth(buildAuthOptions({ prisma, …env }))`), `backend/src/http/error-envelope.ts` (`invalidOriginEnvelope()` → 403 `{ error: { code: "INVALID_ORIGIN", message: "Request origin not allowed." } }`), `backend/src/app.ts` (`app.use("/api/v1", requireTrustedOrigin, apiRouter)`), tests: `backend/tests/helpers/route-inspection.ts` (new), `backend/tests/api-route-guard.integration.test.ts` (new, 5), `backend/tests/csrf.integration.test.ts` (new, 11), `backend/tests/cookie-security.integration.test.ts` (new, 4), `backend/tests/disabled-endpoints.integration.test.ts` (new, 4), `backend/tests/log-sanitizer.test.ts` (new unit, 7), `backend/tests/auth.integration.test.ts` (the `/update-user` test now expects the disabled-path 404 with name and image untouched; one new format-parity test), this file.

**CSRF behaviour (`requireTrustedOrigin`, mounted on `/api/v1` ahead of the router):** GET/HEAD/OPTIONS pass; a request without a session cookie (either name) passes to the route, whose own 401 applies; with a cookie, `Origin` must exactly equal an allowed origin — `null`, a foreign host, wrong port, wrong scheme, a trailing slash, a look-alike host, or an empty value → 403; with no `Origin`, the `Referer`'s origin must match exactly (foreign, unparseable, wrong port → 403); neither header → 403; a good Referer never rescues a bad Origin; the rejection logs nothing and echoes nothing. Allowed origins: the origin of `BETTER_AUTH_URL` plus the Vite dev origin in development only (from `env.auth`). **Boundary:** the middleware proves only origin evidence; a forged cookie with a trusted Origin passes it and is then refused 401 by `requireSession` (tested), so cookie presence is never treated as authentication. The real app's existing GET routes are unaffected (tested). Better Auth's own check on `/api/auth/*` was re-verified: foreign Origin → 403 with the session intact; Referer-origin fallback accepted.

**Structural enforcement (`api-route-guard`):** a read-only walk of the Express 4 layer stack lists every route (descending into nested routers) with methods and handler chain; `findUnguardedStateChangingRoutes` flags any POST/PUT/PATCH/DELETE route where `requireSession` is absent or not strictly before the final handler. Verified against the real router (no violations; landmark GETs listed), against a deliberately unprotected test-only POST inside a nested router (flagged as `post /favorites`), against `requireSession` placed after the handler (flagged) and before it (accepted), and the real app's `/api/v1` layers carry `requireTrustedOrigin` before `apiRouter`. No unprotected route was added to the application.

**Disabled endpoints:** `DISABLED_AUTH_PATHS` = `/update-user`, `/change-email`, `/change-password`, `/verify-password`, `/update-session`, `/delete-user`, `/delete-user/callback`, `/list-sessions`, `/revoke-session`, `/revoke-sessions`, `/revoke-other-sessions`, `/list-accounts`, `/account-info`, `/link-social`, `/unlink-account`, `/refresh-token`, `/get-access-token`, `/sign-in/social`, `/verify-email`, `/send-verification-email` — each verified by test to be an exact path the installed router registers, and each verified to answer `404 Not Found` for a signed-in user with a trusted Origin with no row changed; trailing-slash and case variants also 404. Permitted and still working: `/sign-up/email`, `/sign-in/email`, `/get-session`, `/sign-out`, and the reset routes (`/request-password-reset` is not the disabled 404; `/reset-password/:token` redirects with `error=INVALID_TOKEN`). **Parameterised social callback** (cannot be listed): with no provider configured, GET `/callback/google` → 302 to the library error page (`state_mismatch`), POST `/callback/github` → 302 to itself as GET, `/sign-in/social` and `/link-social` → 404; the full users/accounts/sessions/verifications snapshot is identical before and after. Why two of the disabled paths matter beyond the specification boundary (probed before implementation): `/list-sessions` returned every session token of the signed-in user, and `/verify-password` was a yes/no password oracle for any cookie holder.

**Cookie attributes:** under the http base URL (unchanged Increment 2 tests) `better-auth.session_token; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax`, no `Secure`. Under an https base URL (a second instance built from `buildAuthOptions` with `https://landmarks.example.test`, mounted on a test-only app): the cookie is `__Secure-better-auth.session_token` with exactly `HttpOnly; Max-Age=2592000; Path=/; SameSite=Lax; Secure`, no `Domain`, no plain-named cookie; it authenticates `get-session`; renewal at day 23 re-issues it with the same attributes; sign-out from the https origin clears it with the same attributes; a sign-out from the plain-http origin is refused 403 (exact match). `SameSite=Lax` is kept rather than `Strict` so a signed-in user arriving from the password-reset email is not shown as signed out.

**Logging:** the installed callback signature is `log(level, message, ...args)` after the library's level filter; extra arguments are Error instances, small diagnostic objects (`{ provider }`, `{ issues }`), or strings. `safeAuthLog` renders ONE entry `<iso> <LEVEL> [Better Auth]: <message> <args…>`: control characters (C0 incl. `\r`/`\n`/ESC, DEL, C1) → U+FFFD; message capped at 512, each argument at 256, the complete entry at 1024 with a visible marker; Errors → name, sanitized message, and `code`/`statusCode` only (no stack, no other properties); errors from the database layer (Prisma/pg names) → name and code only, since their messages can echo query arguments; plain objects keep values only for `code`, `statusCode`, `status`, `provider`, `issues`, `model`, `field` and show `key=[omitted]` otherwise; severity preserved (`console.error`/`warn`/`log`). **Finding during verification (recorded as unexpected library behaviour):** the installed router's `onError` logs every API error's message through the library's *module-level* logger whenever a `logger.level` is configured, bypassing the `log` callback (1.7.18 `api/index.mjs`); the first run of the hostile-callbackURL test caught a line in the default colored format. Fixed by supplying the documented `onAPIError.onError` hook, which replaces that path: 5xx → status plus sanitized error details, other API errors → their library-authored message, non-API errors → name plus sanitized details, all at error level as before. Tests: unit — control-character replacement, truncation marker, Error rendering (no stack/`secret` property/path), Prisma-style and pg-style errors reduced to name+code with a victim email absent, unknown object keys omitted, complete-entry bound with prefix intact, severity routing; integration — an 8 KB `Origin` → 403 with every captured line ≤ 1024 and in the sanitizer's format (ANSI default format absent), a `callbackURL` containing `\r\n` and ESC → 403 `INVALID_CALLBACK_URL` with the diagnostic kept and no control character in any line, session untouched. The existing auth tests' "no email/password/hash in logs" assertions still pass.

**Format parity:** a real registration and a synthetic duplicate response both carry a v4 UUID id, millisecond-precision ISO timestamps, `createdAt === updatedAt`, and timestamps within 5 s of now; one row exists afterwards. Practical limitation (accepted, unchanged): the real path performs two inserts in a transaction while the duplicate path performs a lookup and a hash — a few milliseconds that cannot be removed without weakening the design; the Increment 5 rate limiter is the mitigation. Sign-in already hashes a dummy password for unknown users (verified in the installed source).

**Checks executed (all after the final change, via `node` against the binaries):** backend `tsc --noEmit` 0 errors; frontend `tsc -b --noEmit` 0 errors; `eslint .` 0 errors (two `no-control-regex` hits on deliberate test assertions resolved with line-level disables); `prettier --check` clean on every touched file (root still the 50 pre-existing files); backend unit 4 files / **53 tests** (46 + 7); frontend unit 35 files / 301; backend integration 13 files / **105 tests** (80 + 25 new, incl. the parity test and the flipped update-user test); backend and frontend builds ok; Playwright **22/22** against a freshly spawned production-mode server. Docker Desktop and the Postgres container had to be restarted after a host restart mid-increment; no data was lost (the test database is reset per test; `landmarks_dev` untouched).

**Deviations:** none from the approved scope. Two details decided during implementation: (1) the `onAPIError.onError` hook above — necessary to close the module-level-logger bypass, within the "sanitized Better Auth logging" scope; (2) `auth-options.ts` holds the options builder and the disabled-path list rather than a separate `types`/constants module. No application route gained `requireSession` yet (none is state-changing); the mount of `requireTrustedOrigin` is behaviour-neutral for the existing GET routes.

**Remaining risks / notes:** the `__Secure-` prefix changes the production cookie name — `requireTrustedOrigin` handles both names and the frontend never reads the cookie, but any later code naming the cookie must do the same; `disabledPaths` matches exact paths, so `/callback/:id` stays reachable and is safe only while no social provider is configured (any future provider needs explicit approval and a revisit); the library's `Origin: null` + `Sec-Fetch-Site: same-origin` acceptance on `/api/auth/*` is recorded (browser-set header, not script-forgeable); the `requireSession` error-mapping follow-up (5xx must not become 401) is unchanged and still open before production routes depend on it; the in-memory default rate limiter remains active in production mode until Increment 5; CI remains unverified. Nothing committed or pushed.

**Increment 5 Verification Results (2026-11-10) — database-backed rate limiting — ACCEPTED by the developer 2026-11-10** (acceptance covers all approved thresholds, the database-backed enforcement and concurrency verification, the client-IP validation and spoofing tests, the 503 error-handling wrapper and its failure-path tests, the automatic stale-row cleanup closing the rate-limit retention follow-up, and the local verification — 62 backend unit, 120 backend integration, 301 frontend unit, 22 Playwright. **Preserved outstanding items:** production trusted-proxy verification remains a deployment blocker; rate limiting is per IP and path, not per account; application-route throttling remains a later concern; `requireSession` infrastructure-error mapping remains unresolved; expired session and verification cleanup remains a maintenance follow-up; CI remains unverified). Approved 2026-11-10: thresholds (`/sign-in/email` 5 per 60 s; `/sign-up/email` 5 per 10 min; `/request-password-reset` 3 per 10 min; `/reset-password` 5 per 10 min; every other `/api/auth` path 100 per 10 s), database storage on the Increment 1 `RateLimit` model, the Express-derived client-IP design with a private header and an explicit trusted-proxy hop count (default 0), and — after the refinement findings — the Express 503 wrapper for a rejected auth handler. Safeguards honoured: intentional library responses keep their status; no internal message/SQL/stack/credential/token in the 503 response or its log line; no schema change; no new dependency; no Increment 6 work; empty-name hooks and the 30-day/23-day session values untouched.

**Changed files:** `backend/src/config/env.ts` (`auth.rateLimitEnabled` from `AUTH_RATE_LIMIT_ENABLED`, default "production only"; `auth.trustedProxyHops` from `AUTH_TRUSTED_PROXY_HOPS`, default 0, validated as a non-negative integer at startup), `backend/src/auth/client-ip.ts` (new — `createClientIpMiddleware`, `CLIENT_IP_HEADER`, the DEPLOYMENT BLOCKER procedure in its header comment), `backend/src/auth/mount.ts` (new — `mountBetterAuth(app, auth)`: the Node handler's promise forwarded to Express error handling, plus the route-scoped `authInfrastructureErrorHandler` → 503), `backend/src/http/error-envelope.ts` (`serviceUnavailableEnvelope()` → `{ error: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable." } }`), `backend/src/auth/auth-options.ts` (`AuthConfig.rateLimitEnabled`; `RATE_LIMIT_RULES` and `DEFAULT_RATE_LIMIT_RULE`; `rateLimit { enabled, storage: "database", window 10, max 100, customRules }`; `advanced.ipAddress.ipAddressHeaders: [CLIENT_IP_HEADER]`), `backend/src/auth/auth.ts` (passes `env.auth.rateLimitEnabled`), `backend/src/app.ts` (`app.set("trust proxy", hops)`, the client-ip middleware first, `mountBetterAuth`), `backend/.env.example` (the two variables, documented), `backend/tests/client-ip.test.ts` (new unit, 9), `backend/tests/rate-limit.integration.test.ts` (new, 15), `backend/tests/cookie-security.integration.test.ts` (passes `rateLimitEnabled: false`), this file, and `docs/DECISIONS.md` (ADR-011 decision 9 verification note). The application's own instance keeps the limiter at "production only"; every rate-limit test runs on a dedicated instance built from the same option builder with the limiter on, mounted through the same `mountBetterAuth` path.

**Installed-library facts the design rests on (1.7.18, read in full):** `rateLimit.storage: "database"` uses the adapter's `rateLimit` model = the Increment 1 Prisma model (unique `key`, `count`, BigInt `lastRequest` epoch-ms, converted on read); keys are `<ip>|<path>` with IPv6 collapsed to /64 and IPv4-mapped addresses unwrapped; rule resolution is built-in special rules → plugin rules → custom rules, so the custom rules supersede the library's 3-per-10 s sign-in/sign-up and 3-per-60 s reset defaults; the window runs from the client's last ALLOWED request and blocked requests do not extend it; check-and-increment is one request-phase step — create on a missing key (a lost unique-constraint race re-reads and retries), otherwise a conditional update whose WHERE carries the window and count guards plus the row id inside the adapter's transaction, so PostgreSQL re-evaluates the guard against the committed row; a losing update re-reads and answers 429; the 429 body is the fixed `{ message: "Too many requests. Please try again later." }` with `X-Retry-After`, produced before the endpoint runs; stale rows (`lastRequest` older than the longest configured window — 600 s here) are deleted when any key's window resets, awaited inline, with the deletion's own `.catch` logging "Error pruning rate limit rows" so a prune failure never affects the request; when no trustworthy address resolves the library falls back to ONE shared per-path bucket (`no-trusted-ip|path`) with a one-time warning — the reason the address is derived in Express instead; naming `ipAddressHeaders` replaces the default `X-Forwarded-For` entirely; the request hook that runs the limiter (and the one-time schema check) executes OUTSIDE the router's try/catch and the Node adapter awaits it without a catch, so a storage failure left the request hanging with an unhandled rejection (confirmed by simulation before implementation: plain mount → no response, one unhandled rejection; wrapped mount → 503 in 10 ms).

**Actual rate-limit behaviour and database results (`rate-limit.integration.test.ts`, 15 tests, real `rate_limits` table, faked `Date`):** sign-in — five 401s from one client, the sixth and a subsequent CORRECT-password attempt both 429 with the fixed body and `0 < X-Retry-After ≤ 60`, zero sessions created, the row `203.0.113.10|/sign-in/email` at count exactly 5, another client unaffected; registration 5 then 429 with exactly 5 users created; reset request 3 then 429; reset completion 5 then 429; each row at exactly its maximum; get-session 100 then 429 (row at 100); disabled paths (`/update-user` ×10 → 404) create no row; 400 validation, 401 credentials, and 403 CSRF responses keep their status. **Windows:** after 5 sign-ins, attempts at +30 s and +59 s are 429 and leave `lastRequest` unchanged; at +61 s the request is admitted and the row resets to count 1 with `lastRequest = now`.

**Concurrency and cleanup results:** concurrent creation of a nonexistent key (8 at once, max 5) → exactly 5 admitted, 3 × 429, one row at count 5; concurrent updates of an existing key (2 warm + 8 at once) → exactly 3 more admitted, 5 × 429, count 5; window-reset race (two at once after the window) → both admitted, count 2; two instances on one database share one budget (3 on A + 2 on B → the sixth is 429 on either, count 5). Cleanup: rows for three clients at t0/t0/t0+300 s plus the registration row; a sign-in at t0+601 s resets its own key and prunes every row older than 600 s (the t0 sign-up row and the registration row gone) while the t0+300 s get-session row — younger than the longest window though its own 10-s window long elapsed — is preserved; with a Prisma client whose `rateLimit.deleteMany` always rejects, the reset request is still served, "Error pruning rate limit rows" is logged, and the next five attempts are counted and the sixth is 429. **The rate-limit retention follow-up is therefore resolved by the library's built-in pruning, verified**; expired `sessions`/`verifications` rows remain a separate follow-up (the library deletes an expired session only when it is presented).

**Client-IP and proxy-security results:** unit (`client-ip.test.ts`, 9): zero hops → the socket peer and any chain ignored; one/two/three hops → the address that many entries from the right; attacker entries to the left of the proxy-appended address never change the identity; an OVER-counted hop value hands over the leftmost client-supplied entry (documented as the dangerous direction); malformed, port-suffixed, and empty values fall back to the socket peer; a direct request without a chain gets the socket peer; a client-supplied copy of the private header is discarded under both hop counts; IPv6 passes through; the `AUTH_PROXY_CHAIN_MISSING` diagnostic fires once per process, event code only, when hops are positive and a request has no forwarding header. Integration: under the one-hop topology, a limited client sending `X-Forwarded-For: 9.9.9.9, 8.8.8.8, <real>` or a spoofed private header is still 429, no row ever starts with the spoofed addresses, and the library's `no-trusted-ip` bucket never appears. Account-enumeration parity: an existing and an unknown address are throttled at the same request with byte-identical 429 bodies containing no address; reset requests for both return the same status.

**503 error-handling verification:** an instance whose rate-limit storage throws a `P1001`-coded error with SQL in its message → sign-up and sign-in both answer `503 { error: { code: "SERVICE_UNAVAILABLE", … } }`, zero unhandled rejections observed on a process listener, no user and no session created, the response contains no error text, and the single log line is `AUTH_INFRASTRUCTURE_FAILURE … { code=P1001 }` with no message, SQL, or stack. Intentional library responses are unaffected (tested above and across the existing suites).

**Checks executed (all after the final change, via `node` against the binaries):** backend `tsc --noEmit` 0 errors; frontend `tsc -b --noEmit` 0 errors; `eslint .` 0 errors (re-run on the final tree); `prettier --check` clean on every touched code file (`.env.example` is not a Prettier target; root still the 50 pre-existing files); backend unit 5 files / **62 tests** (53 + 9); frontend unit 35 files / 301; backend integration 14 files / **120 tests** (105 + 15); backend and frontend builds ok (eight `dist/auth` modules); Playwright **22/22** against a freshly spawned production-mode server, which now starts with the database-backed limiter ON and `AUTH_TRUSTED_PROXY_HOPS` defaulting to 0.

**Deviations / notes:** none from the approved scope. A `prettier --write backend/src` pass during formatting also reformatted eleven pre-existing files under `backend/src/import` and `backend/src/landmarks` (part of the known 50-file drift); those formatting-only changes were reverted with `git checkout --` before the build and Playwright runs, so the increment touches only its own files and the drift follow-up is unchanged. The limiter is per client address and path, not per account (accepted limitation from the plan). The library's `/reset-password/:token` GET redirect falls under the default 100-per-10-s rule, not the completion rule.

**Remaining risks / notes:** **DEPLOYMENT BLOCKER (explicit, developer-set):** the production `AUTH_TRUSTED_PROXY_HOPS` value must be established on the deployed platform by the procedure in `client-ip.ts` — a known-address sign-in attempt without and WITH a deliberately spoofed `X-Forwarded-For`, checking the `rate_limits` key — and no Render or Cloudflare hop count is assumed; until then the default 0 can only under-count (everyone behind the proxy shares the proxy's bucket — lockout, never bypass). Application-route throttling (spec §7's 429 for favorites) is a later concern. The `requireSession` 5xx-mapping follow-up and the synthetic-response timing limitation stay open. CI remains unverified. Nothing committed or pushed.

**Increment 6 Verification Results (2026-11-10) — password reset — ACCEPTED by the developer 2026-11-10** (acceptance covers the files, the single dependency, the test results, the deviations, and the remaining risks recorded below, all of which stay open as listed). Approved scope (2026-11-10): `MailTransport` abstraction with SMTP, disabled, and test-memory implementations; `nodemailer` pinned to exactly 10.5.0 as the only new dependency; SMTP readiness checks, bounded timeouts, at most 10 concurrent sends, sanitized delivery-failure logging, and the additional safeguard that an application deadline never releases an in-flight slot while the provider call is active; Better Auth reset request/completion with 30-minute, hashed, single-use tokens; explicit `revokeSessionsOnPasswordReset`; enumeration-resistant responses and logging; canonical application-origin links; replacement of the Increment 4 `onAPIError` hook with the verified `onAPIError.throw` configuration; tests, documentation, local verification. Boundaries kept: no frontend pages (M03-T03), no architecture or schema change, no other dependency, no other account-management feature, nothing committed or pushed.

**Changed files:** `backend/package.json` (+ `"nodemailer": "10.5.0"`) and `package-lock.json` (one package added — nodemailer has no dependencies and ships its own types); `backend/src/mail/mail-transport.ts` (new — `MailMessage`, `MailTransport`, `MailError` with codes `MAIL_TRANSPORT_DISABLED`/`MAIL_QUEUE_FULL`/`MAIL_SEND_TIMEOUT`/`MAIL_SEND_FAILED`, `providerErrorCode`), `backend/src/mail/smtp-transport.ts` (new — `SmtpMailTransport` over an injectable `Mailer`, `SMTP_TIMEOUTS`, `createSmtpMailTransport`), `backend/src/mail/disabled-transport.ts` (new), `backend/src/mail/index.ts` (new — `createMailTransport(config)`), `backend/src/auth/password-reset.ts` (new — `buildResetLink`, `composeResetEmail`, `createResetPasswordSender`, `createResetReadinessHook`, `RESET_TOKEN_LIFETIME_SECONDS` = 1800), `backend/src/auth/auth-options.ts` (`AuthConfig.mailTransport`; `sendResetPassword`, `resetPasswordTokenExpiresIn: 1800`, `revokeSessionsOnPasswordReset: true`; `verification.storeIdentifier: "hashed"`; `hooks.before` readiness gate; `onAPIError: { throw: true }` replacing the Increment 4 `onError` hook), `backend/src/auth/auth.ts` (builds the transport from `env.mail`), `backend/src/config/env.ts` (`MAIL_TRANSPORT` "smtp"|"disabled" — required in production, default "disabled" elsewhere; `SMTP_URL` and `MAIL_FROM` required only for smtp), `backend/.env.example`, `backend/tests/setup/vitest.setup.integration.ts` (`MAIL_TRANSPORT=disabled`), `playwright.config.ts` and `.github/workflows/ci.yml` (`MAIL_TRANSPORT=disabled`), tests: `backend/tests/helpers/memory-mail-transport.ts` (new), `backend/tests/mail-transport.test.ts` (new unit, 12), `backend/tests/password-reset.integration.test.ts` (new, 11), `backend/tests/auth-error-handling.integration.test.ts` (new, 2), `backend/tests/cookie-security.integration.test.ts` and `backend/tests/rate-limit.integration.test.ts` (pass a memory transport to the builder), this file.

**Dependency changes:** `npm install nodemailer@10.5.0 --save-exact --workspace=backend` — exactly one lockfile addition (`node_modules/nodemailer`), zero transitive dependencies, Node ≥ 20, MIT-0, bundled TypeScript types, ESM export; the transport is constructed with `{ url, ...SMTP_TIMEOUTS }` (the factory's second positional argument is message defaults, not transport options — caught by the type check). `npm audit` after install: the ten pre-existing moderate findings (eslint/typescript-eslint/`minimatch`, dev-only) plus **one new low advisory unrelated to this install** — `fast-xml-parser` ≤ 5.11.2 (GHSA-474x-hrwr-fgx4, quadratic CPU on unterminated stop-node tags; installed 5.11.2; a fix is available) on the pre-existing GPX-import dependency; recorded for the dependency-security triage follow-up, nothing upgraded. Zero findings from nodemailer.

**Installed-library facts the implementation rests on (1.7.18, read in full):** the request endpoint requires `sendResetPassword` (else 400 `RESET_PASSWORD_DISABLED`); for an unknown address it generates a dummy id, performs a dummy verification lookup, logs a warning WITHOUT the address, and returns the same neutral body as a known one; for a known address it stores `reset-password:<24 alphanumerics>` → user id with `resetPasswordTokenExpiresIn`, and AWAITS `sendResetPassword` (`runInBackgroundOrAwait` with no background handler) — hence the sender hands off and returns immediately; `redirectTo` is validated by the library's origin check; completion takes the token from the body, enforces the password policy, finds the row (hashed lookup under `storeIdentifier: "hashed"` — SHA-256, base64url, unpadded), rejects missing/expired with 400 `INVALID_TOKEN`, then in ONE transaction consumes the row under a lock (a second consume returns null → `INVALID_TOKEN`), deletes every database session of the user when `revokeSessionsOnPasswordReset` is on, and writes the hash; it issues no session; **session revocation is NOT automatic — it requires that option (utils/password.mjs:34)**; every verification lookup deletes expired rows; the parameterised GET `/reset-password/:token` callback validates `callbackURL` against trusted origins, looks the token up WITHOUT consuming it, redirects a missing/expired token to `callbackURL?error=INVALID_TOKEN`, and redirects a valid token to `callbackURL?token=<token>` — it cannot be listed in `disabledPaths`, the application link never references it; `onAPIError.throw` makes the router re-throw before its default logging, API errors are still rendered by the router's inner catch, and non-API errors propagate to the Express 503 handler (probed across every flow before implementation: identical statuses with and without the option; database failure → raw `# SERVER_ERROR` console line + empty 500 under the hook vs sanitized 503 under `throw`).

**Delivery behaviour (`smtp-transport.ts`):** timeouts dns 10 s / connection 10 s / greeting 10 s / socket 30 s (nodemailer defaults 30/120/30/600); a slot is taken when `send` starts and released only when the provider call settles — the 60-second application deadline rejects the caller with `MAIL_SEND_TIMEOUT` but keeps the slot, so timed-out sends cannot accumulate past the cap of 10 (further sends are refused with `MAIL_QUEUE_FULL` and never queued); a send that settles after its deadline logs `MAIL_SEND_SETTLED_AFTER_TIMEOUT`; the slot-owning promise has its own catch so nothing can surface as an unhandled rejection; a provider failure becomes `MAIL_SEND_FAILED` carrying only the provider's `code`/`responseCode` (never its text) and clears readiness; readiness = a successful handshake (`verify()`), re-attempted at most once per 60 s while not ready, logged as `MAIL_TRANSPORT_UNAVAILABLE { provider, code }` — documented as availability, not delivery. The reset sender attaches its rejection handler synchronously and logs event codes with `provider` and the provider code only: no address, no token, no connection URL (which carries the credentials and is never logged anywhere).

**Test results:** unit (`mail-transport.test.ts`, 12): message shape and sender, slot freed on acceptance; cap of 2 refuses the third with `MAIL_QUEUE_FULL` and never calls the provider; deadline rejects but the slot stays occupied until the provider settles (then freed, with the settled-after-timeout event); two stuck sends hold both slots and the next is refused, slots return when the provider's own timeouts settle them; provider failure → `MAIL_SEND_FAILED` with `providerCode` "EAUTH" only (the 535 text is absent) and readiness re-checked; handshake failure logs `code=ECONNECTION` without the address, is not retried within the backoff, is retried after it, and success sticks; bounded `SMTP_TIMEOUTS`; real nodemailer JSON transport accepts the produced message (parsed `from`/`to`/`subject`/`text`, no `html`); canonical link built from the public ORIGIN (a base URL with a path still yields `/reset-password?token=…`, token percent-encoded) and the text never references `/api/auth/`; disabled transport never ready and refuses sends; smtp selection requires both URL and sender; `providerErrorCode` keeps codes/class names only. Integration (`password-reset.integration.test.ts`, 11, memory transport, faked `Date`): known address → neutral 200, one row whose identifier equals the SHA-256/base64url of `reset-password:<token>` and does not contain the token, value = user id, expiry ≈ now + 30 min, one email to the address with `http://localhost:3000/reset-password?token=<24 chars>` and no `/api/auth/` or `callbackURL`, token absent from the response and every log line, address absent from logs; unknown address → byte-identical body, no row, no email, no address in logs; transport not ready → the same 503 `{ code: "RESET_UNAVAILABLE", … }` for both addresses, zero rows, zero send calls; rejecting transport → neutral 200, `MAIL_SEND_FAILED { provider=memory, code=ESIMULATED }` without the address, no unhandled rejection, the token row still created; a 2-second send → response in < 500 ms; foreign `redirectTo` → 403 `INVALID_REDIRECT_URL`, no email; completion → 200 `{ status: true }`, no cookie issued, sessions of BOTH devices deleted and both cookies return `null`, row deleted, old password 401, new password 200, stored hash does not contain the password; reuse / unknown / tampered token → byte-identical 400 `INVALID_TOKEN`; expired token (+31 min) → 400 and the expired row cleaned, password unchanged; 7- and 129-character passwords → 400 with the token still valid afterwards; the GET callback with a bad token → 302 to `/reset-password?error=INVALID_TOKEN` and nothing consumed. Error routing (`auth-error-handling.integration.test.ts`, 2): the real app keeps 400 (invalid email), 200 (registration and duplicate), 401, 200 (sign-in), 200/`null` (session), 403 (CSRF), 503 `RESET_UNAVAILABLE` (the app's disabled transport), 403 (foreign redirect), 400 (bad token), 200 (sign-out), 404 (unknown and disabled paths) with no `# SERVER_ERROR` line and no unhandled rejection; a Prisma-style failure in the user lookup → 503 envelope on sign-in and sign-up, response free of the error text, no user created, exactly two `AUTH_INFRASTRUCTURE_FAILURE { code=P1001 }` lines, no raw console line, no stack, no unhandled rejection.

**Checks executed (all after the final change, via `node` against the binaries):** backend `tsc --noEmit` 0 errors; frontend `tsc -b --noEmit` 0 errors; `eslint .` 0 errors; `prettier --check` clean on every touched file (the one hit in `backend/tests/helpers/` is the pre-existing `gpx-fixtures.ts`; root still exactly the 50 pre-existing files; no file outside the increment changed); backend unit 6 files / **74 tests** (62 + 12); frontend unit 35 files / 301; backend integration 16 files / **133 tests** (120 + 13); backend and frontend builds ok (four `dist/mail` modules, nine `dist/auth` modules); Playwright **22/22** against a freshly spawned production-mode server with `MAIL_TRANSPORT=disabled`; the built server in production mode **refuses to start without `MAIL_TRANSPORT`** (`MAIL_TRANSPORT must be set to "smtp" or "disabled" in production`).

**Deviations:** none from the approved scope. One test-isolation fix during verification: a deliberately slow memory send from one test delivered into the next test's recorder, so the memory transport gained a generation counter (`reset()`) that discards a stale in-flight send — test helper only. The Increment 4 `onError` hook is gone; the existing CSRF suite's "every log line in sanitizer format" assertions still pass because the origin-check middleware's own logger lines remain.

**Remaining risks (developer-listed, all open):** **production SMTP configuration** — provider, verified sender identity, and `SMTP_URL` are deployment decisions; the SMTP handshake and real delivery cannot be exercised locally, and a provider rejection after the neutral confirmation cannot be reported to that user (only logged); **the parameterised callback route** `/reset-password/:token` stays reachable — it consumes nothing and redirects only to trusted origins, but a valid token presented there lands in a redirect URL, and the application never links to it; **frontend token handling (M03-T03)** — the reset page must read the token from the query string, remove it from the visible URL, apply a restrictive `Referrer-Policy`, send the token in the POST body only, and load no third-party scripts; **account-enumeration timing** — the known path stores a row while the unknown path performs a dummy lookup that also prunes expired rows, a few milliseconds mitigated by the 3-per-10-minute limit; **production proxy verification** remains the Increment 5 deployment blocker; **CI** — the workflow edits were unverified at acceptance; verified green in run #14 on 2026-11-17 (see §11); plus the one new low `fast-xml-parser` advisory for triage, the `requireSession` 5xx-mapping follow-up, per-IP (not per-account) limiting, and expired-session cleanup. Nothing committed or pushed.

**Task-level completion review (2026-11-10, presented and approved by the developer as the basis for Increment 7):** every scope item maps to implemented, tested code (approach → Better Auth on the Prisma adapter; endpoint protection → 20 disabled paths, origin check, sanitized logging; sessions → 30-day/23-day policy and `requireSession`; error handling → native shapes on `/api/auth/*`, `UNAUTHENTICATED` envelope, 503 wrapper, `onAPIError.throw`; CSRF → `requireTrustedOrigin` plus the library's check; rate limiting → database-backed with approved thresholds and Express-derived IP; adapter → hand-authored models, ADR-010 migration). The one closure gap was Increment 7 itself (README and the task record), plus the recommendation to fold the `requireSession` infrastructure-error mapping into it since "appropriate authentication error handling" is in this task's scope. All six increments were confirmed documented and accepted; the full local sequence was green; `landmarks_dev` unchanged at 1,692 rows.

**Increment 7 Verification Results (2026-11-10) — final closure and documentation — ACCEPTED by the developer 2026-11-13, closing M03-T02 as Complete** (acceptance covers the README section, the `requireSession` correction and its four tests, the final verification results, and the reconciliation below; every blocker and follow-up listed at the end of this record stays open). Authorized scope: a concise README backend-authentication section; the `requireSession` infrastructure-error correction with focused tests; the final verification sequence incl. Prisma validation, migration status, and a development-data check; the plan record with a reconciliation of the acceptance criteria against the specification; all blockers and follow-ups preserved. No dependency installed, nothing committed or pushed, no M03-T03/M03-T05 work.

**Changed files:** `README.md` (new "Backend Authentication Setup" section: the eight variables with purpose and when required, the secret-generation command, implemented behaviour in one paragraph, development/test defaults, production requirements incl. the proxy-chain verification procedure, verification commands — no credentials, no duplication of the specification); `backend/src/auth/require-session.ts` (`createRequireSession(authority)` seam with `requireSession = createRequireSession(auth)` — the only change needed to test a failing database; the catch now maps a library 4xx verdict to 401 and EVERYTHING else — a 5xx verdict, a database/adapter/library exception — to the project 503 through the existing `authInfrastructureErrorHandler`, never `next(err)` to Express's default page); `backend/src/auth/mount.ts` (`diagnosticCode()` — the 503 handler's log line now prefers a driver/library `code`, then an `APIError`'s own body code or status, then the class name; surfaced by the new tests, which first saw `code=APIError` for a library 5xx verdict); `backend/tests/require-session-errors.integration.test.ts` (new, 4); this file.

**Error-mapping results (`require-session-errors.integration.test.ts`, 4, plus the unchanged 10 in `require-session.integration.test.ts`):** a Prisma-style failure in the session lookup (via an injected failing client on a dedicated instance) → `503 { error: { code: "SERVICE_UNAVAILABLE", … } }`, explicitly not the 401 envelope, handler never run, zero unhandled rejections, exactly one `AUTH_INFRASTRUCTURE_FAILURE` line at error level, no SQL/stack/message/session token in any line, the session row intact; a non-API exception from the authority (`TypeError`) → 503 with `code=TypeError` and no message text; the library's own 5xx verdict (`FAILED_TO_GET_SESSION` at 500) → 503 logged with `code=FAILED_TO_GET_SESSION`, while its 4xx verdict → 401 with no infrastructure line (the distinction, proven both ways); on a healthy authority missing and forged cookies → 401, a valid session → 200 with no cookie re-issued before the renewal threshold; the Increment 3 suite (renewal through the middleware with exactly one forwarded cookie, expiry, revocation, byte-identical 401s) passes unchanged.

**Final verification (all after the final change, via `node` against the binaries):** backend `tsc --noEmit` 0 errors; frontend `tsc -b --noEmit` 0 errors; `eslint .` 0 errors; `prettier --check` clean on `README.md` and every M03-T02 file (root still exactly the 50 pre-existing files); `prisma validate` valid, `prisma format --check` clean; `prisma migrate status` "Database schema is up to date!" on both `landmarks_test` and `landmarks_dev` (2 migrations); backend unit 6 files / **74 tests**; frontend unit 35 files / **301**; backend integration 17 files / **137 tests** (133 + 4); backend and frontend builds ok; Playwright **22/22** against a freshly spawned production-mode server; `landmarks_dev` **1,692 landmarks, content checksum identical before and after the final test runs, 0 users**.

**Acceptance-criteria reconciliation against `specs/AUTHENTICATION_FAVORITES_SPEC.md` v0.3 (M03-T02 owns §§2–4 and 9 per the spec's traceability table; this task's plan entry carries scope items rather than a ticked list, so the ticks below are the task's completion criteria):**
- [x] §2 architecture: Better Auth on Express with database-backed sessions; the supported Prisma adapter with Prisma as the sole schema/migration authority and no redundant user table; library-owned hashing/tokens/cookies with application-owned middleware; `/api/auth/*` under the single origin (ADR-008); HttpOnly session cookies, `Secure` under an https origin, nothing in browser storage; identity always from the validated server session.
- [x] §3.1 identity: stable UUID ids; library-validated, lowercase, case-insensitively unique emails; only email and password collected (name forced empty); passwords never stored plain, returned, or logged.
- [x] §3.2 sessions: server-validated sessions and cookies; expired/revoked/missing/forged treated as unauthenticated (one envelope); 30-day renewable interval with renewal under seven days remaining, verified through the native endpoint and the middleware; sign-out revokes the current session only; reset revokes all.
- [x] §4.1 registration: server-authoritative validation, 8–128 characters, no complexity classes; errors expose no stack/password/record/secret; registration rate-limited; no email verification required and none implied; registration does not sign in (approved M03-T01 decision — the spec permits either).
- [x] §4.2 sign-in: generic failure message, byte-identical for wrong password and unknown address; throttled with a 429; the safe return destination is M03-T03.
- [x] §4.3 reset: library mechanisms only; single-use 30-minute tokens, hashed at rest; neutral confirmation; request and completion rate-limited; links from the configured canonical origin as `/reset-password?token=…`; no token in logs; policy enforced on completion; all sessions revoked; Nodemailer SMTP behind the transport abstraction with a readiness gate; sending does not mark the address verified; provider/sender selection is a deployment decision (open).
- [x] §4.4 sign-out: server-side invalidation; UI and offline cleanup are M03-T03/M06.
- [x] §9.1 controls: explicit CSRF with exact Origin match, Referer-origin fallback, fail-closed, library compatibility tested; cookie attributes verified under http and https; limits on login/registration/reset with database storage; no hashes/tokens/secrets/credentials in responses or logs; enumeration resistance verified (timing limitation recorded); no CORS configured.
- [x] §9.2 tests owned by this task: 1 (registration + sign-in establish a session, no verification), 2 (invalid credentials and throttling), 3 (missing/expired/forged/revoked rejected — on a test-only route until favorites exist), 4 (logout invalidates), 5 and 19 (CSRF rejects foreign, null, and missing origins), 12 (reset non-disclosure with a controlled transport), 13 (single-use, expired, invalid, reused tokens; request throttling), 14 (policy and all-session revocation; sign-out revokes only the current session), 16 (dedicated test database, guarded), 17 (30-day/7-day policy), 20 (single-use, 30-minute, canonical origin, no token in logs — browser referrer handling is M03-T03). Items 6–11, 15, and 18 belong to M03-T03/T04/T05/T06.
- [x] §10.2 decisions 1, 2, 3, 5, and 6 implemented as approved; decision 4 is M03-T05.
- [x] All seven increments documented with developer acceptance records (1–6) and this record (7).

**Deviations:** none from the authorized Increment 7 scope. The `diagnosticCode` improvement in `mount.ts` is the "necessary error-handling support" the authorization allowed, limited to the log line's identifier.

**Preserved blockers and follow-ups (unchanged, all open):** **deployment blockers** — production trusted-proxy verification (`AUTH_TRUSTED_PROXY_HOPS`, spoofed-header procedure); production SMTP provider, verified sender identity, `SMTP_URL`, and a handshake verified on the platform; HTTPS deployment (`BETTER_AUTH_URL` https for `Secure` cookies); the sensitive-location classification policy (release blocker since M02). **Later work** — ~~CI execution (GitHub billing lock; every workflow edit since M02 unverified)~~ — closed 2026-11-17, run #14 green (§11); dependency-audit triage (10 moderate dev-only `minimatch` chain + 1 low `fast-xml-parser` GHSA-474x-hrwr-fgx4) and the seven Dependabot PRs; expired `sessions` cleanup (the library deletes an expired session only when presented; verifications are pruned on lookup); frontend reset-token handling in M03-T03 (strip the token from the visible URL, restrictive `Referrer-Policy`, POST body only, no third-party scripts); the account-enumeration timing limitation on registration and reset request (milliseconds; rate limits mitigate); the parameterised `/reset-password/:token` callback route (reachable, consumes nothing, trusted-origin redirects only, never linked); per-IP rather than per-account limiting; application-route throttling for favorites; the 50-file Prettier drift; M02's open mobile-device criterion. Nothing committed or pushed.

### M03-T03: Implement Authentication Interface

**Status:** Complete — **accepted as Complete by the developer 2026-11-18**, with all six increments accepted, the specification requirements this task owns (`specs/AUTHENTICATION_FAVORITES_SPEC.md` v0.3 §§4 and 8 as they apply to the authentication interface) satisfied, and the final verification approved (Increment 6 record below). The follow-ups listed at the end of that record stay open. History: planning authorized and the implementation plan approved by the developer 2026-11-18: six increments, all seven recommended decisions, and three refinements (below), planned against `specs/AUTHENTICATION_FAVORITES_SPEC.md` v0.3 §§4 and 8 and the M03-T02 backend contracts. **Increment 1 (auth API client and validation): implemented, locally verified, and accepted by the developer 2026-11-18** (record below). **Increment 2 (session provider and shell integration): authorized, implemented, locally and visually verified, and accepted by the developer 2026-11-18** (record below). **Increment 3 (registration page): authorized and implemented 2026-11-18, conditionally accepted pending the registration → sign-in journey, and fully accepted by the developer 2026-11-18** once Increment 4 verified that journey (record below). **Increment 4 (sign-in page): authorized, implemented, verified, and accepted by the developer 2026-11-18**, including the approved `strict-origin` amendment to decision 5 and refinement 1 (record below). **Increment 5 (password-reset pages): authorized, implemented, verified, and accepted by the developer 2026-11-18** (record below). **Increment 6 (closure): authorized, implemented, verified, and accepted by the developer 2026-11-18, together with the task** (record below).

**Dependencies:** M02-T01, M03-T02

**Scope:**
- Create registration and login interfaces.
- Provide validation and error feedback.
- Support the approved sign-out behavior.

**Approved increments (2026-11-18):**
1. **Auth API client and validation** — typed wrappers for the Better Auth endpoints over a shared JSON POST helper; client-side Zod validation mirroring the server policy; the safe return-path function; unit tests.
2. **Session provider, shell navigation, sign-out** — session provider and `useAuth` hook mounted in `main.tsx`; `AppLayout` navigation showing Sign in and Register links, or the signed-in address with a Sign out button; sign-out behaviour; component tests with the auth API module mocked; one Playwright check of the anonymous navigation against the real server. No pages, no reset-token capture, no favorites.
3. **Registration page** — accessible registration form, Zod validation, pending and error states, neutral duplicate-registration behaviour, redirect to sign-in with a success notice, component tests, and real-server Playwright accessibility and registration tests.
4. **Sign-in page** — generic credential failures, 429 feedback, validated `returnTo` navigation, authenticated-user redirect, component tests, and real-server Playwright tests for registration and sign-in, reload persistence, sign-out, revoked sessions, failed session checks, safe return paths, and accessibility.
5. **Password-reset pages** — forgot-password and reset-password forms, neutral request confirmation, 503 handling, synchronous reset-token capture and URL stripping, memory-only token retention, password validation, invalid and expired token handling, component tests, and Playwright tests with the appropriate real-server and mocked-endpoint coverage.
6. **Closure** — accessibility review, full regression verification, documentation reconciliation, and final acceptance review.

**Approved decisions (2026-11-18):**
1. A thin typed auth API wrapper; no Better Auth client package.
2. Zod as a frontend dependency.
3. Registration does not automatically sign in (consistent with the M03-T02 `autoSignIn: false` configuration).
4. A strict same-origin `returnTo` query parameter.
5. A global restrictive referrer policy and synchronous reset-token stripping. **Amended 2026-11-18 (developer-approved): the global policy is `strict-origin`, not the originally approved `no-referrer`** — see refinement 1 for the reason.
6. Auth rate limiting disabled for the Playwright server through the existing test configuration (`AUTH_RATE_LIMIT_ENABLED=false`) once auth journeys start.
7. Unique test-account email addresses per end-to-end run rather than database resets.

**Approved refinements (2026-11-18):**
1. **Reset-token security** — a global `<meta name="referrer" content="strict-origin">` (amended 2026-11-18, see below); synchronous token capture and `history.replaceState` before React initialization or any application request; the token held in memory only and submitted in the POST body only; tests for URL and referrer leakage. The token's presence in the initial document request (and so in any server or proxy access log) is preserved as a deployment consideration. Cors-mode fetches keep the `Origin` header under the global policy; the real sign-out journey in Increment 4 verifies this.
   **Amendment (approved by the developer 2026-11-18, during Increment 4):** the originally approved global `<meta name="referrer" content="no-referrer">` is replaced by `strict-origin`. Reason: a verified conflict with the OpenStreetMap Foundation tile usage policy (https://operations.osmfoundation.org/policies/tiles/, read 2026-11-18), which lists among its mandatory "You must not" rules setting "a restrictive Referrer-Policy that prevents the HTTP Referer header being sent", and requires web pages to send a valid Referer to `tile.openstreetmap.org` — the tile service the M02 maps use for development and demonstration (DECISIONS.md, ADR-004 implementation note). `strict-origin` sends only the application origin as the Referer (never a path or query, and nothing from an https page to an http URL), so a reset token in the query string can never appear in any Referer, tile requests still carry a Referer, and the backend's Origin checks and Referer-origin fallback are unaffected. The reset-token capture, URL stripping, memory-only retention, and POST-body submission requirements above are unchanged and remain Increment 5 work.
2. **Return-path security** — reject external and protocol-relative URLs, backslashes, control characters, whitespace, malformed percent-encoding, unsafe encoded leading slashes, and values over 2048 characters; preserve valid internal query strings and fragments; fall back safely to `/`.
3. **Session behaviour** — four states: `loading`; `anonymous` (the session endpoint answered 200 with `null`); `authenticated` with the user; `unavailable` (network error, 5xx, or malformed body) carrying a retry function. `unavailable` renders the same links as `anonymous` plus a polite "Couldn't check whether you're signed in" notice with Retry, and the sign-in and register pages must not redirect away in that state. Sign-out changes state only on server-confirmed success; on failure the user stays authenticated with an alert that sign-out did not complete, with retry. Revoked and expired sessions appear as `anonymous` on the next check; `refresh` is exposed for later 401 handling. Required tests: each state, sign-out success and failure, and retry (Increment 2); the real-server reload-restores-session, cleared-cookie, revoked-from-another-context, failed-check, and failed-sign-out journeys (later increments).

**Increment 1 Verification Results (2026-11-18) — auth API client and validation — ACCEPTED by the developer 2026-11-18** (results as reported at acceptance; not re-executed when this record was written).

**Changed files:** `frontend/package.json` (+ `"zod": "^4.6.7"`, resolving to the already-installed 4.6.7 — no new package in the lockfile) and `package-lock.json` (the matching workspace manifest line only); `frontend/src/api/client.ts` (modified — `postJson` beside `getJson`, explicit request options, auth error mapping); new: `frontend/src/api/auth.ts`, `frontend/src/api/auth.test.ts`, `frontend/src/api/postJson.test.ts`, `frontend/src/auth/validation.ts`, `frontend/src/auth/validation.test.ts`, `frontend/src/auth/returnPath.ts`, `frontend/src/auth/returnPath.test.ts`.

**Contracts established:** `postJson` and `getJson` both send `mode: "cors"` and `credentials: "same-origin"` explicitly. Error mapping handles the project envelope `{ error: { code, message } }`, the library's flat `{ code, message }`, and the 429 `{ message }` with `retryAfterSeconds` from `Retry-After` or `X-Retry-After`; network failures become `NETWORK_ERROR` with status 0; non-JSON bodies become `INVALID_RESPONSE`. `api/auth.ts`: `register` sends `name: ""` (duplicate addresses receive the same success; existence is never inferred); `signIn`; `getSession` returns `null` or `{ session, user }`; `signOut` resolves only on exact `success: true`; `requestPasswordReset` sends the email only (the backend builds the link); `resetPassword` sends the token in the body only; unexpected 2xx bodies throw rather than being trusted. Validation mirrors the server and is never authoritative: 8–128 characters, no character classes, passwords untrimmed, emails trimmed but not lowercased, sign-in checks presence only. `safeReturnPath(raw, origin)` returns an internal pathname plus query plus fragment, or `/`, per refinement 2.

**Checks executed at acceptance (via `node` against the binaries):** frontend and backend type checks 0 errors; `eslint .` 0 errors; `prettier --check` clean repository-wide; frontend unit 39 files / **370 tests** (68 new); backend unit 74; backend and frontend builds ok; Playwright **22/22** against the production-mode server.

**Deviations:** none recorded. Nothing committed or pushed.

**Increment 2 Verification Results (2026-11-18) — session provider and shell integration — ACCEPTED by the developer 2026-11-18** (acceptance covers the provider and hook, the account navigation, the sign-out behaviour, the two approved layout corrections, the automated and visual verification below, and the absence of outstanding Increment 2 blockers or deviations requiring follow-up). Authorized scope: session provider and `useAuth` hook mounted in `main.tsx`; `AppLayout` account navigation; sign-out behaviour; component tests with the auth API module mocked; one real-server Playwright check of the anonymous navigation. No registration, sign-in, or password-reset page, no reset-token capture, no favorites.

**Changed files:** new — `frontend/src/auth/session.ts` (the four-state `SessionState` type, `AuthContext`, `useAuth`), `frontend/src/auth/AuthProvider.tsx`, `frontend/src/layout/AccountNav.tsx`, `frontend/src/layout/AccountNav.module.css`, `frontend/src/auth/testFixtures.ts` (synthetic user/session and a deferred-promise helper, test-only), tests `frontend/src/auth/AuthProvider.test.tsx` (19), `frontend/src/layout/AccountNav.test.tsx` (11), `e2e/auth-navigation.spec.ts` (1); modified — `frontend/src/main.tsx` (`<AuthProvider>` around `<App />` inside `BrowserRouter`), `frontend/src/layout/AppLayout.tsx` (renders `<AccountNav />` after the Primary navigation), `frontend/src/App.test.tsx` (wraps the app in the provider with the auth API mocked to answer "signed out"; asserts the Sign in link). No dependency added; no backend change.

**Session provider (`AuthProvider`, `useAuth`):** the state comes only from `GET /api/auth/get-session`, checked on mount (which is how a reload restores the signed-in UI) and on every `refresh` or `retry`; nothing is read from or written to browser storage (tested). `null` → `anonymous`; a session → `authenticated` with the user; any failure — network error, 5xx, 429, or malformed body — → `unavailable` carrying `retry`, never `anonymous`. `refresh` keeps the current state while the check runs (no flicker), exposes a `checking` flag, never rejects, and moves a revoked or expired session to `anonymous` — exposed for later 401 handling. Every check takes a generation number, so an older, slower answer can never overwrite a newer one, and unmounting discards in-flight answers. `signOut` changes the state to `anonymous` only after the server confirms (`success: true`); on any failure it rejects with the underlying error and leaves the state exactly as it was; a confirmed sign-out also discards any session check still in flight. `useAuth` outside the provider throws a clear error.

**Account navigation (`AccountNav`):** `loading` — an empty `aria-busy` Account navigation with no text, so a signed-in user never sees "Sign in" flash on reload and the existing end-to-end "no loading text" checks are unaffected; `anonymous` — Sign in (`/sign-in`) and Register (`/register`) links; `unavailable` — the same links plus "Couldn't check whether you're signed in." in a polite `role="status"` with a Retry button that shows "Checking whether you're signed in…" and ignores repeat activation (`aria-disabled`) while the check runs; `authenticated` — "Signed in as {email}" and a Sign out button that shows "Signing out…" and ignores repeat activation while pending. A sign-out failure keeps the signed-in UI and shows a `role="alert"` reading "Sign-out didn't complete. You're still signed in." with a "Try signing out again" button; the alert is cleared during a new attempt and re-announced on a second failure; no error detail reaches the UI. **Focus management:** when the control the user just activated disappears (Sign out after confirmation, or Retry once the check resolves), focus moves to the new state's first control — the Sign in link, or the Sign out button — and never moves if the user has focused something else. The Sign in and Register routes themselves arrive in Increments 3 and 4.

**Approved layout corrections (2026-11-18, after visual review):** (1) `.account { margin-left: auto }` keeps the account area at the header's right edge, including when it wraps to its own row (it previously started at the left on wrapped rows, and Discover sat mid-header on desktop); (2) the loading branch renders its busy navigation inside the same `.account` wrapper as the other states, which removed a Discover shift on session resolution of 387 px at 1280 px and 131 px at 768 px.

**Tests:** provider — each of the four states, `unavailable` for network/5xx/malformed/429 failures, retry success and failure, refresh keeping state then showing a revoked session as `anonymous`, refresh never rejecting, stale-response protection, sign-out confirmed and failing (network, CSRF 403, unconfirmed body) with the user kept signed in, sign-out discarding an in-flight check, no browser storage, `useAuth` outside the provider; account navigation — each state's rendering, retry progress and focus outcome (to Sign in, to Sign out, or staying on Retry after a second failure), sign-out pending/double-activation/success with focus to Sign in, failure alert and retry from it, alert re-announcement, keyboard-only sign-out; Playwright (real production-mode server, no interception) — the browser's own `get-session` returns 200 with `null`, Sign in and Register are shown with no Sign out and no notice, Discover is intact, and browser storage stays empty.

**Checks executed (via `node` against the binaries):** after the final change — frontend `tsc -b --noEmit` 0 errors; ESLint 0 errors; `prettier --check .` clean repository-wide; frontend unit 41 files / **400 tests** (370 + 30 new); `vite build` ok; Playwright **23/23** (22 existing + 1 new; `CI=1`, freshly spawned production-mode server, `landmarks_test`); the six axe states at 0 violations, now scanned with the anonymous Account navigation present. At the initial implementation verification (no backend file changed since) — backend `tsc --noEmit` 0 errors, backend unit 6 files / **74 tests**, backend build ok. `DATABASE_URL_TEST` was set explicitly for the Playwright runs to the documented local value from `backend/.env.example`.

**Responsive visual verification:** a scratch Playwright script outside the repository, against the production build, with only the session responses and map tiles mocked, at 1280 × 800, 768 × 1024, 375 × 812, and 320 × 640, across loading, anonymous, unavailable, authenticated (short and 80-character addresses), and sign-out failure; screenshots inspected and measured. Final results: no horizontal overflow, clipping, or overlap in any of the 32 captures; the account area's right edge on the header's inner edge in every capture; long addresses break within the header on phone widths; Tab order skip link → Discover → Sign in → Register (or → Sign out) at every width, with the 3 px solid focus outline visible; **zero remaining Discover shift** when the session check resolves (x 392 → 392 at 1280 and 768 px, 16 → 16 at 375 and 320 px; header height unchanged).

**Deviations:** none requiring follow-up. Design details decided during implementation and accepted with the increment: the `checking` flag on the context (so Retry can show progress); the dedicated "Try signing out again" button inside the failure alert; the focus-management rule above; a failed sign-out does not re-check the session, so a session that already expired on the server stays shown as signed in until the next check, consistent with server-confirmed sign-out. Nothing committed or pushed.

**Increment 3 Verification Results (2026-11-18) — registration page — ACCEPTED by the developer 2026-11-18** (conditionally accepted after implementation and automated review, pending verification of the complete registration → sign-in journey; the developer approved leaving `/sign-in` unimplemented until Increment 4 — no placeholder route — as an expected cross-increment dependency rather than a reason to expand this increment; **full acceptance granted 2026-11-18 after Increment 4 verified that journey** against the real server, see the Increment 4 record). Authorized scope: an accessible `/register` page; email, password, and confirmation with the Increment 1 Zod validation; field-level errors, pending feedback, and API error handling; neutral duplicate-registration behaviour; redirect to `/sign-in` with a confirmation notice and no automatic sign-in; no redirect away while the session check is unavailable; keyboard accessibility, focus management, and error announcements. No sign-in, password-reset, or favorites work.

**Changed files:** new — `frontend/src/routes/RegisterPage.tsx` (also exports `SignInLocationState`, the router-state contract the sign-in page reads), `frontend/src/routes/RegisterPage.module.css`, tests `frontend/src/routes/RegisterPage.test.tsx` (32) and `e2e/registration.spec.ts` (4); modified — `frontend/src/App.tsx` (the `register` route), `playwright.config.ts` (`AUTH_RATE_LIMIT_ENABLED: "false"` for the spawned server, decision 6; CI uses the same configuration). No dependency added; no backend change.

**Behaviour:** labelled email, password (with a "Use 8 to 128 characters." hint), and confirmation fields with `autocomplete` `email`/`new-password`; validation through `registrationSchema` with errors tied to their fields by `aria-describedby` and `aria-invalid`, focus moved to the first invalid field on a rejected submit, and an edited field's error cleared on its own; a pending state ("Creating account…", `aria-disabled`, `aria-busy` form) that keeps the button focusable and ignores repeat submits. Server failures: `PASSWORD_TOO_SHORT`/`PASSWORD_TOO_LONG` → a password field error; `VALIDATION_ERROR`/`INVALID_EMAIL` → an email field error; network failure, 429 (with the wait from `Retry-After`/`X-Retry-After`), and everything else → fixed messages in a `role="alert"`; the server's own wording is never shown. **Neutral duplicates:** the backend answers a duplicate address exactly like a new one, so both reach the same success; even a hypothetical existence-revealing error would show only the generic message. **Success:** navigates to `/sign-in` with `{ registered: true }` router state, forwarding a `returnTo` that passes `safeReturnPath`; it never calls sign-in or re-checks the session, so registration does not authenticate. **Session states:** `loading`, `anonymous`, and `unavailable` show the form; a signed-in visitor is sent to the safe return path (or `/`).

**Checks executed at implementation (via `node` against the binaries):** Prettier clean repository-wide; ESLint 0; frontend and backend type checks 0 errors; frontend unit 42 files / **432 tests** (400 + 32); backend unit 74; both builds ok; Playwright **27/27** (23 + 4) against the production-mode server; axe at 0 violations across 9 states (the six existing plus empty form, field errors, and server error). Playwright journeys: header Register link → registration with the request body exactly `{ name: "", email, password }`, no `Set-Cookie`, session `null` afterwards; a duplicate (different case) with the same status and response shape, no alert, no existence wording; keyboard-only completion; the axe states (only the server-error state simulated).

**Deviations (accepted with the increment):** the confirmation notice travels as router state for the sign-in page to display; the authenticated-visitor redirect was applied to `/register` as well as the planned sign-in page (refinement 3); `returnTo` is forwarded to sign-in. Two test-only fixes during implementation: long passwords are pasted rather than typed (a timed-out typing test had kept typing into later tests' forms), and an assertion was corrected because browsers strip surrounding whitespace from `type="email"` values. Correction recorded: the Increment 2 report stated the header's unbuilt Sign in link showed "the header over an empty page"; in fact an unmatched route rendered nothing, header included, until Increment 4 added `/sign-in`. Nothing committed or pushed.

**Increment 4 Verification Results (2026-11-18) — sign-in page — ACCEPTED by the developer 2026-11-18** (acceptance covers the sign-in page, the session journeys, the `strict-origin` referrer-policy amendment and its real-browser verification, the cross-increment registration → sign-in journey that completed Increment 3's acceptance, and the verification results below). Authorized scope: a working `/sign-in` route within the application shell; an accessible email/password form with validation, pending states, labels, and error announcements; generic credential errors and 429 handling; the registration confirmation notice from router state; safe `returnTo` navigation with `/` as the fallback; redirecting signed-in visitors but never while the session is unavailable; refreshing the session provider and navigating on success; session persistence, confirmed sign-out, revoked/expired handling, and recovery from failed checks; the approved CSRF protections and no credentials or session data in browser storage; plus the cross-increment criteria set at Increment 3's conditional acceptance. No password-reset pages, reset-token capture, or favorites.

**Referrer-policy amendment (approved 2026-11-18, before any page code):** implementation stopped on finding that the approved global `no-referrer` conflicts with the OpenStreetMap tile usage policy; the developer approved `strict-origin` (decision 5 and refinement 1 above, with reason and source). Implemented as `<meta name="referrer" content="strict-origin" />` in `frontend/index.html`, with the `client.ts` comment updated; `mode: "cors"` and every backend CSRF protection unchanged. **Real-browser verification** (`e2e/referrer-policy.spec.ts`, 2; tile responses stubbed so no request left the machine, the headers asserted being the ones Chromium built): loading `/?q=Falls&secret=do-not-leak`, every request to `tile.openstreetmap.org` and the same-origin API request carried exactly `Referer: http://localhost:3000/`; the real sign-out sent `Origin: http://localhost:3000` and the same origin-only Referer, received 200 `{ success: true }`, and the server session was then `null`. **Regression guard:** `frontend/src/referrerPolicy.test.ts` (2) fails unless `index.html` holds exactly one referrer meta, `strict-origin`, in `<head>` before the application script. The Increment 5 reset-token requirements (synchronous capture and `history.replaceState` before React initialization or any application request, memory-only retention, POST-body-only submission, URL and referrer leakage tests) are unchanged and not yet implemented.

**Changed files:** new — `frontend/src/routes/SignInPage.tsx` (exports `SIGN_IN_MESSAGES`), `frontend/src/routes/SignInPage.module.css` (the confirmation notice only; form styles are shared from `RegisterPage.module.css` so the then conditionally accepted Increment 3 files stayed unchanged), `frontend/src/referrerPolicy.test.ts`, tests `frontend/src/routes/SignInPage.test.tsx` (38), `e2e/sign-in.spec.ts` (11), `e2e/referrer-policy.spec.ts` (2); modified — `frontend/index.html`, `frontend/src/api/client.ts` (comment only), `frontend/src/App.tsx` (the `sign-in` route), this file (the amendment). No dependency added; no backend change.

**Behaviour:** labelled email and password fields (`autocomplete` `email`/`current-password`) checked for presence only through `signInSchema`, so the password policy is never restated to someone guessing; field errors, first-invalid-field focus, and the pending state ("Signing in…") as on the registration page. **Generic credential errors:** any 400 or 401 — a wrong password and an unknown address alike — shows "The email address or password is incorrect.", clears the password, and focuses it; 429 shows the wait ("30 seconds", "2 minutes", or "a minute" when none is given); network failure and everything else show fixed messages in a `role="alert"`; server wording never appears. **Notice:** "Registration received. Sign in with your email address and password." in a `role="status"`, only for router state exactly `{ registered: true }`. **Destination:** `returnTo` through `safeReturnPath` (fallback `/`), also forwarded to the "Create an account" link. **Success:** after the sign-in call resolves, `refresh()` lets the provider confirm the session with the server before navigating (replace) to the destination; if that confirming check fails the page still navigates and the header shows its Retry notice. **Session states:** a signed-in visitor is sent to the safe destination; `loading`, `anonymous`, and `unavailable` show the form and never redirect.

**Tests — component (`SignInPage.test.tsx`, 38):** form and presence-only checks; the notice for exactly `{ registered: true }` and not for five other states; refresh before navigation (the page stays pending until the provider's check resolves); repeat-submit protection; safe `returnTo` with its query kept and five unsafe forms falling back to `/`; navigation despite a failed confirming check; four 400/401 variants with one message, password cleared and focused; byte-identical page output after a wrong password and an unknown address; three 429 waits; five other failures; retry after failure; the four session states; the registration → sign-in flow with `returnTo` preserved, the notice shown, and no sign-in call or extra session check from registration; keyboard-only completion. **Real-server journeys (`e2e/sign-in.spec.ts`, 11):** *cross-increment* — `/sign-in?returnTo=<landmark>` → Create an account → registration → the usable sign-in page inside the shell with the notice, the visitor still signed out (header and server session `null`) → sign-in lands on the landmark, with the session cookie HttpOnly and `SameSite=Lax` and browser storage empty; *sign-in* — identical generic page after a wrong password and an unknown address; unsafe `returnTo` (`https://evil.example/`, `//evil.example`) falls back to `/`; an already signed-in visitor is sent on from `/sign-in` and `/register`; *session* — reload restores the session; confirmed sign-out ends it and stays ended after reload; a cleared cookie shows as signed out; a session revoked from another browser context (same cookie, real server-side sign-out) shows as signed out on the next load; *accessibility* — keyboard-only validation and sign-in with a visible focus outline; axe across five states (empty form, registration notice, field errors, credential failure, signed-in shell).

**Real-server versus simulated:** everything above runs against the real production-mode server and `landmarks_test` except, by design, (1) the failed session check — `get-session` answered 503 by interception, the sign-in page shown without redirecting, then the interception removed and Retry recovering against the real server; (2) the failed sign-out — `sign-out` answered 503 by interception, the alert shown and the real session still valid, then a real retry signing out; (3) map-tile responses, stubbed in the referrer checks; and Increment 3's server-error axe state. A truly expired session was not exercised in the browser (the server's 30-day clock cannot be advanced there); in the UI it takes the same `null`-session path as the revoked and cleared-cookie journeys, and expiry itself is covered by the M03-T02 backend tests.

**Checks executed after the final change (via `node` against the binaries):** Prettier clean repository-wide; ESLint 0; frontend and backend type checks 0 errors; frontend unit 44 files / **472 tests** (432 + 38 + 2); backend unit 6 files / **74 tests**; frontend and backend builds ok; Playwright **40/40** (27 + 2 + 11; `CI=1`, freshly spawned production-mode server, `landmarks_test`); axe **14 states, 0 violations**.

**Deviations (accepted with the increment):** the referrer-policy amendment above; the shared form styles; the page navigates even when the post-sign-in confirming check fails; no "Forgot password?" link yet (spec §4.3 places it on the sign-in screen, and it arrives with the Increment 5 reset pages). The draft amendment first cited ADR-005 for the tile-service note and was corrected to ADR-004 before reporting. Nothing committed or pushed.

**Nonblocking cleanup for Increment 6 (closure):** (1) consider renaming the shared `frontend/src/routes/RegisterPage.module.css` to a neutral authentication-form module used by both pages; (2) correct the outdated comment in `e2e/registration.spec.ts` that says `/sign-in` "has no route until Increment 4".

**Increment 5 Verification Results (2026-11-18) — password-reset pages — ACCEPTED by the developer 2026-11-18** (acceptance covers the two pages and their routes, the sign-in link and notice, the reset-token handling and its security verification, the verification results, the accepted deviations, and the outstanding considerations below, which stay open). Authorized scope: accessible forgot-password and reset-password pages and routes on the existing auth API client and validation utilities; a "Forgot password?" link on the sign-in page; a neutral request confirmation and the approved message for unavailable delivery; synchronous token capture and URL stripping in `main.tsx` before React initialization, rendering, or application requests; memory-only retention; POST-body-only submission through `resetPassword`; the `strict-origin` policy and `mode: "cors"` preserved; safe handling of missing, invalid, expired, and used tokens with no token in UI or diagnostics; accessible validation, pending states, announcements, focus, and post-reset navigation; existing behaviour preserved. No Increment 6 cleanup, no other authentication feature, no favorites.

**Changed files:** new — `frontend/src/auth/resetToken.ts` (`RESET_PASSWORD_PATH`, `captureResetToken`, `getResetToken`, `clearResetToken`), `frontend/src/routes/ForgotPasswordPage.tsx` (exports `FORGOT_PASSWORD_MESSAGES`), `frontend/src/routes/ResetPasswordPage.tsx` (exports `RESET_PASSWORD_MESSAGES`), tests `frontend/src/auth/resetToken.test.ts` (13), `frontend/src/routes/ForgotPasswordPage.test.tsx` (14), `frontend/src/routes/ResetPasswordPage.test.tsx` (19), `e2e/password-reset.spec.ts` (9); modified — `frontend/src/main.tsx` (`captureResetToken()` as the first statement after the imports), `frontend/src/App.tsx` (the `forgot-password` and `reset-password` routes), `frontend/src/routes/SignInPage.tsx` ("Forgot password?" link; `SignInNoticeState` adding `passwordReset` to the registration state, defined there so `RegisterPage.tsx` stays unchanged; the reset notice), `frontend/src/routes/SignInPage.test.tsx` (+4). No dependency added; no backend change.

**Token capture and handling:** `captureResetToken` acts only on `/reset-password` with a `token` parameter: it copies the value into module memory, then `history.replaceState` rewrites the current entry without it, keeping other parameters, the fragment, and the existing history state; an empty or over-256-character value is stripped and discarded. `main.tsx` calls it before `createRoot` or `render` (a unit test enforces that it is the first statement after the imports and precedes both). The reset page reads the token only through `getResetToken` and never renders, logs, routes, or stores it; `resetPassword` sends it only in the POST body. The token is forgotten after a successful reset or a server rejection. The global `strict-origin` policy and `mode: "cors"` requests are unchanged.

**Pages:** *Forgot password* — one email field (validated with `passwordResetRequestSchema`); only the trimmed address is sent; success replaces the form with a focused `role="status"` neutral confirmation ("If an account exists for that email address, a link to reset its password is on its way. The link works once and expires after 30 minutes."); `RESET_UNAVAILABLE` (503) shows the approved message "Password reset is temporarily unavailable. Please try again later." and never claims an email was sent; 429 shows the wait; network, other 503, CSRF, and unexpected failures show fixed messages; a server email-validation error becomes a field error; server wording is never shown. *Reset password* — three states: the form when a token is held (new password with the 8–128 hint and confirmation, `passwordResetSchema`); "incomplete link" when none is held; "invalid or expired" (a focused `role="alert"`, with a link to request a new one) when the server answers `INVALID_TOKEN` — invalid, expired, and used tokens alike — or the visitor arrives from the library's `?error=INVALID_TOKEN` redirect. Policy errors become field errors and keep the token; 429, network, and other failures show alerts, keep the token, and can be retried. On success the provider re-checks the session (a reset revokes every session) and the user goes to `/sign-in` with "Your password has been reset. Sign in with your new password." A signed-in visitor is not redirected away from either page. Both pages use labelled fields, errors tied to inputs, first-invalid-field focus, and pending states ("Sending link…", "Resetting password…") that keep the button focusable and ignore repeats.

**Security verification (real Chromium):** a script installed before page scripts recorded the address bar at React's first render and at every `fetch` call — the token was already gone at all of them; of every request the page made, only the initial document request carried the token in its URL; no Referer, the address bar, `history.state`, local or session storage, cookies, or console output contained it; after navigating from the reset page to the map in the same document, tile requests still carried only `Referer: http://localhost:3000/`; the submission was `POST /api/auth/reset-password` with no token in the URL, a body of exactly `{ token, newPassword }`, `Origin: http://localhost:3000`, and the origin-only Referer; the real server rejected an unknown token with 400 (the token check, not a 403 CSRF rejection). The production-mode server's own stdout and stderr, captured during the reset spec with a scratch configuration outside the repository, contained no token and no address (its only reset lines were `RESET_UNAVAILABLE { provider=disabled }`). Unit tests separately assert that no token reaches the DOM, console, storage, or cookies.

**Real-server versus simulated:** *real server* — the reset-request 503 (the e2e server runs with `MAIL_TRANSPORT=disabled`), identical for an existing and an unknown address; rejection of an unknown token by the completion endpoint; the library's GET callback redirect for a bad token; the missing-token page; the sign-in page's Forgot password? link; the token capture and leak checks; four of the eight new axe states (empty forms, field errors, the unavailable alert, the invalid-link alert after a real 400). *Simulated by interception, as approved* — a successful reset completion (no real token can be obtained without mail delivery), a successful (200) reset request for the neutral confirmation, and map-tile responses.

**Checks executed after the final change (via `node` against the binaries):** Prettier clean repository-wide; ESLint 0; frontend and backend type checks 0 errors; frontend unit 47 files / **522 tests** (472 + 50); backend unit 6 files / **74 tests**; frontend and backend builds ok; Playwright **49/49** (40 + 9; `CI=1`, freshly spawned production-mode server, `landmarks_test`); axe **22 states, 0 violations** (14 + forgot-password empty, field error, unavailable, confirmation; reset form, field errors, invalid link; sign-in with the Forgot password? link).

**Accepted deviations and implementation decisions:** the "Forgot password?" link sits after "Create an account" rather than beside the password field, keeping Increment 4's keyboard order and tests; a signed-in visitor may use both pages (the token decides the account); the token is forgotten after success or a server rejection, otherwise it stays in memory until reload; the new pages reuse the shared form styles and the sign-in notice style; the reset notice is carried by `SignInNoticeState` in `SignInPage.tsx`. Nothing committed or pushed.

**Outstanding considerations (open):** (1) a successful reset has not been verified through the complete real-server mail-delivery journey — the M03-T02 backend tests cover successful completion and session revocation, and the frontend success path was simulated; (2) the initial document request carries the token and may expose it to infrastructure access logs (deployment consideration; the application itself logs no request URLs); (3) consider clearing the token when the visitor navigates away from the reset page instead of keeping it in module memory until reload; (4) consider renaming the shared authentication form CSS module during Increment 6; (5) correct the outdated comment in `e2e/registration.spec.ts` during Increment 6. _(Items 3–5 were resolved in Increment 6; items 1 and 2 remain open — see the Increment 6 record.)_

**Increment 6 Verification Results (2026-11-18) — closure — ACCEPTED by the developer 2026-11-18, closing M03-T03 as Complete** (acceptance covers the requirements review, the cleanup, the README reconciliation, the reset-token navigation guard approved during this increment, the final accessibility and responsive review, and the final verification below; the follow-ups at the end of this record stay open). Authorized scope: a review of the complete implementation against its approved requirements and security decisions; a decision on each of the five Increment 5 considerations (proposing, not implementing, any reset-token change); the smallest reasonable CSS cleanup; the registration test comment; a final accessibility review; the full available regression suite; documentation reconciliation and remaining blockers. Boundaries kept: no production SMTP configuration, no test-only backend endpoint, no new authentication feature, no favorites, no backend change.

**Requirements review:** the implementation was checked against spec §4 (registration, sign-in, reset, sign-out), the §3.2 and §9.1 items that apply to the frontend, the seven decisions and three refinements (including the `strict-origin` amendment), and the six approved increments; no gap was found. Spec §8's favorites behaviour, including the expired-session explanation, belongs to M03-T06.

**The five Increment 5 considerations:** (1) a successful reset through real mail delivery — **still open**: it needs SMTP or a test hook, both excluded without separate approval; the README's local route (a capture server such as Mailpit) would be a manual check with a new tool, left to the developer; the M03-T02 backend tests cover successful completion and the revocation of every session. (2) The token in the initial document request — **still open** as a deployment consideration, now documented in the README's production requirements. (3) Clearing the token on leaving the reset page — **resolved**: assessed (benefit: a token left in memory let Back restore a working form for up to 30 minutes, e.g. on an unattended shared computer; cost: after leaving, Back shows the incomplete-link message and the emailed link must be reopened), proposed, approved by the developer 2026-11-18, and implemented (below). (4) The shared CSS module — **resolved** (below). (5) The registration test comment — **resolved** (below).

**Changed files:** new — `frontend/src/routes/AuthForm.module.css` (the shared form styles plus the confirmation-notice style, rules unchanged), `frontend/src/auth/ResetTokenGuard.tsx`, `frontend/src/auth/ResetTokenGuard.test.tsx` (6); deleted — `frontend/src/routes/RegisterPage.module.css` and `frontend/src/routes/SignInPage.module.css` (merged into `AuthForm.module.css`); modified — `frontend/src/routes/RegisterPage.tsx`, `SignInPage.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx` (imports only, plus removal of the comments about the old module names), `frontend/src/App.tsx` (renders `<ResetTokenGuard />` beside `<Routes>`), `e2e/registration.spec.ts` (the outdated inline comment and file header now point to the registration → sign-in journey in `sign-in.spec.ts`), `e2e/password-reset.spec.ts` (+1 Back-navigation test), `README.md` (below). No dependency added; no backend change.

**Final reset-token behaviour:** `main.tsx` still captures the token and strips it from the URL before React starts, and keeps it only in memory. `ResetTokenGuard` — rendered once at the application root, outside `<Routes>`, so it runs for every route including unmatched ones that render no layout — clears the token whenever the path is not `/reset-password`. It does nothing while the visitor stays on `/reset-password`, so the token survives re-renders, same-path navigation, and React development mode's unmount and remount; it does not depend on the reset page unmounting. Once cleared, browser Back (or Forward then Back) shows the incomplete-link message, because the URL was already stripped and nothing else holds the token. A successful reset and a server rejection still forget it as before. No browser storage is used.

**Tests:** `ResetTokenGuard.test.tsx` (6, real `App` routes under React StrictMode, auth API mocked) — arrival with a token shows the form and keeps the token through StrictMode's remount; typing, a failed submission, and a same-path navigation keep it; navigating away clears it and Back shows the incomplete-link state; navigating to an unmatched route clears it; a successful reset and an invalid token behave as before. With the guard temporarily disabled, exactly the two navigate-away tests failed and the other four passed; the guard was then restored. Playwright (`e2e/password-reset.spec.ts`, +1) — arrive with a token, type into the form, leave through Discover, then the browser's real Back: the form is gone, the incomplete-link message shows, Forward then Back cannot restore it, the URL has no token, and the completion endpoint was never called.

**README reconciliation:** a "Frontend pages (M03-T03)" paragraph (the four pages, session restoration from the server with nothing in browser storage, the global `strict-origin` policy and why, the reset-token capture and POST-body submission, and the Playwright server's `AUTH_RATE_LIMIT_ENABLED=false`); and, under production requirements, a note that a reset link's token is part of the first request for `/reset-password?token=…`, so the platform's and any proxy's access logs should be checked for query strings and treated as sensitive for the token's 30-minute lifetime.

**Final accessibility and responsive review:** the four authentication pages were captured in their key states (registration with field errors; sign-in with the registration notice, a credential error, and a long address; forgot-password unavailable and confirmation; reset-password field errors and invalid link) at 1280 × 800, 768 × 1024, 375 × 812, and 320 × 640 (320 px also covers WCAG reflow) by a scratch Playwright script outside the repository: no horizontal overflow, clipping, or overlap in any of the 24 captures; screenshots inspected. A keyboard pass on the registration, sign-in, and reset pages found the 3 px solid focus outline at every stop, and the header's active link marks the current page. Error announcements, first-invalid-field focus, and the focused confirmation and alerts were already covered by the axe and keyboard checks of Increments 2–5.

**Final verification:** *after the final change* — Prettier clean repository-wide; ESLint 0; frontend and backend type checks 0 errors; frontend unit 48 files / **528 tests**; `vite build` ok; Playwright **50/50** (`CI=1`, freshly spawned production-mode server, `landmarks_test`); axe **22 states, 0 violations**. *During the earlier Increment 6 verification (not re-run after the final, frontend-only change)* — backend unit 6 files / **74 tests**; backend integration 17 files / **137 tests** on `landmarks_test`; `prisma validate` valid; `prisma migrate status` up to date (2 migrations); backend build ok.

**Deviations:** none from the authorized scope; the reset-token guard was proposed and approved within the increment before it was implemented. Nothing committed or pushed.

**Follow-ups (open):** *deployment* — verify a successful password reset through real mail delivery end to end; review infrastructure and proxy access logs for reset-link query strings. *Accessibility, app-wide (not regressions; also true of the discovery pages)* — route-specific page titles (every route shares one `document.title`, WCAG 2.4.2) and focus management on route change. *Map provider* — whichever production tile provider is chosen must accept an origin-only Referer under the `strict-origin` policy (to record under ADR-004 when the provider is decided). *Unchanged from M03-T02 and earlier* — the production deployment blockers (trusted-proxy verification, production SMTP provider and sender, HTTPS, the sensitive-location classification policy), dependency-audit triage and the seven Dependabot pull requests, expired-session cleanup, the account-enumeration timing limitation, the parameterised reset callback route, per-IP rather than per-account limiting, favorites throttling, and M02's open mobile-device criterion.

**Post-commit CI follow-up (2026-11-18 to 2026-11-20) — CLOSED.** The developer-approved checkpoint committed M03-T03 as `27ee99f` and pushed it to `origin/main` (2026-11-18). **CI run #16 on `27ee99f` failed**: in both the quality job ("Smoke tests") and the regression job (`npm run test:e2e`), exactly one Playwright test failed — `e2e/sign-in.spec.ts` "registration → sign-in (cross-increment)", which stayed on `/register?returnTo=…` when `/sign-in?returnTo=…` was expected (49 of 50 passed in each job; every earlier step, including unit and integration tests, passed). **Root cause — a test synchronization race, not an application defect:** React Router 7's `BrowserRouter` applies each navigation inside `React.startTransition`, so the URL changes before the new page renders. The test waited only for the `/register` URL and then filled fields located by label alone; on the slower CI runners the "Email address" and "Password" fills landed in the still-rendered sign-in form, only "Confirm password" reached the registration form, and its client validation stopped the submission. Reproduced locally with Chromium's CPU throttled (×12 and ×20: fills received by `sign-in-email` and `sign-in-password`; at ×1 never); no other e2e test follows the same navigate-then-fill pattern. **Correction (developer-approved):** the test now waits for the "Create an account" registration region to be visible and scopes the email, password, confirmation, and submit interactions to it — no added timeout, no assertion weakened, no application, CI, or other test change. Verified before commit: Prettier, ESLint, frontend and backend type checks, and a strict `tsc --noEmit` on the spec clean; the affected test 5/5; the full Playwright suite 50/50 with 22 axe states at 0 violations; and, in a scratch check outside the repository, the corrected steps 10/10 under ×12 and ×20 throttling. **Committed as `80b018a`** ("Fix Playwright registration navigation race in CI") and pushed to `origin/main` 2026-11-20. **CI run #19 on `80b018a` passed**: the quality job and the regression job both completed `success` with every step successful (https://github.com/tpalme14/hidden_tennessee/actions/runs/44797440938). The M03-T03 CI follow-up is closed; the deployment and accessibility follow-ups above are unchanged.

### M03-T04: Implement Authorization

**Status:** Complete — closed 2026-11-20 after the developer accepted Increments 1–3 and authorized the Increment 4 closure (final verification and documentation reconciliation, record below). This task delivered the reusable **authorization infrastructure** — protected mounts, the session-derived identity accessor, protected-route caching and error handling, deny-by-default structural enforcement, two-user test helpers, and ADR-012. **Ownership enforcement on real account data is not part of this task**: no account-scoped resource exists yet, and owner-scoped queries plus the favorites ownership tests are M03-T05 work (see the hand-off below). History: planning authorized 2026-11-20; the plan and six decisions approved 2026-11-20 — D1 keep the task order (T04 builds the foundation, T05 proves real ownership), D2 uniform 404 for missing and non-owned resources, D3 identity only from the validated session (T05 schemas reject unexpected identity fields; validation is not authorization), D4 `Cache-Control: private, no-store` on protected responses, D5 record the conventions as ADR-012, D6 favorites throttling deferred to M03-T05. Increment 1 authorized and accepted 2026-11-20; Increment 2 authorized with three corrections and accepted 2026-11-20; Increment 3 authorized with two refinements and accepted 2026-11-20 (decisions E1–E6 approved); Increment 4 authorized 2026-11-20.

**Dependencies:** M03-T02

**Scope:**
- Enforce ownership and access rules.
- Protect authenticated operations.
- Test unauthorized access attempts.

**Increment 1 (2026-11-20) — protected mount, identity accessor, no-store — ACCEPTED 2026-11-20.** New `backend/src/auth/protected-route.ts` (no runtime dependency on Better Auth, so it is unit-testable): `noStore` (`Cache-Control: private, no-store`; documented as not guaranteeing back-forward-cache isolation); `authenticatedUserId(req)` (the only sanctioned identity source; returns the user ID alone; throws `AuthenticationContextMissingError` when no validated identity exists, so a mis-wired route fails closed); `protectedRouteErrorHandler` (errors carrying a 4xx status and errors after headers are sent pass through unchanged; anything else becomes a fixed 500 `INTERNAL_ERROR` with `no-store` and one sanitized log line — `AUTHORIZATION_CONTEXT_MISSING` or `PROTECTED_ROUTE_FAILURE` plus the class name); `createMountProtected(requireSession)` (mounts `noStore → requireSession → router → protectedRouteErrorHandler` at a literal path only; the root, wildcards, and parameterised paths are refused). New `backend/src/auth/mount-protected.ts` binds the real `requireSession` (`mountProtected`). `backend/src/http/error-envelope.ts` gained `internalErrorEnvelope()`. No production route uses `mountProtected` yet. Tests: `protected-route.test.ts` (30 unit) and `protected-mount.integration.test.ts` (16, test-only app wired like `app.ts`): anonymous GET/POST/nested GET get identical 401s with no handler run; forged, malformed, revoked, and expired sessions get the same 401; a valid session reaches GET/POST/nested handlers with its own user ID, `no-store`, and no session token, session ID, or cookie name in the body; another user's ID in the query, body, or headers is ignored; CSRF 403, malformed-JSON 400, a deliberate 404, and an infrastructure 503 keep their status; synchronous and asynchronous failures and a mis-wired mount get the fixed 500 without internals; public routes and anonymous unknown or look-alike `/api/v1` paths keep their 200 and 404. A mutation (disabling the 4xx pass-through) failed the 404 integration test and three unit cases. Accepted deviations: two modules instead of one (unit-test configuration), the stricter literal-path guard, and the documented fact that a body-parser error raised before a sub-router never reaches that sub-router's error handler (the pass-through is proven by the 404 case and unit tests).

**Increment 2 (2026-11-20) — structural enforcement — ACCEPTED 2026-11-20.** `backend/tests/helpers/route-inspection.ts` (existing `listRoutes`/`findUnguardedStateChangingRoutes` unchanged) gained a deny-by-default inventory: `inspectApp` walks the whole Express routing tree (full paths, inherited middleware via Express's own `Layer.match`, literal mount paths decoded strictly; parameter/regex mounts and sub-applications fail closed); `evaluateInventory` requires every endpoint — routes and bare middleware functions — to sit inside a contiguous `mountProtected` group recognised by the identity of its four functions, with nothing that could answer ahead of `requireSession`, or to match an exact entry (kind, method set, full path) in the reviewed allowlist `backend/tests/helpers/public-api-routes.ts`. Allowlisted application endpoints must be GET-only; Better Auth's `/api/auth/*` is classified as externally managed authentication endpoints, identified by its error handler (its own controls stay covered by the M03-T02 suites, and nothing assumes its endpoints accept anonymous requests); stale entries fail; global middleware at `/` is recognised by name only and any new one is flagged; route-level-only `requireSession`, a guard after a handler or on another path, a function merely named `requireSession`, and short-circuiting middleware ahead of the guard all fail. Tests: `route-inspection.test.ts` (25 self-tests on synthetic apps, pinning every Express 4 internal used, with a version guard) and `route-inventory.integration.test.ts` (14): the real app has no violations, unrecognised layers, or stale entries, and 0 protected endpoints today; anonymous public GETs still 200 and unknown paths 404; an unprotected router attached to a fresh `createApp()` is detected; on a fixture, anonymous and forged-cookie requests to every discovered protected endpoint (nested and parameterised included) get 401 with `no-store` before any handler runs, and signed-in requests to the same sampled paths reach each handler; short-circuit and ordering bypasses are shown to answer anonymously and are reported; a pass-through in place of the guard fails both the structural check and the sweep. Manual mutation check run and restored. One inspector path-join bug (`//health`) found and fixed during the increment. Accepted limitations: undocumented Express 4 internals (isolated, version-guarded, self-tested); registrations, identity, and order are inspected, not logic inside a function.

**Increment 3 (2026-11-20) — two-user test helpers and ADR-012 — ACCEPTED 2026-11-20.** New `backend/tests/helpers/test-users.ts`: `createSignedInUser`, `createTwoUsers`, `asUser`, `anonymous` (cookie and trusted Origin preset, so writes pass CSRF), `signOut`, `sessionCookieFrom`, `uniqueTestEmail`. Users are created only through the real registration, sign-in, and session endpoints; `TestUser` carries `email`, `userId` (from the server's session endpoint), and `cookie` — no session ID or token (refinement 1); failures throw `TestUserSetupError` naming only the step and HTTP status, with no `cause`, logging, credentials, cookies, tokens, or request/response objects (refinement 2). The helpers never touch the database; files keep their own `resetTestDatabase()` calls. The 13 existing per-file sign-in helpers were left unchanged (E1). Tests: `test-users.test.ts` (13 unit) and `test-users.integration.test.ts` (8): two independent identities, cookies, and session rows; each cookie resolving to its own user; registration not signing in; signing one user out leaving the other signed in; a protected route seeing only the session's identity; client-supplied identity (query, body, header, path) unable to override it; rapid creation without collisions; failure messages exact and credential-free. **ADR-012 — Authorization Conventions for Account-Scoped API Resources — added to `docs/DECISIONS.md` as Accepted (2026-11-20)**, recording ten decisions: protected mounts, session-only identity, owner-scoped queries, uniform 404, request validation as defence in depth, the response-status summary, caching, protected-route errors, deny-by-default structural enforcement, and two-user ownership testing.

**Increment 4 Verification Results (2026-11-20) — final verification and documentation closure.** Documentation: the ADR index table in `docs/DECISIONS.md` gained the missing ADR-011 and ADR-012 rows, and the sentence below it now names both; this task record and §11 were updated. Diff review: production changes are additive only — `protected-route.ts` and `mount-protected.ts` (new, mounted on no production route) and `internalErrorEnvelope()`; no existing route, middleware, schema, dependency, or frontend file changed; the rest is tests, test helpers, and documentation. No blocking defect was found. **Final verification after the final change (via `node` against the binaries):** Prettier clean repository-wide; ESLint 0; frontend and backend type checks 0 errors; `prisma validate` valid and `prisma migrate status` up to date (2 migrations); backend unit 9 files / **142 tests** (74 before M03-T04, +68); backend integration 20 files / **175 tests** (137 before, +38); frontend unit 48 files / **528 tests** (unchanged); backend and frontend builds ok; Playwright **50/50** (`CI=1`, freshly spawned production-mode server, `landmarks_test`); axe **22 states, 0 violations**; `landmarks_dev` unchanged (1,692 landmarks, 0 users).

**Acceptance-criteria reconciliation (scope items and the approved M03-T04 criteria):**
- [x] **Protect authenticated operations** — one standard protected mount (`mountProtected`) applying `requireSession` to every method and nested route, with `no-store` and safe 500s; proven behaviourally on test-only apps.
- [x] **Identity only from the validated session** — `authenticatedUserId`; client-supplied identity in query, body, headers, or path cannot override it (Increments 1 and 3).
- [x] **Unauthorized access attempts tested** — anonymous, forged, malformed, expired, and revoked sessions rejected before handlers run; CSRF, 400, 404, and 503 preserved; deny-by-default inventory with behavioural sweep and mutation checks (Increments 1–2).
- [x] **Unprotected account routes cannot be added silently** — direct routes, plain `use()` mounts, bare functions, route-level-only or mis-ordered guards, impostor functions, and short-circuiting middleware are all reported (Increment 2).
- [x] **Public behaviour preserved** — public routes and the 404 for unknown `/api` paths unchanged; Better Auth's mount classified separately with its own tests intact.
- [x] **Two-user test helpers ready for ownership tests** (Increment 3).
- [x] **Ownership conventions documented** — ADR-012, Accepted.
- [ ] **Enforce ownership on real resources — deferred by approved decision D1 to M03-T05**, where the first account-scoped resource (favorites) is implemented and its owner-scoped queries are tested with two real accounts. This is a hand-off, not an unmet criterion of this task's approved scope. *(Carried out in M03-T05, 2026-11-20 — owner-scoped favorites queries, the protected favorites mount, and two-user ownership tests; see the M03-T05 record, Complete 2026-11-20.)*

**Hand-off to M03-T05 (required there, per ADR-012):** mount the favorites router with `mountProtected` (never `apiRouter.use` or route-level guards); take identity only from `authenticatedUserId`; scope every favorites query by user ID inside the query itself; answer missing and non-owned rows with the same 404 `NOT_FOUND`; use strict request schemas that reject identity fields (400); prove spec §9.2 tests 6–8 with `createTwoUsers`/`asUser`; add favorites throttling (429) under D6; update `route-inventory.integration.test.ts`'s "0 protected endpoints" expectation in the same change that mounts favorites; extend the behavioural sweep's real-app run, which will then exercise the favorites endpoints.

**Follow-ups (open; none blocks this task):** application-wide JSON handling for unexpected errors on public routes (Express's default HTML 500, with a stack when `NODE_ENV` is not `production`) — accepted as a separate item; three code comments still describe ADR-012 as a draft (`backend/src/auth/protected-route.ts` line 7, `backend/src/http/error-envelope.ts` line 42, `backend/tests/helpers/route-inspection.ts` line 73) — a comment-only correction left for approval because two are production files; the structural inspector depends on Express 4 internals and must be revisited before any Express 5 upgrade (including via Dependabot); protected-route failure logs carry the shared sanitized logger's `[Better Auth]` label; optional consolidation of the 13 per-file sign-in helpers onto `test-users.ts`. Preserved from earlier tasks: the production deployment blockers (trusted-proxy verification, SMTP provider and sender, HTTPS, sensitive-location classification), real mail-delivery reset verification and the access-log review, dependency-audit triage and the Dependabot pull requests, expired-session cleanup, the app-wide page-title and route-change-focus accessibility items, and M02's open mobile-device criterion. Nothing committed or pushed.

### M03-T05: Implement Favorites Data Model and API

**Status:** Complete — formally accepted by the developer 2026-11-20 with all five increments accepted, including the final documentation and verification. Planning authorized 2026-11-20; the plan, decisions D1–D9, and the five-increment structure approved 2026-11-20 (D6 and D9 with refinements); Increments 1 (with checkpoints 1a, 1b, 1c), 2, 3, and 4 each authorized and accepted 2026-11-20; Increment 5 (this documentation and final verification) authorized 2026-11-20. Backend only — the favorites UI is M03-T06. Committed as one developer-approved checkpoint commit on `main`, "Implement favorites data model and API (M03-T05)" (`ebfc63a3008dcee89704673b9b60897a09ef380b`), pushed to `origin/main` 2026-11-20, and verified by GitHub Actions run #22 (success; record below).

**Dependencies:** M01-T03, M03-T01, M03-T04

**Specification:** `specs/AUTHENTICATION_FAVORITES_SPEC.md` v0.3 §§5–7 and 9 (verification disposition in its §11.1). **Decisions applied:** ADR-006, ADR-009, ADR-010, ADR-011 (decisions 7, 8, 10), ADR-012 (clarified for this task, see `docs/DECISIONS.md`).

**Scope:**
- Establish user-to-landmark favorite relationships.
- Support adding, retrieving, and removing favorites.
- Prevent unintended duplicate favorites.
- Enforce user ownership.

**Approved decisions (developer, 2026-11-20):**
- **D1–D9 (plan):** D1 only active `PUBLIC` landmarks can be favorited (others → 404); D2 DELETE answers 200 for any well-formed UUID without a landmark lookup, and PUT on a saved landmark that is no longer eligible answers 404; D3 a retired favorite lists as `{ landmark_id, availability: "unavailable" }` with no name; D4 an active non-`PUBLIC` favorite lists as the Spec 2 §9.4a redacted summary; D5 order `created_at DESC, id ASC` (matches the approved index); D6 per-user in-process throttling, 60 mutations / 120 reads per minute, documented per-process scope, bounded memory (refined); D7 new codes `INVALID_REQUEST` and `RATE_LIMITED`; D8 no favorite ID or `favorited_at` in responses; D9 migration deployed to `landmarks_test` first, then `landmarks_dev`, through explicit checkpoints (refined).
- **E1–E7 (Increment 2):** strict Zod request schemas; any-case 8-4-4-4-12 hex landmark IDs returned in lower case; `page`/`limit` digits only; coordinates selected for every row and redacted centrally (existing pattern); E5 the reclassification race is judged on the add statement's snapshot (accepted as observed: subsequent reads enforce current visibility); body absent or `{}` only; the router maps outcomes to HTTP.
- **F1–F9 (Increment 3):** the limiter runs before validation; limiter middleware attached per route (keeps exactly three inventory endpoints); a full cap answers 429 with `Retry-After` = the window and logs once each time it fills; fixed messages; only `Retry-After` as a throttling header; envelope helpers in the shared `error-envelope.ts`; malformed JSON keeps the existing app-level 400 (follow-up); route-inventory expectations changed without loosening any check; test-only apps wired like `app.ts` with the real `mountProtected`.
- **G1–G7 (Increment 4):** exploratory duplicate-session-cookie test; favorites cross-checked against the public landmark endpoint; no favorites-specific password-reset test (covered by M03-T02 plus revoked-session tests); re-import only from generated temporary fixtures against `landmarks_test`; spec test #11 belongs to M03-T03/M03-T06 and #16 to the test-database guard; local test helpers; the "No longer available" wording is M03-T06's.
- **Approved corrections during the task:** CSRF 403 responses gain `Cache-Control: private, no-store` (Increment 3, Option A — the only shared-middleware change); the M03-T02 route-guard test recognises verified protected mounts (Increment 3, Option A with refinement); the re-import lifecycle test shifts coordinates in its update step because metadata-only re-import is an open M01-T04 defect (Increment 4, Option B).

**Increment 1 (2026-11-20) — Favorite schema and migration — ACCEPTED.** `Favorite` model (`favorites`: database-generated UUID `id`, `user_id`, `landmark_id`, `created_at TIMESTAMP(3)`, no `updated_at`; unique `(user_id, landmark_id)`; index `(user_id, created_at DESC, id)`; foreign keys to `users` and `landmarks`, both `ON DELETE RESTRICT ON UPDATE CASCADE`), with client-only `favorites Favorite[]` back-relations on `User` and `Landmark`. Hand-written `prisma/migrations/20261120000000_favorites/migration.sql` (statements identical to read-only `prisma migrate diff` output, schema-to-schema and against `landmarks_test`, apart from the two known ADR-010 `location` artefacts, which were discarded) and a recovery-only `down.sql` that refuses to run while `favorites` holds rows. Checkpoint 1a (preparation and review), 1b (`landmarks_test`: guard and live identity verified, `migrate deploy`, 16 new schema tests, backend unit 142 / integration 191), and 1c (`landmarks_dev`: live identity verified, SQL SHA-256 identical to the checksum recorded on `landmarks_test`, `migrate deploy`; 1,692 landmarks, 0 users, the full-row landmark fingerprint `00eef4a2aa435548467e2bde7c6b711b`, the `location` definition, its generated expression, the GiST index, and all `landmarks` indexes and constraints identical before and after) each accepted separately.

**Increment 2 (2026-11-20) — repository and service — ACCEPTED.** `src/favorites/request-schema.ts`, `repository.ts`, `service.ts`. The add is ONE statement (a CTE checks eligibility — active and `PUBLIC` — and inserts with `ON CONFLICT (user_id, landmark_id) DO NOTHING`, returning `eligible`/`created` counts), so there is no check-then-act gap and no unique-violation error reaches the caller. Every statement applies the session user ID inside the SQL. List entries are shaped through the existing `redaction.ts` (`toDetailResult`, `toCollectionItem`). Tests: 68 unit, 31 repository integration (repeated 5 extra times, all green), including the deterministic interleavings — an add blocked (confirmed via `pg_stat_activity` and `pg_blocking_pids`) behind an uncommitted duplicate returns `existing` after COMMIT and `created` after ROLLBACK, under PostgreSQL READ COMMITTED; bounded waits; transactions and connections always closed. E5 observed: an add blocked behind a transaction that inserts the duplicate and reclassifies the landmark returns `existing`; an uncommitted reclassification alone does not block the add (`created`); later reads show the redacted entry and later adds are `not_found`. Five deliberate repository faults all detected. Backend unit 210, integration 222.

**Increment 3 (2026-11-20) — router, protected mount, throttling, route inventory — ACCEPTED.** `src/favorites/rate-limit.ts` and `router.ts`; `mountProtected(apiRouter, "/favorites", favoritesRouter)` in `src/routes/index.ts`; `invalidRequestEnvelope` and `rateLimitedEnvelope` in `src/http/error-envelope.ts`. Approved shared change: both CSRF rejection paths in `src/auth/require-trusted-origin.ts` now send `Cache-Control: private, no-store` (status, body, origin logic, and middleware order unchanged; public GET responses still send no `Cache-Control`). Route inventory: exactly three protected endpoints, verified by method and path; zero violations; behavioural sweep 6/6. The M03-T02 route-guard test's real-app assertion now accepts a state-changing route only when the M03-T04 inspector verifies a `mountProtected` group (by function identity, with no problems) or a route-level `requireSession` before the handler; eight fixture checks (including impostor guards and short-circuiting middleware) and two real-app wiring faults confirm it. Tests: 13 limiter unit, 48 favorites HTTP, CSRF 11 → 12, route inventory 14 → 15, route guard 5 → 14. Faults detected: CSRF header removed (9 failures), limiter removed from PUT (4), 201/200 swapped (9), plain `apiRouter.use` instead of `mountProtected` (44). Backend unit 223, integration 281.

**Increment 4 (2026-11-20) — security, lifecycle, full regression — ACCEPTED.** `tests/favorites-security.integration.test.ts` (21) and `tests/favorites-lifecycle.integration.test.ts` (5); test-only. Two real accounts over real HTTP: isolation on every page; shared landmarks; deletes of another user's landmark indistinguishable from never-saved; favorite-row and user IDs used as `:landmarkId`; identity in query (400), body (400), headers (ignored), and `Authorization: Bearer` (not accepted); sign-out, re-sign-in persistence, two sessions of one user, mid-sequence expiry, and deleted sessions. Duplicate session cookies (G1): exactly one identity, the first cookie in the header, consistent across the session endpoint, reads, and writes — never combined (pinned in the test). Cross-user concurrency: 20 parallel PUTs → each user {201 ×1, 200 ×9}; DELETE/PUT races correct; lists during concurrent mutations contained only the requester's favorites (no intermediate snapshot asserted). Reclassification to `SENSITIVE`/`UNREVIEWED`, retirement, reactivation, and re-import through the real `runPreflight` → `applyImport` pipeline (live `landmarks_test` identity and temporary-fixture location asserted before every import): favorites rows (IDs and `created_at`) and landmark UUIDs preserved, `sensitivity_status` preserved, entries never show more than the public landmark endpoint. Two ownership faults detected (8 failures each).

**Increment 5 (2026-11-20) — documentation and final verification — ACCEPTED.** This record; §11 below; ADR-012 clarification notes in `docs/DECISIONS.md`; the verification disposition (§11.1) in `specs/AUTHENTICATION_FAVORITES_SPEC.md` and its status phrase in `specs/README.md` (H1, explicitly approved; requirement text in §§1–10 unchanged); a "Favorites API" section in `README.md`.

**Final API contract (as implemented and tested):**

| Method and path | Success | Body |
|---|---|---|
| `GET /api/v1/favorites?page&limit` | 200 | `{ "favorites": Entry[], "page": n, "limit": n, "has_more": bool }` |
| `PUT /api/v1/favorites/:landmarkId` | 201 newly saved; 200 already saved | `{ "success": true, "landmark_id": "<uuid>" }` |
| `DELETE /api/v1/favorites/:landmarkId` | 200 always (idempotent) | `{ "success": true, "landmark_id": "<uuid>" }` |

- `:landmarkId` is the internal landmark UUID (never `source_code`): any 8-4-4-4-12 hexadecimal string, any case; `landmark_id` is returned in lower case.
- **Middleware order:** `requireTrustedOrigin` (on all of `/api/v1`) → `noStore` → `requireSession` → favorites router (per-route limiter → handler) → `protectedRouteErrorHandler`.
- **Identity and ownership:** the user is taken only from the validated session (`authenticatedUserId`) and applied inside every SQL statement. PUT/DELETE accept no query parameters and only an absent or empty-object body; GET accepts only `page` and `limit`.
- **Errors** (`{ "error": { "code", "message" } }`; every response produced under the protected mount, and every CSRF 403, carries `Cache-Control: private, no-store` — the one exception is a malformed JSON body, rejected by the app-level parser before both, which receives Express's default HTML 400 with no `Cache-Control`; see follow-ups): 400 `INVALID_REQUEST` (`Invalid landmark ID.` / `This request accepts no body fields.`); 400 `INVALID_QUERY` (`This request accepts no query parameters.` / `page and limit must be positive integers; no other query parameters are accepted.` / `limit must be from 1 through 100.` / `page is too large.`); 401 `UNAUTHENTICATED` (missing, forged, malformed, expired, revoked — one identical body); 403 `INVALID_ORIGIN` (cookie-bearing PUT/DELETE without a trusted Origin, or trusted Referer when Origin is absent); 404 `NOT_FOUND` (PUT on an unknown, retired, `UNREVIEWED`, or `SENSITIVE` landmark — byte-identical to every other API 404); 429 `RATE_LIMITED` with `Retry-After` (seconds); 503 `SERVICE_UNAVAILABLE` (session validation infrastructure failure); 500 `INTERNAL_ERROR` (fixed message; one sanitized log line).
- **Pagination:** `page` default 1, `limit` default 50, maximum 100; each a single string of decimal digits with no leading zero; the offset must be a safe integer. Order `created_at DESC, id ASC`. `has_more` from a one-row lookahead; a page past the end is 200 with an empty array.
- **Throttling:** per authenticated user, per bucket (reads; mutations), fixed 60 s windows; 120 reads and 60 mutations per window; every request counts, including invalid ones; blocked requests do not count or extend the window; per process (see follow-ups); at most 10,000 live counters — a new key with every counter live is refused with 429 rather than evicting.
- **List entries** (no entry ever contains source metadata, favorite IDs, user IDs, or timestamps):
  - `available` — active and `PUBLIC`: `{ "landmark_id", "availability": "available", "landmark": { "id", "display_name", "category", "latitude", "longitude" } }`. The landmark object is the public collection item (`toCollectionItem`): `category` is the lower-case slug; `latitude`/`longitude` are present because the landmark is `PUBLIC`; `distance_miles` is never present (no distance is computed for favorites).
  - `redacted` — active and `UNREVIEWED` or `SENSITIVE`: `{ "landmark_id", "availability": "redacted", "landmark": { "id", "display_name", "category", "redacted": true } }` — exactly the Spec 2 §9.4a minimal profile; no coordinates.
  - `unavailable` — retired: `{ "landmark_id", "availability": "unavailable" }` only; still removable with DELETE.

**Acceptance Criteria (reconciled):**
- [x] User-to-landmark favorite relationships established — `favorites` table with RESTRICT foreign keys and the internal landmark UUID (Increment 1).
- [x] Adding, retrieving, and removing favorites — the three endpoints above (Increments 2–3).
- [x] Unintended duplicates prevented — composite unique constraint plus the single-statement add; one row under parallel and forced-interleaving duplicate adds (Increments 1–4).
- [x] User ownership enforced — owner-scoped SQL, protected mount, two-user and spoofing tests, ownership fault checks (Increments 2–4). This also completes M03-T04's hand-off.

**Final verification (Increment 5, after the documentation edits; commands via `node` against the binaries because npm script wrappers are blocked by group policy on this machine):** Prettier (repository-wide), ESLint (backend and frontend), and `tsc` (backend and frontend) clean; backend unit 11 files / 223, backend integration 25 files / 307; `prisma validate` valid; `migrate status` up to date (3 migrations) on `landmarks_test` and `landmarks_dev`. The documented contract and the §11.1 disposition were checked against the code and named tests; two documentation corrections resulted (the malformed-JSON exception to `no-store`, and five — not six — axe needs-review states). Cited without re-running, because no executable code changed after Increment 4: frontend unit 48 files / 528, Playwright 50/50 (`CI=1`, production-mode server on `landmarks_test`), axe 22 states with 0 violations, backend and frontend builds.

**CI verification (2026-11-20, developer-accepted):** commit `ebfc63a3008dcee89704673b9b60897a09ef380b` was pushed to `origin/main` as a fast-forward from `3446a91` (non-force). GitHub Actions run #22 (https://github.com/tpalme14/hidden_tennessee/actions/runs/44835665735), triggered by the push, concluded **success**: both the quality and the regression jobs passed, every step green. In both jobs `prisma migrate deploy` succeeded against a freshly created PostgreSQL/PostGIS database, applying all three migrations including `20261120000000_favorites` (the quality job's integration step, which includes `favorites-schema.integration.test.ts`, then passed against that schema). The quality job's format check, lint, Prisma client generation, type check, build, unit tests (backend and frontend), integration tests, and Playwright smoke tests passed; the regression job's build and full Playwright suite passed. Exact CI test counts could not be retrieved, because GitHub job logs require authenticated access (HTTP 403 without it) and the GitHub CLI is not installed locally; the previously verified local counts for this code remain backend unit 223, backend integration 307, frontend unit 528, and Playwright 50/50. **Dependency audit (not passing; existing):** the quality job's `npm audit --audit-level=high` step is informational and configured `continue-on-error: true`; it exited with code 1, producing a "Process completed with exit code 1" failure annotation without failing the job or the workflow. Run #21 (on `3446a91`) carried the identical annotation, and `ebfc63a` changes no dependency files; a local audit of the same lockfile reports 13 findings (1 low, 9 moderate, 3 high, 0 critical), the high ones in `prisma` and its transitive `@prisma/config` and `effect`. These findings are not resolved; the existing dependency-audit and Dependabot triage follow-up remains open.

**Files changed (committed together in the checkpoint commit):** new — `backend/prisma/migrations/20261120000000_favorites/` (`migration.sql`, `down.sql`), `backend/src/favorites/` (`request-schema.ts`, `repository.ts`, `service.ts`, `rate-limit.ts`, `router.ts`), and tests `favorites.test.ts`, `favorites-rate-limit.test.ts`, `favorites-schema.integration.test.ts`, `favorites-repository.integration.test.ts`, `favorites.integration.test.ts`, `favorites-security.integration.test.ts`, `favorites-lifecycle.integration.test.ts`; modified — `backend/prisma/schema.prisma`, `backend/src/routes/index.ts`, `backend/src/http/error-envelope.ts` (additions only), `backend/src/auth/require-trusted-origin.ts` (approved no-store change), and tests `csrf.integration.test.ts`, `route-inventory.integration.test.ts`, `api-route-guard.integration.test.ts`; documentation — this file, `docs/DECISIONS.md`, `specs/AUTHENTICATION_FAVORITES_SPEC.md`, `specs/README.md`, `README.md`. No dependency change.

**Deviations:** none beyond the approved corrections listed above.

**Follow-ups (open; none blocks this task's backend scope):**
- **M01-T04 — GPX metadata-only re-import defect (OPEN; a defect, not correct behaviour).** Preflight (`computePreflightDiff` / `candidateChanged` in `backend/src/import/preflight.ts`) classifies an existing active landmark as `unchanged` when only its metadata changes and its coordinates and `source_file` stay the same; `applyImport` writes only updates and reactivations, so changes to the display name, description, and potentially other metadata fields (access label, URL, category within the same file) are not persisted. This contradicts `specs/LANDMARK_DATA_IMPORT_SPEC.md` §5.1 ("update the existing landmark in place") and the code's own comment. Impact: a later GPX correction to such fields would be reported as unchanged and silently not applied; landmark UUIDs and favorites are unaffected; `landmarks_dev` has been imported once, so nothing has drifted yet. Found in M03-T05 Increment 4 and confirmed by a guarded probe on `landmarks_test`. The correction must be planned and approved separately, with regression tests for metadata-only updates; the favorites lifecycle test exercises the update path by shifting coordinates and does not cover this case.
- **Sensitive-location classification policy — release blocker (unchanged).** No landmark is `PUBLIC` in `landmarks_dev`, so no real landmark can be favorited (D1) until classification is decided; all favorites tests use synthetic statuses. Approval of the redaction mechanics is not approval of a classification policy.
- **axe needs-review items (existing; not violations).** In the Increment 4 run (22 states, 0 violations), axe reported `incomplete` (needs-review) results only on Leaflet's own zoom controls — `color-contrast` (symbol-only glyph) and `label-content-name-mismatch` — in five map-bearing states: `profile-full`, `discovery-error`, `discovery-initial`, `name-search-populated`, `discovery-popup-open`. A sixth state logged in the same detailed form, `profile-redacted`, had no `incomplete` results. These items were assessed in M02-T08 (needs-review checks 2 and 3 in its record); they remain for the M07-T03 accessibility review.
- **Per-process favorites throttling.** Counters are not shared across application instances and reset on restart or redeploy; exact on the single Render instance (ADR-006/ADR-008). Shared storage would need its own decision.
- **Malformed JSON response (existing, app-wide).** A malformed JSON body is rejected by the app-level parser before any sub-router, so it receives Express's default 400 (HTML, with a stack when `NODE_ENV` is not `production`; and without `Cache-Control`) rather than the JSON envelope — the M03-T04 follow-up, unchanged (F7). Confirmed on 2026-11-20 against the real app on a favorites route: `400`, `text/html`, stack frame present with `NODE_ENV` unset, no `Cache-Control`.
- **Express 4 route-inspector dependency (existing).** The deny-by-default inventory and now the route-guard test rely on Express 4 internals isolated in `backend/tests/helpers/route-inspection.ts`; revisit before any Express 5 upgrade (including via Dependabot).
- **Duplicate session cookies (observed, pinned).** With two `better-auth.session_token` cookies, Better Auth 1.7.18 resolves exactly one identity — the first cookie in the header — consistently; never combined. Pinned in `favorites-security.integration.test.ts`; review it after any library upgrade rather than re-pinning blindly.
- **M03-T06 UI responsibilities:** show the favorite action on public cards and profiles and offer sign-in when signed out; hide or disable it for redacted (non-`PUBLIC`) landmarks, which the API refuses (D1); show saved state from the server with accessible pending feedback and `aria-pressed`; the My Favorites view with empty state; render `unavailable` entries as non-navigable "No longer available" items with a removal action and no location details (spec §§6.2, 8; G7); `redacted` entries without coordinates; handle 401 (session expiry, preserving discovery context), 404, and 429 (`Retry-After`); spec §9.2 tests #11 and #15's UI half.
- **Resolved:** the M03-T04 follow-up "three code comments still describe ADR-012 as a draft" — confirmed 2026-11-20 that `backend/src/auth/protected-route.ts` line 7, `backend/src/http/error-envelope.ts` line 42, and `backend/tests/helpers/route-inspection.ts` line 73 all read "Accepted", unchanged since commit `3446a91`.

### M03-T06: Implement Favorites Interface

**Status:** Complete — all increments (1–5, 6A–6E) accepted by the developer 2026-11-20; committed as `c34d161` ("Implement favorites interface (M03-T06)"), pushed to `origin/main`, and verified by GitHub Actions run #24 (success; CI verification record below). The test counts below are local results. Frontend and end-to-end tests only — no backend, schema, migration, or dependency change.

**Dependencies:** M02-T04, M03-T03, M03-T05

**Specification:** `specs/AUTHENTICATION_FAVORITES_SPEC.md` v0.3 §8 (with §§6.2 and 9.2 #11, #15; verification disposition in §11.1). **Decisions applied:** ADR-006, ADR-009, ADR-012; the M03-T05 backend contract (D1–D8, E5, the CSRF `no-store` correction, G1).

**Scope:**
- Allow authenticated users to manage favorites.
- Display saved landmarks.
- Handle authentication and request failures.

**Approved decisions (developer, 2026-11-20):**
- **K1–K12 (plan):** K1 per-landmark membership with saved / known-unsaved / unknown states, never assuming a capped load is complete; K2 favorite controls on profiles and the geographic results list, not in map popups; K3 signed out → a "Sign in to save" link; K4 no automatic save after sign-in; K5 no optimistic updates — state changes only after the server confirms; K6 a `/favorites` route with a primary-navigation link only for a verified signed-in user; K7 50 entries per page with `?page=`; K8 no removal confirmation dialog; K9 redacted entries link to the redacted profile; K10 a real E2E journey (its fixture design approved separately, below); K11 a stable "Favorite <name>" toggle with `aria-pressed`; K12 a 401 may trigger `auth.refresh()`, and only the verified session state signs anyone out, preserving the route and filters.
- **L1–L4:** membership loaded at most 5 pages × 100; `unknown` offers save only; no reload on window focus; a busy, inactive control while checking.
- **A3:** no favorite buttons in `LandmarkSearch` (keeps the M02-T05/T06 "identical rows" criterion). **B2:** one shared announcer outside `GeographicResultsList` (keeps M02-T08's "no status/alert regions in that list"). **E1:** two M02 E2E locators changed to `exact: true`.
- **M1–M6 (My Favorites page):** M1 unavailable entries' Remove buttons are named "Remove unavailable favorite, item N on this page" (N = 1-based position); M2 visiting the page does not refresh the provider's membership; M3 available entries show name and category only — never coordinates; M4 an invalid `?page=` is replaced by page 1 (history replace), and a valid page past the end shows a message with a link to page 1; M5 after a confirmed removal the current page is re-fetched (only when later pages exist), so offset pagination does not skip entries; M6 while the session is `unavailable` a distinct message is shown and nothing is fetched or assumed.
- **6A test-fixture design:** Q1 parameterized SQL through `pg`; Q2 test-created users are kept (Better Auth's `deleteUser` is disabled by M03-T02 configuration and the only supported test cleanup is the integration suite's full reset); Q3 fixtures isolated from existing discovery specs; Q4 no automatic cleanup of earlier runs' fixtures; Q5 real E2E paging beyond 50 entries out of scope; Q6 existing CI jobs; Q7 `context.clearCookies()` for the expired-session journey. **R1–R4 (6B):** R1 fixtures in an isolated region outside Tennessee (about 0.5°N 160.5°W); R2 manual cleanup of abandoned fixtures deferred; R3 one run tag per Playwright run, shared by all workers; R4 guarded SQL teardown of the fixtures' favorites and landmarks.

**Increment 1 — API layer — ACCEPTED.** `frontend/src/api/client.ts` gained `putJson`/`deleteJson` (returning `{ status, body }`; `getJson`/`postJson` unchanged); `frontend/src/api/favorites.ts` adds `listFavorites`/`addFavorite`/`removeFavorite` with strict response checks: entries are rebuilt from their allowed fields only, redacted entries never carry coordinates, unavailable entries carry the ID only, an unknown `availability` is treated as unavailable, and a malformed response becomes `INVALID_RESPONSE`.

**Increment 2 — saved-state provider — ACCEPTED.** `frontend/src/favorites/favoritesContext.ts` and `FavoritesProvider.tsx` (mounted in `main.tsx` inside `AuthProvider`): per-landmark status checking / saved / unsaved / unknown / signed-out; confirmed changes carry operation numbers so a stale list never overwrites them, and only the latest load writes; all state belongs to the verified user and a previous user's data is discarded; a 401 calls `auth.refresh()` only; 429 keeps `Retry-After`; no automatic retries; memory only.

**Increment 3 — favorite button on profiles — ACCEPTED.** `frontend/src/favorites/FavoriteButton.tsx` (+ CSS): one native button (busy and inactive while checking; a toggle with `aria-pressed` and the stable name "Favorite <name>"; save-only "Save <name> to favorites" with an explanatory note when unknown); signed out, the link "Sign in to save <name>" with `returnTo` = path + query. Shown on full (PUBLIC) profiles only — never on minimal, unavailable, loading, or error profiles.

**Increment 4 — geographic results list and shared announcer — ACCEPTED.** List-variant buttons in `GeographicResultsList` (no live regions of their own) announce through `frontend/src/favorites/FavoritesAnnouncer.tsx` — one polite live region and one `role="alert"` present only while there is an error, wrapping only that list inside `DiscoveryPage` (B2). Verification at acceptance: frontend unit 54 files / 676; Playwright 50/50; axe 22 states, 0 violations.

**Increment 5 — My Favorites page — ACCEPTED.** `frontend/src/favorites/useFavoritesList.ts` (only the latest request for the current verified user and page may write; confirmed removals are numbered so a response to a request that started earlier can never restore one; at most one background re-fetch in flight, with one queued; a failed re-fetch keeps the list and removals, drops the queue, and offers retry; 401 → `auth.refresh()` only; 429 keeps the wait), `frontend/src/favorites/favoritesPageParam.ts` (M4), `frontend/src/routes/FavoritesPage.tsx` (+ CSS) with one status region and at most one alert, the `/favorites` route in `App.tsx`, and the signed-in-only "My Favorites" link in `AppLayout.tsx`. Removal goes through the provider; an entry leaves only after the server confirms; focus then moves to the next Remove button, else the previous one, else the heading — only when focus was on the removed control; a page above 1 emptied by removal moves to the preceding page (history replace). `FavoriteButton.tsx`'s `failureText` was exported for reuse (one-word change). `AccountNav.test.tsx`'s keyboard test now includes the new signed-in tab stop (Discover → My Favorites → Sign out); no assertion was loosened. Three deliberate faults (focus restoration, stale-response filtering, re-fetch coalescing) were each detected by the new tests and reverted. Verification at acceptance: frontend unit 58 files / 754; Playwright 50/50; axe 22 states, 0 violations.

**Increment 6A — test-fixture design — ACCEPTED** (decisions Q1–Q7 above; revised by the developer before 6B).

**Increment 6B — fixture helper and database guards — ACCEPTED.** `e2e/helpers/favoritesFixtures.ts`, `e2e/fixture-guard.spec.ts` (22 tests), and one line in `playwright.config.ts` (`process.env.E2E_FIXTURE_RUN ||= …`, the shared run tag). Every database statement runs inside one private guarded transaction: the existing `getVerifiedTestDatabaseUrl()` check before any connection; then, on the same connection that writes, `current_database()` must be `landmarks_test` and the `landmarks` and `favorites` tables must exist, otherwise ROLLBACK. Setup inserts three PUBLIC fixtures in one transaction (all or nothing; `ZZ`-namespace source codes retried on conflict); every update and teardown first locks and verifies each recorded row (exact ID, exact source code in the `ZZ` namespace, exact name carrying this run's and test's tags) and refuses the whole operation on any mismatch; favorites rows are deleted only for verified IDs, and never inserted. The Playwright fixture checks that the running server sees the fixture (`GET /api/v1/landmarks/:id`) before any test body, and tears down in `finally`. Fixtures from other runs are only reported (read-only), never deleted. A deliberate fault (live-identity check disabled) was detected. Verification: guard spec 22/22 in three separate runs; Playwright 72/72; axe 22 states, 0 violations; no fixture rows left.

**Increment 6C — real favorites journeys and accessibility — ACCEPTED.** `e2e/favorites.spec.ts` (8 journeys against the production-mode server and `landmarks_test`, each with its own user): signed-out prompts, safe `returnTo`, and no automatic save after sign-in; saving from a PUBLIC profile, persistence after reload, and API confirmation; saved-state sync across the profile, My Favorites, and the geographic list (`?bbox=` around the fixture region); available, redacted, and unavailable entries (saved through the API while PUBLIC, then changed with the guarded operations) with no coordinates anywhere and no name, category, or link on the unavailable entry; keyboard-only removal with focus next → previous → heading, the empty state, and Discover; a failed DELETE that never removes the entry; an expired session (`context.clearCookies()`) leading to the sign-in prompt with the favorite intact; a failing list request with Try again. Five new axe states: `profile-favorite-saved`, `favorites-populated`, `favorites-empty`, `favorites-error`, `favorites-signed-out`. Verification: 8/8; `--repeat-each=3` 24/24 (one run tag across 24 workers); Playwright 80/80; axe 27 states, 0 violations; no fixture rows left; no intermittent failures.

**Increment 6D — manual browser verification and full regression — ACCEPTED.** Manual checks in the in-app Chromium pane against a production-mode server on `landmarks_test`, with 51 guarded fixtures (17 sets) and 51 favorites saved through the real API (one set then made redacted and one retired): the listing (50 per page, one status region, no coordinate text, correct redacted and unavailable entries); the pager (Next → `?page=2` with focus on the heading; Previous → `/favorites`; removing page 2's only entry returned to page 1 with focus on the heading); keyboard removal with focus on the next Remove button and the next-page entry moving up (M5); the profile toggle by keyboard (Space saves; focus stays; "Saved to favorites." announced); sign-out on `/favorites` replacing the list with the sign-in prompt and removing the nav link; a second user's empty state and Discover by keyboard; a 3 px solid focus outline (`:focus-visible`) at every stop checked; no horizontal overflow on My Favorites or the profile at 1280, 768, 375, and 320 px; and no fixture in the default Tennessee discovery view. Teardown deleted 51 landmarks and 50 favorites after ownership verification; no fixture rows remained.

**Final verification (Increment 6D, local, run sequentially — backend integration never alongside Playwright or the browser):** frontend unit 58 files / **754**; backend unit 11 files / **223**; backend integration 25 files / **307** (`landmarks_test`); TypeScript clean (frontend `tsc -b --noEmit`, backend `tsc --noEmit`, and the e2e files through a temporary configuration outside the repository); ESLint (backend, frontend, e2e, Playwright config) and Prettier (repository-wide) clean; backend build and frontend `tsc -b && vite build` passed; Playwright **80/80** (`CI=1`, freshly started production-mode server, `landmarks_test`; the one `x` line is the guard spec's deliberate expected failure); axe **27 states, 0 violations**; read-only fixture-leftover check before and after: **0** fixture rows, 0 fixture favorites; no intermittent failures. Backend code is unchanged since M03-T05.

**Acceptance criteria (spec §8, reconciled):**
- [x] Public landmark cards and profiles show a recognizable favorite action; signed out, it offers sign-in — full profiles and the geographic results list (K2, K3; A3 keeps name-search rows unchanged); verified in unit tests and `e2e/favorites.spec.ts`.
- [x] Signed-in users see the current saved/unsaved state and can toggle it — K1, K11, L1–L4; profile and geographic list.
- [x] A dedicated My Favorites view lists saved landmarks and supports removal and navigation to public profiles — `/favorites` (K6, K7, M1–M5).
- [x] An empty collection shows an informative empty state and a way back to discovery.
- [x] Retired favorites are non-navigable "No longer available" entries with removal and no location details (also §6.2; §9.2 #15).
- [x] Pending feedback and no confusing duplicate submissions — busy, inactive controls; requests per landmark are never duplicated.
- [x] On authentication expiry, sign-in is explained and the discovery context preserved — K12; the expired-session journey.
- [x] Nothing implies a save before the server confirms (K5); a failed DELETE never removes an entry.
- [x] Accessible names and state (`aria-pressed`), visible keyboard focus, and screen-reader feedback through status/alert regions — unit tests, axe (27 states, 0 violations), and the 6D keyboard pass. *Screen-reader output itself was not verified (below).*
- [x] Forms keep explicit labels and validation (unchanged from M03-T03); no keyboard traps found.
- [x] Favoriting does not disturb the URL-based discovery state (K12; the list variant changes no query state).

**Files changed (committed together in `c34d161`, 46 files):** new — `frontend/src/api/favorites.ts`, `favorites.test.ts`, `putDeleteJson.test.ts`; `frontend/src/favorites/` (`favoritesContext.ts`, `FavoritesProvider.tsx` + test, `FavoriteButton.tsx` + `.module.css` + test, `FavoritesAnnouncer.tsx` + `.module.css` + test, `testFavorites.tsx`, `useFavoritesList.ts` + test, `favoritesPageParam.ts` + test); `frontend/src/routes/FavoritesPage.tsx` + `.module.css` + test, `GeographicResultsList.favorites.test.tsx`; `frontend/src/layout/AppLayout.test.tsx`; `e2e/helpers/favoritesFixtures.ts`, `e2e/fixture-guard.spec.ts`, `e2e/favorites.spec.ts`. Modified — `frontend/src/api/client.ts`, `main.tsx`, `App.tsx`, `App.test.tsx`, `layout/AppLayout.tsx`, `layout/AccountNav.test.tsx`, `routes/DiscoveryPage.tsx` and its three test files (wrappers and +1 test), `routes/GeographicResultsList.tsx` and its test (wrapper only), `routes/LandmarkProfilePage.tsx` and its test; `e2e/accessibility.spec.ts`, `e2e/keyboard-workflow.spec.ts` (E1); `playwright.config.ts`; documentation — this file, `specs/AUTHENTICATION_FAVORITES_SPEC.md` (§11.1 only), `specs/README.md`, `README.md`. `frontend/src/routes/LandmarkSearch.tsx` appears modified only because of a line-ending/timestamp artifact (identical blob to HEAD); it was excluded from the commit and is not part of this task. No dependency, backend, schema, or migration change.

**Git checkpoint and CI verification (2026-11-20, developer-accepted):** exactly the 46 approved files were staged by explicit path (`LandmarkSearch.tsx` excluded; `git diff --cached --check` and Prettier clean; no credentials, scratchpad files, or other artifacts staged) and committed as `c34d161618d297a7201bbd08b191a7ce5ac5fda57e` ("Implement favorites interface (M03-T06)", parent `a45cdef`; no Git hooks are configured, none ran, and `--no-verify` was not used). A first commit attempt failed before any commit was created, because PowerShell passed the message as command-line arguments rather than standard input; it was retried, with developer approval, from a message file with identical staging and message. The commit was pushed to `origin/main` as a fast-forward from `a45cdef` (non-force); local `main` and `origin/main` were then in sync. GitHub Actions run #24 (https://github.com/tpalme14/hidden_tennessee/actions/runs/44849060482), triggered by the push, concluded **success**: the **quality** job (format check, lint, Prisma client generation, type check, migrations on a fresh `landmarks_test`, build, unit tests, integration tests, Playwright browser install, the Playwright suite, and the informational dependency audit) and the **regression** job (install, Prisma generate, `prisma migrate deploy`, build, Playwright install, and the full `npm run test:e2e`) each completed with every step reported successful. **Informational annotations (not job failures):** both jobs carry the warning that Node.js 20 is deprecated and that `actions/checkout@v4` and `actions/setup-node@v4` are being run on Node.js 24 (the existing Dependabot v7 follow-up); the quality job also carries "Process completed with exit code 1." The job logs require authenticated access (HTTP 403 without it), so the step that produced that annotation could not be identified directly; the only step in that job configured `continue-on-error` is the informational `npm audit`, as in runs #21 and #22, so it is most likely the existing dependency-audit finding — unconfirmed without the logs. Exact CI test counts could not be retrieved for the same reason; the local counts above stand.

**Deviations:** none beyond the approved decisions and corrections recorded above.

**Follow-ups (open; none blocks this task):**
- **Leaflet attribution contrast (for M07-T03).** axe reports a `color-contrast` needs-review item (not a violation) on the attribution link in `profile-favorite-saved`. Measured directly: the project CSS gives the attribution an opaque white background, the links (`#0078A8`, 12 px) are **4.94:1** and the text (`#333`) **12.63:1** — both meet AA 4.5:1 regardless of the tiles beneath. axe's own reason is `error-occurred` (`blendFunctions[blendMode] is not a function`): Leaflet 1.9 tiles use `mix-blend-mode: plus-lighter`, which axe-core cannot blend, so it skips the check whenever a tile is in the link's stacking path. An inconclusive automated result, not a confirmed failure; 4.94:1 is close to the threshold, so reassess in M07-T03 or after any Leaflet or attribution-style change.
- **Removal announcement on page fallback (for M07-T03).** Removing the last entry on a page above 1 moves to the preceding page; the "Removed …" message is cleared during that navigation (by design in Increment 5), so the confirmation is conveyed only by focus moving to the heading.
- **Real E2E paging beyond 50 entries** was intentionally excluded (Q5); paging is covered by unit tests and was checked manually with 51 favorites in 6D.
- **`e2e/` has no permanent TypeScript configuration** in the repository; the e2e files were type-checked with a temporary configuration outside it.
- **Test-created Better Auth users are kept** (`e2e-fav-…@example.com`): user deletion is disabled by configuration; the integration suite's reset removes them locally, and CI databases are fresh.
- **Interrupted runs may leave fixtures** (a killed process skips teardown). Abandoned fixtures are reported, read-only, at the start of each worker and are never deleted automatically; manual cleanup is deferred (R2).
- **Verification coverage:** Chromium only, automated and manual-in-pane; no physical-keyboard or screen-reader (NVDA, JAWS, VoiceOver) confirmation; 375 px used mobile emulation, not a touch device. The automation-focus caveat recorded in M02-T08 applies.
- **Unchanged and still open:** the sensitive-location classification policy (release-blocking — no real landmark is `PUBLIC`, so no favorite button appears on real data), the M01-T04 metadata-only re-import defect, Leaflet zoom-control needs-review items, per-process favorites throttling, the malformed-JSON HTML 400, the Express 4 route-inspector dependency, dependency-audit and Dependabot triage (including the informational `npm audit` finding and the Node.js 20 Actions deprecation addressed by the pending Dependabot v7 pull requests), and the app-wide page-title and route-change-focus items.

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

**Current Milestone:** M01 — Landmark Data Foundation is **Complete**. M02 — Landmark Discovery: all eight tasks (M02-T01 through M02-T08) are **Complete**; the milestone's own completion criteria (below M02-T08) have **not yet been formally reviewed and ticked** — in particular "Primary discovery workflows are usable on mobile devices" has only mobile-*width* layout evidence (M02-T01/M02-T02), not touch-device verification, and "Geographic discovery satisfies its specification" and the real-`PUBLIC`-data items depend on the unresolved classification policy. Milestone closure is a developer decision to be taken explicitly. M03 — User Accounts and Favorites is in progress: M03-T01 (design), M03-T02 (authentication backend), M03-T03 (authentication interface, Complete 2026-11-18 with all six increments accepted), and M03-T04 (authorization infrastructure, Complete 2026-11-20) Complete; M03-T05 (favorites data model and API, Complete 2026-11-20 with all five increments accepted) Complete; M03-T06 (favorites interface) Complete 2026-11-20 (Increments 1–5 and 6A–6E accepted; committed as `c34d161`, pushed, and verified by GitHub Actions run #24). All six M03 tasks are therefore Complete; the milestone's own completion criteria (below M03-T06) have **not** been formally reviewed and ticked — milestone closure is a developer decision.

**Current Task:** none in progress — **M03-T06 (Implement Favorites Interface) was accepted as Complete 2026-11-20** (Increments 1–5 and 6A–6E accepted): favorites API client, saved-state provider, favorite controls on profiles and the geographic results list, the My Favorites page, guarded synthetic E2E fixtures, and real favorites journeys — frontend unit 754, backend unit 223, backend integration 307, Playwright 80/80, axe 27 states at 0 violations, manual browser checks at four widths, no fixture rows left (local results). Committed as `c34d161` (46 files, staged by name; `LandmarkSearch.tsx` excluded) and pushed to `origin/main` 2026-11-20; GitHub Actions run #24 (https://github.com/tpalme14/hidden_tennessee/actions/runs/44849060482) concluded success, with the quality and regression jobs both green; exact CI test counts were not retrievable without authenticated log access; the annotations were informational — the Node.js 20 deprecation warning and an "exit code 1" in the quality job, most likely the `continue-on-error` dependency audit as in runs #21 and #22 (unconfirmed without the logs). Record, decisions, CI record, and follow-ups under M03-T06. **M03-T05 (Implement Favorites Data Model and API) was formally accepted as Complete 2026-11-20.** Increments 1–5 accepted 2026-11-20 (schema and migration on `landmarks_test` and `landmarks_dev` with `landmarks_dev` verified unchanged; repository and service; router, protected mount, throttling, and route inventory; security, lifecycle, and full regression — backend unit 223, backend integration 307, frontend unit 528, Playwright 50/50, axe 22 states at 0 violations); Increment 5 (documentation and final verification) accepted. Committed as `ebfc63a` on `main` and pushed to `origin/main` 2026-11-20; GitHub Actions run #22 (https://github.com/tpalme14/hidden_tennessee/actions/runs/44835665735) concluded success, with both the quality and regression jobs green and `prisma migrate deploy` applying the favorites migration to fresh databases in both; exact CI test counts were not retrievable without authenticated log access (local counts above stand); the informational `npm audit` step again exited 1 under `continue-on-error`, as in run #21 — the dependency-audit follow-up remains open (CI record under M03-T05). Record, final API contract, and follow-ups (including the open M01-T04 metadata-only re-import defect) under M03-T05. **M03-T04 (Implement Authorization) was closed Complete 2026-11-20** (four increments: protected mount, identity accessor, and no-store; deny-by-default structural enforcement; two-user test helpers and ADR-012; final verification and documentation — backend unit 142, backend integration 175, frontend unit 528, Playwright 50/50, axe 22 states at 0 violations; since committed as `3446a91`, which `origin/main` points to). It delivered authorization infrastructure only; ownership enforcement on real account data, and its two-user tests, were carried out with favorites in M03-T05 (hand-off in the M03-T04 record). **M03-T03 (Implement Authentication Interface) was accepted as Complete 2026-11-18** with all six increments accepted. M03-T03 increment trail: the developer approved its six-increment plan, seven decisions, and three refinements on 2026-11-18; **Increment 1 (auth API client and validation) was accepted 2026-11-18** (`zod` added to the frontend as the only dependency change; 68 new unit tests; frontend unit 39 files / 370, backend unit 74, Playwright 22/22; changes uncommitted in the working tree); **Increment 2 (session provider and shell integration) was accepted 2026-11-18** (four-state `AuthProvider`/`useAuth` mounted in `main.tsx`; header account navigation with server-confirmed sign-out, an accessible failure alert, and focus management; two approved layout corrections; 30 new unit tests and 1 new Playwright test; frontend unit 41 files / 400, backend unit 74, Playwright 23/23; responsive visual verification at 1280/768/375/320 px with zero remaining layout shift; changes uncommitted in the working tree); **Increment 3 (registration page) was accepted 2026-11-18** (accessible `/register` form with neutral duplicate handling and no automatic sign-in; conditionally accepted until Increment 4 verified the registration → sign-in journey, then fully accepted; 432 frontend unit / 27 Playwright at implementation); **Increment 4 (sign-in page) was accepted 2026-11-18** (`/sign-in` within the shell with generic credential errors, 429 handling, the registration notice, and safe `returnTo`; session refresh, persistence, sign-out, revocation, and recovery journeys against the real server; the developer-approved amendment of decision 5 and refinement 1 from `no-referrer` to `strict-origin` because of the OpenStreetMap tile usage policy, verified in real Chromium; frontend unit 44 files / 472, backend unit 74, Playwright 40/40, axe 14 states at 0 violations; changes uncommitted in the working tree); **Increment 5 (password-reset pages) was accepted 2026-11-18** (forgot-password and reset-password pages with a sign-in link; synchronous token capture and URL stripping before React initialization, memory-only retention, POST-body-only submission, `strict-origin` preserved; neutral confirmation and the approved unavailable-delivery message; real-browser leak checks and captured server logs free of the token; frontend unit 47 files / 522, backend unit 74, Playwright 49/49, axe 22 states at 0 violations; a successful reset verified only against a simulated completion endpoint; changes uncommitted in the working tree); **Increment 6 (closure) was accepted 2026-11-18, closing the task** (requirements review with no gap found; the shared `AuthForm.module.css`; corrected registration test comments; README frontend and access-log notes; the approved `ResetTokenGuard`, which clears the reset token on leaving `/reset-password`, including for unmatched routes, so browser Back cannot restore it; a 24-capture responsive review and keyboard focus pass; after the final change frontend unit 48 files / 528, Playwright 50/50, axe 22 states at 0 violations, type checks, ESLint, Prettier, and the frontend build clean; backend unit 74, integration 137, Prisma checks, and the backend build passed earlier in the increment and were not re-run after the frontend-only final change; changes uncommitted in the working tree). Full plan and records under M03-T03. **Preserved from M03-T03 (open):** deployment — real mail-delivery reset verification and an infrastructure access-log review for reset-link query strings; accessibility, app-wide — route-specific page titles and route-change focus management; the production tile provider must accept an origin-only Referer. **Committed and pushed (developer-approved checkpoints):** `27ee99f` "M03-T03 complete: implement frontend authentication experience" (44 files, 2026-11-18) — the per-increment "uncommitted" notes above describe the working tree before this commit — and `80b018a` "Fix Playwright registration navigation race in CI" (2026-11-20). **CI:** run #16 on `27ee99f` failed one Playwright test in both jobs (a test synchronization race after client-side navigation, not an application defect); after the correction, run #19 on `80b018a` passed both the quality and regression jobs (https://github.com/tpalme14/hidden_tennessee/actions/runs/44797440938). The M03-T03 CI follow-up is closed (record under M03-T03). **M03-T02 (Implement Authentication Backend) was closed Complete 2026-11-13** on acceptance of Increment 7. M03-T02 increment trail: **Increment 1 (identity and rate-limit schema) accepted 2026-11-07** (migration applied to `landmarks_test` and `landmarks_dev`, landmarks data untouched by snapshot checksum, 10 new schema tests); **Increment 2 (Better Auth instance and Express mount) accepted by the developer 2026-11-09** (`better-auth@1.7.18` installed as the only new dependency with zero new audit findings; instance, hooks, and `/api/auth/*` mount in place; 13 new auth integration tests; 65 integration / 46 + 301 unit / 22 Playwright all passing; record under M03-T02); **Increment 3 (session policy and `requireSession` middleware) accepted by the developer 2026-11-09** (30-day/23-day renewal and expiry proven with a faked `Date` through both the native endpoint and the middleware; 15 new tests; 80 integration / 46 + 301 unit / 22 Playwright passing; no application route protected yet); **Increment 4 (CSRF and cookie security) accepted by the developer 2026-11-10** (`requireTrustedOrigin` on `/api/v1`, structural route-guard test, 20 Better Auth paths disabled, https cookie shape verified, sanitized logging incl. the `onAPIError` fix for the library's module-level-logger bypass; 25 new integration + 7 unit tests; 105 integration / 53 + 301 unit / 22 Playwright passing); **Increment 5 (database-backed rate limiting) accepted by the developer 2026-11-10** (approved thresholds on the `rate_limits` table; Express-derived client IP with a private header and `AUTH_TRUSTED_PROXY_HOPS` default 0; 503 wrapper for a rejected auth handler; 9 unit + 15 integration tests incl. concurrency, cleanup, spoofing, and the 503 path; 120 integration / 62 + 301 unit / 22 Playwright passing; **production proxy-topology verification is an explicit deployment blocker**); **Increment 6 (password reset) accepted by the developer 2026-11-10** (`nodemailer@10.5.0` as the only new dependency; `MailTransport` with SMTP/disabled/memory implementations, bounded timeouts and a slot-preserving cap of 10; hashed 30-minute single-use tokens; all sessions revoked on reset via the explicit option; canonical `/reset-password?token=…` links; `onAPIError.throw` routing unexpected failures to the sanitized 503; 12 unit + 13 integration tests; 133 integration / 74 + 301 unit / 22 Playwright passing); **Increment 7 (final closure and documentation) accepted by the developer 2026-11-13** (README authentication section; `requireSession` now maps infrastructure failures to the 503 envelope and only genuine authentication failures to 401, with 4 new tests; full final sequence green: 137 integration / 74 + 301 unit / 22 Playwright, both databases' migrations up to date, `landmarks_dev` unchanged; acceptance criteria reconciled against the specification in the M03-T02 record). **Preserved from M03-T02 (all open):** deployment blockers — production trusted-proxy verification, production SMTP provider/sender/handshake, HTTPS deployment, the sensitive-location classification policy; later work — ~~CI execution~~ (closed 2026-11-17), dependency-audit findings and Dependabot PRs, expired-session cleanup, frontend reset-token handling (M03-T03), the account-enumeration timing limitation, the parameterised reset callback route, per-IP limiting, favorites throttling, the Prettier drift. **Committed and pushed 2026-11-17** (developer-approved checkpoint): `8a5cb2d` Prettier housekeeping (50 pre-existing files, formatting only), `8454eef` M03-T02 complete (46 files), `7b2289f` CI generate + migrate steps, `6c7dccf` CI generate-before-type-check fix; `origin/main` fast-forwarded from `6ba9ff9` to `6c7dccf`. **CI verification (2026-11-17):** run #9 on `7b2289f` was the first Actions execution — regression job fully green, quality job failed at Type check because the pre-existing workflow generated the Prisma client only after the type check (Prisma 7 generates none on install); run #14 on `6c7dccf` (https://github.com/tpalme14/hidden_tennessee/actions/runs/44161694553) completed `success` with the quality job green through format check, lint, Prisma generate, type check, `prisma migrate deploy`, build, unit, integration, Playwright, and the informational audit, and the regression job green through generate, migrate, build, and Playwright. The CI execution follow-up is closed; the `.github/workflows/ci.yml` values are now verified rather than recorded as unverified. Informational annotations remain: the checkout/setup-node v4 actions target the deprecated Node 20 runtime (the pending Dependabot v7 PRs address this) and the runner image's Ubuntu migration notice. M03-T01 (Design User Data Model) — a design-only task — was **approved and marked Complete 2026-11-07** (six recorded decisions; closure record and ADR-011 both accepted by the developer 2026-11-07). **Task count: 25 of 47 planned tasks Complete (53.2%)** (M00: 6 of 6; M01: 5 of 5; M02: 8 of 8; M03: 6 of 6 — M03-T06 committed as `c34d161` and CI verified; M04–M07: 0 of 22). **Next:** a developer decision on Milestone 03 closure (its completion criteria have not yet been formally reviewed); the next planned task in sequence is **M04-T01 — Design Ratings and Reviews Model** (Proposed), which starts only on explicit developer go-ahead. **M03-T03 — Implement Authentication Interface: Complete 2026-11-18** (see its record). M03-T03's originally recorded starting scope, against spec §§4 and 8: registration and sign-in forms (email and password only, with `name: ""` sent to the registration endpoint), client-side Zod validation mirroring the 8–128 character policy, generic failure feedback, sign-out, session restoration on reload via the session endpoint, the safe return destination after sign-in, and the reset-request and reset-completion pages with the token-handling requirements recorded under M03-T02 Increment 6 (strip the token from the visible URL, restrictive `Referrer-Policy`, token in the POST body only, no third-party scripts). The M02 milestone-level mobile-device criterion stays open pending touch-device verification; the sensitive-location classification policy remains a release blocker with no classification decision made. **Git:** the developer made the repository's first commit (`6ba9ff9` "M02 complete") and pushed it to `origin/main` on 2026-11-07; the M03-T01 documentation changes (this file and `docs/DECISIONS.md`), accepted by the developer 2026-11-07, were committed in `8454eef` and pushed to `origin/main` 2026-11-17 (corrected 2026-11-18 against Git history: at `6ba9ff9` `docs/DECISIONS.md` has no ADR-011 and M03-T01 reads Proposed; `8454eef` carries both) — no commit is to be made by the assistant without instruction. M02-T08 (Implement Accessible Non-Map Discovery and Keyboard-Accessible Map Interactions) was **marked Complete 2026-11-07** after the developer's manual physical-keyboard verification and acceptance (full increment history, verification evidence, manual results, and preserved follow-ups are in the M02-T08 record). The GitHub account billing restriction that stopped the first push's workflow run has since been resolved: GitHub Actions runs #14 and #15 passed, and the CI verification follow-up is closed (see the CI verification record above). The seven open Dependabot pull requests are held for separate review and are not to be merged or modified.

**Session Handoff (2026-11-07) — resuming in a new session:** M02-T08 is Complete and developer-accepted; no task is in progress. The repository's verified state: `tsc -b --noEmit` 0 errors, `eslint .` 0 errors, `vitest run` 35 files / 301 tests, `vite build` succeeds, Playwright 22/22 (Chromium, production build against `landmarks_test`), six axe states at 0 violations. On this machine `npm run <script>` wrappers are blocked by group policy, so checks run via `node` against the binaries directly (see M02-T08's Increment 3 record for the exact commands); Playwright reuses any server answering `/health` on port 3000, so stop any scratch mock API before e2e. **M03-T01 (Design User Data Model) is Complete (approved 2026-11-07)** — read its record and ADR-011 before any M03 work. **Next step: M03-T02 (Implement Authentication Backend), only on explicit developer go-ahead**, starting from `specs/AUTHENTICATION_FAVORITES_SPEC.md` v0.3 §§2–5 and 9, ADR-006/ADR-010/ADR-011, the M03-T01 record's installation-time verification requirements, and the `postgres-prisma`/`fullstack-typescript`/`testing-and-verification` skills — plan first (including the dependency request for Better Auth 1.7.18 and its Prisma adapter), then stop for approval. Open developer decisions that are not tasks: Milestone 02 formal closure; the sensitive-location classification policy; committing the M03-T01 documentation (the repository itself is now committed and pushed — `6ba9ff9` on `origin/main`). Continue the established workflow unchanged: plan → explicit approval → small implementation increments → verification → review → acceptance, one increment at a time, stopping for developer review after each.

**Implementation Authorization:** M00-T01 through M00-T06 are complete and verified. M00-T05's GitHub Actions execution, unverified until the repository was pushed, was confirmed on 2026-11-17 (run #14 on `6c7dccf`, both jobs green; see the CI verification record in the Current Task entry). M01 (Landmark Data Foundation) is Complete in full, including the initial `landmarks_dev` import. M02-T01 through M02-T08 are Complete (M02-T08 accepted 2026-11-07). M03-T01 is Complete as a design-only task (approved 2026-11-07; it authorized no code, schema, migration, or dependency change). M03-T02 is Complete (closed 2026-11-13; seven accepted increments; `better-auth@1.7.18` and `nodemailer@10.5.0` are the two dependencies it added). M03-T03 is Complete (accepted 2026-11-18; six accepted increments; `zod` is the only dependency it added). M03-T04 is Complete (closed 2026-11-20; four increments; no dependency or schema change; ADR-012 accepted). M03-T05 was authorized increment by increment on 2026-11-20 (one migration, `20261120000000_favorites`, applied to `landmarks_test` and `landmarks_dev`; no dependency change) and is Complete (formally accepted 2026-11-20; committed as `ebfc63a`, pushed to `origin/main`, and verified by GitHub Actions run #22). M03-T06 was authorized increment by increment on 2026-11-20 (frontend and E2E tests only; no backend, schema, migration, or dependency change) and is Complete (committed as `c34d161`, pushed to `origin/main`, and verified by GitHub Actions run #24). All subsequent tasks await explicit developer go-ahead before any work begins; the sensitive-location classification policy remains unresolved and release-blocking throughout.

**Open Follow-Up Items:**
- Keyboard arrow-key map panning (from M02-T02): previously recorded as "confirmed still broken" during M02-T08 planning, but that reproduction was never documented (the handoff note referred to a root-cause trail that did not exist in this file). **Re-investigated in M02-T08 Increment 4 (2026-11-04)** with instrumented real-browser input against both the app and standalone Leaflet: **no application defect found** — panning works via Tab, programmatic focus, and mouse-click focus in dev and production builds, and `e2e/keyboard-panning.spec.ts` now guards it. The earlier "broken" result is most consistent with an automation-focus artifact (container made `activeElement` without a `focus` event in an unfocused window, so Leaflet's handler never activates), which was captured directly in the in-app pane. Full trail in M02-T08's Increment 4 Verification Results. **Closed 2026-11-04 by developer acceptance: resolved through verification, no production fix required**, with the explicit caveat that the automation-focus explanation is not conclusively proven for every earlier observation, and with human foreground-window keyboard verification deferred to the final manual accessibility pass. Two related observations are preserved there for final accessibility review (arrows do not pan while a marker has focus — consider brief keyboard instructions; the map-pane transform assertion may need revisiting if brittle).
- **M02-T08 accessibility follow-up — Shift+Tab from popup content** (recorded at Increment 3 acceptance): **resolved — investigated and fixed in Increment 5c (Option A), accepted by the developer 2026-11-04.** Shift+Tab at the popup's backward boundary now returns to the originating marker with the popup open; rationale and regression coverage (`LandmarkMarkersRenderer.shiftTab.leaflet.test.tsx`, `e2e/popup-backward-navigation.spec.ts`) preserved in M02-T08's Increment 5c records.
- **M02-T08 accessibility follow-up — focus loss when a focused marker is removed** (recorded at Increment 3 acceptance; was a potential completion blocker): **resolved — fixed in Increment 5a and accepted by the developer 2026-11-04.** Focus now moves to the geographic-results heading when the focused marker or its open popup is removed by a results update, with no steal otherwise; verified with real Leaflet in component tests and real-browser Playwright with changing synthetic `PUBLIC` results. Rationale and regression tests preserved in M02-T08's Increment 5a Verification Results.
- **M02-T08 deferred follow-ups (recorded 2026-11-04 at Increment 5d; confirmed at task closure 2026-11-07; none blocked Complete):** screen-reader testing (NVDA/JAWS/VoiceOver); Firefox/Safari verification (the Playwright project is Chromium-only; the manual checklist is reusable for this); actual GitHub Actions execution (**RESOLVED 2026-11-17** — see the CI verification record in this section: run #14 on `6c7dccf` completed with both jobs successful; the 2026-11-07 run #1 had failed with no steps executed because of the GitHub account billing lock, since lifted; see the M02-T08 closure record); separate dependency-security triage, now covering both the 10 pre-existing moderate `npm audit` findings (dev-only, `minimatch` via eslint/typescript-eslint) and the seven open Dependabot PRs, several of them major-version bumps; separate housekeeping pass for 52 pre-existing files failing root `prettier --check .` (none touched by M02-T08); focus restoration after a focused marker is removed was verified by automation only (the developer did not manually test checklist section F). The natural home for the accessibility items is M07-T03 (Accessibility and Usability Review) unless the developer schedules them earlier. *(The manual physical-keyboard pass was executed 2026-11-07 — results in the M02-T08 record; the attribution-contrast and keyboard-instruction decisions were approved and implemented 2026-11-04 — neither is open.)*
- Marker rendering against real `PUBLIC` data (from M02-T03, now also applying to M02-T07/M02-T08's geographic discovery) has not been browser-verified, since no `PUBLIC` landmark currently exists — only synthetic-fixture tests and the real-`UNREVIEWED`-data checks recorded under M02-T07 cover this. Revisit once classification produces real `PUBLIC` records.
- Full `PUBLIC` profile and mini-map rendering (from M02-T04) has not been browser-verified against real data, since no `PUBLIC` landmark currently exists — only synthetic-fixture tests cover this. Revisit once classification produces real `PUBLIC` records.
- **From M03-T05 (recorded 2026-11-20; full text in the M03-T05 record):** (1) **M01-T04 metadata-only GPX re-import defect — OPEN**: metadata-only changes to an existing active landmark are classified `unchanged` and not persisted; needs its own approved plan and regression tests. (2) The sensitive-location classification policy remains a release blocker; no real landmark can be favorited until landmarks are classified `PUBLIC`. (3) axe needs-review results on Leaflet's zoom controls in five map-bearing states (not violations; assessed in M02-T08; for M07-T03). (4) Favorites throttling is per process (not shared across instances; resets on restart). (5) Malformed JSON bodies still receive Express's default 400 rather than the JSON envelope (app-wide). (6) The route inventory and route-guard tests depend on Express 4 internals. (7) Duplicate session cookies resolve to the first cookie's identity (observed and pinned; never combined). (8) M03-T06 owns the favorites UI, including non-navigable "No longer available" entries and hiding the favorite action for redacted landmarks — *delivered by M03-T06 (Complete 2026-11-20; `c34d161`, CI run #24 success).* **Resolved:** the M03-T04 follow-up about three comments describing ADR-012 as a draft (all three read "Accepted").
- **From M03-T06 (recorded 2026-11-20; full text in the M03-T06 record):** (1) ~~the Git checkpoint and CI verification of M03-T06 are pending~~ — done: `c34d161` pushed, GitHub Actions run #24 success (CI record under M03-T06). (2) Leaflet attribution contrast — measured 4.94:1 (links) and 12.63:1 (text) on an opaque white background; axe's needs-review result comes from its unsupported `plus-lighter` blend mode and is inconclusive, not a confirmed violation — reassess in M07-T03. (3) Removing the last entry on a page above 1 clears the success announcement during the move to the preceding page — review in M07-T03. (4) Real E2E paging beyond 50 entries excluded (unit tests plus a manual 51-favorite check). (5) `e2e/` has no permanent TypeScript configuration. (6) Test-created Better Auth users are kept (deletion disabled). (7) Interrupted runs may leave fixtures; abandoned fixtures are reported but never deleted automatically. (8) Chromium only, automated and manual-in-pane; no physical-keyboard or screen-reader confirmation.

*(The search Retry button's real-click-to-real-refetch path, previously an open item, was closed in M02-T06 by `LandmarkSearch.realHook.test.tsx` — see M02-T05's and M02-T06's Verification Results for the full history; not repeated here as it's no longer open. Likewise, M02-T03's marker coordinate-validation and `MAX_MARKER_PAGES` follow-ups, and M02-T04's profile-return-navigation follow-up, and M02-T05/M02-T06's map/list-reconciliation follow-up were all closed by M02-T07. `useLandmarkSearch`'s previous-results retention follow-up, recorded during M02-T07's final verification, was closed by M02-T08's increment 1 — see M02-T08's Increment 1 Verification Results for the full history.)*

**Next Planned Activities:**

1. **M02-T08 closed Complete 2026-11-07.** Increment acceptance trail: 3 (marker accessibility, incl. both Escape deviations), 4 (keyboard-panning resolved through verification; `e2e/keyboard-panning.spec.ts`), 5a (focus-loss fix), 5b (`@axe-core/playwright` + `role="group"` correction), 5c (Shift+Tab Option A) all accepted 2026-11-04; 5d's automated verification and its two corrections accepted 2026-11-05; the developer's manual physical-keyboard pass executed 2026-11-07 (A–E passed, keyboard instruction clear and usable, F not manually tested). Final state 301 frontend tests, 22/22 Playwright, six axe states at 0 violations, no exclusions.
2. **M03-T01 — Design User Data Model: Complete 2026-11-07** and **M03-T02 — Implement Authentication Backend: Complete 2026-11-13** (seven accepted increments: identity schema and migration; Better Auth instance and mount; session policy and `requireSession`; CSRF and cookie security; database-backed rate limiting; password reset; closure — full records under the task). **M03-T03 — Implement Authentication Interface: Complete 2026-11-18** (six accepted increments: auth API client and validation; session provider and shell integration; registration page; sign-in page with the `strict-origin` amendment; password-reset pages; closure — full records under the task). **M03-T04 — Implement Authorization: Complete 2026-11-20** (four accepted increments: protected mount, identity accessor, and no-store; structural enforcement; two-user helpers and ADR-012; closure — full record under the task). **Next planned task: M03-T05 — Implement Favorites Data Model and API** (Proposed; dependencies satisfied). **Not started; awaits explicit developer go-ahead**, then begins with a plan for approval. M03-T05 is the first consumer of `mountProtected`, `authenticatedUserId`, and the two-user helpers; the deny-by-default route inventory will enforce ADR-012 on its routes, and it carries the ownership tests and favorites throttling handed off by M03-T04.
3. Developer decisions pending that are not tasks: formal Milestone 02 closure against its completion criteria (mobile-device usability has width-only evidence; kept open pending touch-device verification); the sensitive-location classification policy (release-blocking; also gates real-`PUBLIC`-data verification; no classification decision has been made); ~~committing the M03-T01 documentation changes~~ (done: committed in `8454eef` and pushed 2026-11-17; the repository's first commit, `6ba9ff9` "M02 complete", was made and pushed by the developer 2026-11-07); ~~resolving the GitHub account/billing lock so the CI workflow can actually run, then re-running it~~ (done 2026-11-17: run #14 green); triaging the seven open Dependabot PRs (several major-version bumps) rather than merging them.
4. ~~Once a git remote exists, confirm the CI workflow actually runs successfully on GitHub Actions (currently unverified).~~ **Done 2026-11-17** — see the CI verification record above.
5. **M03-T05 — Complete 2026-11-20** (formally accepted; one checkpoint commit on `main`). Pushed to `origin/main` and verified by GitHub Actions run #22 (success) on 2026-11-20.
6. **M03-T06 — Complete 2026-11-20** (Increments 1–5 and 6A–6E accepted; record under the task). Committed as `c34d161` (staged by name, excluding the `LandmarkSearch.tsx` line-ending artifact), pushed to `origin/main`, and verified by GitHub Actions run #24 (success). Next: the Milestone 03 closure decision (separate approval), M04-T01 on explicit go-ahead, and a separately planned correction for the M01-T04 metadata-only re-import defect.

No application feature implementation tasks beyond what is explicitly approved are authorized at this stage.
