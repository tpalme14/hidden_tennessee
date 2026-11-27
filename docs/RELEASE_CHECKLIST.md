# Release Checklist

**Status:** Initialized 2026-11-27 at M06-T05 (Milestone 06 verification) to record the FR-14
deferral. **Not a release approval.** The checklist is completed in Milestone 07 (M07-T01–M07-T07),
and release requires the developer's explicit authorization after reviewing the evidence
(Specification 7 §9).

**Format (Specification 7 §9):** each release criterion is recorded as **Pass**, **Fail**,
**Deferred with approval**, or **Not applicable**, with evidence links and an approver. Failed
mandatory criteria cannot be waived implicitly. Items not yet assessed are listed separately as
**open**; they carry no status until assessed.

## Recorded criteria

| Criterion | Status | Evidence | Approver | Date |
|---|---|---|---|---|
| FR-14 — bounded offline map downloads (Specification 7 §9, §10.4.2) | **Deferred with approval** | M00-T06 feasibility study and deferral (`docs/IMPLEMENTATION_PLAN.md`, M00-T06); Specification 6 §7.4 and OFF-GATE-2 (§12.13); Specification 7 §10.4.2 Phase 1 deferral record; M06-T04 recorded as Deferred; interface verification that nothing offers or implies offline map downloads (Specification 6 AC-30: M06-T03 3g check (g5), `e2e/offline-final.spec.ts`) | Developer | Decision 2026-10-30; recorded here 2026-11-27 |

**FR-14 conditions carried with the deferral:** the release must not present offline map downloads
as delivered; no persistent tile downloads against public OSM tile servers or another provider
without explicit permission; reconsidering FR-14 or selecting a provider needs a new, explicit
developer decision. The deferral does **not** satisfy any other gate — in particular, a production
tile provider for the **online** map is still unselected (Specification 7 §7; ADR-004).

## Open items carried forward from Milestone 06 (not yet assessed)

| Item | Source | Assigned |
|---|---|---|
| Sensitive-location classification policy, including persistent offline distribution of coordinates (OFF-GATE-1) — **release blocker** | Specification 6 §9.8, §12.13; Specification 7 §7, §10.4.3 | M07 |
| Manual assistive-technology verification (Specification 6 AC-29, AC-41; M06-T02 obligation A2) | `docs/IMPLEMENTATION_PLAN.md` M06-T02, M06-T03 | M07-T03 |
| Dependency security dispositions (the recorded audit findings) | `docs/IMPLEMENTATION_PLAN.md` M06-T02 | M07-T02 |
| CI verification of the Milestone 06 changes (M06-T02 obligation A3) | `docs/IMPLEMENTATION_PLAN.md` M06-T02, M06-T05 | Milestone 06 Git checkpoint |
| Firefox, Safari, and iOS behavior: unverified (Chromium-only browser evidence) | Specification 7 §10.3; M06-T05 | M07 |

**Accepted Milestone 06 limitations to document for release (Specification 7 §8):** OFF-OUT-11
interrupted sign-out request risk; DR-5 browser-shutdown limitation; S1 conservative ordering;
suspended tabs and best-effort cross-tab notices; browser eviction and persistent-storage limits;
blocked-deletion limitations; quota behavior verified only with injected errors; Chromium-only
browser evidence; no physical-erasure guarantee for offline copies.
