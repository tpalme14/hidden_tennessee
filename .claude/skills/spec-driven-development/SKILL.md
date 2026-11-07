---
name: spec-driven-development
description: Plan and implement Tennessee Natural Landmarks Explorer tasks against approved specifications and ADRs, with explicit approval gates and traceable verification.
---

# Spec-driven development

Use this skill when planning, implementing, reviewing, or verifying any project task.

1. Read repository `CLAUDE.md` first, then the relevant approved specification(s), ADRs, and implementation-plan task. Confirm files and versions actually exist; do not assume a draft is approved.
2. Before changing anything, present a bounded plan: task ID, requirements and acceptance criteria, affected files, dependencies, tests, risks, and unresolved decisions. **Stop for explicit user approval.** Planning approval is not permission for unrelated work.
3. Treat approved specs and ADRs as authoritative. If requirements conflict, are missing, or depend on an unresolved policy, flag the conflict and ask for a decision; do not silently invent policy.
4. Implement only the approved scope. Preserve existing architecture and user data. Avoid unrelated refactors, dependency changes, and infrastructure provisioning.
5. Verify with relevant automated tests and manual checks. Report exact commands run and their outcomes; never claim a test passed if it was not executed.
6. Summarize changed files, requirement coverage, remaining gaps, and any documentation updates. Stop after the approved task; do not automatically begin the next task.

## Project-specific guardrails

- Never persist session tokens, passwords, or password-reset tokens in localStorage, sessionStorage, or IndexedDB. Use server-managed sessions with HttpOnly, Secure, SameSite cookies and derive user IDs from authenticated server context; never trust client-supplied user IDs for authorization.
- Apply the unified service-layer sensitive-location guard before serializing public discovery, review, or shared-trip responses and before producing landmark data eligible for IndexedDB offline snapshots. For inactive or sensitive landmarks, return the generic 404 or explicitly permitted redacted summary/placeholder required by the approved endpoint specification; never leak coordinates, exact descriptions, or restricted metadata.
- Never publish sensitive-site coordinates or location metadata without applying the approved redaction mechanics. The classification criteria for which landmarks are sensitive, and the initial review of the dataset against those criteria, remain unresolved and release-blocking (see `specs/README.md`) — approval of the redaction mechanics is not approval of a classification policy.
- FR-13 offline saved data is independent of FR-14; offline map downloads remain conditional on M00-T06 provider feasibility.
- GPX source files are immutable; import behavior must preserve stable landmark identities and user relationships.
- Production deployment requires a deliberate manual action after CI succeeds.
