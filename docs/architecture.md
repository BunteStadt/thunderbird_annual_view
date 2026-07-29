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

### 2.2 Key modules

- [src/background/background.js](../src/background/background.js)
  - creates the custom space shown in Thunderbird
  - handles entry point behavior for the add-on

- [icons](../icons)
  - stores the SVG assets used by the add-on action and the custom space
  - should remain theme-aware and compatible with the extension manifest references

- [src/ui/year-view/main.js](../src/ui/year-view/main.js)
  - initializes DOM references and state
  - wires filters, navigation, loading, refresh, and rendering updates
  - owns Google connect/log-out header control wiring for standalone web mode
  - coordinates the event store and grid view

- [src/ui/year-view/calendar-service.js](../src/ui/year-view/calendar-service.js)
  - resolves the active calendar provider (dummy, Thunderbird, or Google web)
  - keeps provider selection out of the renderer

- [src/ui/year-view/google-calendar-provider.js](../src/ui/year-view/google-calendar-provider.js)
  - handles Google OAuth token flow (Google Identity Services)
  - queries Google Calendar list/events endpoints in read-only mode
  - maps Google payloads into the shared event shape

- [src/ui/year-view/google-client-id.js](../src/ui/year-view/google-client-id.js)
  - stores the Google OAuth web client ID used by standalone Google mode

- [src/ui/year-view/event-store.js](../src/ui/year-view/event-store.js)
  - caches events by year
  - applies filtering logic without re-fetching data repeatedly

- [src/ui/year-view/grid-view.js](../src/ui/year-view/grid-view.js)
  - renders the infinite-scrolling annual grid
  - handles viewport virtualization, event bar placement, and layout modes

- [src/ui/year-view/storage.js](../src/ui/year-view/storage.js)
  - persists UI and filter state in browser storage

- [src/ui/year-view/theme.js](../src/ui/year-view/theme.js)
  - applies light/dark theme behavior

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

1. The UI initializes and loads persisted preferences.
2. The UI chooses a provider (Thunderbird APIs, Google web APIs, or dummy data).
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

## 6. Target shared architecture for the monorepo

The monorepo should split responsibilities so the same calendar engine can be reused in multiple products without platform-specific coupling.

### 6.1 Shared package boundaries

Proposed boundaries:

- Shared calendar domain package
  - date handling
  - event normalization
  - filter rules and preference models
  - business rules for layout decisions

- Shared UI package
  - view-mode engine
  - event placement logic
  - reusable rendering primitives
  - accessible components for the annual calendar surface

- Thunderbird addon shell
  - manifest, permissions, action wiring, and Thunderbird-specific APIs

- Web app shell
  - hosting, page layout, routing, and browser environment integration

### 6.2 Architectural rule

Any code that depends on Thunderbird APIs, browser extension APIs, or the web runtime should remain behind adapter interfaces. Shared logic should work with plain data objects and generic input/output contracts.

### 6.3 Suggested data contracts

The shared layer should define stable contracts for:

- calendar list input
- event list input
- filter state
- theme state
- view state
- render output requests

That contract-driven structure will allow both the add-on and website to use the same rendering engine while still customizing their host behavior.

## 7. Implementation guidance

When extending this project:

- keep DOM and browser-specific code in the shell or adapter layer
- keep layout rules and filtering rules in shared logic
- avoid mixing Thunderbird-specific API semantics into the renderer
- preserve the current module boundaries until a clear extraction plan exists
