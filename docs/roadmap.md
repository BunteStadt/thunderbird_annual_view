# Core + hosts roadmap

## Status summary (as of 2026-07-31)

### What was completed

All four phases were worked through in two agent sessions. The overall
`src/core/` + `src/hosts/` target architecture is **fully in place**:

**Phase A — Ports and UI slots** ✅ complete

- A1: `StoragePort` introduced; `storage.js` and `ics-calendar-integration.js`
  no longer call `browser.storage.local` directly; both
  `createWebExtensionStorageAdapter()` and `createWebStorageAdapter()` exist in
  `src/core/storage-port.js`; `ensureBrowserStorageBridge()` deleted.
- A2: Provider selection extracted from `calendar-service.js`; global flags
  (`ENABLE_DUMMY_CALENDARS`, `ENABLE_GOOGLE_CALENDARS`) removed; explicit
  `createCalendarProvider(kind)` factory used by each host bootstrap.
- A3: `main.js` split into `src/core/app.js` (orchestration, `initApp(config)`)
  and thin host bootstraps.
- A4: Named UI slots (`data-ui-slot`) introduced; Google auth and ICS upload
  UI are mounted through the slot mechanism; `app.js` has no host imports.

**Phase B — Reorganize into `src/core/` + `src/hosts/`** ✅ complete

- B1: All platform-neutral files moved to `src/core/domain/`, `src/core/providers/`,
  `src/core/ui/`, `src/core/`.
- B2: Host shells created: `src/hosts/thunderbird/` (background, main,
  Thunderbird provider) and `src/hosts/web/` (main, web storage adapter, deep
  links, UI modules). Both host documents mount the shared `src/core/ui/view-shell.js`.
- B3: `test/core/core-boundaries.test.js` asserts no `browser.*` or `hosts/`
  imports in `src/core/`; runs in CI.
- B4: Test suite split into `test/core/` and `test/hosts/thunderbird/` and
  `test/hosts/web/`.

**Phase C — Web shell as a product** ✅ complete

- C1: `src/core/ui/view-shell.js` provides the shared calendar markup for web and Thunderbird host pages.
- C2: `src/hosts/web/web-storage-adapter.js` — composite adapter routing the
  ICS descriptor key to IndexedDB, all other keys to `localStorage`.
- C3: Google connect always available in the web header (no `?google=1` needed);
  `src/hosts/web/ui/empty-state.js` guides users to connect or upload.
- C4: `src/hosts/web/deep-links.js` handles `#/<year>` deep links.
- C5: `src/hosts/web/ui/clear-data.js` "Clear all local data" action;
  privacy paragraph added to the landing page `index.html`.
- C6: `.github/workflows/deploy-pages.yml` deploys landing page + web app to
  GitHub Pages on every push to `main`.

**Phase D — Decoupled builds and releases** ⚠️ partially complete

- D1: `justfile` and `.github/workflows/build.yml` updated to package only
  `src/core/` + `src/hosts/thunderbird/` + `experiments/` + `assets/icons/` in the
  XPI — `src/hosts/web/` is excluded. ✅
- D2: Browser-based web E2E (Playwright, `test/e2e/web/`) **not done**.
- D3: Feature matrix (`docs/feature-matrix.md`) **not done**.
- D4: Release documentation update in `README.md` and `docs/contributor-workflow.md`
  for both release paths (add-on tag → XPI; merge to `main` → Pages) **not done**
  (old `src/ui/year-view/` paths may still appear in docs).

### What is still open

1. **D2 — Web E2E smoke test** (see `migration-plan.md` Task D2)
  Add a Playwright test under `test/e2e/web/` that opens the web shell in dummy mode
   and asserts the grid renders, the year input is correct, and view-mode switching
   works.  Add the CI job to `.github/workflows/ci-tests.yml`.

2. **D3 — Feature matrix** (see `migration-plan.md` Task D3)
   Create `docs/feature-matrix.md` listing which features are core vs.
   Thunderbird-host-specific vs. web-host-specific.

3. **D4 — Release documentation update** (see `migration-plan.md` Task D4)
   Update `README.md` and `docs/contributor-workflow.md` to document both release
   paths and remove all stale `src/ui/year-view/` path references:
   `grep -rn "ui/year-view" README.md docs/ AGENT.md index.html`

4. **Manual verification**
   The add-on has not been manually verified in Thunderbird since the
   reorganization.  The existing Thunderbird E2E in
   `.github/workflows/ci-tests.yml` should be run (or the add-on tested manually)
   to confirm the new host layout works end-to-end.

---

> This roadmap supersedes the earlier monorepo (`apps/` + `packages/`) proposal.
> The decided target is a single lightweight repository with `src/core/` + `src/hosts/`
> as described in [architecture.md](architecture.md) section 6.
> Detailed, task-level instructions live in [migration-plan.md](migration-plan.md).

## 1. Goal

The repository delivers the same annual calendar experience as two products in parallel:

- a **Thunderbird add-on** (XPI, Thunderbird calendars via experiment APIs)
- a **website** (static GitHub Pages deployment, **no backend and no database**;
  Google calendars are fetched directly from the browser, ICS imports and
  preferences are stored client-side)

Both products consume the same platform-neutral core. Platform-specific code is
limited to two thin host shells that provide ports (storage, calendar source,
host behavior) and host-specific UI modules mounted into named core slots.

The migration is incremental: the add-on stays fully functional after every phase.

## 2. Current baseline

The codebase already contains the main ingredients for reuse:

- a provider pattern (`calendar-provider.js` + Thunderbird/Google/ICS/dummy/empty
  implementations) behind a uniform `fetchCalendars()` / `fetchCalendarEvents()` interface
- DOM-free domain logic (`event-store.js`, `date-utils.js`) covered by `node --test`
- a standalone HTML page (`year-view.html?dummy=1` / `?google=1`) that already acts
  as a web harness
- an early mount-point pattern (`providerAuthMount`, `providerSidebarMount`) for
  provider-specific UI

The main blockers are:

- `main.js` mixes app orchestration with host bootstrap concerns
  (query flags, storage bridging, provider selection, Google auth wiring)
- `storage.js` is bound directly to `browser.storage.local`
- platform detection happens implicitly via globals
  (`ENABLE_DUMMY_CALENDARS`, `ENABLE_GOOGLE_CALENDARS`) and feature detection
- there is no separate build/deploy path for the website

## 3. Migration phases

### Phase A — Introduce ports and UI slots (no file moves)

Objectives:

- put a `StoragePort` behind `storage.js` with two adapters
  (WebExtension storage; web client storage)
- lift provider selection out of the core into explicit host configuration
- split `main.js` into core orchestration (`app.js`) and a host bootstrap
- generalize the existing mount points into named UI slots that hosts fill
  with their own UI modules

Deliverables: ports defined and used, no behavior change, all tests green.

### Phase B — Reorganize into `src/core/` + `src/hosts/`

Objectives:

- move files into `core/domain`, `core/providers`, `core/ui`,
  `hosts/thunderbird`, `hosts/web` (pure moves + import updates)
- split tests into core tests and host tests
- enforce the boundary rules (no `hosts/` imports and no `browser.*` in `core/`)
  with an automated check

Deliverables: new layout, updated manifest/build paths, boundary check in CI.

### Phase C — Build the web shell into a product

Objectives:

- dedicated web entry page under `src/hosts/web/` (no query-flag reuse of the add-on page)
- client-side persistence: preferences in `localStorage`, uploaded ICS content
  in IndexedDB — both behind the StoragePort
- source selection in the UI (Google login, ICS upload) instead of URL flags
- year deep links (`#/2026`), privacy note, and a "clear data" action
- GitHub Pages deploy workflow for landing page + app

Deliverables: usable website deployed from `main`, fully backend-free.

### Phase D — Decouple builds and releases

Objectives:

- XPI packaging includes only `core/` + `hosts/thunderbird/` + `experiments/`
- Pages deployment excludes manifest/experiments artifacts
- add-on release (tag → XPI) and web release (push to `main` → Pages) run independently
- add a lightweight browser E2E for the web shell (dummy mode) next to the
  existing Thunderbird E2E

Deliverables: independent release pipelines, feature matrix documented.

## 4. Success criteria

- the Thunderbird add-on and the website share the same calendar engine
- the same view modes and filter semantics work in both products
- platform-specific code is limited to `src/hosts/` adapters and UI modules
- host-specific UI elements appear only on their host (mounted via slots,
  no host branches in the core)
- the website works without any server-side component
- changing core behavior updates both experiences consistently

## 5. Risks and mitigation

### Risk: feature drift between products

- keep shared contracts explicit and documented
- keep regression tests around core behavior
- maintain the feature matrix (core vs. host-specific) and review both shells
  whenever core logic changes

### Risk: over-extraction too early

- Phase A changes no file locations; Phase B is pure moves
- avoid moving UI shell concerns until the ports are stable

### Risk: compatibility regressions in Thunderbird

- keep the existing Thunderbird E2E test running in CI for every phase
- test the add-on manually in supported Thunderbird versions before releases

### Risk: client-storage limits on the web

- preferences are small (localStorage is sufficient)
- ICS uploads can be large — store them in IndexedDB, not cookies or localStorage
- the StoragePort keeps this an adapter decision that can change without touching the core
