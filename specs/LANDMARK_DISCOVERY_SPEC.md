# Tennessee Natural Landmarks Explorer
## Specification 2 — Landmark Discovery, Search, Filtering, and Profiles

**Status:** Approved — October 29, 2026. Sensitive-location classification criteria and initial dataset classification remain unresolved and release-blocking (see §9.5).  
**Version:** 1.0 — October 29, 2026  
**Requirements:** FR-01 through FR-06  
**Dependencies:** Approved Landmark Data and GPX Import Specification v0.3; ADR-001, ADR-002, ADR-003, ADR-004, ADR-009

**Amended:** November 2, 2026 — added §9.4a (minimal redacted profiles for active, non-public landmarks) and the corresponding updates to §6, §7.3, §9.5, and §10, approved during M01-T05 planning. This amendment establishes redaction *mechanics* only; the underlying sensitive-location classification criteria and initial dataset review remain unresolved and release-blocking, unchanged by this amendment (see §9.5).

---

## 1. Purpose and Scope

Provide a usable, accessible way to discover Tennessee natural landmarks on an interactive map and in an equivalent list, narrow results by name and category, explore a geographic area, and view a landmark's available source-derived details.

**In scope:** initial discovery view; map markers; category selection; case-insensitive partial-name search; map-area discovery; landmark list; landmark profiles; proximity discovery; loading, empty, and error states; keyboard and screen-reader access; API behavior and verification.

**Out of scope:** account creation, favorites, reviews, trip planning, offline downloads, turn-by-turn navigation, verified trail routing, public-access guarantees, and route optimization. Those features belong to other specifications.

Only active landmarks are included in public discovery by default. Sensitive-location disclosure remains a release-blocking policy decision where relevant (see §9).

## 2. Approved Product Decisions

The developer approved the following on October 29, 2026:

1. **Search:** case-insensitive partial matching against the landmark display name.
2. **Categories:** users may select multiple categories simultaneously.
3. **Map movement:** panning or zooming does **not** automatically fetch new results; offer an explicit **“Search this area”** action.
4. **Profile return:** returning from a landmark profile preserves search text, category selections, map position/zoom, and discovery context.

These are binding requirements for this draft. They must not be silently changed during implementation.

## 3. Discovery Experience (FR-01, FR-02)

### 3.1 Initial View

- Show an interactive Leaflet map centered on a useful Tennessee-wide extent, accompanied by a landmark results list.
- Display clear controls for search, category filters, and proximity discovery.
- Initial results must be bounded; the application must not request or render all landmarks as an unbounded marker collection on every view change.
- The map and list represent the same current result set and filtering state.
- Each map marker and list item identifies the landmark and allows opening its profile.
- Provide a visible count for the current results and disclose when the result set is limited or paginated.
- The initial map uses a documented Tennessee-wide viewport and the same maximum 200-item collection response as subsequent queries; it must disclose truncation and invite zooming/filtering.

### 3.2 Map Interaction

- Users can pan and zoom using supported pointer and keyboard interactions.
- After a meaningful map extent change, show **“Search this area”**. Until activated, preserve the currently loaded results and make clear they reflect the previously searched area.
- Activating the action searches the current visible map extent using the existing name/category filters, updates the map and list together, and clears the pending-area indicator.
- Changing name or category filters executes a new search against the **last committed search area**, not an uncommitted panned extent. The UI must make that distinction understandable.
- Opening and returning from a profile must not silently reset the last committed search area or the map viewport.
- Avoid overlapping requests replacing newer results: stale responses must be ignored or cancelled.

### 3.3 Accessible List Alternative

- The list must support all essential discovery tasks without requiring interaction with map markers.
- Each result has a descriptive accessible name and a keyboard-operable link or button to open the profile.
- Map-only information needed to choose a landmark must also appear in the list or profile.
- Focus indicators, landmarks/headings, form labels, and result status announcements shall target WCAG 2.2 AA.
- The list remains usable if the map or tile provider fails.

## 4. Search and Category Filtering (FR-03, FR-04)

### 4.1 Name Search

- Search uses case-insensitive partial matching against the stored **display name**.
- Trim leading/trailing whitespace in the query; an empty or whitespace-only query means no name restriction.
- Treat user input as literal text, not a SQL wildcard or regular expression. `%` and `_` entered by users must not unexpectedly broaden results.
- Search must be parameterized and bounded, with input length limits and stable result ordering.
- Display names are derived according to approved Specification 1: `<cmt>` preferred, with `<name>` fallback.
- Searching by source code, county, or fuzzy similarity is **not** implicitly included; those require separate approval.

### 4.2 Categories

- Present the eight source-derived categories: natural arches, mountain balds, waterfalls, lakes, other natural features, mountain peaks, rock formations, and sinkholes.
- Multiple categories can be active concurrently; matching any selected category qualifies a landmark, subject to other filters.
- No categories selected means **all categories** (not zero results). This default must be explained by the UI.
- Filters combine with name search and geographic constraints using AND semantics.
- Each category has a text label; color and marker shape alone must not communicate category.
- A clear/reset action returns search and category filters to defaults without changing the map viewport unless explicitly requested.

### 4.3 Results and Ordering

- The API must provide deterministic ordering and stable pagination or an explicit capped result set.
- Map and list must remain consistent for the current query, including when limits apply.
- A result limit must never be presented as the total number of matching landmarks unless the server separately computes that total.
- Default non-proximity ordering is display name ascending, then internal ID ascending for deterministic ties. Default proximity ordering is geodesic distance ascending, then display name and internal ID ascending. Each collection page has at most 200 records. The map displays the current page of results, never silently implying that all matches are displayed. The accessible list offers explicit next/previous page controls; a response indicates whether more results exist. When more matches exist, show a visible “Showing up to 200 results; zoom in or refine filters” notice (or the corresponding page range).

## 5. Geographic and Proximity Discovery (FR-06)

### 5.1 Map-Bounds Search

- The client submits the committed map bounding box in WGS84 longitude/latitude coordinates.
- The server validates coordinate ranges, rejects malformed or impossible bounds, and applies the bounds filter in PostGIS.
- Queries must be bounded and indexed where appropriate.
- Correctly handle or explicitly reject antimeridian-crossing bounds with a documented response; do not silently invert coordinates.
- Geographic filtering uses landmark coordinates, not assumptions about trailheads or accessible routes.

### 5.2 Proximity Search

Two explicit proximity origin modes are supported:

1. **Find near map center:** A visible crosshair identifies the current map center. Activating the button uses that center as the proximity origin. The origin is captured when the user presses the button; merely panning does not trigger a search.
2. **Near me:** A separate optional button invokes `navigator.geolocation.getCurrentPosition` only after the user's action. Browser permission denial, timeout, or unavailable geolocation leaves existing results intact and offers the map-center alternative.

Only one proximity origin is active at a time. Changing origin replaces the prior origin rather than combining them. A user can exit proximity mode and return to geographic-area discovery.

- Default radius: **25 miles**; allowed choices: **5, 10, 25, 50, 100 miles**.
- Miles are the primary UI unit; also show kilometer equivalents (1 mile = 1.609344 km). The API accepts radius in miles and converts for PostGIS calculations.
- Results are sorted by straight-line/geodesic distance ascending, not driving, hiking, or trail distance. Distance labels must explicitly say straight-line distance.
- A proximity request uses `near` and `radius`, **not `bbox`**. Map-area searches use `bbox`, not `near`/`radius`. Name and category filters apply to either mode.
- The origin must be finite, globally valid WGS84 coordinates, and the radius must match an allowed value.
- No third-party address geocoding or place lookup is included in this phase.
- Precise device location is not saved in the application's database, analytics, or server logs. The origin is sent to the server only to execute the requested query. Device-derived origins are not placed in shareable URLs by default; reloading a device-location search requires the user to request location again. Manually chosen map-center origins may be represented in URL state.

## 6. Landmark Profiles (FR-05)

- Each active, publicly disclosable landmark has a stable profile route based on its internal database ID or another explicitly approved stable public identifier.
- An active landmark that is not yet publicly disclosable (`UNREVIEWED` or `SENSITIVE`) also has a reachable profile route, but returns only the minimal redacted profile defined in §9.4a, never the full profile described below.
- Show the display name, category, and location information supported by the imported data.
- Show optional county/description and land-manager/access-label metadata only when present and accurately mapped.
- A source URL is clickable only if the importer validated an actual URL; plain access labels are not converted into links.
- Include an appropriate map location representation when permitted by the sensitive-site policy.
- Explain that coordinates and labels do not establish public access, legal entry, maintained trails, or safety.
- Do not fabricate descriptions, photographs, elevations, trail routes, or opening hours.
- Missing optional fields are omitted or clearly marked unavailable; never show placeholder facts.
- A profile opened from discovery offers a return path that preserves the discovery search, filters, map viewport, and results context. Direct profile visits must also work without prior discovery state.
- A missing or retired landmark must not leak private location details; use the approved generic not-found/unavailable behavior (§9.4). An active, non-public landmark instead returns the minimal redacted profile (§9.4a), which likewise must not leak private location details.

## 7. API Contract and Security Expectations

Public discovery is read-only and requires no authentication. The following versioned endpoints are required:

| Endpoint | Contract |
|---|---|
| `GET /api/v1/landmarks` | Filtered, ordered, paginated collection |
| `GET /api/v1/landmarks/:id` | One landmark by stable internal UUID: full profile if active and `PUBLIC`; minimal redacted profile (§9.4a) if active and `UNREVIEWED`/`SENSITIVE`; generic `404` if unknown or inactive |
| `GET /api/v1/categories` | The eight category slugs and human-readable labels |

### 7.1 Collection Query Parameters

- `q`: optional literal case-insensitive display-name substring; trim surrounding whitespace; maximum **100 characters** after trimming.
- `categories`: optional comma-separated category slugs; unknown or duplicate slugs are rejected with a controlled `400` response. Absence or empty value means all categories.
- `bbox`: optional `minLng,minLat,maxLng,maxLat` in WGS84 decimal degrees; require min values less than max values; reject antimeridian-crossing boxes in this version with `400` and a clear message.
- `near`: optional `lat,lng` in WGS84 decimal degrees.
- `radius`: required with `near`; numeric miles, restricted to **5, 10, 25, 50, 100**. Reject radius without near, near without radius, or near combined with bbox.
- `page`: optional positive integer, default **1**.
- `limit`: optional integer from **1 through 200**, default **200**.

All query parameters are validated server-side. Unknown query parameter names, invalid values, or malformed identifiers return `400` with a consistent error body. SQL wildcard characters in `q` are treated literally. All filters use parameterized SQL, with PostGIS queries isolated in the data-access layer per ADR-003.

### 7.2 Collection Response Shape

A successful collection response has the following stable top-level fields:

```json
{
  "items": [],
  "page": 1,
  "limit": 200,
  "has_more": false,
  "is_truncated": false
}
```

`items` contains at most `limit` landmarks. Each item includes `id` (UUID), `display_name`, `category`, `latitude`, and `longitude`, plus `distance_miles` only in proximity mode. Coordinates are included only when permitted by the sensitive-location policy.

`has_more` means another page of matches exists. `is_truncated` is true when the query has more than 200 matches, even if the requested page is not the first; this describes the **full query result set**, not the current page size. Implement this accurately using an efficient bounded count or lookahead strategy; do not infer it merely because 200 rows were returned. The client must not label the returned page count as the total matching count.

Pages use deterministic ordering: `display_name ASC, id ASC` for ordinary discovery, or `distance ASC, display_name ASC, id ASC` for proximity. The list can page through results; map markers reflect only the currently loaded page. Changing query filters resets pagination to page 1.

### 7.3 Detail, Categories, and Errors

- A full detail response (active, `PUBLIC` landmarks only) includes the same public identity, display name, category, and permitted coordinates, plus available approved source metadata. Do not fabricate optional fields.
- An active, non-public (`UNREVIEWED` or `SENSITIVE`) landmark ID returns `200` with the minimal redacted profile defined in §9.4a instead of the full detail response, and instead of `404`.
- Unknown or retired landmark IDs return `404` without exposing protected coordinates, per §9.4.
- Category objects have stable `slug` and `label` fields; final slug enumeration must match the approved data schema and be shared with the frontend.
- Errors use `{ "error": { "code": "INVALID_QUERY", "message": "..." } }` with a stable machine-readable code and a safe user-facing message. Never expose SQL, stack traces, or internal paths.
- All endpoints must apply the eventual sensitive-location policy before release; this specification does not approve public disclosure of every imported coordinate.

## 8. Loading, Failure, and Accessibility Requirements

- **Loading:** show progress without clearing useful prior results prematurely; prevent ambiguous multiple submissions.
- **No results:** explain that no landmarks match and offer an obvious way to adjust filters or search area.
- **Invalid input:** show an actionable, accessible message and do not send invalid requests.
- **API error:** show retry capability; retain the user's query and filters.
- **Map tile failure:** preserve usable list search and profile navigation.
- **Geolocation denied/unavailable:** provide a non-geolocation alternative.
- **Slow networks:** prevent stale responses from overwriting newer searches.
- **Responsive layout:** map, list, and controls must work on mobile and desktop without requiring hover.
- **Keyboard/screen readers:** meaningful control names, visible focus, appropriate status announcements, and no map-only essential workflow.

## 9. Resolved Decisions and Remaining Approval Gates

### 9.1 Proximity Origin — Resolved

Support **Find near map center** with visible center crosshair and optional **Near me** using browser geolocation only on user request. Do not add address geocoding in this phase. Modes are mutually exclusive; permission failures preserve existing results.

### 9.2 Radius and Units — Resolved

Default 25 miles; choices 5, 10, 25, 50, and 100 miles. Show miles as primary and kilometers as supplemental. API radius units are miles.

### 9.3 Ordering and Limits — Resolved

Ordinary results sort by display name ascending; proximity by distance ascending. Stable ID breaks ties. Server `limit` defaults to 200 and cannot exceed 200. The map shows only the current result page; the accessible list supports pagination. `has_more` and `is_truncated` disclose additional matches accurately, with prompts to zoom or refine filters.

### 9.4 Retired Landmark Profiles — Resolved

A retired or otherwise unavailable landmark profile displays a generic unavailable page: the heading **"Landmark unavailable"** and the explanatory text **"This landmark is no longer available in the explorer."** This page must not expose the landmark's name, coordinates, county, description, or other historical location metadata. The underlying API response remains the generic `404` defined in §7.3.

### 9.4a Minimal Redacted Profile for Active Non-Public Landmarks — Resolved (Amended November 2, 2026)

Applies only to a landmark that is `isActive: true` and whose `sensitivityStatus` is `UNREVIEWED` or `SENSITIVE` (i.e., active but not yet publicly disclosable). This is distinct from, and takes precedence over, the generic `404` behavior in §9.4/§7.3, which continues to apply unchanged to unknown or retired/inactive landmark IDs.

- **Response:** HTTP `200`. The body is an explicit allowlist containing exactly these fields and no others:
  - `id`
  - `display_name`
  - `category`
  - `redacted`: `true`
- Every other field — `sensitivityStatus` itself, coordinates, `sourceDescription`, `sourceAccessLabel`, `sourceUrl`, distance, or any other database column — is never present in this response, with no exceptions.
- The `redacted: true` flag is present so a client can distinguish "this profile is intentionally minimal" from "this optional field happened to be empty," rather than inferring redaction from absent keys.
- This section establishes only the redaction *mechanics* for landmarks that have not yet been classified `PUBLIC`. It does not decide, or depend on resolving, the sensitive-location classification criteria themselves — those remain unresolved and release-blocking per §9.5. `id`, `display_name`, and `category` are hereby established as the permitted public discovery fields for active `UNREVIEWED` and `SENSITIVE` landmarks, consistent with the "permitted non-location discovery" principle already approved for collection search (§4.1, §4.2).

### 9.5 Sensitive-Location Disclosure — Release-Blocking

A separate approved policy must determine whether any source landmarks are excluded, obscured, or restricted. No implementation or release may assume all coordinates are public solely because they appear in source GPX files. Collection and detail endpoints must apply the same policy. (§9.4a establishes the interim redaction mechanics for landmarks pending that classification; it is not itself the classification policy.)

### 9.6 Discovery State Persistence — Resolved

Use canonical URL query parameters for search text (`q`), category slugs (`categories`), viewport center (`lat`, `lng`), zoom (`zoom`), and committed map bounds (`bbox`), plus non-sensitive proximity settings (`mode`, `radius`, and map-center origin when applicable). Use browser history and router integration to restore controls, viewport, committed search area, and query results after profile return, browser Back/Forward, and page refresh. Do not serialize precise device-geolocation origins into URLs automatically.

Use `replaceState` for debounced typing and frequent viewport changes; use `pushState` for meaningful committed navigation such as **Search this area**, changing search mode, or opening a profile. A pending uncommitted viewport and committed search bounds must remain distinguishable. Validate URL parameters before issuing requests and normalize malformed or unsupported values to safe defaults with an accessible notice.

### 9.7 Search Timing — Resolved

Text input triggers search after **300 ms** without typing; category changes trigger immediately. A clear **X** button empties text and immediately updates results. Reset pagination to page 1 after filter changes. Abort or ignore stale requests; do not allow an older response to overwrite a newer query. Search changes use the last committed geographic bounds until **Search this area** is activated.

### 9.8 API Routes and Fields — Resolved With Schema Dependency

Use `GET /api/v1/landmarks`, `GET /api/v1/landmarks/:id`, and `GET /api/v1/categories`, with the validated query and response contracts in §7. The stable public detail identifier is the internal UUID. The final eight category slugs must be aligned with the approved database schema before implementation.

## 10. Acceptance Criteria and Test Coverage

1. A user can discover active, publicly disclosable landmarks on both map and list.
2. Case-insensitive partial-name search finds matching display names; whitespace-only search removes the name filter.
3. Literal `%` and `_` input does not act as unintended SQL wildcard syntax.
4. Selecting two or more categories returns the union of those categories, intersected with the other filters.
5. Clearing all category selections restores all categories.
6. Moving the map exposes **“Search this area”** without automatically replacing results.
7. Clicking **“Search this area”** commits the new bounds and updates map and list consistently.
8. Filters changed before a pending-area search use the last committed bounds, with no hidden geographic switch.
9. Opening a landmark profile and returning preserves search, categories, map viewport, and discovery context.
10. Direct navigation to a valid landmark profile works without prior discovery navigation.
11. Missing optional GPX metadata does not produce invented facts or broken links.
12. Public collection results omit retired (inactive) landmarks entirely. Active, non-public (`UNREVIEWED`/`SENSITIVE`) landmarks remain discoverable by name/category (permitted non-location discovery) but never expose coordinates, distance, or other restricted fields — per the approved default-deny policy and §9.4a. Whether any landmark is excluded from discovery altogether remains governed by the separate, unresolved classification policy (§9.5).
13. Invalid bounds, coordinates, category values, and pagination parameters return controlled errors.
14. Proximity distance is correct against a real PostGIS test database and is labeled as straight-line distance.
15. Rapid successive requests do not let older responses overwrite newer results.
16. The list remains usable with keyboard and screen reader when the map is unavailable.
17. Mobile and desktop smoke tests cover search, filters, map-area action, profile navigation, and return state.
18. Tests cover empty results, API failure, loading state, and geolocation permission denial.
19. Map-center proximity uses the crosshair center; Near me requests permission only after explicit user action, and denial preserves prior results.
20. Radius choices, mile-to-kilometer labels, geodesic ordering, and `near`/`bbox` mutual exclusion are tested.
21. Collection responses never exceed 200 items; `has_more` and `is_truncated` are accurate at 199, 200, and 201 matching records, and pagination retrieves later records.
22. URL refresh, direct links, browser Back/Forward, and profile return restore canonical discovery state; device location is not written into shareable URLs.
23. Debounced text input, immediate category changes, clear-X behavior, and stale-request cancellation are tested.
24. All three versioned REST endpoints validate parameters and return consistent response/error shapes.
25. An active, non-public (`UNREVIEWED`/`SENSITIVE`) landmark's detail route returns exactly the §9.4a allowlist (`id`, `display_name`, `category`, `redacted: true`) with `200`, and no other field — tested as an explicit allowlist assertion, not merely "coordinates absent". Unknown and inactive landmark IDs continue to return the identical generic `404` envelope (byte-for-byte), both to each other and regardless of what the underlying landmark's real data is.

**Testing approach:** Vitest for search/filter/state logic, React Testing Library for accessible UI interactions, Supertest for API validation, real PostgreSQL/PostGIS integration tests for geographic queries, and Playwright for end-to-end discovery and profile-return smoke tests, consistent with ADR-009.

## 11. Traceability and Approval Gate

| Requirement | Covered behavior |
|---|---|
| FR-01 | Map and list landmark discovery |
| FR-02 | Eight landmark categories and category presentation |
| FR-03 | Partial-name search |
| FR-04 | Multi-select category filters and combined query semantics |
| FR-05 | Landmark profiles and source-data integrity, including minimal redacted profiles for active non-public landmarks (§9.4a) |
| FR-06 | Geographic bounds and proximity discovery |

---

**End of Specification**
