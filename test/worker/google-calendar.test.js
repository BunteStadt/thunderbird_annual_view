const test = require('node:test');
const assert = require('node:assert/strict');

async function loadGoogleCalendarModule() {
    return import('../../worker/google-calendar.ts');
}

function installFetch(t, responses) {
    const originalFetch = globalThis.fetch;
    const requests = [];
    let responseIndex = 0;

    globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        const response = responses[responseIndex++];
        if (!response) throw new Error('Unexpected Google API request');
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

test('fetchGoogleCalendars follows pagination and maps calendar metadata', async (t) => {
    const requests = installFetch(t, [
        {
            body: {
                items: [
                    { id: 'team@example.com', summary: 'Team', backgroundColor: '#3367d6' },
                    { summary: 'Missing id' }
                ],
                nextPageToken: 'page-2'
            }
        },
        {
            body: {
                items: [
                    { id: 'private@example.com', foregroundColor: '#16a765' }
                ]
            }
        }
    ]);
    const { fetchGoogleCalendars } = await loadGoogleCalendarModule();

    const calendars = await fetchGoogleCalendars('google-token');

    assert.deepEqual(calendars, [
        { id: 'team@example.com', name: 'Team', color: '#3367d6' },
        { id: 'private@example.com', name: 'private@example.com', color: '#16a765' }
    ]);
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[1].url).searchParams.get('pageToken'), 'page-2');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer google-token');
});

test('fetchGoogleEvents maps timed and all-day events and follows event pages', async (t) => {
    const requests = installFetch(t, [
        {
            body: {
                items: [
                    { id: 'team@example.com', summary: 'Team', backgroundColor: '#3367d6' }
                ]
            }
        },
        {
            body: {
                items: [
                    {
                        id: 'timed-1',
                        summary: 'Planning',
                        start: { dateTime: '2026-03-02T09:00:00Z' },
                        end: { dateTime: '2026-03-02T10:30:00Z' },
                        location: 'Room A'
                    }
                ],
                nextPageToken: 'events-page-2'
            }
        },
        {
            body: {
                items: [
                    {
                        id: 'day-1',
                        summary: 'Holiday',
                        start: { date: '2026-03-10' },
                        end: { date: '2026-03-12' }
                    },
                    {
                        summary: 'Missing end',
                        start: { dateTime: '2026-04-01T12:00:00Z' },
                        end: { dateTime: '2026-04-01T11:00:00Z' }
                    }
                ]
            }
        },
        {
            body: {
                items: [
                    {
                        id: 'day-2',
                        summary: 'Second page',
                        start: { date: '2026-05-01' },
                        end: { date: '2026-05-02' }
                    }
                ]
            }
        }
    ]);
    const { fetchGoogleEvents } = await loadGoogleCalendarModule();

    const events = await fetchGoogleEvents('google-token', 2026, ['team@example.com']);

    assert.equal(events.length, 3);
    assert.deepEqual(events[0], {
        id: 'timed-1',
        calendarId: 'team@example.com',
        title: 'Planning',
        start: '2026-03-02T09:00:00.000Z',
        end: '2026-03-02T10:30:00.000Z',
        allDay: false,
        description: '',
        location: 'Room A',
        calendarName: 'Team',
        calendarColor: '#3367d6'
    });
    assert.equal(events[1].allDay, true);
    assert.equal(events[1].start, '2026-03-10T00:00:00.000Z');
    assert.equal(events[1].end, '2026-03-12T00:00:00.000Z');
    assert.equal(events[2].end, '2026-04-01T13:00:00.000Z');

    assert.equal(requests.length, 3);
    const eventRequest = new URL(requests[1].url);
    assert.equal(eventRequest.searchParams.get('singleEvents'), 'true');
    assert.equal(eventRequest.searchParams.get('orderBy'), 'startTime');
    assert.equal(eventRequest.searchParams.get('timeMin'), '2026-01-01T00:00:00.000Z');
    assert.equal(eventRequest.searchParams.get('timeMax'), '2027-01-01T00:00:00.000Z');
    assert.equal(new URL(requests[2].url).searchParams.get('pageToken'), 'events-page-2');
});

test('fetchGoogleEvents ignores invalid events and respects selected calendars', async (t) => {
    const requests = installFetch(t, [
        {
            body: {
                items: [
                    { id: 'selected@example.com', summary: 'Selected', backgroundColor: '#3367d6' },
                    { id: 'other@example.com', summary: 'Other', backgroundColor: '#16a765' }
                ]
            }
        },
        {
            body: {
                items: [
                    { id: 'selected', summary: 'Selected', start: { date: '2026-01-01' }, end: { date: '2026-01-02' } },
                    { id: 'invalid', summary: 'Invalid', start: { date: 'not-a-date' } }
                ]
            }
        }
    ]);
    const { fetchGoogleEvents } = await loadGoogleCalendarModule();

    const events = await fetchGoogleEvents('google-token', 2026, ['selected@example.com']);

    assert.equal(events.length, 1);
    assert.equal(events[0].id, 'selected');
    assert.match(requests[1].url, /selected%40example\.com/);
});

test('Google API failures are surfaced to the caller', async (t) => {
    installFetch(t, [{ ok: false, status: 403, body: { error: 'forbidden' } }]);
    const { fetchGoogleCalendars } = await loadGoogleCalendarModule();

    await assert.rejects(
        fetchGoogleCalendars('google-token'),
        /Google Calendar API request failed \(403\)/
    );
});