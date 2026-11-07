# M02-T08 — Manual Physical-Keyboard Verification Checklist

**Status:** Executed by the developer on 2026-11-07 in a normal, foreground browser window with a physical keyboard (dev server + synthetic mock API). Results are recorded in `docs/IMPLEMENTATION_PLAN.md` under M02-T08's "Manual physical-keyboard verification results": sections A–E and G passed or are covered; section F (focus restoration after a marker disappears) was not manually tested and remains verified by automated tests only. The checklist is kept for re-use in future accessibility passes (M07-T03) and for Firefox/Safari verification, which remains a recorded follow-up.

**What this adds beyond the automated checks:** every step below has already passed under automated Chromium with trusted (CDP) keyboard input on the production build (Playwright specs `keyboard-panning`, `keyboard-workflow`, `popup-backward-navigation`, `marker-focus-on-results-update`, `accessibility`). Automated input cannot prove how a real foreground window, a real keyboard, and real OS focus behave together — that is the gap this checklist closes. It is deliberately a check of behaviour the automation *claims*, so a difference you observe is a finding, not a mistake on your part.

## Setup (once)

1. Start the local database (`docker compose up -d`), then the backend and the frontend dev server as usual, **or** run the production build via the backend. Either is fine; note which you used.
2. Real `PUBLIC` landmarks do not exist yet (classification policy unresolved), so the map will show **no markers** against real data. To exercise marker steps, use one of:
   - the synthetic-fixture mock API used during M02-T08 verification (serves five `PUBLIC` fixtures on port 3000 for the dev server to proxy), or
   - a browser devtools network override that returns a few `PUBLIC` items for `GET /api/v1/landmarks?bbox=…`.
   Do **not** change any real landmark's classification or the development database.
3. Use Chrome or Edge for this pass (Firefox/Safari remain a separate, recorded follow-up). Make sure the browser window is the **foreground** window and click once on page text so the window definitely has focus.

Record each step as **Pass / Fail / Could not test**, with a note for anything unexpected.

## A. Skip links

| # | Step | Expected |
|---|---|---|
| A1 | From the top of the page press **Tab** until "Skip to landmarks on the map" appears (it is visually hidden until focused). Press **Enter**. | Focus moves to the "Landmarks on the map" heading below the map (a focus ring on the heading). You skipped the map and every marker. |
| A2 | Reload. Tab to "Skip to name search results". Press **Enter**. | Focus moves to the "Name search results" heading. |
| A3 | After A1, press **Tab** once. | Focus goes into the geographic results list (a landmark link), **not** back to the map. |

## B. Map keyboard panning

| # | Step | Expected |
|---|---|---|
| B1 | Reload. Tab until the **map itself** has focus (a focus ring around the whole map; the URL shows `lat`/`lng`/`zoom`). | Map container focused. |
| B2 | Press **→** (ArrowRight), then **↓** (ArrowDown). | The map pans east, then south, with a short animation; the URL `lng` increases, then `lat` decreases. |
| B3 | Press **+** then **−**. | The map zooms in, then out. |
| B4 | Click a neutral control outside the map (e.g. "Find near map center") so it has focus, then press the arrow keys. | The map does **not** move. |
| B5 | Tab onto a **marker** (B-section step C1) and press the arrow keys. | The map does **not** move (arrows pan only when the map container itself is focused). Note whether this surprised you — it feeds the keyboard-instructions decision. |

## C. Marker focus and activation

| # | Step | Expected |
|---|---|---|
| C1 | From the focused map container press **Tab**. | Focus moves to the first marker: a clear blue ring with a white halo around a 24px area centred on the dot. A screen reader (if running) would say the landmark name and category, as a button. |
| C2 | Press **Tab** repeatedly. | Each marker in turn gets the ring, in result order; the map scrolls to keep the focused marker in view; a focused marker overlapping another is drawn on top. After the last marker focus goes to the "+" zoom control. |
| C3 | On a marker press **Enter**. | Its popup opens showing name, category, and "View profile"; focus moves **into** the popup (ring around the popup text). |
| C4 | Press **Escape**. | Popup closes; focus is back on the same marker (ring visible). |
| C5 | Press **Space**. | Popup opens as in C3 and the **page does not scroll**. Press **Escape** to close. |

## D. Popup navigation and dismissal

| # | Step | Expected |
|---|---|---|
| D1 | Open a popup (Enter). Press **Tab**. | Focus moves to "View profile". |
| D2 | Press **Tab** again. | Focus moves to the popup's "×" close button (ring visible). |
| D3 | Press **Enter** on the close button. | Popup closes; focus returns to the originating marker. |
| D4 | Open the popup again; Tab to "View profile"; press **Enter**. | The landmark profile page opens. Press **Tab** to "Back to Discover", press **Enter**. | The discovery page returns with the same map position, search text, and filters as before. |
| D5 | Open a popup; Tab to the close button; press **Escape**. | Popup closes; focus returns to the originating marker. |
| D6 | Open a popup, Tab to the close button, press **Tab** once more. | Focus leaves the popup to the "+" zoom control; the popup stays open. (No trap.) |

## E. Shift+Tab from inside a popup

| # | Step | Expected |
|---|---|---|
| E1 | Open the popup of a marker that is **not** the last one (e.g. the first). With focus in the popup text (just after Enter), press **Shift+Tab**. | Focus returns to **that marker** (not the last marker on the map); the popup **stays open**. |
| E2 | Press **Shift+Tab** again. | Focus moves to the previous marker (or, from the first marker, to the map container). |
| E3 | Open the popup, press **Tab** to "View profile", then **Shift+Tab**. | Focus returns to the originating marker; popup stays open. |
| E4 | Open the popup, Tab twice to the close button, then **Shift+Tab**. | Focus moves to "View profile" (normal order inside the popup is unchanged). |
| E5 | After E1, press **Escape**. | Popup closes; focus stays on the marker. |

## F. Focus restoration after a geographic result change

| # | Step | Expected |
|---|---|---|
| F1 | Type a letter into "Search landmarks by name", then **quickly** (within about a second) Tab/Shift+Tab onto a marker that will **not** match the filter, and wait. | When the results update removes that marker, focus lands on the "Landmarks on the map" heading — never on the page body (pressing Tab afterwards continues from that heading, not from the top of the page). |
| F2 | Same, but open that marker's popup (Enter) before the update arrives. | Popup disappears with the marker; focus lands on the "Landmarks on the map" heading. |
| F3 | Type a filter that matches **nothing** on the map while a marker is focused. | Markers disappear, the "No publicly viewable landmarks are currently shown on the map" message shows, focus is on the heading. |
| F4 | Type a filter and simply **stay in the search box**. | Results update; focus stays in the search box (nothing steals it). |

## G. Non-map results

| # | Step | Expected |
|---|---|---|
| G1 | Tab through the "Landmarks on the map" list. | Each landmark is a link reachable by Tab, showing name and category (and straight-line distance in proximity mode). |
| G2 | Tab into "Search landmarks by name", type a name fragment, Tab onward. | The "Name search results" links are reachable; Enter opens a profile. |

## H. Record

Note your browser and version, the date, each step's result, and anything you noticed that the automated checks could not have (visual glitches, unexpected scrolling, focus rings that were hard to see on busy map areas, screen-reader output if you had one running). Add the summary to the M02-T08 Increment 5d record in `docs/IMPLEMENTATION_PLAN.md`.
