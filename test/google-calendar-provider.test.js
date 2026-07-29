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
