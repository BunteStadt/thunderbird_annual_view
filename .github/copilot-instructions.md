# Copilot Instructions for Thunderbird Annual View

## Project Overview

This is a Thunderbird WebExtension add-on that provides an annual calendar view displaying all 12 months in a grid layout. The add-on is built using pure JavaScript, HTML, and CSS without any build tools or package managers.

## Project Structure

- `manifest.json` - WebExtension manifest (v3) with experimental APIs
- `src/background/` - Background scripts for handling extension actions
- `src/ui/year-view/` - UI components for the annual view
- `experiments/calendar/` - Experimental calendar APIs for Thunderbird integration
- `icons/` - SVG icons for light and dark themes
- `media/` - Screenshots and documentation assets

## Technology Stack

- **Platform**: Thunderbird WebExtension API (manifest v3)
- **Languages**: JavaScript (ES6+), HTML5, CSS3
- **APIs**: Thunderbird Spaces API, experimental calendar APIs
- **Version Support**: Thunderbird 147.0 to 148.0
- **No build tools**: Direct JavaScript, no transpilation or bundling

## Coding Standards

### JavaScript
- Use modern ES6+ syntax (async/await, arrow functions, template literals)
- Use `const` and `let`, avoid `var`
- Prefer async/await over promise chains
- Use browser.* API namespaces (WebExtension standard)
- Include descriptive console.log statements for debugging
- Follow existing naming conventions:
  - camelCase for functions and variables
  - PascalCase for class names

### File Organization
- Keep related functionality together in single files
- Background scripts in `src/background/`
- UI components in `src/ui/`
- Experimental APIs in `experiments/calendar/`

### Comments
- Add comments to explain complex logic or Thunderbird-specific behavior
- Document function purposes when not obvious from name
- Keep comments concise and relevant
- When changing code, review nearby comments and update/add them if intent is not obvious

## Building and Testing

### Creating XPI Package
The project uses a manual zip-based build process:
```bash
zip -r calendar-annual-view.xpi manifest.json src experiments icons
```

### Testing in Thunderbird
1. Open Thunderbird
2. Go to Tools > Add-ons and Themes
3. Click the gear icon > Install Add-on From File
4. Select the .xpi file
5. Test the annual view by clicking the space icon

### No Automated Tests
This project currently has no automated test suite. Manual testing in Thunderbird is required.

## Key Features

- Annual grid view with 12 months
- Multi-calendar support with automatic detection
- Calendar filtering and event duration filters
- Light and dark theme support
- Read-only view (editing via standard Thunderbird views)

## Important Considerations

### Thunderbird-Specific
- Uses Thunderbird Spaces API for sidebar integration
- Experimental calendar APIs for calendar data access
- Theme-aware icons for light/dark mode
- Respects Thunderbird's calendar color settings

### WebExtension Compatibility
- Manifest v3 format
- Strict version range (147.0-148.0)
- Uses browser.* namespace (not chrome.*)
- Requires specific permissions: tabs, storage

### Release Process
- Version tags trigger GitHub Actions workflow
- Workflow automatically builds XPI and creates releases
- Tag format: v{major}.{minor}.{patch} (e.g., v1.0.0)

## Common Tasks

### Adding a New Feature
1. Modify relevant files in `src/`
2. Update manifest.json if new permissions needed
3. Test manually in Thunderbird
4. Always update README.md when user-facing behavior, setup, options, or compatibility details change
5. Update version in manifest.json
6. Create git tag for release

### Modifying Calendar Behavior
- Calendar data access: `experiments/calendar/parent/ext-calendar-*.js`
- UI rendering: `src/ui/year-view/`
- Storage/settings: `src/ui/year-view/storage.js`

### Styling Changes
- Main styles: `src/ui/year-view/year-view.css`
- Support both light and dark themes
- Use CSS variables for theme-dependent colors
- Test in both theme modes
- If GUI output changes, include at least one updated screenshot in the PR

## Troubleshooting

### Common Issues
- **Events not showing**: Check calendar permissions and experimental API schemas
- **Icons not displaying**: Verify SVG paths in manifest.json
- **Space not creating**: Check browser.spaces API compatibility with TB version
- **Colors incorrect**: Verify theme detection in theme.js

## Files to Avoid Modifying

- `LICENSE` - Mozilla Public License 2.0
- `.git/` - Git internals
- `media/` - Screenshots for documentation (unless updating)

## Making Changes

When making code changes:
1. Keep changes minimal and focused
2. Maintain compatibility with Thunderbird 147.0-148.0
3. Preserve existing functionality
4. Test in both light and dark themes
5. Verify calendar detection still works
6. Check that the space opens correctly

## Version Management

- Current version defined in `manifest.json`
- Update version number for releases
- Follow semantic versioning (major.minor.patch)
- Push tags to trigger automated release builds
