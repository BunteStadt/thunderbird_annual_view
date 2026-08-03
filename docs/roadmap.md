# Core + hosts roadmap

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
