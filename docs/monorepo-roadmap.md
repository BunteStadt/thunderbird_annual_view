# Monorepo roadmap

## 1. Goal

The repository should become a shared-code monorepo that supports both a Thunderbird add-on and a website using the same annual calendar experience.

The migration should be incremental. The first target is not a full rewrite; it is a controlled extraction of the calendar domain and rendering layer into reusable modules while preserving the current add-on behavior.

## 2. Current baseline

The current codebase already contains the main ingredients for reuse:

- a calendar domain centered around events, filters, and year-based navigation
- rendering logic that is mostly independent from Thunderbird-specific APIs
- a standalone HTML page that can already act as a development harness

The main blocker is that the current implementation is still tied to the add-on runtime through the Thunderbird calendar integration layer and the extension storage model.

## 3. Recommended migration phases

### Phase 0 — Stabilize the contract

Objectives:

- document the current view modes and filter semantics
- define the shared event model and filter model
- establish a clear boundary between UI state and platform state

Deliverables:

- a documented event schema
- a documented filter-state schema
- a list of current view modes and their rendering rules

### Phase 1 — Extract the shared calendar domain

Objectives:

- move date calculations, event normalization, and filter application into shared logic
- keep Thunderbird-specific calendar access in an adapter layer
- make the shared layer independent from browser extension APIs

Deliverables:

- shared package for date, event, and filter logic
- adapter interfaces for calendar sources
- tests that verify shared behavior with plain data objects

### Phase 2 — Extract the shared rendering engine

Objectives:

- move the annual grid rendering rules into a reusable renderer package
- keep host-specific shell concerns separate from row rendering and event placement
- preserve the existing view modes and visual behavior

Deliverables:

- shared renderer package for month and week-row layouts
- host-agnostic rendering contract
- a wrapper that connects renderer output to the addon and web DOM

### Phase 3 — Build the web application shell

Objectives:

- use the shared renderer in a browser-hosted website
- provide the same calendar view experience in a standard web page
- support hosting and navigation patterns expected by the web product

Deliverables:

- web app shell using shared modules
- route or query-based year navigation
- optional web-side persistence and theme support

### Phase 4 — Build the Thunderbird shell on top of the shared layer

Objectives:

- rewire the add-on to consume the shared domain and renderer packages
- preserve add-on-specific features such as space creation and Thunderbird calendar integration
- keep the add-on experience functionally equivalent to the current version

Deliverables:

- addon shell with Thunderbird-specific adapters
- preserved add-on functionality
- regression checks to confirm parity with the current experience

## 4. Suggested repository structure

A practical monorepo layout could look like this:

- apps/thunderbird-addon
  - Thunderbird-specific extension code
  - manifest and permissions
  - integration adapter layer

- apps/web
  - website shell and browser-hosted entry point
  - route handling and host-specific UI

- packages/shared-calendar
  - domain logic, event model, filter rules, normalization

- packages/shared-ui
  - renderer, layout engine, view models, accessible components

- packages/shared-config
  - preference schemas and persistence abstractions

## 5. Success criteria

The monorepo transition is successful when:

- the Thunderbird add-on and web app share the same calendar engine
- the same view modes and filter semantics work in both products
- platform-specific code is limited to adapters and shell integration
- changing shared calendar behavior updates both experiences consistently

## 6. Risks and mitigation

### Risk: feature drift between products

Mitigation:

- keep shared contracts explicit
- use regression tests around shared behavior
- review both shells whenever shared logic changes

### Risk: over-extraction too early

Mitigation:

- keep the first extraction minimal and focused on domain and render logic
- avoid moving UI shell concerns until the contracts are stable

### Risk: compatibility regressions in Thunderbird

Mitigation:

- maintain a compatibility checklist for each Thunderbird-related change
- test the add-on manually in supported Thunderbird versions
