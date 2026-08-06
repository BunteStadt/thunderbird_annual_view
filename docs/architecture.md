# Architecture specification

## 1. Product overview

This project currently delivers a Thunderbird add-on that presents an annual calendar view in a compact, read-only layout. Users can navigate across years, switch between multiple grid modes, and filter events by calendar, duration, and all-day status.

The product is intentionally narrow in scope: it focuses on annual overview, planning, and quick scanning rather than editing or full calendar management. That emphasis shapes the architecture: the UI is optimized for high-density display, and the data flow is designed to support fast iteration and filtering.

## 2. Current architecture

### 2.1 Runtime layers

The current implementation is organized into three practical layers:

1. Platform layer
   - Thunderbird WebExtension entry points and manifest wiring
   - custom space creation and add-on action behavior
   - browser-specific storage and calendar API access

2. Domain layer
   - event normalization and filtering rules
   - year-based event caching
   - date calculations for month and week-row rendering

3. Presentation layer
   - annual grid rendering
   - header and sidebar controls
   - theme handling and viewport behavior

The implementation of these layers is split between `src/core/` and
`src/hosts/`. The core is host-neutral; each host supplies storage, a calendar
provider, and host-specific UI modules through the bootstrap.

### 2.2 Key modules

- [src/hosts/thunderbird/background.js](../src/hosts/thunderbird/background.js)
  - creates the custom space shown in Thunderbird
  - handles entry point behavior for the add-on

- [assets/icons](../assets/icons)
  - stores the SVG assets used by the add-on action and the custom space
  - should remain theme-aware and compatible with the extension manifest references

- [src/core/app.js](../src/core/app.js)
  - initializes DOM references and state
  - wires filters, navigation, loading, refresh, and rendering updates
  - mounts host UI modules through named slots
  - coordinates the event store and grid view

- [src/hosts/thunderbird/main.js](../src/hosts/thunderbird/main.js) and
  [src/hosts/web/main.js](../src/hosts/web/main.js)
  - configure the host storage adapter and calendar provider
  - register host-specific UI modules before calling `initApp()`

- [src/core/providers/calendar-service.js](../src/core/providers/calendar-service.js)
  - manages the active calendar provider and merges uploaded `.ics` calendars
  - creates providers through explicit kinds or registered host factories
  - keeps uploaded `.ics` calendars in a dedicated `IcsCalendarProvider` instance
  - merges `IcsCalendarProvider` calendars/events with the active provider output in `fetchCalendars()` and `fetchCalendarEvents()`
  - exports `IcsCalendarProvider`, `GoogleCalendarProvider`, `ThunderbirdCalendarProvider`, `DummyCalendarProvider`, and `EmptyCalendarProvider`
  - keeps provider selection out of the renderer

- [src/core/providers/google-calendar-provider.js](../src/core/providers/google-calendar-provider.js)
  - handles Google OAuth token flow (Google Identity Services)
  - queries Google Calendar list/events endpoints in read-only mode
  - maps Google payloads into the shared event shape

- [src/hosts/web/google-client-id.js](../src/hosts/web/google-client-id.js)
  - stores the Google OAuth web client ID used by standalone Google mode

- [src/core/providers/ics-calendar-provider.js](../src/core/providers/ics-calendar-provider.js)
  - platform-agnostic provider that reads events from in-memory ICS (iCalendar) content
  - accepts an array of `{ id, name, color, content }` descriptors; the caller supplies the raw ICS text
  - handles iCalendar line unfolding, `VALUE=DATE` and `TZID`-qualified `DTSTART`/`DTEND`, and UTC timestamps
  - supports `calendarIds`, `allDayOnly`, and `calendarAllDayModes` filter options
  - can be selected by calendar-service as the active provider, and can be constructed directly in tests

- [src/core/ics-calendar-integration.js](../src/core/ics-calendar-integration.js)
  - owns the manual ICS upload button shown below the calendar list
  - loads and persists uploaded ICS descriptors in browser storage
  - supports removing individual uploaded ICS calendars from the sidebar list
  - updates the active ICS provider without adding provider-specific state to `main.js`

- [src/core/domain/event-store.js](../src/core/domain/event-store.js)
  - caches events by year
  - applies filtering logic without re-fetching data repeatedly

- [src/core/ui/grid-view.js](../src/core/ui/grid-view.js)
  - renders the infinite-scrolling annual grid
  - handles viewport virtualization, event bar placement, and layout modes

- [src/core/storage.js](../src/core/storage.js)
  - persists UI and filter state in browser storage

- [src/core/ui/theme.js](../src/core/ui/theme.js)
  - applies light/dark theme behavior

- [src/core/ui/index.html](../src/core/ui/index.html)
  - single source of truth for the shared app markup (header, sidebar, grid shell)
  - Vite builds it with the selected host entry module through the
    `@calendar-host` alias

- [src/hosts/web/ui](../src/hosts/web/ui)
  - contains Google authentication, empty-state, and clear-data UI modules
  - these modules are mounted only by the web bootstrap

## 3. Core domain concepts

### 3.1 Calendar

A calendar is a named data source with:

- an identifier
- a display name
- a color
- optional metadata such as all-day preferences or per-calendar overrides

### 3.2 Event

An event is the smallest unit of business data rendered in the annual view. Each event should carry:

- a title
- a start date/time
- an end date/time
- a calendar reference
- all-day status
- optional location and description

### 3.3 Filter state

The current UI supports a rich filter model:

- selected calendars
- global all-day-only flag
- per-calendar all-day override mode
- global minimum-duration threshold
- per-calendar duration override
- duration filter toggle state

These values influence event visibility and should be treated as first-class state rather than incidental UI state.

### 3.4 View state

The user can change:

- the visible year
- the current view mode
- whether week numbers are shown
- whether past days are dimmed
- whether the current day is highlighted
- whether the filters pane is expanded

## 4. Current data flow

1. The host bootstrap installs a storage adapter and chooses a provider
  (Thunderbird APIs, Google web APIs, dummy data, or empty).
2. The core UI initializes and loads persisted preferences.
3. The event store requests events for the needed year range.
4. The store caches normalized events and filters them according to current settings.
5. The grid view renders visible rows and overlays event bars.
6. User actions change filter or view state and trigger a refresh of the rendered grid.

## 5. Constraints and requirements

### Functional requirements

- Render a full-year overview in a compact and readable format.
- Support multiple view modes including month-based and week-row-based layouts.
- Respect calendar colors and user-selected visibility preferences.
- Keep the experience read-only to avoid conflicting with native Thunderbird editing flows.

### Non-functional requirements

- Must remain compatible with supported Thunderbird versions.
- Must degrade gracefully when calendar APIs are unavailable or incomplete.
- Must support local development without requiring a full Thunderbird runtime.
- Must preserve a lightweight and dependency-free implementation style for now.
- `IcsCalendarProvider` must be platform-agnostic and work in both the add-on and future web contexts.

## 6. Target architecture: core + hosts

The repository stays a single lightweight codebase (no npm workspaces, no bundler). Responsibilities are split so the same calendar engine can be reused by two thin host shells without platform-specific coupling.

### 6.1 Target directory layout

- `src/core/` — platform-neutral. No `browser.*`/`messenger.*` calls, no direct access to host storage, no host detection.
  - `core/domain/` — `date-utils`, `event-store`, filter rules, event/calendar schema
  - `core/providers/` — provider base class, `ics-`, `google-`, `dummy-`, `empty-provider`, and `calendar-service` (merge logic only, no auto-detection)
  - `core/ui/` — `grid-view`, `theme`, header/sidebar scaffolding, shared CSS
  - `core/app.js` — the orchestration currently living in `main.js`, initialized with injected ports

- `src/hosts/thunderbird/` — the add-on shell:
  - `background.js`, manifest wiring, experiment submodule concerns
  - `ThunderbirdCalendarProvider` (the only provider that depends on the experiment APIs)
  - storage adapter backed by `browser.storage.local`
  - Thunderbird-only UI modules mounted into core slots

- `src/hosts/web/` — the website shell (static hosting on GitHub Pages, **no backend, no database**):
  - web entry point (HTML page deployed to Pages)
  - storage adapter backed by client-side storage (`localStorage` for preferences, IndexedDB for uploaded ICS content)
  - Google auth setup (`google-standalone-auth.js`, client ID configuration) — calendars are fetched directly from Google APIs in the browser; OAuth tokens never leave the client
  - web-only UI modules mounted into core slots

### 6.2 Ports (host-provided interfaces)

Each host shell supplies these ports to `core/app.js` at startup:

- **StoragePort** — async `get(key)` / `set(key, value)` / `remove(key)` for preferences and uploaded ICS data. Replaces the direct `browser.storage.local` coupling in `storage.js` and the `ensureBrowserStorageBridge()` workaround in `main.js`.
- **CalendarSourcePort** — the host decides which provider is the default (Thunderbird provider, Google provider, dummy, or empty). The core never feature-detects the platform.
- **HostPort** — theme detection hooks, refresh triggers, and navigation behavior where hosts differ.

### 6.3 UI extension points (host-specific UI elements)

The core renders only the shared UI (grid, common header controls, filter sidebar). Host-specific controls live in `src/hosts/<host>/ui/` and are attached through named mount slots:

- The core defines named slots (e.g. `header-actions`, `sidebar-sections`), generalizing the existing `providerAuthMount` / `providerSidebarMount` pattern.
- Each host passes a list of UI modules `{ slot, mount(container, appApi) }` to `app.init()`. The core calls `mount()` without knowing the content.
- There are no `if (isThunderbird)` branches in the core: UI that is not mounted simply does not exist in the DOM.

Element assignment:

- **Web only:** Google connect/log-out button, "clear data" action, optional sample calendars (public holidays/school holidays ICS)
- **Thunderbird only:** Thunderbird calendar refresh/sync behavior, add-on option hints
- **Both (core):** view-mode selector, year navigation, filter sidebar, theme toggle, ICS upload (works on both hosts through the StoragePort)

### 6.4 Web app constraints

- The website is a purely static deployment. There is no server-side session, token relay, or persistence.
- Google calendars are read directly from the browser via the Google Calendar API (Google Identity Services, read-only scope).
- ICS imports and preferences are persisted client-side only. Preferences use `localStorage`; uploaded ICS content uses IndexedDB (size limits make cookies unsuitable, and without a backend cookies would only add request overhead). Both sit behind the same StoragePort so the core does not see the difference.
- All user data stays in the user's browser. The landing page should state this, and the web options should offer a "clear data" action (wipe client storage, Google logout).

### 6.5 Architectural rules

- `src/core/` must never import from `src/hosts/`.
- No `browser.*` / `messenger.*` usage inside `src/core/` — such access goes through ports.
- Any code that depends on Thunderbird APIs, browser extension APIs, or web-runtime specifics stays behind the port/adapter interfaces. Shared logic works with plain data objects and generic input/output contracts.

### 6.6 Data contracts

The core defines stable contracts for:

- calendar list input
- event list input
- filter state
- theme state
- view state
- render output requests

That contract-driven structure allows both the add-on and website to use the same rendering engine while still customizing their host behavior.

## 7. Implementation guidance

When extending this project:

- keep DOM host wiring and browser-specific code in the host shell or adapter layer
- keep layout rules and filtering rules in core logic
- avoid mixing Thunderbird-specific API semantics into the renderer
- preserve the current module boundaries and keep host-specific behavior behind the host adapters
