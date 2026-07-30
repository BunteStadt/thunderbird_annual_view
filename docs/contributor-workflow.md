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

The standalone page can be used for faster iteration and debugging. It supports dummy data via the URL parameter `?dummy=1` and is useful for validating rendering behavior without the Thunderbird environment.
It also supports Google Calendar integration via `?google=1` using a Google OAuth web client ID configured in `src/ui/year-view/google-client-id.js`.

## 3. GitHub workflows and CI

The repository uses GitHub Actions for build, test, lint, and release automation:

- [build.yml](../.github/workflows/build.yml) builds the XPI package and uploads it as a workflow artifact.
- [ci-tests.yml](../.github/workflows/ci-tests.yml) runs the repository test suite with Node.js via `node --test`.
- [linter.yml](../.github/workflows/linter.yml) builds the XPI, runs the Thunderbird web extension linter, and publishes the report.
- [release.yml](../.github/workflows/release.yml) builds the XPI, generates sample images, and publishes a draft release when a version tag is pushed.

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
|---|---|
| `test/addon-integration.test.js` | Manifest integrity and XPI build |
| `test/background-runtime.test.js` | Background script click handler |
| `test/calendar-service.test.js` | Calendar service with dummy and injected providers |
| `test/thunderbird-provider.test.js` | `ThunderbirdCalendarProvider` end-to-end with mocked `browser.calendar.*` API fed from `feiertage_nrw.ics` |
| `test/date-utils.test.js` | Date utility functions |
| `test/event-store.test.js` | Event store filtering and caching |
| `test/storage-theme.test.js` | Storage and theme helpers |

The `thunderbird-provider.test.js` file simulates the exact API shape that
Thunderbird exposes to the add-on background and verifies that
`ThunderbirdCalendarProvider` correctly parses real ICS calendar data into
normalised event objects.

### Real-Thunderbird end-to-end test

`e2e/run-e2e-test.sh` installs the add-on on a **real Thunderbird 153**
instance (the host snap installation), verifies the log is clean, and
saves a screenshot.  Run it from the repository root:

```sh
./e2e/run-e2e-test.sh
```

Prerequisites (once):

```sh
sudo snap install thunderbird   # already present on GitHub runners
sudo apt install -y xvfb scrot xdotool
```

Artifacts are written to `test-results/` (gitignored):

| File | Contents |
|---|---|
| `test-results/addon-installed.png` | Screenshot of the Thunderbird window |
| `test-results/thunderbird.log` | Full Thunderbird log |
| `test-results/result.txt` | `PASS` or `FAIL` |

The test exits with code `0` on PASS and `1` on FAIL and is safe to run
inside an agent's terminal loop.  See [e2e/README.md](../e2e/README.md)
for full details.

### Container-based sandboxed development

A slim container now provides the full Thunderbird/Xvfb/Node runtime needed to
run the add-on and the real-Thunderbird e2e test without relying on the host
installation.  It mounts the repository into `/workspace` so local edits are
visible immediately and cloud agents can work inside the sandboxed shell.

```sh
docker compose build
docker compose run --rm dev bash
docker compose run --rm dev ./e2e/run-e2e-test.sh
docker compose run --rm dev node --test
```

If the submodule is not present inside the container yet, initialize it once:

```sh
docker compose run --rm dev bash -lc 'git submodule update --init --recursive'
```

See [thunderbird-profile/README.md](../thunderbird-profile/README.md)
for full instructions about the pre-configured profile used by the e2e test.

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

## 9. Recommended PR checklist

Before submission, confirm:

- the change is scoped and easy to review
- the relevant docs are updated
- behavior remains correct in the current add-on flow
- no unnecessary platform-specific logic was introduced into a shared module
- the change does not block the future monorepo extraction plan
