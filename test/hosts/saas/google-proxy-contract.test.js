const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.resolve(__dirname, '../../../worker/routes/google-calendar.ts'),
    'utf8'
);

test('Google proxy enforces paid access before reading the provider token', () => {
    const entitlement = source.indexOf('requireEntitlement(request, env)');
    const providerToken = source.indexOf('X-Google-Access-Token');
    assert.ok(entitlement >= 0);
    assert.ok(providerToken > entitlement);
});

test('Google proxy fixes the upstream origin and allowlists operations and parameters', () => {
    assert.match(source, /const GOOGLE_CALENDAR_API = "https:\/\/www\.googleapis\.com\/calendar\/v3"/);
    assert.match(source, /url\.pathname === "\/api\/google\/calendar-list"/);
    assert.match(source, /\/api\\\/google\\\/calendars/);
    assert.match(source, /EVENT_PARAMETERS\.has\(name\)/);
    assert.doesNotMatch(source, /new URL\(url\.searchParams\.get/);
});