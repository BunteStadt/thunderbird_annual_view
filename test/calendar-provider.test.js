const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadCalendarProviderModule() {
    const modulePath = path.resolve(__dirname, '../src/ui/year-view/calendar-provider.js');
    await fs.access(modulePath);
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

test('calendar provider exposes resolveCalendarAllDayOnly as a named export', async () => {
    const module = await loadCalendarProviderModule();

    assert.equal(typeof module.resolveCalendarAllDayOnly, 'function');
    assert.equal(module.resolveCalendarAllDayOnly('cal', { allDayOnly: true }), true);
    assert.equal(module.resolveCalendarAllDayOnly('cal', { allDayOnly: false, calendarAllDayModes: { cal: 'no' } }), false);
    assert.equal(module.resolveCalendarAllDayOnly('cal', { allDayOnly: false, calendarAllDayModes: { cal: 'yes' } }), true);
});
