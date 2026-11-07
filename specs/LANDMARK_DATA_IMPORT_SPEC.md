# Tennessee Natural Landmarks Explorer
## Landmark Data and GPX Import Specification

**Status:** Approved — October 29, 2026  
**Version:** 0.3  
**Related requirements:** FR-02, FR-05, FR-06; NFR 7.4, 7.5, 7.7  
**Related tasks:** M01-T01 through M01-T05  
**Authoritative decisions:** ADR-003, ADR-005, ADR-009

---

## 1. Purpose and Boundaries

This specification defines the required interpretation, validation, persistence, and repeatable import behavior for the existing Tennessee natural landmark GPX dataset.

The specification covers:

- GPX source inventory and field mapping.
- Landmark identity and provenance.
- Source validation and normalization.
- Duplicate handling.
- Repeatable database imports.
- Landmark retirement and reactivation.
- Transaction atomicity and failure recovery.
- Large-change safeguards.
- Import verification and acceptance criteria.

Search ranking, public API URL structures, user interface layouts, ratings, reviews, and trip-planning behavior are addressed by separate specifications.

The original `coordinates/*.gpx` files are read-only inputs and must never be modified by the importer.

The importer shall be a standalone Node.js/TypeScript command-line application using `fast-xml-parser`, explicit TypeScript mapping, and Zod validation, consistent with ADR-005.

The importer shall not be exposed as a public API endpoint.

## 2. Source Inventory and Provenance

ADR-005 documents **1,693 waypoint occurrences across eight GPX files**, based on an earlier dataset inspection.

This count serves as the documented baseline. M01-T01 must independently verify the actual source files, record counts, structures, and data quality before implementation.

Any discrepancy must be documented and reviewed rather than silently changing the baseline.

| Source file | Landmark category |
|---|---|
| `tnarches.gpx` | Natural arches |
| `tnbalds.gpx` | Mountain balds |
| `tnfalls.gpx` | Waterfalls |
| `tnlakes.gpx` | Lakes |
| `tnother.gpx` | Other natural features |
| `tnpeaks.gpx` | Mountain peaks |
| `tnrocks.gpx` | Rock formations |
| `tnsinks.gpx` | Sinkholes |

The documented GPX waypoint structure includes:

- `<wpt>` with latitude and longitude attributes.
- `<name>` containing the source landmark identifier.
- `<cmt>` containing the preferred display name.
- `<desc>` containing source descriptive or county information.
- Optional `<link>` metadata.
- `<sym>` containing source symbol information.

The current dataset does not establish structured trail, elevation, photograph, or verified access information.

Landmark categories shall be derived from source filenames, not from GPX symbol values.

## 3. Required Landmark Data Contract

| Attribute | Required behavior |
|---|---|
| Internal landmark ID | Database-generated primary key, stable across imports |
| `source_code` | Required, unique identifier derived from GPX `<name>` |
| `source_file` | Required source filename for provenance |
| Category | Required; one of the eight approved categories |
| Display name | Trimmed `<cmt>`, falling back to trimmed `<name>` |
| Latitude | Required numeric WGS84 latitude |
| Longitude | Required numeric WGS84 longitude |
| Source description/county | Optional source-provided `<desc>` content |
| Access/land-manager label | Optional, unverified `<link><text>` content |
| Source URL | Optional; only a valid, nonempty URL may be treated as navigable |
| Active/retired state | Required to distinguish current and retired landmarks |

The database shall use a surrogate internal primary key independent of `source_code`.

Favorites, reviews, and trip stops shall reference the internal landmark ID rather than the GPX source identifier.

Source metadata must not be represented as proof of public access, landowner permission, safe hiking routes, or official endorsement.

The sensitive-location disclosure policy remains a separate unresolved requirement.

## 4. GPX Mapping and Parsing Rules

### 4.1 Source Files

The importer shall recognize the eight approved GPX filenames and their associated categories.

Unknown filenames must be reported and must not be silently assigned a category.

The original GPX files shall remain unchanged.

### 4.2 Source Identifiers

GPX `<name>` maps to `source_code`.

The value shall be trimmed before validation.

A missing, empty, or whitespace-only `<name>` shall cause Tier 1 record rejection, even if other metadata is present.

Source-code case sensitivity and any additional normalization rules must be confirmed during M01-T01/M01-T02.

### 4.3 Display Names

GPX `<cmt>` is the preferred display name.

The importer shall apply the following rules:

1. Trim leading and trailing whitespace from `<cmt>`.
2. If the resulting value is nonempty, use it as the display name.
3. Otherwise, use the validated, trimmed `<name>` value.
4. If `<name>` is missing or empty, reject the record under Tier 1 validation.

The importer shall not invent placeholder names such as "Unknown Landmark."

Meaningful Unicode characters, punctuation, and internal spacing shall be preserved unless a separately approved normalization rule applies.

### 4.4 Source Description and County

GPX `<desc>` shall be treated as source-provided metadata.

Leading and trailing whitespace shall be trimmed, and whitespace-only values shall be treated as absent.

The precise database representation—dedicated county field, raw description field, or both—remains pending verification of the actual GPX contents during M01-T01/M01-T02.

The importer must not independently infer county information from coordinates.

### 4.5 Link and Access Metadata

Optional `<link><text>` content may describe a land manager, access condition, or other source label.

Such content shall be preserved as unverified metadata.

A missing or empty `href` shall not produce a navigable URL.

Only an actual valid URL may populate the source URL field.

Source labels must not be transformed into claims of verified public access or official endorsement.

### 4.6 Coordinate Identity

Two distinct source codes may refer to identical coordinates.

Coordinate equality shall not be used to deduplicate landmark records.

The source code, not the coordinate pair, establishes external landmark identity.

## 5. Landmark Identity, Duplicates, and Repeat Imports

### 5.1 Stable Identity

The importer shall match existing landmarks using the unique `source_code`.

For each accepted record:

- If the source code is new, insert a landmark.
- If the source code already exists, update the existing landmark in place.
- Never delete and recreate a landmark merely to update its metadata.

The existing internal primary key shall remain unchanged during updates.

Related favorites, reviews, and trip stops shall remain intact.

### 5.2 Duplicate Source Records

ADR-005 documents one exact duplicate waypoint occurrence:

**`MIF026` — Denny Cove Falls — `tnfalls.gpx`**

The importer shall count both source occurrences but persist only one landmark record.

The import summary shall report the duplicate occurrence.

When identical source codes contain conflicting attributes, the importer shall flag the conflict for review rather than silently choosing a record.

A conflict that prevents determination of the authoritative record must block the affected update and any unsafe retirement decisions.

### 5.3 Retirement Scope

Retirement is permitted only during a complete, successfully validated eight-file import.

A complete import requires:

1. All eight approved source files are present and readable.
2. Their GPX structures can be parsed.
3. The source inventory and import scope are verified.
4. The accepted source-code inventory can be determined reliably.
5. All required safety checks and approvals have been satisfied.

A single-file import or other partial import shall never retire landmarks, including landmarks within the imported category.

An unreadable, missing, malformed, or incomplete file shall never be interpreted as evidence that its landmarks were removed.

Previously active landmarks absent from a complete, approved source inventory may be marked inactive/retired.

Retirement shall not hard-delete the landmark or its associated user-generated records.

### 5.4 Protection Against False Retirement

If a known source code is present in an import but its associated record fails validation, that source code must not be treated as absent.

The importer shall:

- Report the rejected record.
- Preserve the existing landmark unchanged.
- Exclude that landmark from proposed retirements.
- Prevent any retirement operation whose correctness cannot be established from the accepted source inventory.

Record-level validation failures do not automatically require rejection of every valid record, but they must never cause accidental retirement.

### 5.5 Reactivation

When a retired landmark reappears in a subsequent accepted import, the importer shall:

1. Match the existing record using `source_code`.
2. Set its active state to true.
3. Update its source-derived metadata and coordinates.
4. Preserve its original internal primary key.
5. Preserve existing favorites, reviews, and trip-stop relationships.
6. Record the reactivation separately in the import summary.

Reactivation shall not be counted as a new landmark insertion.

## 6. Validation, Preflight, and Import Safety

### 6.1 Text Validation

All supported text fields shall be normalized by trimming leading and trailing whitespace.

Required fields that become empty after trimming shall fail validation.

Optional fields that become empty after trimming shall be treated as absent.

The importer shall preserve meaningful Unicode and punctuation.

It shall not fabricate missing required values.

### 6.2 Global Coordinate Validation

Latitude and longitude must be finite numeric values representing WGS84 coordinates.

Valid ranges are:

- Latitude: -90 through +90 degrees.
- Longitude: -180 through +180 degrees.

Missing, malformed, nonnumeric, non-finite, or globally out-of-range coordinates shall result in Tier 1 record rejection.

The importer must preserve correct coordinate ordering when constructing PostGIS geometry or geography values: **longitude first, latitude second**.

### 6.3 Tennessee Geographic Warning Envelope

The initial geographic warning envelope is approximately:

- Latitude: 34.8°N to 36.7°N.
- Longitude: 90.3°W to 81.6°W.

This envelope is a preliminary quality-control heuristic, not a legal or authoritative Tennessee boundary.

A coordinate outside the envelope but within globally valid WGS84 bounds shall trigger a preflight warning.

The importer shall identify the source file, source code, and coordinates of each flagged record.

The flagged record shall not be automatically discarded.

However, it shall not be written to the database without explicit developer approval for that import run.

An override must be specific to the flagged records and current import preview, not a permanent suppression of geographic checks.

M01-T01 shall verify the suitability of this warning envelope against the actual source dataset before implementation.

### 6.4 Preflight Validation

Before opening a write transaction, the importer shall:

1. Verify the selected source files.
2. Parse the GPX input.
3. Validate required fields and coordinates.
4. Normalize supported text values.
5. Identify exact duplicates and conflicting identifiers.
6. Determine accepted unique source records.
7. Compare accepted records against the current database state.
8. Calculate proposed inserts, updates, reactivations, and retirements.
9. Identify geographic warnings and unexpected changes.
10. Present an import summary and any required approval requests.

No database writes shall occur during preflight.

### 6.5 Large-Change Safety Thresholds

The importer shall require explicit developer approval before applying an import when any of the following conditions is met.

**Retirements**

Approval is required if proposed retirements exceed either:

- 2% of the currently active landmark dataset; or
- 35 landmarks.

**Coordinate updates**

Approval is required if more than 10% of existing matched landmarks would experience a coordinate shift greater than 100 meters.

Distance shall be calculated using an appropriate geographic distance method consistent with PostGIS.

**Insertions**

Approval is required if new source codes exceed 5% of the existing landmark dataset.

For percentage calculations, use the database state recorded during preflight as the baseline. Threshold comparisons are strictly greater than the specified values.

These thresholds are safety gates, not automatic reasons to reject valid source data.

The preflight report shall provide the actual counts, denominators, percentages, and reasons for each triggered gate.

Approval must apply to the specific import preview. A general-purpose override that silently bypasses all safeguards is not permitted.

These thresholds are initial project policy and may be revised through an explicit developer-approved specification change.

### 6.6 Single Global Transaction

A complete eight-file import shall apply all accepted database changes within **one atomic PostgreSQL transaction**.

This includes:

- New landmark insertions.
- Existing landmark updates.
- Landmark reactivations.
- Approved retirements.

The transaction shall begin only after parsing, validation, preflight checks, and required developer approvals are complete.

If any database operation fails during the transaction, the entire transaction shall be rolled back.

No partial import shall be committed.

The importer shall not claim success unless the transaction commits successfully.

Partial imports, when explicitly permitted, shall also use a single transaction for their accepted write set, but shall perform no retirement operations.

### 6.7 Database State Reconciliation

Because preflight and approval occur before the transaction begins, the importer must guard against the database changing between preview and execution.

Immediately before applying writes, the importer shall verify that the relevant database state still matches the state used to calculate the approved import preview.

If a material discrepancy is detected, the importer shall abort without applying changes and require a new preflight.

This check shall be performed within an appropriate transaction and concurrency-control strategy so that the verified state cannot become inconsistent before the approved writes are applied.

### 6.8 Three-Tier Failure Handling

**Tier 1 — Invalid Source Record**

Invalid individual records shall be skipped and reported according to approved validation rules.

Reports shall include the source file, source code where available, reason for rejection, and relevant counts.

A Tier 1 failure shall not cause an existing landmark to be falsely retired.

Malformed or incomplete source files that prevent reliable inventory determination shall block retirement processing.

**Tier 2 — Database or Transaction Failure**

Database connection failures, constraint violations, or other transaction failures shall cause rollback of the entire import transaction.

No earlier changes from that transaction may remain committed.

The importer shall report the failure without claiming a successful import.

**Tier 3 — Unexpected Large-Scale Dataset Change**

Changes exceeding the approved thresholds shall halt the import before writes.

The importer shall report proposed changes and request explicit developer approval.

Without approval, the import shall terminate without database modifications.

## 7. Verification and Acceptance Criteria

The eventual implementation must satisfy the following scenarios.

### 7.1 Source Mapping

- All eight approved GPX filenames map to their correct categories.
- Unknown filenames are rejected or explicitly reported.
- Categories are derived from filenames rather than GPX symbol values.
- Original GPX files remain byte-for-byte unchanged.

### 7.2 Field Validation

- Required source codes are present and nonempty after trimming.
- `<cmt>` supplies the preferred display name.
- Missing or empty `<cmt>` falls back to `source_code`.
- Missing or empty `<name>` causes record rejection.
- Optional whitespace-only fields are treated as absent.
- Meaningful Unicode and punctuation are preserved.
- Missing or empty link URLs do not become navigable links.

### 7.3 Geographic Validation

- Valid WGS84 coordinates are accepted.
- Missing, malformed, nonnumeric, non-finite, and globally out-of-range coordinates are rejected.
- Coordinates outside the regional warning envelope are flagged.
- Flagged regional coordinates require explicit approval before writing.
- PostGIS coordinate ordering is correct.
- Geographic distance calculations are verified against a real PostGIS test database.

### 7.4 Identity and Duplicate Handling

- The documented `MIF026` exact duplicate produces one persisted landmark.
- Duplicate occurrences are reported separately.
- Conflicting records sharing a source code are flagged.
- Distinct source codes sharing coordinates remain separate landmarks.
- Repeated imports preserve stable internal IDs.
- Unchanged imports do not create unintended duplicates.

### 7.5 Updates and Reactivation

- Existing landmarks are updated in place.
- Internal primary keys remain stable.
- Favorites, reviews, and trip-stop references remain intact.
- A retired landmark reappearing in source data is reactivated.
- Reactivation preserves its original internal ID and related records.
- Reactivations appear separately in import summaries.

### 7.6 Retirement Safety

- A complete approved eight-file import may retire genuinely missing landmarks.
- A partial or single-file import never retires landmarks.
- Missing or unreadable source files prevent retirement processing.
- A rejected record with a recognizable existing source code is not falsely retired.
- Retired landmarks are not hard-deleted.
- Proposed retirements appear in the preflight report.

### 7.7 Transaction Atomicity

A test shall deliberately induce a database failure after earlier changes have been applied within a multi-record import transaction.

The test must verify that:

- The entire transaction is rolled back.
- No earlier inserts remain committed.
- No earlier updates remain committed.
- No earlier reactivations or retirements remain committed.
- Existing data retains its pre-import state.
- The importer reports failure rather than success.

The test shall use a dedicated PostgreSQL/PostGIS test database.

### 7.8 Large-Change Safeguards

Tests shall verify that:

- Retirement thresholds trigger mandatory approval.
- Coordinate-shift thresholds trigger mandatory approval.
- Insertion thresholds trigger mandatory approval.
- Threshold calculations use the documented baseline and strict comparison rules.
- Missing approval prevents all writes.
- Approval is specific to the current preview.
- A materially changed database state invalidates the approved preview.

### 7.9 Import Summary Reconciliation

The importer shall produce a summary that distinguishes:

- Input waypoint occurrences.
- Exact duplicate occurrences.
- Rejected records.
- Accepted unique records.
- New insertions.
- Updated records.
- Reactivated records.
- Retired records.
- Unchanged records.
- Validation warnings.
- Transaction failures, where applicable.

Counts must reconcile consistently without treating every source occurrence as a newly inserted landmark.

## 8. Remaining Decisions Before Implementation

The following decisions remain open and must be resolved through explicit developer review.

### 8.1 Source-Code Normalization

Confirm whether source-code matching is case-sensitive and whether normalization beyond trimming is appropriate.

Any normalization must preserve stable identity across repeat imports.

### 8.2 County and Description Mapping

Inspect actual `<desc>` values during M01-T01.

Determine whether the approved data model should store a dedicated county field, raw source description, or both.

### 8.3 Raw Source Metadata Preservation

Determine whether the mapped source fields provide sufficient provenance or whether additional raw link metadata should be retained.

Avoid unnecessary duplication of source data.

### 8.4 Import Completeness and Rejected Records

Finalize the checks establishing that all eight source files form a complete, reliable import inventory.

Define how source records with missing or unrecognizable identifiers affect the eligibility of a run to perform retirements.

No unresolved inventory ambiguity may result in accidental retirement.

### 8.5 Geographic Warning Envelope Verification

Validate the proposed Tennessee-focused warning envelope against the actual GPX dataset during M01-T01.

Adjust it only through documented developer approval.

### 8.6 Sensitive Natural Sites

Determine whether any landmark coordinates or other information require restricted public disclosure.

This decision must be resolved before publishing potentially sensitive location information through the discovery API.

### 8.7 Database Concurrency Strategy

Select an appropriate implementation mechanism for ensuring that the approved preflight state remains valid when writes begin.

The mechanism must satisfy Section 6.7 without introducing unnecessary infrastructure or complexity.

## 9. Traceability and Approval

| Requirement or task | Specification coverage |
|---|---|
| FR-02 | Category mapping and source classification |
| FR-05 | Landmark attributes, names, metadata, provenance |
| FR-06 | Geographic coordinate correctness |
| NFR 7.4 | Source sensitivity and access-information safeguards |
| NFR 7.5 | Import integrity, idempotency, rollback, retirement |
| NFR 7.7 | Explicit contracts and automated verification |
| M01-T01 | Source inventory and data-quality verification |
| M01-T02 | Landmark data model and validation policies |
| M01-T03 | Database schema and constraints |
| M01-T04 | GPX import implementation |
| M01-T05 | Landmark retrieval data semantics |

The detailed public API contract and user-facing discovery behavior shall be defined in separate specifications.

---

**End of Specification**
