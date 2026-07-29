# AGENT.md

## Project purpose

This repository is the foundation for a calendar-centric product family. Today it is a Thunderbird WebExtension add-on that renders an annual calendar view with filtering, theming, and multi-calendar support. The long-term goal is to evolve it into a monorepo that shares the calendar engine and view layer between:

- a Thunderbird add-on experience
- a browser-based website experience that runs the same annual calendar view

## Current product scope

The add-on currently provides:

- a read-only annual calendar grid with month and week-row layouts
- event loading from Thunderbird calendar APIs
- calendar filtering, all-day filtering, minimum-duration filtering, and theme preferences
- a standalone HTML debug surface for local development via dummy data

## Repository shape

- [manifest.json](manifest.json) defines the Thunderbird add-on entry point and experiment APIs.
- [src/background/background.js](src/background/background.js) creates the custom Thunderbird space entry point.
- [src/ui/year-view](src/ui/year-view) contains the calendar UI, event-store logic, grid rendering, storage, theming, and HTML shell.
- [experiments/calendar](experiments/calendar) holds Thunderbird-specific experimental calendar APIs used by the add-on.
- [apps](apps) is the starting point for the future monorepo split into addon, web, and backend surfaces.
- [test](test) contains integration and unit-style checks for the current calendar behavior.
- [thunderbird-profile](thunderbird-profile) is a pre-configured Thunderbird profile for real-Thunderbird integration testing via Docker or a local installation.

## Architecture principles

- Keep the calendar domain logic platform-agnostic.
- Keep Thunderbird-specific integration code isolated behind adapters.
- Preserve the current user experience and compatibility with Thunderbird versions supported by the add-on.
- Prefer small, testable modules over large UI files.
- Design the view layer so the same renderer can be used in both the addon and web app.

## Project conventions captured from the repository instructions

- The project is a Thunderbird WebExtension add-on built with plain JavaScript, HTML, and CSS, with Manifest v3 and Thunderbird-specific experiment APIs.
- The current compatibility target is Thunderbird 147.0 through 154.0, and the code should continue to use the browser namespace rather than chrome-specific APIs.
- Keep the add-on behavior read-only and preserve the existing light/dark theme support.
- The release path is still manual and tag-driven: update the version in manifest.json, create a release tag, and let the GitHub workflows build and publish the XPI.
- Avoid changing protected files such as LICENSE, .git internals, and documentation assets unless the change is intentionally related to the update.
- The add-on uses SVG assets from the icons directory for the extension action and the custom space. Keep icon paths in manifest.json and background wiring valid when changing or replacing assets.

## Monorepo target direction

The shared layer should eventually own the calendar domain, filtering rules, view modes, and event layout logic. The platform-specific layers should only handle:

- Thunderbird integration and manifest wiring
- browser/web hosting, routing, and shell UI
- storage and environment differences

## Detailed specifications

Use the following documents as the authoritative deeper references:

- [docs/architecture.md](docs/architecture.md) — current architecture, module responsibilities, and the target shared architecture.
- [docs/monorepo-roadmap.md](docs/monorepo-roadmap.md) — phased plan to evolve the repository into a monorepo.
- [docs/contributor-workflow.md](docs/contributor-workflow.md) — development workflow, testing expectations, and release conventions.
- [docs/thunderbird-profile/README.md](../thunderbird-profile/README.md) — how to use the pre-configured Thunderbird profile for end-to-end manual and Docker-based testing.

## Working rules for contributors

- Keep changes focused and compatible with the existing add-on behavior.
- Do not move shared logic into platform-specific files unless the dependency boundary is explicit.
- When adding new calendar features, preserve the existing filter model and rendering contract.
- Update docs whenever behavior, architecture, or workflow changes materially.
- Favor incremental extraction over large rewrites.
