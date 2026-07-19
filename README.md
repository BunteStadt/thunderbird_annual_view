# Thunderbird Annual View
Calendar Annual View is a Thunderbird add-on that shows an entire year in one compact, readable grid with multiple layout options.
It displays all 12 months in various formats (compact linear, day-aligned, or 4-week rows), supports multiple calendars with automatic color matching, and keeps the view read-only for quick planning and overview use cases.

## Marketplace Description

Calendar Annual View adds a full-year calendar layout to Thunderbird with multiple view modes: compact linear grid (each row is a month), day-aligned layout, or 4-week row format. It is designed for fast yearly planning and conflict spotting.

The add-on automatically detects your Thunderbird calendars, applies their configured colors, and lets you filter what is shown (per-calendar visibility, per-calendar all-day overrides, minimum event duration, all-day events only, week numbers, past day graying, and current day highlighting). The annual view is intentionally read-only, so event editing remains in Thunderbird's standard day/week/month views.

## Features

- **Multiple View Modes**: Choose from compact linear (each row is a month), day-aligned, or 4-week row layouts for flexible annual viewing.
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

### Light Theme
![Light Theme Screenshot 1](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/linear-light.png)
![Light Theme Screenshot 2](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/day-aligned-light.png)

### Dark Theme
![Dark Theme Screenshot 2](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/linear-dark.png)
![Dark Theme Screenshot 1](https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/day-aligned-dark.png)

## Installation

1. Download the latest `.xpi` file from the [Releases](https://github.com/BunteStadt/thunderbird_annual_view/releases) page.
2. In Thunderbird, go to **Add-ons and Themes** (Tools > Add-ons and Themes).
3. Click the gear icon and select **Install Add-on From File**.
4. Select the downloaded `.xpi` file and follow the prompts.

Alternatively, install directly from the [Thunderbird Add-ons site](https://addons.thunderbird.net/en-US/thunderbird/addon/calendar-annual-view/) using the ID: `GlamorousPotato.calendar-annual-view@addons.thunderbird.net`.

## Usage

1. After installation, new buttons (on the left in the spaces toolbar and at the top left) will appear.
2. Click a button to open the annual calendar view.
3. Select the year to display using the input field or the 2 buttons.
4. Choose the view mode (compact, aligned, or 4-week) from the dropdown in the header.
5. Click on `show options` to open the configuration sidebar for filters and calendar selection.

## Configuration

Access the add-on options through Thunderbird's Add-ons Manager:

- **Calendars**: Select which calendars to include in the annual view.
- **Duration Filter**: Set a minimum event duration (in hours) to display.
- **All-Day Events Only**: Toggle to show only full-day events.
- **Per-Calendar All-Day Mode**: Use the per-calendar symbol to force all-day-only on, off, or follow the global setting.
- **Per-Calendar Duration Override**: Set a calendar-specific minimum duration, or `-1` to follow the global duration filter.
- **Week Numbers**: Toggle to show/hide ISO week numbers in the grid.
- **Gray Past Days**: Toggle to gray out days before today for better focus.
- **Highlight Current Day**: Toggle to highlight today's date.

The view mode can be changed directly in the annual view header: select between compact (linear), aligned, or 4-week layouts.

## Development

### Dummy Data
Open the standalone page with `?dummy=1` or `?dummy=true` to load the built-in sample calendars and events, for example `src/ui/year-view/year-view.html?dummy=1`.

### Build standalone html

Work wihtout Thunderbird - see the thunderbird tab in the browser - faster for development and debugging.

1. Install `Live Server (Five Server)` extension in Visual Studio Code.
2. Right click `/src/ui/year-view/year-view.html` and select `Open with Live Server`.
3. Add `?dummy=1` to the URL to load the built-in sample calendars and events.

### Run in Thunderbird

1. Install extension in Thunderbird as debugg mode.

## Deployments

When development is finished, merge to main. Make sure the ci-test is successful.
In a new commit, update the version number in `manifest.json`.
In vscode: select the last commit, right click and select `Create Tag`. Follow the versioning scheme.
The tag needs to be pushed to the remote repo seperatly. The GitHub Actions workflow will automatically create a new release and upload the `.xpi` file.

Might add message to the tag to be included in release notes. (Not tested yet).

### Prerequisites

### Building

To create an `.xpi` file manually:

1. Clone or download the repository.
2. Zip the contents (excluding the `.git` folder).
3. Rename the zip file extension to `.xpi`.

### Releasing a New Version

1. Create branches and commits as needed during development.
2. When ready for release, create a Git tag on the desired commit.
3. Push the tag to the repository (separate from pushing commits).
4. The GitHub Actions workflow will automatically create a new release and upload the `.xpi` file.

## License

This project is licensed under the Mozilla Public License Version 2.0. See the [LICENSE](LICENSE) file for details.

## Author

GlamorousPotato
