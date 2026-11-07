---
name: testing-and-verification
description: Plan and report honest, requirements-based unit, integration, end-to-end, accessibility, security, and release checks.
---

# Testing and verification

Use this skill when defining acceptance criteria, adding tests, reviewing changes, or preparing release.

- Follow ADR-009 and the approved release specification. Use Vitest for unit tests, React Testing Library for UI behavior, Supertest for Express API tests, a real PostGIS database for spatial/integration tests, and Playwright for critical browser journeys.
- Derive test cases from approved acceptance criteria. Include positive, negative, boundary, authorization, and error scenarios where relevant.
- Authentication integration tests using Supertest must exercise real HTTP requests and real session cookies rather than mocked server users. Verify cookie flags (HttpOnly, Secure in production, SameSite), anti-CSRF protections (including Origin/Referer validation where specified), and session creation, renewal, expiry, and revocation behavior.
- Run database integration tests only against a dedicated local or CI PostgreSQL/PostGIS test database, with an explicitly test-scoped connection string. Never connect integration tests to the live production Render database; fail closed if the environment or database target is ambiguous.
- Verify `GET /health` returns HTTP 200 when the application and database are ready and HTTP 503 when database connectivity/readiness fails.
- Cover sensitive-location non-disclosure in discovery, detail/reviews, shared trips, and offline snapshots; cover authentication, account-scoped offline storage, and sign-out access blocking.
- For imports, test duplicate source codes, validation failures, preview thresholds, transactional rollback, reactivation, no partial-import retirement, and preservation of user-linked records.
- For the PWA, separately verify FR-13 shell and explicitly saved structured offline data. Do not assert FR-14 offline map support before the feasibility gate is passed and the feature is approved.
- Include accessibility and map/list alternatives; verify current Chrome, Firefox, and Safari, including mobile where available. Record any unavailable environment rather than implying coverage.
- CI should gate production deployment. Manual Render deployment and production readiness checks remain separate approval-controlled operations.
- In the completion report, list exact commands executed, pass/fail/skip counts if known, environment limitations, untested areas, and outstanding release blockers.
