# Migration plan: core + hosts

This document breaks the roadmap ([roadmap.md](roadmap.md)) into small, self-contained
tasks with step-by-step instructions. Each task is written so it can be handed to an
AI agent (or contributor) **in isolation**: it lists the goal, the files involved,
exact steps, and acceptance criteria.

Target architecture reference: [architecture.md](architecture.md) section 6.

## How to use this plan

- Execute tasks **in order** within a phase. Tasks in later phases depend on earlier phases.
- One task = one PR-sized change. Do not combine tasks.
- Every task must leave the repository green: `node --test` passes and the add-on
  still works (`src/ui/year-view/year-view.html?dummy=1` renders in a browser).
- Do not rename or change behavior beyond what the task states.

### Global rules for every task

1. Run `node --test` from the repository root before and after your change.
2. Keep the implementation dependency-free (no npm packages, no bundler).
3. Follow existing code style: ES modules, 4-space indent, double quotes,
   `console.error("[module] message", err)` error logging.
4. Never introduce `browser.*` / `messenger.*` calls into files designated as core.
5. Update `docs/architecture.md` module list if you move or rename modules.
6. If a step is impossible as written (file drifted, symbol renamed), stop and
   report instead of improvising.

### Current file inventory (baseline, before Phase B moves)

| File | Role | Future home |
| --- | --- | --- |
| `src/ui/year-view/date-utils.js` | date calculations | `core/domain` |
| `src/ui/year-view/event-store.js` | year cache + filtering | `core/domain` |
| `src/ui/year-view/calendar-provider.js` | provider base + empty provider | `core/providers` |
| `src/ui/year-view/calendar-service.js` | active provider + ICS merge | `core/providers` |
| `src/ui/year-view/ics-calendar-provider.js` | ICS parsing provider | `core/providers` |
| `src/ui/year-view/dummy-calendar-provider.js` | sample data provider | `core/providers` |
| `src/ui/year-view/google-calendar-provider.js` | Google API provider | `core/providers` |
| `src/ui/year-view/grid-view.js` | grid rendering | `core/ui` |
| `src/ui/year-view/theme.js` | theme application | `core/ui` |
| `src/ui/year-view/year-view.css` | styles | `core/ui` |
| `src/ui/year-view/storage.js` | preference persistence | `core` (via StoragePort) |
| `src/ui/year-view/main.js` | orchestration + bootstrap (to be split) | `core/app.js` + host bootstraps |
| `src/ui/year-view/year-view.html` | entry page | add-on page in `hosts/thunderbird`, new page in `hosts/web` |
| `src/ui/year-view/ics-calendar-integration.js` | ICS upload UI + persistence | core UI module (uses StoragePort) |
| `src/ui/year-view/google-standalone-auth.js` | Google connect/logout UI | `hosts/web/ui` |
| `src/ui/year-view/google-client-id.js` | OAuth web client ID | `hosts/web` |
| `src/ui/year-view/thunderbird-calendar-provider.js` | Thunderbird experiment API provider | `hosts/thunderbird` |
| `src/background/background.js` | space/action wiring | `hosts/thunderbird` |

### Storage keys used today (all via `browser.storage.local`)

`selectedCalendarIds`, `allDayOnly`, `minDurationHours`, `calendarAllDayModes`,
`calendarMinDurationHours`, `calendarPanelExpanded`, `uiThemeOverride`,
`grayPastDays`, `highlightCurrentDay`, `refreshSettings`, `showWeekNumbers`,
`viewMode`, plus the uploaded-ICS descriptor key used by
`src/ui/year-view/ics-calendar-integration.js`.

---

## Phase A — Ports and UI slots (no file moves)

### Task A1 — Introduce the StoragePort

**Goal:** `storage.js` no longer calls `browser.storage.local` directly. All reads and
writes go through an injectable storage adapter, and the `ensureBrowserStorageBridge()`
workaround in `main.js` is deleted.

**Files:**
- create `src/ui/year-view/storage-port.js`
- modify `src/ui/year-view/storage.js`
- modify `src/ui/year-view/main.js`
- modify `src/ui/year-view/ics-calendar-integration.js` (it also persists via `browser.storage.local`)
- modify/extend `test/storage-theme.test.js`

**Steps:**
1. Create `src/ui/year-view/storage-port.js` exporting:
   - `createWebExtensionStorageAdapter()` — returns `{ get(key), set(key, value), remove(key) }`
     implemented on top of `browser.storage.local.get/set/remove`. `get` returns the raw
     stored value or `undefined` when absent (unwrap the `{ key: value }` object shape).
   - `createWebStorageAdapter({ prefix = "annualView.storage." } = {})` — same interface on
     top of `globalThis.localStorage`, JSON-serializing values with the key prefix.
     Port the logic from `ensureBrowserStorageBridge()` in `main.js` (including the
     try/catch around `JSON.parse` with `console.error("[storage-bridge] parse failed", err)`).
   - `setStorageAdapter(adapter)` and `getStorageAdapter()` — module-level active adapter.
     `getStorageAdapter()` must throw a clear error if no adapter was set.
2. In `src/ui/year-view/storage.js`, replace every `browser.storage.local.get("x")` /
   `browser.storage.local.set({ x })` pair with `getStorageAdapter().get("x")` /
   `getStorageAdapter().set("x", value)`. Keep all function names, signatures, defaults,
   and error handling exactly as they are. There are 12 load/persist pairs; the keys are
   listed above under "Storage keys used today".
3. In `src/ui/year-view/ics-calendar-integration.js`, replace its direct
   `browser.storage.local` usage with the same `getStorageAdapter()` calls.
4. In `src/ui/year-view/main.js`:
   - delete `ensureBrowserStorageBridge()` and its call
   - immediately after the query-flag setup, add adapter selection:
     if `globalThis.browser?.storage?.local` exists call
     `setStorageAdapter(createWebExtensionStorageAdapter())`,
     otherwise `setStorageAdapter(createWebStorageAdapter())`.
     (This is temporary bootstrap logic; Task A3 moves it into the host bootstrap.)
5. Update `test/storage-theme.test.js`: instead of stubbing `globalThis.browser.storage.local`,
   install a fake adapter via `setStorageAdapter({...})`. Add unit tests for both adapters:
   the WebExtension adapter unwraps `{ key: value }`, the web adapter round-trips JSON with
   the `annualView.storage.` prefix and survives corrupted JSON.

**Acceptance criteria:**
- `grep -rn "browser.storage" src/ui/year-view/` only matches `storage-port.js`.
- `node --test` passes.
- `year-view.html?dummy=1` in a plain browser still persists preferences across reload
  (check `localStorage` keys with the `annualView.storage.` prefix).

### Task A2 — Explicit provider configuration (remove globals)

**Goal:** `calendar-service.js` no longer reads `globalThis.ENABLE_DUMMY_CALENDARS` /
`ENABLE_GOOGLE_CALENDARS` or feature-detects Thunderbird. The bootstrap decides which
provider to use.

**Files:**
- modify `src/ui/year-view/calendar-service.js`
- modify `src/ui/year-view/main.js`
- modify `test/calendar-service.test.js`, `test/addon-integration.test.js` (they set the globals today)

**Steps:**
1. In `calendar-service.js`, change `createDefaultCalendarProvider()` to
   `createCalendarProvider(kind)` where `kind` is one of
   `"dummy" | "google" | "thunderbird" | "empty"`, returning the matching provider
   instance. Remove all `globalThis.ENABLE_*` reads and the
   `globalThis.browser?.calendar` feature detection from this file.
2. In `main.js`, compute the kind in the bootstrap section (where the query flags are
   parsed today):
   - `?dummy=1` (or pre-set `globalThis.ENABLE_DUMMY_CALENDARS === true`, kept for the
     test harness) → `"dummy"`
   - `?google=1` → `"google"`
   - `globalThis.browser?.calendar?.calendars?.query && globalThis.browser?.calendar?.items?.query`
     → `"thunderbird"`
   - otherwise → `"empty"`
   Then call `setCalendarProvider(createCalendarProvider(kind))`.
3. Update the tests to call `createCalendarProvider("dummy")` etc. instead of setting
   globals. Keep a test that verifies each kind maps to the right provider class and that
   an unknown kind returns `EmptyCalendarProvider`.

**Acceptance criteria:**
- `grep -rn "ENABLE_DUMMY_CALENDARS\|ENABLE_GOOGLE_CALENDARS" src/ui/year-view/calendar-service.js` is empty.
- `node --test` passes; `?dummy=1` and `?google=1` behave as before.

### Task A3 — Split `main.js` into `app.js` + bootstrap

**Goal:** Core orchestration is a reusable `app.js` with an `initApp(config)` entry point.
`main.js` shrinks to a bootstrap that builds the config (storage adapter, provider kind,
UI modules) and calls `initApp`.

**Files:**
- create `src/ui/year-view/app.js`
- modify `src/ui/year-view/main.js`
- modify `src/ui/year-view/year-view.html` only if script tags need adjusting (keep `main.js` as the module entry)

**Steps:**
1. Create `app.js` and move everything from `main.js` **except**:
   - the query-flag parsing (`queryParams`, `isTruthyQueryFlag`)
   - storage adapter selection (from Task A1)
   - provider kind selection and `setCalendarProvider` call (from Task A2)
   - the `setupGoogleStandaloneAuth` import and call (becomes a UI module in Task A4)
2. Export a single async function `initApp(config)` from `app.js` with
   `config = { uiModules?: Array<{ slot: string, mount: (container, appApi) => any }> }`
   (the `uiModules` wiring is completed in Task A4 — accept and store it now).
   `initApp` runs the current `init()` logic. The `DOMContentLoaded` listener moves to
   the bootstrap: `main.js` calls `initApp(config)` inside its own `DOMContentLoaded` handler.
3. `main.js` becomes: imports (`storage-port.js`, `calendar-service.js`, `app.js`,
   `google-standalone-auth.js` until Task A4), flag parsing, adapter + provider setup,
   then `initApp({...})`.
4. Do not change any behavior, DOM IDs, or persistence semantics.

**Acceptance criteria:**
- `main.js` is under ~80 lines and contains no rendering/filter logic.
- `app.js` contains no query-flag parsing, no `localStorage`, no provider auto-detection.
- `node --test` passes; dummy mode renders and all header/sidebar controls work.

### Task A4 — Named UI slots for host-specific UI

**Goal:** Host-specific UI (today: the Google connect button) is mounted through a
generic slot mechanism instead of being hardwired in the core init.

**Files:**
- modify `src/ui/year-view/app.js`
- modify `src/ui/year-view/main.js`
- modify `src/ui/year-view/year-view.html`
- create `test/ui-slots.test.js`

**Steps:**
1. In `year-view.html`, keep the existing mount elements but give them slot data
   attributes: `providerAuthMount` → `data-ui-slot="header-actions"`,
   `providerSidebarMount` → `data-ui-slot="sidebar-sections"`.
2. In `app.js`, during `initApp`:
   - build a map of slot name → container element from `[data-ui-slot]`
   - define `appApi = { getCalendarProvider, refreshCalendars: refreshCalendarData, applyFilterChange, eventStore }`
     (expose exactly what the current integrations need — check the current
     `setupGoogleStandaloneAuth({ mount, getProvider, refreshCalendars })` and
     `setupIcsCalendarIntegration({ mount, onCalendarsChanged })` call sites)
   - for each entry in `config.uiModules`, look up the slot container and call
     `module.mount(container, appApi)`; log a `console.error` and skip when the slot is unknown
3. Convert the Google auth wiring: remove the `setupGoogleStandaloneAuth` import/call
   from `app.js`; in `main.js`, when provider kind is `"google"` (or always in web
   context — decide: only when not running inside Thunderbird), push
   `{ slot: "header-actions", mount: (container, api) => setupGoogleStandaloneAuth({ mount: container, getProvider: api.getCalendarProvider, refreshCalendars: api.refreshCalendars }) }`
   into `uiModules`.
4. Keep `setupIcsCalendarIntegration` called from `app.js` for now (ICS upload is a
   core feature on both hosts), but route its `mount` through the
   `sidebar-sections` slot container lookup.
5. Add `test/ui-slots.test.js`: a fake DOM-less test that calls the slot-resolution
   helper with a stubbed document and asserts modules get mounted into the right
   container and unknown slots are skipped with an error log. (Extract the slot
   resolution into a small pure helper in `app.js` so it is testable — e.g.
   `resolveUiSlots(rootDocument)` and `mountUiModules(modules, slots, appApi)`.)

**Acceptance criteria:**
- `app.js` has no import of `google-standalone-auth.js`.
- With `?google=1` the connect button appears; without it, the header has no Google UI.
- `node --test` passes.

---

## Phase B — Reorganize into `src/core/` + `src/hosts/`

### Task B1 — Move core files

**Goal:** Pure `git mv` reorganization of platform-neutral files, imports updated.

**Target moves:**

| From `src/ui/year-view/` | To |
| --- | --- |
| `date-utils.js`, `event-store.js` | `src/core/domain/` |
| `calendar-provider.js`, `calendar-service.js`, `ics-calendar-provider.js`, `dummy-calendar-provider.js`, `google-calendar-provider.js` | `src/core/providers/` |
| `grid-view.js`, `theme.js`, `year-view.css` | `src/core/ui/` |
| `app.js`, `storage.js`, `storage-port.js`, `ics-calendar-integration.js` | `src/core/` |

**Steps:**
1. Use `git mv` for every file; then update all relative import paths in moved files
   and in their importers (`main.js`, `year-view.html` for the CSS link, tests).
2. Do not modify any logic. Diffs inside files must only touch import/href paths.
3. Update the module list in `docs/architecture.md` section 2.2.

**Acceptance criteria:** `node --test` passes; dummy mode renders; `git log --follow`
shows the moves as renames.

### Task B2 — Create the host shells

**Goal:** Host-specific files live under `src/hosts/`.

**Target moves/creates:**

| From | To |
| --- | --- |
| `src/background/background.js` | `src/hosts/thunderbird/background.js` |
| `src/ui/year-view/thunderbird-calendar-provider.js` | `src/hosts/thunderbird/thunderbird-calendar-provider.js` |
| `src/ui/year-view/google-standalone-auth.js` | `src/hosts/web/ui/google-standalone-auth.js` |
| `src/ui/year-view/google-client-id.js` | `src/hosts/web/google-client-id.js` |
| `src/ui/year-view/main.js` | split: `src/hosts/thunderbird/main.js` + `src/hosts/web/main.js` |
| `src/ui/year-view/year-view.html` | `src/hosts/thunderbird/year-view.html` |

**Steps:**
1. Move the files with `git mv` and fix imports.
2. Split the bootstrap: the Thunderbird `main.js` sets the WebExtension storage adapter,
   creates the Thunderbird provider (import it from the host directory, not from core),
   passes Thunderbird UI modules (currently none), and calls `initApp`.
   The web `main.js` sets the web storage adapter, parses `?dummy=1` (dev only),
   defaults to the empty provider with the Google connect UI module mounted in
   `header-actions`, and calls `initApp`.
3. `calendar-service.js` in core must no longer import
   `thunderbird-calendar-provider.js`. Change `createCalendarProvider(kind)` to also
   accept a provider **instance** or add `registerProviderFactory(kind, factory)` so
   the Thunderbird host registers its provider from the host side. Update
   `test/calendar-service.test.js` accordingly.
4. Update `manifest.json`: `background.scripts` path, and the page URL used by
   `src/hosts/thunderbird/background.js` when opening the view (search for
   `year-view.html` references in the background script).
5. Update `justfile` `build-xpi` (it copies `src` wholesale today — verify the zip
   still contains everything the manifest references) and the workflows in
   `.github/workflows/` if they reference moved paths.
6. Update `README.md` development URLs (`src/ui/year-view/year-view.html?dummy=1` →
   new paths) and `index.html` demo iframe/button links.

**Acceptance criteria:**
- `node --test` passes.
- `just build-xpi` produces an XPI; installing it in Thunderbird opens the view
  (manual check, or the existing e2e in `.github/workflows/ci-tests.yml` passes).
- The web entry renders with `?dummy=1`.
- `grep -rn "hosts/" src/core/` is empty.

### Task B3 — Boundary check test

**Goal:** An automated test fails when core purity is violated.

**Files:** create `test/core-boundaries.test.js`

**Steps:**
1. Write a `node --test` file that recursively reads every `.js` file under `src/core/`
   and asserts:
   - no occurrence of `browser.` or `messenger.` (allow comments is unnecessary — keep it strict;
     if a legitimate string literal needs it, whitelist that file+line explicitly in the test)
   - no `import` path containing `hosts/`
   - exception: `storage-port.js` is the only core file allowed to reference
     `browser.storage` and `localStorage`
2. Use only Node's `fs` and `path` modules.

**Acceptance criteria:** test passes on the clean tree and fails when you temporarily
add `browser.storage.local.get("x")` to `src/core/domain/date-utils.js` (verify, then revert).

### Task B4 — Split the test suite

**Goal:** Tests are grouped `test/core/` vs. `test/hosts/` mirroring the source layout.

**Steps:**
1. `git mv` existing tests: provider/store/date/service/ics tests → `test/core/`;
   `background-runtime.test.js`, `thunderbird-provider.test.js`, `addon-integration.test.js`
   → `test/hosts/thunderbird/`; Google standalone auth tests → `test/hosts/web/`.
   `test/fixtures/` stays shared at `test/fixtures/`.
2. Fix relative import paths.
3. Confirm `node --test` still discovers all files (it recurses `test/` by default;
   verify the count of executed tests is unchanged).

**Acceptance criteria:** same number of passing tests as before the move.

---

## Phase C — Web shell as a product

### Task C1 — Dedicated web entry page

**Goal:** `src/hosts/web/index.html` is the website app page (separate from the add-on page).

**Steps:**
1. Create `src/hosts/web/index.html` based on the add-on `year-view.html`: same core
   markup (grid, header, sidebar, `data-ui-slot` containers), loading
   `src/hosts/web/main.js` and the core CSS.
2. Remove add-on-only markup if any; add a `<noscript>` note and page metadata
   (title "Annual Calendar View", description, favicon from `icons/`).
3. Update the repository landing page `index.html` (root): demo button and iframe point
   to the new web page with `?dummy=1` for the demo.
4. Keep `?dummy=1` supported in the web bootstrap for the demo/dev harness.

**Acceptance criteria:** serving the repo root (`python -m http.server`) and opening
`/src/hosts/web/index.html?dummy=1` shows the full working view; the landing page demo works.

### Task C2 — IndexedDB storage for uploaded ICS

**Goal:** Uploaded ICS content on the web host is stored in IndexedDB (size), while
preferences stay in `localStorage`. No behavior change for the add-on.

**Files:**
- create `src/hosts/web/web-storage-adapter.js`
- modify `src/hosts/web/main.js`
- create `test/hosts/web/web-storage-adapter.test.js`

**Steps:**
1. Create a composite adapter `createWebHostStorageAdapter()` implementing the
   StoragePort interface: route the uploaded-ICS descriptor key (find the exact key
   in `src/core/ics-calendar-integration.js`) to an IndexedDB-backed store
   (database `annual-view`, object store `kv`), all other keys to the existing
   `createWebStorageAdapter()`.
2. Implement the IndexedDB wrapper with plain `indexedDB` APIs and promises;
   handle `indexedDB` being unavailable by falling back to `localStorage` with a
   `console.error` warning.
3. Migrate silently: on first `get` of the ICS key, if IndexedDB has no value but
   `localStorage` has one under the old prefix, copy it over and delete the old entry.
4. Use the composite adapter in `src/hosts/web/main.js`.
5. Test with a stubbed `indexedDB` (or fake fallback path) — Node has no IndexedDB, so
   test the routing logic and the fallback path; keep the IndexedDB wrapper thin.

**Acceptance criteria:** on the web page, uploading an ICS file persists across reload;
preference keys remain in `localStorage`; add-on behavior unchanged; `node --test` passes.

### Task C3 — Source selection UI instead of URL flags

**Goal:** On the web host, Google login is always available in the header (no `?google=1`
needed), and the empty state guides the user to connect Google or upload an ICS file.

**Steps:**
1. In `src/hosts/web/main.js`, always register the Google auth UI module in
   `header-actions`. Connecting switches the active provider to
   `GoogleCalendarProvider` (via `setCalendarProvider`) and triggers a refresh;
   logging out switches back to the empty provider. Check
   `src/hosts/web/ui/google-standalone-auth.js` — most of this logic exists; adjust
   it so provider switching happens on connect instead of at bootstrap.
2. Keep `?google=1` working as a no-op alias (it must not break existing links) and
   `?dummy=1` for the demo.
3. Add an empty-state message in the grid area when the active provider is empty and
   no ICS calendars are loaded: "Connect Google or upload an .ics file to get started."
   Implement it as a web host UI module in a new `content-empty-state` slot
   (add the slot container to `src/hosts/web/index.html` only, not to the add-on page).
4. Document the Google Cloud origin configuration for the production Pages domain in
   `docs/contributor-workflow.md` (Authorized JavaScript origins must include the
   Pages URL).

**Acceptance criteria:** fresh visit to the web page shows the empty state with a
working Connect button and ICS upload; the add-on page shows neither Google button
nor empty-state module.

### Task C4 — Year deep links

**Goal:** The web page supports `#/<year>` URLs (e.g. `#/2026`) for direct navigation
and updates the hash while scrolling/jumping.

**Steps:**
1. Implement in the web host only (`src/hosts/web/main.js` or a small
   `src/hosts/web/deep-links.js`): on load, parse `location.hash` matching
   `#/\d{4}`; if valid and within the year input min/max (1900–2999), pass it as the
   initial year to `initApp` (add an optional `config.initialYear` to `initApp`;
   default stays "current year").
2. Subscribe to year changes: `initApp` should accept an optional
   `config.onYearChange(year)` callback (wire it into the existing `onYearChange`
   handling in the grid view coordination). The web host uses `history.replaceState`
   to update the hash without polluting history.
3. Handle `hashchange` events: navigating to a new `#/<year>` jumps the view.
4. Add tests for the hash-parsing helper (pure function: input string → year or null).

**Acceptance criteria:** opening `...index.html#/2028` centers 2028; scrolling updates
the hash; back/forward does not create an entry per scroll step; add-on unaffected.

### Task C5 — Privacy note and "clear data" action

**Goal:** The web host offers a "Clear data" control and the landing page states that
all data stays in the browser.

**Steps:**
1. Create `src/hosts/web/ui/clear-data.js` UI module mounted into `sidebar-sections`:
   a button "Clear all local data" with a `confirm()` dialog that
   - calls Google logout if connected (reuse the auth controller),
   - clears all `annualView.storage.*` keys from `localStorage`,
   - deletes the IndexedDB database,
   - reloads the page.
2. Add a short privacy paragraph to the root `index.html` landing page:
   no backend, no database, calendars are read directly from Google in the browser,
   ICS files and settings are stored only locally.
3. Mention the same in `README.md` under the web section.

**Acceptance criteria:** after Clear data, `localStorage` has no `annualView.storage.*`
keys and the page loads in its fresh empty state.

### Task C6 — GitHub Pages deploy workflow

**Goal:** Pushes to `main` deploy the landing page + web app to GitHub Pages.

**Files:** create `.github/workflows/deploy-pages.yml`

**Steps:**
1. Workflow triggers: `push` to `main` and `workflow_dispatch`. Permissions:
   `contents: read`, `pages: write`, `id-token: write`.
2. Build step assembles a `_site/` directory containing only:
   root `index.html`, `icons/`, `src/core/`, `src/hosts/web/`,
   `feiertage_nrw.ics`, `ferien_nrw.ics` (sample calendars). Exclude
   `manifest.json`, `experiments/`, `src/hosts/thunderbird/`, tests, docs.
3. Use `actions/upload-pages-artifact` + `actions/deploy-pages`.
4. Verify all paths referenced from the deployed pages resolve within `_site/`
   (relative links from `index.html` to `src/hosts/web/index.html` and from there to
   `src/core/...` must keep the same relative structure — keep the repo-root-relative
   layout inside `_site/`).
5. Update the README "GitHub Pages Demo" section with the final URLs.

**Acceptance criteria:** workflow runs green on `main`; the Pages site serves the
landing page and a working app page (dummy mode demo functional).

---

## Phase D — Decoupled builds and releases

### Task D1 — Trim the XPI package

**Goal:** The XPI contains only what the add-on needs.

**Steps:**
1. Edit `justfile` `build-xpi`: copy `manifest.json`, `icons/`, `experiments/`,
   `src/core/`, `src/hosts/thunderbird/` into `dist/package` (not all of `src`,
   and not `src/hosts/web/`).
2. Verify every path referenced by `manifest.json` and by
   `src/hosts/thunderbird/year-view.html` exists inside the package
   (unzip and grep for `src/hosts/web` — must be absent).
3. Mirror the same file list in `.github/workflows/build.yml` and `release.yml`
   if they build the package independently of `just`.

**Acceptance criteria:** XPI installs and works in Thunderbird; the archive contains
no `hosts/web` files; existing linter workflow passes.

### Task D2 — Web E2E smoke test

**Goal:** A browser-based E2E validates the web shell in dummy mode in CI.

**Steps:**
1. Add a Playwright-based script under `e2e/web/` (this is the one allowed new dev
   dependency; keep it out of the runtime — no `package.json` dependencies for the
   app itself, use `npx playwright` in CI or a devDependency-only `package.json`).
2. The test: start a static file server on the repo root, open
   `/src/hosts/web/index.html?dummy=1`, assert the grid renders rows, the year input
   shows the current year, switching view mode re-renders, and the ICS upload button
   is present.
3. Add a job to `.github/workflows/ci-tests.yml` running this test on ubuntu-latest.

**Acceptance criteria:** CI job green; test fails if the web page throws during load
(assert no console errors of level error).

### Task D3 — Feature matrix documentation

**Goal:** `docs/feature-matrix.md` lists which features are core vs. host-specific.

**Steps:**
1. Create the file with a table: rows = features (view modes, year navigation, filters,
   week numbers, gray past days, highlight today, theming, ICS upload, Google login,
   Thunderbird calendars, deep links, clear data, auto refresh), columns =
   Core / Thunderbird host / Web host, cells = ✓ / – / host-specific notes.
2. Link it from `docs/architecture.md` and `README.md`.
3. Add a maintenance note: any PR adding a feature must update the matrix.

**Acceptance criteria:** matrix matches the actually shipped behavior at time of writing.

### Task D4 — Release documentation update

**Goal:** `README.md` and `docs/contributor-workflow.md` describe both release paths.

**Steps:**
1. Document: add-on release = version bump in `manifest.json` + tag → release workflow
   builds XPI (unchanged); web release = merge to `main` → Pages deploy (automatic).
2. Update the development section: how to run the web shell locally, how to run the
   add-on, where host-specific code lives, and the core boundary rules.
3. Remove outdated references to the old `src/ui/year-view/` layout everywhere in the
   docs (`grep -rn "ui/year-view" README.md docs/ AGENT.md index.html`).

**Acceptance criteria:** no stale paths in docs; a new contributor can follow the
README to run both targets.

---

## Task dependency overview

```
A1 ─→ A3 ─→ A4 ─→ B1 ─→ B2 ─→ B3
A2 ─→ A3              B2 ─→ B4
B2 ─→ C1 ─→ C3 ─→ C5
      C1 ─→ C4
A1 ─→ C2 (needs StoragePort; file locations from B2)
C1 ─→ C6 ─→ D2
B2 ─→ D1
C-phase done ─→ D3, D4
```
