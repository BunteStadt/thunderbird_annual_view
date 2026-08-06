const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.resolve(__dirname, '../../../worker/routes/stripe-webhook.ts'),
    'utf8'
);

test('Stripe webhook verifies raw payload before claiming an event', () => {
    const verification = source.indexOf('constructEventAsync');
    const claim = source.indexOf('stripe_webhook_events").insert');
    assert.ok(verification >= 0, 'webhook signature verification is required');
    assert.ok(claim > verification, 'event must be verified before it is claimed');
    assert.match(source, /Stripe\.createSubtleCryptoProvider\(\)/);
});

test('Stripe webhook handles subscription lifecycle events idempotently', () => {
    for (const eventType of [
        'checkout.session.completed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.paid',
        'invoice.payment_failed'
    ]) {
        assert.ok(source.includes(`"${eventType}"`), `missing ${eventType}`);
    }
    assert.match(source, /claimError\?\.code === "23505"/);
    assert.match(source, /stripe_event_created_at/);
    assert.match(source, /\.delete\(\)\.eq\("event_id", event\.id\)/);
});