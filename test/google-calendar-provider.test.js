const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadGoogleProviderModule() {
    const modulePath = path.resolve(__dirname, '../src/ui/year-view/google-calendar-provider.js');
    await fs.access(modulePath);
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

test('GoogleCalendarProvider maps calendars and events from Google API responses', async () => {
    const { GoogleCalendarProvider } = await loadGoogleProviderModule();
    const requests = [];

    const authSession = {
        setClientId() { },
        getAuthState() {
            return { configured: true, authenticated: true, clientId: 'test-client' };
        },
        async signIn() { },
        async signOut() { },
        isAuthenticated() {
            return true;
        },
        async authorizedFetch(url) {
            requests.push(url);
            if (url.includes('/calendarList')) {
                return {
                    items: [
                        { id: 'team@example.com', summary: 'Team', backgroundColor: '#3367d6' },
                        { id: 'private@example.com', summary: 'Private', backgroundColor: '#16a765' }
                    ]
                };
            }
            if (url.includes('/team%40example.com/events')) {
                return {
                    items: [
                        {
                            id: 'event-team-1',
                            summary: 'Planning',
                            start: { dateTime: '2026-03-02T09:00:00Z' },
                            end: { dateTime: '2026-03-02T10:30:00Z' }
                        },
                        {
                            id: 'event-team-2',
                            summary: 'All day offsite',
                            start: { date: '2026-03-10' },
                            end: { date: '2026-03-12' }
                        }
                    ]
                };
            }
            if (url.includes('/private%40example.com/events')) {
                return {
                    items: [
                        {
                            id: 'event-private-1',
                            summary: 'Vacation',
                            start: { date: '2026-07-01' },
                            end: { date: '2026-07-05' }
                        }
                    ]
                };
            }
            return { items: [] };
        }
    };

    const provider = new GoogleCalendarProvider(authSession);

    const calendars = await provider.fetchCalendars();
    assert.deepEqual(calendars.map((calendar) => calendar.id), ['team@example.com', 'private@example.com']);

    const allEvents = await provider.fetchCalendarEvents(2026, { calendarIds: ['team@example.com', 'private@example.com'] });
    assert.equal(allEvents.length, 3);
    assert.equal(allEvents[0].calendarName.length > 0, true);

    const onlyAllDayForTeam = await provider.fetchCalendarEvents(2026, {
        calendarIds: ['team@example.com'],
        allDayOnly: true,
        calendarAllDayModes: { 'team@example.com': 'yes' }
    });
    assert.equal(onlyAllDayForTeam.length, 1);
    assert.equal(onlyAllDayForTeam[0].allDay, true);
    assert.equal(requests.some((url) => url.includes('/calendarList')), true);
});

test('GoogleAuthSession retries once with consent when Google returns scope-related 403', async (t) => {
    const { GoogleAuthSession } = await loadGoogleProviderModule();

    const originalGoogle = globalThis.google;
    const originalFetch = globalThis.fetch;
    t.after(() => {
        if (originalGoogle === undefined) delete globalThis.google;
        else globalThis.google = originalGoogle;
        if (originalFetch === undefined) delete globalThis.fetch;
        else globalThis.fetch = originalFetch;
    });

    let tokenClientCallback = null;
    const requestedPrompts = [];
    let accessTokenCounter = 0;

    globalThis.google = {
        accounts: {
            oauth2: {
                initTokenClient() {
                    return {
                        set callback(fn) {
                            tokenClientCallback = fn;
                        },
                        requestAccessToken({ prompt }) {
                            requestedPrompts.push(prompt ?? "");
                            accessTokenCounter += 1;
                            tokenClientCallback({
                                access_token: `token-${accessTokenCounter}`,
                                expires_in: 3600
                            });
                        }
                    };
                }
            }
        }
    };

    const fetchCalls = [];
    globalThis.fetch = async (url, options = {}) => {
        fetchCalls.push(options?.headers?.Authorization || "");
        if (fetchCalls.length === 1) {
            return {
                ok: false,
                status: 403,
                clone() {
                    return {
                        async json() {
                            return {
                                error: {
                                    message: 'Request had insufficient authentication scopes.',
                                    status: 'PERMISSION_DENIED',
                                    errors: [{ reason: 'insufficientPermissions' }]
                                }
                            };
                        }
                    };
                }
            };
        }
        return {
            ok: true,
            status: 200,
            async json() {
                return { items: [] };
            }
        };
    };

    const session = new GoogleAuthSession();
    session.setClientId('test-client-id.apps.googleusercontent.com');
    await session.signIn();

    const result = await session.authorizedFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    assert.deepEqual(result, { items: [] });
    assert.deepEqual(requestedPrompts, ['consent', 'consent']);
    assert.equal(fetchCalls[0].endsWith('token-1'), true);
    assert.equal(fetchCalls[1].endsWith('token-2'), true);
});
