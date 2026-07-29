// Thunderbird development profile — preferences
// Used when starting Thunderbird with: thunderbird -profile test/thunderbird-profile
//
// This profile configures Thunderbird to:
//   - load the add-on from source (unpacked) via the extensions proxy file
//   - pre-register the NRW public holiday ICS calendar from the repository
//   - skip the first-run wizard and disable telemetry
//   - disable extension signature enforcement (required for temporary installs)

// ------------------------------------------------------------------
// First-run / telemetry suppression
// ------------------------------------------------------------------
user_pref("mail.provider.suppress_dialog_on_startup", true);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("app.shield.optoutstudies.enabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);

// ------------------------------------------------------------------
// Auto-update suppression
// ------------------------------------------------------------------
user_pref("app.update.enabled", false);
user_pref("app.update.auto", false);
user_pref("extensions.update.enabled", false);
user_pref("extensions.update.autoUpdateDefault", false);

// ------------------------------------------------------------------
// Extension signature — allow unsigned / unpacked extensions
// ------------------------------------------------------------------
user_pref("xpinstall.signatures.required", false);
// Scope 4 = profile; value 0 means no scope is auto-disabled.
// This prevents Thunderbird from auto-disabling the proxy-installed extension.
user_pref("extensions.autoDisableScopes", 0);
// Allow experiments (required for the calendar experiment APIs)
user_pref("extensions.experiments.enabled", true);

// ------------------------------------------------------------------
// Pre-registered ICS calendar: NRW Feiertage
//
// The URI points to the feiertage_nrw.ics file mounted at /workspace in the
// Docker container (see docker-compose.yml).  When running locally adjust the
// path to match the absolute location of your repository checkout.
//
// Calendar ID: a stable UUID used as the registry key.
// ------------------------------------------------------------------
user_pref("calendar.registry.e1a2b3c4-d5e6-7890-abcd-ef1234567890.uri", "file:///workspace/feiertage_nrw.ics");
user_pref("calendar.registry.e1a2b3c4-d5e6-7890-abcd-ef1234567890.type", "ics");
user_pref("calendar.registry.e1a2b3c4-d5e6-7890-abcd-ef1234567890.name", "NRW Feiertage (Test)");
user_pref("calendar.registry.e1a2b3c4-d5e6-7890-abcd-ef1234567890.color", "#FF0000");
user_pref("calendar.registry.e1a2b3c4-d5e6-7890-abcd-ef1234567890.calendar-main-in-composite", true);

// ------------------------------------------------------------------
// Pre-registered ICS calendar: NRW Schulferien
// ------------------------------------------------------------------
user_pref("calendar.registry.f2b3c4d5-e6f7-8901-bcde-f12345678901.uri", "file:///workspace/ferien_nrw.ics");
user_pref("calendar.registry.f2b3c4d5-e6f7-8901-bcde-f12345678901.type", "ics");
user_pref("calendar.registry.f2b3c4d5-e6f7-8901-bcde-f12345678901.name", "NRW Schulferien (Test)");
user_pref("calendar.registry.f2b3c4d5-e6f7-8901-bcde-f12345678901.color", "#0000FF");
user_pref("calendar.registry.f2b3c4d5-e6f7-8901-bcde-f12345678901.calendar-main-in-composite", true);

// ------------------------------------------------------------------
// Misc UX tweaks for a clean test environment
// ------------------------------------------------------------------
user_pref("mail.tabs.drawInTitlebar", false);
user_pref("app.donation.eoy.version.viewed", 8);
