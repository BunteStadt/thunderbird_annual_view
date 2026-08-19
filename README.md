# Thunderbird Year View
Calendar Year View is a Thunderbird add-on that shows an entire year in one compact, readable grid with multiple layout options.
It displays all 12 months in various formats (compact linear, day-aligned, 4-week rows, 2-week rows, or 1-week rows), scrolls continuously across year boundaries, supports multiple calendars with automatic color matching, and keeps the view read-only for quick planning and overview use cases.

## Marketplace Description

Calendar Year View adds a full-year calendar layout to Thunderbird with multiple view modes: compact linear grid (each row is a month), day-aligned layout, or 4/2/1-week row formats. It is designed for fast yearly planning and conflict spotting.

The add-on automatically detects your Thunderbird calendars, applies their configured colors, and lets you filter what is shown (per-calendar visibility, per-calendar all-day overrides, minimum event duration, all-day events only, week numbers, past day graying, and current day highlighting). The year view is intentionally read-only, so event editing remains in Thunderbird's standard day/week/month views.

## Features

- **Multiple View Modes**: Choose from compact linear (each row is a month), day-aligned, 4-week, 2-week, or 1-week row layouts for flexible year viewing.
- **Row Month/Year Labels**: Every row shows a left-side short month label (`Jan`) plus year; week-row modes show range labels like `Jan / Feb` (and `2026 / 2027` when needed).
- **Infinite Scrolling**: Scroll seamlessly up and down across year boundaries. In the month-based views, December is directly followed by January of the next year; in the week-row views, years change within a row. Events for neighboring years are prefetched in the background, so scrolling stays smooth.
- **Multi-Calendar Support**: Show events from multiple calendars at once.
- **Automatic Calendar Detection**: Pulls calendars and colors from Thunderbird's settings.
- **ICS Upload and Removal**: Add one or more `.ics` files from the options sidebar and remove uploaded calendars individually with the `✕` button.
- **Merged Calendar Sources**: Uploaded `.ics` calendars are merged with the active provider (Thunderbird or Google standalone) instead of replacing it.
- **Configurable Filters**:
  - Enable/disable specific calendars.
  - Set each calendar's all-day-only mode to on, off, or follow the global setting.
  - Filter events by duration (longer than X hours).
  - Filter to show only all-day events.
  - Show/hide ISO week numbers.
  - Gray out past days for better focus.
  - Highlight the current day.
- **Theming**: Supports light and dark themes with appropriate icons.

## Screenshots

### Compact Linear View
![Compact Linear View Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/linear-light.png)

### Day-Aligned View
![Day-Aligned View Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/day-aligned-light.png)

### 4-Week View
![4-Week View Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/week-rows-light.png)

### 2-Week View
![2-Week View Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/two-week-rows-light.png)

### 1-Week View
![1-Week View Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/one-week-rows-light.png)

### Collapsable Options Sidebar
![Options Sidebar Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/options-disabled.png)

### Dark Theme Screenshots
![Compact Linear Dark Theme Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/linear-dark.png)
![Day-Aligned Dark Theme Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/day-aligned-dark.png)
![4-Week Dark Theme Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/week-rows-dark.png)
![2-Week Dark Theme Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/two-week-rows-dark.png)
![1-Week Dark Theme Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/one-week-rows-dark.png)

## Installation

1. Download the latest `.xpi` file from the [Releases](https://github.com/BunteStadt/thunderbird_annual_view/releases) page.
2. In Thunderbird, go to **Add-ons and Themes** (Tools > Add-ons and Themes).
3. Click the gear icon and select **Install Add-on From File**.
4. Select the downloaded `.xpi` file and follow the prompts.

Alternatively, install directly from the [Thunderbird Add-ons site](https://addons.thunderbird.net/en-US/thunderbird/addon/calendar-annual-view/) using the ID: `GlamorousPotato.calendar-annual-view@addons.thunderbird.net`.

## SaaS Demo

The SaaS website includes a credential-free `/demo` route backed by the shared
calendar core. Run `npm run dev` and open `http://localhost:5173/demo`.
The authenticated `/app` route uses Clerk and the Worker-backed Google Calendar
provider.

## Usage

1. After installation, new buttons (on the left in the spaces toolbar and at the top left) will appear.
2. Click a button to open the annual calendar view.
3. Scroll the grid to move through time — the view continues endlessly into past and future years. The year input always shows the year at the center of the view; type a year or use the +/- buttons to jump directly.
4. Choose the view mode (compact, aligned, 4-week, 2-week, or 1-week) from the dropdown in the header.
5. Click on `show options` to open the configuration sidebar for filters and calendar selection.
6. Use `Upload ICS` below the calendar list to add local `.ics` calendars, then use `✕` on an uploaded calendar row to remove it.

## Configuration

Access the add-on options through Thunderbird's Add-ons Manager:

- **Calendars**: Select which calendars to include in the year view.
- **Duration Filter**: Set a minimum event duration (in hours) to display.
- **Duration Filter Toggle (Header)**: Quickly enable or disable duration/all-day filtering without changing calendar selection. When off, all events from selected calendars are shown and the overridden sidebar controls are visibly marked inactive.
- **All-Day Events Only**: Toggle to show only full-day events.
- **Per-Calendar All-Day Mode**: Use the per-calendar symbol to force all-day-only on, off, or follow the global setting.
- **Per-Calendar Duration Override**: Set a calendar-specific minimum duration, or `-1` to follow the global duration filter.
- **Week Numbers**: Toggle to show/hide ISO week numbers in the grid.
- **Gray Past Days**: Toggle to gray out days before today for better focus.
- **Highlight Current Day**: Toggle to highlight today's date.

The view mode can be changed directly in the year view header: select between compact (linear), aligned, 4-week, 2-week, or 1-week layouts.

## Development

The shadcn preset: --preset b1D5T6K8 was used.
For the SaaS development setup, see [docs/saas-setup.md](docs/saas-setup.md) and
[docs/saas-architecture.md](docs/saas-architecture.md). General contribution and
testing guidance is in [docs/contributor-workflow.md](docs/contributor-workflow.md).

Use a separate Thunderbird profile.

Use `just tb` or:

1. Close Thunderbird.
2. Start the profile selector  and use a test profile.

``` cmd
"C:\Program Files\Mozilla Thunderbird\thunderbird.exe" -P
```

### Vite
Vite is used to merge htmls and build the stuff.

```bash
npm run dev
npm run build:saas
npm run build:thunderbird
npm run check:thunderbird
```

### Demo Calendars
Run `npm run dev`, then open `http://localhost:5173/demo` to load the built-in sample `.ics` calendars and events.

### Run in Thunderbird

1. Install extension in Thunderbird as debugg mode.

### Development Tooling

#### Just Commands

[`just`](https://github.com/casey/just) is a command runner. Available recipes:

| Command | Description |
| --------- | ------------- |
| `just tag` | Creates a Git tag from the version in `src/hosts/thunderbird/manifest.json` and pushes it to `origin`. Only runs on `main` when the working tree is clean and the branch is in sync with `origin/main`. |
| `just tb` | Starts Thunderbird with the `addon-test` profile |
| `just website` | Builds and starts the SaaS website with Wrangler |

#### Building the Experiment Package

The experimental calendar APIs live in `src/hosts/thunderbird/submodules/calendar/experiments/calendar/` (a Git submodule). The build script copies them to `dist/package/experiments/calendar/` when assembling the add-on.

## Deployments

When development is finished, merge to `main` after CI passes. The planned
Pages deployment is not active yet. The add-on release remains tag-driven: update the version in
`src/hosts/thunderbird/manifest.json`, create and push a tag (or use
`just tag`), and the release workflow builds and uploads the XPI.

### Prerequisites

### Building

To create an `.xpi` file manually:

1. Clone or download the repository.
2. Run `npm run build:xpi` (or `assets/scripts/build-xpi.sh`) to assemble `dist/package/` and create the XPI.

### Releasing the Add-on

1. Create branches and commits as needed during development.
2. When ready for release, create a Git tag on the desired commit.
3. Push the tag to the repository (separate from pushing commits).
4. The GitHub Actions workflow will automatically create a new *draft* release and upload the `.xpi` file.
5. Check the release, test the `.xpi` file, and publish the release when ready.

### Releasing the Web App

Web release automation is still open: enable and verify
`.github/workflows/deploy-pages.yml`, then deploy the landing page and the
`dist/saas` build from `main`.

## License

This project is licensed under the Mozilla Public License Version 2.0. See the [LICENSE](LICENSE) file for details.

## Author

GlamorousPotato
