# Contributor workflow

## 1. Development environment

This repository is intentionally lightweight. There is no build pipeline required for the current add-on experience; development is mostly done through direct file editing, local browser testing, and manual Thunderbird testing.

Recommended setup:

- use a dedicated Thunderbird profile for extension testing
- use a local simple web server for standalone HTML testing when the Thunderbird runtime is not needed
- keep the current add-on behavior intact while extracting shared logic

## 2. Local development options

### Thunderbird-based testing

Use a dedicated profile and install the add-on from a generated XPI package or from a local unpacked extension when supported by your setup.

### Standalone HTML development

The web shell can be used for faster iteration and debugging. Run `npm run dev:web`
and open `http://localhost:5173/?dummy=1` for dummy data. Google login is always
available in the web header; `?google=1` remains a compatibility alias. Configure
the OAuth client ID in `src/hosts/web/google-client-id.js`.

### SaaS development

The SaaS shell is a separate React/Vite host. It uses Clerk for authentication
and Clerk Billing for pricing and subscription controls;
See [saas-setup.md](saas-setup.md) for
provider configuration and [saas-architecture.md](saas-architecture.md) for
the host boundaries.

```sh
npm run dev:saas
npm run typecheck:saas
npm run build:saas
```

The `/demo` route works without external credentials. Testing `/login`,
`/pricing`, `/account`, and `/app` requires a configured Clerk publishable key;

### Thunderbird linter

Run the same XPI build and `webext-linter` check used by CI locally:

```sh
npm run lint:thunderbird
# or: just lint-thunderbird
```

The command rebuilds `dist/calendar-annual-view.xpi` and writes text and JSON
reports to `test-results/thunderbird-linter/`. The report directory is ignored
by Git. Dependencies are installed with the normal `npm install` or `npm ci`
workflow.

## 3. GitHub workflows and CI

The repository uses GitHub Actions for build, test, lint, and add-on release automation:

- [build.yml](../.github/workflows/build.yml) builds the XPI package and uploads it as a workflow artifact.
- [ci-tests.yml](../.github/workflows/ci-tests.yml) runs the repository test suite with Node.js via `node --test`.
- [linter.yml](../.github/workflows/linter.yml) builds the XPI, runs the Thunderbird web extension linter, and publishes the report.
- [release.yml](../.github/workflows/release.yml) builds the XPI, generates sample images, and publishes a draft release when a version tag is pushed.

The Pages workflow is currently commented out. Web deployment is not active
until that workflow is enabled and its generated `dist/web` paths are verified.

When changing manifest behavior, release packaging, or any shared calendar logic, verify the relevant workflow expectations and, where possible, test locally before pushing.

## 4. Workflow expectations

### Before changing behavior

- read the relevant module and confirm the current interaction flow
- understand the user-visible behavior that should be preserved
- note whether the change affects the addon shell, shared calendar logic, or the UI renderer

### When implementing a feature

- update the smallest relevant module first
- keep platform-specific code isolated from shared logic
- add or update tests where the behavior is meaningful and stable
- document public contracts if a module becomes shared across hosts

### When changing UI behavior

- verify the new experience in both light and dark themes where relevant
- ensure the view remains readable and accessible
- confirm that filters and navigation still behave consistently

## 5. Testing expectations

The repository uses two complementary layers of automated and manual testing.

### Automated tests (CI)

All tests in `test/` are run with `node --test` and execute on every push via
GitHub Actions.  The test suite covers:

| File | Coverage |
| --- | --- |
| `test/hosts/thunderbird/addon-integration.test.js` | Manifest integrity and XPI build |
| `test/hosts/thunderbird/background-runtime.test.js` | Background script click handler |
| `test/core/calendar-service.test.js` | Calendar service with dummy and injected providers |
| `test/hosts/thunderbird/thunderbird-provider.test.js` | `ThunderbirdCalendarProvider` with mocked `browser.calendar.*` APIs and NRW ICS data |
| `test/core/date-utils.test.js` | Date utility functions |
| `test/core/event-store.test.js` | Event store filtering and caching |
| `test/core/storage-theme.test.js` | Storage and theme helpers |
| `test/core/core-boundaries.test.js` | Core imports and host API boundary |
| `test/hosts/web/web-storage-adapter.test.js` | Web storage routing and fallback behavior |

The `thunderbird-provider.test.js` file simulates the exact API shape that
Thunderbird exposes to the add-on background and verifies that
`ThunderbirdCalendarProvider` correctly parses real ICS calendar data into
normalised event objects.

### Real-Thunderbird end-to-end test

`test/e2e/run-e2e-test.sh` installs the add-on on a **real Thunderbird 153**
instance (the host snap installation), verifies the log is clean, and
saves a screenshot.  Run it from the repository root:

```sh
./test/e2e/run-e2e-test.sh
```

Prerequisites (once):

```sh
sudo snap install thunderbird   # already present on GitHub runners
sudo apt install -y xvfb scrot xdotool
```

Artifacts are written to `test-results/` (gitignored):

| File | Contents |
| --- | --- |
| `test-results/addon-installed.png` | Screenshot of the Thunderbird window |
| `test-results/thunderbird.log` | Full Thunderbird log |
| `test-results/result.txt` | `PASS` or `FAIL` |

The test exits with code `0` on PASS and `1` on FAIL and is safe to run
inside an agent's terminal loop.  See [test/e2e/README.md](../test/e2e/README.md)
for full details.

### Manual / Docker GUI

A pre-configured Thunderbird profile lives in `test/.thunderbird-profile/`.  It
installs the add-on from source via an extension proxy file and pre-registers
the NRW ICS calendars.  Use it for interactive end-to-end verification:

```sh
docker compose -f docker/docker-compose.yml up      # opens GUI at http://localhost:5800
```

See [test/.thunderbird-profile/README.md](../test/.thunderbird-profile/README.md)
for full instructions.

### When adding tests

- prefer regression tests for shared domain logic
- verify UI behavior manually in the browser or Thunderbird
- validate filter and rendering changes with dummy data first
- update the table above when adding a new test file

## 6. Coding standards

- use modern JavaScript syntax where compatible with the current environment
- keep functions and modules focused and readable
- avoid introducing bundlers or heavy dependencies unless the monorepo migration explicitly requires them
- preserve naming conventions already used in the repository
- add comments for non-obvious logic, especially around Thunderbird-specific behavior

## 7. Documentation expectations

Any meaningful change should include documentation updates when it affects:

- user-visible behavior
- the architecture boundary between shared and platform-specific logic
- development workflow or release steps
- the planned monorepo transition

## 8. Release and packaging

Release work should follow the existing conventions in the repository:

- update the version when a user-visible change is ready for release
- ensure the packaged build remains consistent with the current manifest and source layout
- test the resulting package manually before publishing
- add-on releases are created by pushing a version tag; the release workflow
 builds and uploads the XPI
- web release automation is still open; do not describe the current repository
 as having an active Pages deployment

## 9. Recommended PR checklist

Before submission, confirm:

- the change is scoped and easy to review
- the relevant docs are updated
- behavior remains correct in the current add-on flow
- no unnecessary platform-specific logic was introduced into a shared module
- the change does not block the future monorepo extraction plan
