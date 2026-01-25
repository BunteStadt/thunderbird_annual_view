# Thunderbird Annual View
Annual calendar year view in a grid layout.
Displays all 12 months with rows as months and columns as weekdays. Supports multiple calendars with automatic detection and color matching.
Read-only.
Filtering by event duration and "full day event"

## Description

This add-on allows to view all months of a year in a single, linear grid layout. Each row represents a month, and each column represents a weekday. Multiple calendars can be displayed simultaneously, with automatic detection from Thunderbird's standard calendar list. Calendar colors are inherited from the normal calendar settings.

The view is read-only; to edit events, use Thunderbird's standard calendar views.

## Features

- **Annual Grid View**: Displays all 12 months in a compact grid.
- **Multi-Calendar Support**: Show events from multiple calendars at once.
- **Automatic Calendar Detection**: Pulls calendars and colors from Thunderbird's settings.
- **Configurable Filters**:
  - Enable/disable specific calendars.
  - Filter events by duration (longer than X hours).
  - Filter to show only all-day events.
- **Theming**: Supports light and dark themes with appropriate icons.

## Screenshots

### Light Theme
![Light Theme Screenshot 1](media/Light_1.jpg)
![Light Theme Screenshot 2](media/Light_2.jpg)

### Dark Theme
![Dark Theme Screenshot 2](media/Dark_2.jpg)
![Dark Theme Screenshot 1](media/Dark_1.jpg)

## Installation

1. Download the latest `.xpi` file from the [Releases](https://github.com/your-repo/thunderbird_annual_view/releases) page.
2. In Thunderbird, go to **Add-ons and Themes** (Tools > Add-ons and Themes).
3. Click the gear icon and select **Install Add-on From File**.
4. Select the downloaded `.xpi` file and follow the prompts.

Alternatively, install directly from the [Thunderbird Add-ons site](https://addons.thunderbird.net/en-US/thunderbird/addon/calendar-annual-view/) using the ID: `GlamorousPotato.calendar-annual-view@addons.thunderbird.net`.

## Usage

1. After installation, new buttons (on the left in the spaces toolbar and at the top left) will appear.
2. Click a button to open the annual calendar view.
3. Select the year to display using the input field or the 2 bottons.
4. Click on `show options` to open the configuration tab.

## Configuration

Access the add-on options through Thunderbird's Add-ons Manager:

- **Calendars**: Select which calendars to include in the annual view.
- **Duration Filter**: Set a minimum event duration (in hours) to display.
- **All-Day Events Only**: Toggle to show only full-day events.

## Development

### Prerequisites

- Thunderbird 147.0 or later (up to 148.0).

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
