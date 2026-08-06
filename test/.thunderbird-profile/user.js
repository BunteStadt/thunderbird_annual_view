// test/.thunderbird-profile/user.js
//
// User preferences applied at every Thunderbird startup.
// Thunderbird reads this file on top of prefs.js but never writes to it,
// so these values survive across sessions.
//
// Purpose:
//   - Load the add-on from source via the extensions proxy file
//   - Pre-register the NRW ICS calendars from the repository
//   - Suppress all first-run wizards and dialogs so the test gets a clean window
//   - Disable extension signature enforcement (required for unpacked installs)

// ------------------------------------------------------------------
// First-run / telemetry suppression
// ------------------------------------------------------------------
user_pref("mail.provider.suppress_dialog_on_startup", true);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("app.shield.optoutstudies.enabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("toolkit.telemetry.enabled", false);
// Don't show the "What's New" tab after updates
user_pref("app.update.showInstalledUI", false);
// Don't show donation / end-of-year screens
user_pref("app.donation.eoy.version.viewed", 8);

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
// Scope 4 = profile; 0 disables auto-disabling so proxy-installed
// extensions are not silently disabled on startup.
user_pref("extensions.autoDisableScopes", 0);
// Allow experiment APIs (required for the calendar experiment APIs in this add-on)
user_pref("extensions.experiments.enabled", true);
// Mirror extension/content console output to stdout/stderr so CI logs include add-on logging.
user_pref("devtools.console.stdout.content", true);
// Suppress the extension install notification bar
user_pref("extensions.ui.lastCategory", "addons://list/extension");

// ------------------------------------------------------------------
// Suppress account setup wizard
//
// Thunderbird skips the account setup wizard when at least one mail
// server is already configured.  We register a "Local Folders" account
// (server type "none") which requires no network access.
// ------------------------------------------------------------------
user_pref("mail.accountmanager.accounts", "account1");
user_pref("mail.accountmanager.defaultaccount", "account1");
user_pref("mail.accountmanager.localfoldersaccount", "account1");
user_pref("mail.account.account1.server", "server1");
user_pref("mail.account.account1.identities", "id1");
user_pref("mail.server.server1.type", "none");
user_pref("mail.server.server1.hostname", "Local Folders");
user_pref("mail.server.server1.name", "Local Folders");
user_pref("mail.server.server1.userName", "nobody");
user_pref("mail.identity.id1.fullName", "Test User");
user_pref("mail.identity.id1.useremail", "test@localhost");
user_pref("mail.identity.id1.smtpServer", "");

// ------------------------------------------------------------------
// Suppress additional first-run dialogs
// ------------------------------------------------------------------
// Don't show the Thunderbird start page on first launch
user_pref("mailnews.start_page.enabled", false);
// Don't prompt to integrate Lightning calendar
user_pref("calendar.integration.notify", false);
// Don't show the offline/online dialog
user_pref("offline.startup_state", 0);
// Disable the session-restore dialog on unclean exit
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("toolkit.startup.max_resumed_crashes", -1);

// ------------------------------------------------------------------
// Pre-registered ICS calendar: NRW Feiertage
//
// The URI uses a placeholder path. The e2e test script substitutes the
// actual repository root path before starting Thunderbird.
// For manual Docker use the path resolves to /workspace/feiertage_nrw.ics.
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
// Misc UX tweaks for a clean test window
// ------------------------------------------------------------------
user_pref("mail.tabs.drawInTitlebar", false);
