# End-to-end installation test

This directory contains the real-Thunderbird end-to-end test for the
Calendar Year View add-on.  The test installs the add-on **from source**
(via Thunderbird's extension-proxy mechanism, which is equivalent to the
"Load Temporary Add-on" flow on the Debug Add-on page) and verifies the
following:

1. **Installation succeeds** — the add-on appears as `active` in
   Thunderbird's `extensions.json` database.
2. **No add-on errors** — the Thunderbird log contains no errors or
   warnings attributable to the add-on.
3. **Thunderbird renders** — a screenshot of the running Thunderbird
   window is saved as proof.

## Prerequisites

The test runs on the host machine using the snap-installed Thunderbird.
Install the tools once:

```sh
# Thunderbird 153 via snap (already installed on GitHub runners)
sudo snap install thunderbird

# Headless display + screenshot tooling
sudo apt install -y xvfb scrot xdotool
```

No Docker is required; the test is intentionally host-native so an AI
agent can run it from the terminal and inspect the output inline.

## Running the test

From the repository root:

```sh
./test/e2e/run-e2e-test.sh
```

The script takes roughly 30 seconds (25 seconds of which is waiting for
Thunderbird's UI to fully render before taking the screenshot).

The SaaS demo has a separate credential-free Playwright smoke test. It runs in
Chromium against the Vite SaaS host and does not require Clerk or Google
credentials:

```sh
npx playwright install --with-deps chromium
npm run test:e2e:saas
```

That test verifies the rendered demo calendar, four demo calendars, year
navigation, view mode, theme control, option collapse, and browser console
errors. Playwright is not used for the native Thunderbird window test below.

## Output artifacts

All artifacts are written to `test-results/` (gitignored):

| File | Contents |
| --- | --- |
| `test-results/addon-installed.png` | Screenshot of the running Thunderbird window |
| `test-results/thunderbird.log` | Full Thunderbird stdout + stderr |
| `test-results/result.txt` | `PASS` or `FAIL` (exit code also reflects this) |

## What the test checks

| Check | How |
| --- | --- |
| Thunderbird 153 is available | `--version` output |
| Extension proxy written | `extensions/{ext-id}` file points to the assembled `dist/package` root |
| Thunderbird window appears | `xdotool search --class Thunderbird` |
| Screenshot is not blank | File size > 20 KB (uniform black PNG compresses to < 5 KB) |
| No add-on errors in log | `grep` for lines matching both the extension ID and `error/warning` |
| No install-phase failures | `grep` for WebExtension install-failure patterns |
| Add-on is active | Parse `extensions.json`, confirm `active=True` |

## How the extension proxy works

The file `test/.thunderbird-profile/extensions/GlamorousPotato.calendar-annual-view@addons.thunderbird.net`
contains the path to the repository root.  Thunderbird reads this file on
startup and loads the add-on from source — the same mechanism used by
the Debug Add-on page.  The profile also sets:

- `xpinstall.signatures.required = false` — allows unsigned extensions
- `extensions.autoDisableScopes = 0` — prevents auto-disable of proxy-loaded extensions
- `extensions.experiments.enabled = true` — enables Experiment API access

These preferences are in `test/.thunderbird-profile/user.js` which Thunderbird
reads on every startup but never overwrites.

## Docker alternative

A Docker-based GUI environment is also available via
`docker compose -f docker/docker-compose.yml up`
(opens at <http://localhost:5800>).  That approach is primarily useful for
manual exploration.  The script above is preferred for automated testing
because it does not require Docker and runs directly in the agent's terminal.
