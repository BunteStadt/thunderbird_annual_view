const test = require('node:test');
const assert = require('node:assert/strict');

async function loadProviderModule() {
    return import('../../../src/hosts/saas/src/saas-google-provider.ts');
}

function installFetch(t, response) {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        return {
            ok: response.ok ?? true,
            status: response.status ?? 200,
            async json() {
                return response.body;
            }
        };
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });
    return requests;
}

test('SaaS Google provider sends the Clerk token and maps calendar data', async (t) => {
    const requests = installFetch(t, {
        body: {
            calendars: [
                { id: 'team@example.com', name: 'Team', color: '#3367d6' }
            ]
        }
    });
    const { createSaasGoogleProvider } = await loadProviderModule();
    const provider = createSaasGoogleProvider(async () => 'clerk-session-token');

    const calendars = await provider.fetchCalendars();

    assert.deepEqual(calendars, [
        { id: 'team@example.com', name: 'Team', color: '#3367d6' }
    ]);
    assert.equal(requests[0].options.headers.Authorization, 'Bearer clerk-session-token');
    assert.deepEqual(provider.getAuthState(), { configured: true, authenticated: true });
});

test('SaaS Google provider maps dates and applies per-calendar all-day filtering', async (t) => {
    const requests = installFetch(t, {
        body: {
            events: [
                {
                    id: 'timed',
                    calendarId: 'team@example.com',
                    title: 'Planning',
                    start: '2026-03-02T09:00:00.000Z',
                    end: '2026-03-02T10:30:00.000Z',
                    allDay: false,
                    description: '',
                    location: '',
                    calendarName: 'Team',
                    calendarColor: '#3367d6'
                },
                {
                    id: 'holiday',
                    calendarId: 'team@example.com',
                    title: 'Holiday',
                    start: '2026-03-10',
                    end: '2026-03-12',
                    allDay: true,
                    description: '',
                    location: '',
                    calendarName: 'Team',
                    calendarColor: '#3367d6'
                }
            ]
        }
    });
    const { createSaasGoogleProvider } = await loadProviderModule();
    const provider = createSaasGoogleProvider(async () => 'clerk-session-token');

    const events = await provider.fetchCalendarEvents(2026, {
        calendarIds: ['team@example.com'],
        allDayOnly: true,
        calendarAllDayModes: { 'team@example.com': 'yes' }
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].id, 'holiday');
    assert.ok(events[0].start instanceof Date);
    assert.equal(events[0].start.getFullYear(), 2026);
    assert.equal(events[0].start.getMonth(), 2);
    assert.equal(events[0].start.getDate(), 10);
    assert.match(requests[0].url, /year=2026/);
    assert.match(requests[0].url, /calendarId=team%40example\.com/);
});

test('SaaS Google provider returns empty results when Clerk token is unavailable', async (t) => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => {
        fetchCalled = true;
        throw new Error('fetch must not be called');
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const { createSaasGoogleProvider } = await loadProviderModule();
    const provider = createSaasGoogleProvider(async () => null);

    assert.deepEqual(await provider.fetchCalendars(), []);
    assert.deepEqual(await provider.fetchCalendarEvents(2026), []);
    assert.equal(fetchCalled, false);
    assert.deepEqual(provider.getAuthState(), { configured: true, authenticated: false });
});

test('SaaS Google provider clears its connection state on sign out', async (t) => {
    installFetch(t, { body: { calendars: [] } });
    const { createSaasGoogleProvider } = await loadProviderModule();
    const provider = createSaasGoogleProvider(async () => 'clerk-session-token');

    await provider.signIn();
    assert.equal(provider.getAuthState().authenticated, true);
    await provider.signOut();
    assert.equal(provider.getAuthState().authenticated, false);
});

test('SaaS Google provider handles Worker errors without leaking response details', async (t) => {
    installFetch(t, {
        ok: false,
        status: 401,
        body: { error: 'secret Google token detail' }
    });
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);
    t.after(() => {
        console.error = originalError;
    });

    const { createSaasGoogleProvider } = await loadProviderModule();
    const provider = createSaasGoogleProvider(async () => 'clerk-session-token');

    assert.deepEqual(await provider.fetchCalendars(), []);
    assert.ok(errors.every((args) => !String(args).includes('secret Google token detail')));
});