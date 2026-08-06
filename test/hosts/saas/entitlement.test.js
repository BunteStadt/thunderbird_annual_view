const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('only active Stripe subscriptions grant access', async () => {
    const modulePath = path.resolve(__dirname, '../../../worker/shared/entitlement.js');
    const { hasActiveSubscription } = await import(pathToFileURL(modulePath));

    assert.equal(hasActiveSubscription('active'), true);
    for (const status of [null, undefined, 'none', 'trialing', 'incomplete', 'incomplete_expired', 'past_due', 'canceled', 'unpaid', 'paused']) {
        assert.equal(hasActiveSubscription(status), false, `${status} must not grant access`);
    }
});