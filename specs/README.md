# Tennessee Natural Landmarks Explorer — Specification Index

This index lists the feature specifications under `specs/` and their current approval status.
Specifications define *what* the system must do; `.claude/skills/` define *how* engineering
work is performed; `docs/DECISIONS.md` records *why* architectural choices were made.

**Do not implement against a specification that is not marked Approved below.**

| # | Specification | File | Version | Status | Related ADRs |
|---|---|---|---|---|---|
| 1 | Landmark Data and GPX Import | `LANDMARK_DATA_IMPORT_SPEC.md` | 0.3 | **Approved** (2026-10-29) | ADR-003, ADR-005, ADR-009 |
| 2 | Landmark Discovery, Search, Filtering, and Profiles | `LANDMARK_DISCOVERY_SPEC.md` | 1.0 | **Approved** (2026-10-29). §9.4 (retired-landmark profile page) resolved: a generic "Landmark unavailable" page, no location metadata exposed. Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (§9.5). | ADR-001–004, ADR-009 |
| 3 | Authentication and Favorites | `AUTHENTICATION_FAVORITES_SPEC.md` | 0.3 | **Approved** (2026-10-29). Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (§10.3). | ADR-001–003, ADR-006–009 |
| 4 | Landmark Ratings and Reviews | `RATINGS_REVIEWS_SPEC.md` | 1.0 | **Approved** (2026-10-29). Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (§10.2.3). | ADR-001–003, ADR-005, ADR-006, ADR-008, ADR-009 |
| 5 | Trip Planning and Management | `TRIP_PLANNING_SPEC.md` | 1.0 | **Approved** (2026-10-29), including public read-only trip sharing (see `docs/PROJECT_PLAN.md` FR-12). Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (§10.5). | ADR-002, ADR-003, ADR-006, ADR-007, ADR-009 |
| 6 | Offline Access and Progressive Web App | `OFFLINE_PWA_SPEC.md` | 1.0 | **Approved** (2026-10-29) for FR-13 (installable PWA; explicit offline saves). FR-14 (offline map downloads) remains conditional on M00-T06 feasibility, by design. Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (§9.8). | ADR-004, ADR-007, ADR-008, ADR-009 |
| 7 | Deployment, Testing, and Release Readiness | `DEPLOYMENT_TESTING_RELEASE_SPEC.md` | 1.0 | **Approved** (individual task implementation still requires separate authorization) | ADR-001–009 |

## Unresolved cross-specification dependencies

- **Sensitive-location classification policy** (Specs 1–7): the *mechanics* of enforcing
  sensitive/inactive-landmark redaction are approved and specified consistently across every
  document. The actual classification criteria and an initial review of the dataset against
  them are **not** approved and remain release-blocking per Spec 7 §7/§9/§10.4.3. Approving
  the redaction mechanics is not the same as approving a classification policy — no specific
  landmark has been classified sensitive or confirmed safe to disclose.
- **Public trip sharing** (Spec 5): approved, and now reflected in `docs/PROJECT_PLAN.md`
  FR-12 and §5.1.
- **Production hosting cost** (Spec 7 §10.4.1): production requires a paid Render PostgreSQL
  plan; the specific tier and cost are not yet selected or approved.

## Specification approval requirements

A specification must be explicitly marked **Approved**, with its version and date recorded,
before any implementation task may proceed against it. Draft and candidate specifications may
be read for planning purposes but are not authorization to implement, consistent with
`CLAUDE.md` and the `spec-driven-development` skill.
