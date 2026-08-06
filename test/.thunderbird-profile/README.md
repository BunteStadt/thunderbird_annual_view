# Thunderbird test profile

This directory contains a pre-configured Thunderbird profile for testing the
add-on installation from source and the calendar provider integration.

## What is pre-configured

| Item | Details |
| --- | --- |
| Add-on (unpacked) | `extensions/GlamorousPotato.calendar-annual-view@addons.thunderbird.net` — proxy file pointing to `/workspace` (Docker) |
| Calendar 1 | NRW Feiertage from `feiertage_nrw.ics` (ICS type, red) |
| Calendar 2 | NRW Schulferien from `ferien_nrw.ics` (ICS type, blue) |
| Signature check | Disabled (`xpinstall.signatures.required = false`) |
| First-run wizard | Suppressed |
| Auto-updates | Disabled |
| Experiments | Enabled (required for the calendar experiment APIs) |

## Usage

### Option A — Docker (recommended)

The `docker/docker-compose.yml` file mounts the source code at `/workspace`
inside the container.  The profile is mounted to `/config/profile`
so Thunderbird uses it on startup.

```sh
docker compose -f docker/docker-compose.yml up
```

Then open <http://localhost:5800> in a browser to see the Thunderbird GUI.

The add-on is loaded automatically because the extensions proxy file
(`extensions/GlamorousPotato.calendar-annual-view@addons.thunderbird.net`)
points to `/workspace`, which is the mounted source directory.

The two ICS calendars are registered and will appear in the Calendar tab once
Thunderbird fetches the files from `file:///workspace/`.

### Option B — Local Thunderbird installation

1. Copy or symlink this profile to a convenient location:

   ```sh
   cp -r test/.thunderbird-profile /tmp/tb-test-profile
   ```

2. Update the calendar URIs in `user.js` to match your local repository path:

   ```js
   user_pref("calendar.registry.e1a2b3c4-....uri",
             "file:///your/path/to/thunderbird_annual_view/feiertage_nrw.ics");
   ```

3. Update the extension proxy file content to match your local path:

   ```sh
   echo "/your/path/to/thunderbird_annual_view" \
   > test/.thunderbird-profile/extensions/GlamorousPotato.calendar-annual-view@addons.thunderbird.net
   ```

4. Launch Thunderbird with the profile:

   ```sh
   thunderbird -profile /tmp/tb-test-profile
   ```

## Verifying the installation

After Thunderbird starts:

1. Open the **Add-ons Manager** (`Tools > Add-ons and Themes`).  
   You should see **Calendar Annual View** listed with status *Enabled*.

2. Open the **Calendar** tab.  
   The two ICS calendars (NRW Feiertage and NRW Schulferien) should appear in
   the calendar list on the left.  If events are not visible, right-click a
   calendar and choose *Reload Remote Calendars*.

3. Click the **Calendar Annual View** toolbar button (space icon).  
   The annual grid should open and display events from the two calendars,
   confirming that the provider integration is working end-to-end.

## Automated tests

The Node.js integration test `test/thunderbird-provider.test.js` covers the
same calendar provider path without requiring a running Thunderbird instance.
It mocks `browser.calendar.*` with data from `feiertage_nrw.ics` and verifies
that `ThunderbirdCalendarProvider` correctly parses and returns all events.

Run it with:

```sh
node --test test/thunderbird-provider.test.js
```

or alongside the full suite:

```sh
node --test
```
