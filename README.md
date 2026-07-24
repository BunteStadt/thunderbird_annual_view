# Thunderbird Annual View
Calendar Annual View is a Thunderbird add-on that shows an entire year in one compact, readable grid with multiple layout options.
It displays all 12 months in various formats (compact linear, day-aligned, or 4-week rows), scrolls continuously across year boundaries, supports multiple calendars with automatic color matching, and keeps the view read-only for quick planning and overview use cases.

## Marketplace Description

Calendar Annual View adds a full-year calendar layout to Thunderbird with multiple view modes: compact linear grid (each row is a month), day-aligned layout, or 4-week row format. It is designed for fast yearly planning and conflict spotting.

The add-on automatically detects your Thunderbird calendars, applies their configured colors, and lets you filter what is shown (per-calendar visibility, per-calendar all-day overrides, minimum event duration, all-day events only, week numbers, past day graying, and current day highlighting). The annual view is intentionally read-only, so event editing remains in Thunderbird's standard day/week/month views.

## Features

- **Multiple View Modes**: Choose from compact linear (each row is a month), day-aligned, or 4-week row layouts for flexible annual viewing.
- **Infinite Scrolling**: Scroll seamlessly up and down across year boundaries. In the month-based views, December is directly followed by January of the next year; in the 4-week view, years change within a row. Events for neighboring years are prefetched in the background, so scrolling stays smooth.
- **Multi-Calendar Support**: Show events from multiple calendars at once.
- **Automatic Calendar Detection**: Pulls calendars and colors from Thunderbird's settings.
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

### Collapsable Options Sidebar
![Options Sidebar Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/options-disabled.png)

### Dark Theme Screenshots
![Compact Linear Dark Theme Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/linear-dark.png)
![Day-Aligned Dark Theme Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/day-aligned-dark.png)
![4-Week Dark Theme Screenshot](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/week-rows-dark.png)

## Installation

1. Download the latest `.xpi` file from the [Releases](https://github.com/BunteStadt/thunderbird_annual_view/releases) page.
2. In Thunderbird, go to **Add-ons and Themes** (Tools > Add-ons and Themes).
3. Click the gear icon and select **Install Add-on From File**.
4. Select the downloaded `.xpi` file and follow the prompts.

Alternatively, install directly from the [Thunderbird Add-ons site](https://addons.thunderbird.net/en-US/thunderbird/addon/calendar-annual-view/) using the ID: `GlamorousPotato.calendar-annual-view@addons.thunderbird.net`.

## GitHub Pages Demo

The repository root contains a landing page (`index.html`) designed for GitHub Pages.
It is responsive from mobile to wide desktop layouts, includes animated visual accents, and now embeds an interactive dummy demo directly on the page.

- Landing page: `https://buntestadt.github.io/thunderbird_annual_view/`
- Dummy demo button target (opens in a new tab): `src/ui/year-view/year-view.html?dummy=1`
- Embedded demo target (inside an iframe): `src/ui/year-view/year-view.html?dummy=1`

## Usage

1. After installation, new buttons (on the left in the spaces toolbar and at the top left) will appear.
2. Click a button to open the annual calendar view.
3. Scroll the grid to move through time — the view continues endlessly into past and future years. The year input always shows the year at the center of the view; type a year or use the +/- buttons to jump directly.
4. Choose the view mode (compact, aligned, or 4-week) from the dropdown in the header.
5. Click on `show options` to open the configuration sidebar for filters and calendar selection.

## Configuration

Access the add-on options through Thunderbird's Add-ons Manager:

- **Calendars**: Select which calendars to include in the annual view.
- **Duration Filter**: Set a minimum event duration (in hours) to display.
- **Duration Filter Toggle (Header)**: Quickly enable or disable duration/all-day filtering without changing calendar selection. When off, all events from selected calendars are shown and the overridden sidebar controls are visibly marked inactive.
- **All-Day Events Only**: Toggle to show only full-day events.
- **Per-Calendar All-Day Mode**: Use the per-calendar symbol to force all-day-only on, off, or follow the global setting.
- **Per-Calendar Duration Override**: Set a calendar-specific minimum duration, or `-1` to follow the global duration filter.
- **Week Numbers**: Toggle to show/hide ISO week numbers in the grid.
- **Gray Past Days**: Toggle to gray out days before today for better focus.
- **Highlight Current Day**: Toggle to highlight today's date.

The view mode can be changed directly in the annual view header: select between compact (linear), aligned, or 4-week layouts.

## Development

Use a seperate Thunderbird profile.

1. Close Thunderbird.
2. Start the profile selecter and use a test profile.

``` cmd
"C:\Program Files\Mozilla Thunderbird\thunderbird.exe" -P
```

### Dummy Data
Open the standalone page with `?dummy=1` or `?dummy=true` to load the built-in sample calendars and events, for example `src/ui/year-view/year-view.html?dummy=1`.
Or use the commented out code in main.js.

### Build standalone html

Work wihtout Thunderbird - see the thunderbird tab in the browser - faster for development and debugging.

1. Install `Live Server (Five Server)` extension in Visual Studio Code.
2. Right click `/src/ui/year-view/year-view.html` and select `Open with Live Server`.
3. Add `?dummy=1` to the URL to load the built-in sample calendars and events.

### Run in Thunderbird

1. Install extension in Thunderbird as debugg mode.

### Development Tooling

#### Git Hooks

The repository ships with custom Git hooks in `.githooks/`. To enable them, run once:

```bash
git config core.hooksPath .githooks
```

- **`pre-commit`** — Checks that the submodule has no unpulled commits and that `experiments/` is in sync with `submodules/calendar/experiments/calendar/`. If they differ, run `just sync-experiments` to sync them before committing.

#### Just Commands

[`just`](https://github.com/casey/just) is a command runner. Available recipes:

| Command | Description |
|---------|-------------|
| `just sync-experiments` | Copies experiment APIs from `submodules/calendar/experiments/calendar/` to `experiments/` for development |
| `just build-xpi` | Builds the `.xpi` release package into `dist/` |
| `just tag` | Creates a Git tag from the version in `manifest.json` and pushes it to `origin`. Only runs on `main` when the working tree is clean and the branch is in sync with `origin/main`. |

#### Syncing the Experiment Submodule

The experimental calendar APIs live in `submodules/calendar/experiments/calendar/` (a Git submodule). For the add-on to work, they must also be present at `experiments/calendar/`. To sync manually:

```bash
just sync-experiments
```

This copies all files from the submodule source to the target directory. The `pre-commit` hook will warn you if they drift out of sync.

## Deployments

When development is finished, merge to main. Make sure the ci-test is successful.
In a new commit, update the version number in `manifest.json`.
In vscode: select the last commit, right click and select `Create Tag`. Follow the versioning scheme. - or use the `just tag` command.
The tag needs to be pushed to the remote repo seperatly. The GitHub Actions workflow will automatically create a new release and upload the `.xpi` file.

### Prerequisites

### Building

To create an `.xpi` file manually:

1. Clone or download the repository.
2. Stage the package layout so `submodules/calendar/experiments/calendar/` is also available as `experiments/calendar/` at the archive root.
3. Zip the staged contents (excluding the `.git` folder).
4. Rename the zip file extension to `.xpi`.

### Releasing a New Version

1. Create branches and commits as needed during development.
2. When ready for release, create a Git tag on the desired commit.
3. Push the tag to the repository (separate from pushing commits).
4. The GitHub Actions workflow will automatically create a new *draft* release and upload the `.xpi` file.
5. Check the release, test the `.xpi` file, and publish the release when ready.

## License

This project is licensed under the Mozilla Public License Version 2.0. See the [LICENSE](LICENSE) file for details.

## Author

GlamorousPotato
