const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../../../supabase/migrations/20260806210000_saas_billing.sql'
);
const source = fs.readFileSync(migrationPath, 'utf8');

test('billing migration protects subscription writes and webhook events', () => {
    assert.match(source, /alter table public\.subscriptions enable row level security/i);
    assert.match(source, /auth\.uid\(\)\) = user_id/i);
    assert.match(source, /revoke insert, update, delete on public\.subscriptions from anon, authenticated/i);
    assert.match(source, /alter table public\.stripe_webhook_events enable row level security/i);
    assert.match(source, /revoke all on public\.stripe_webhook_events from anon, authenticated/i);
});

test('billing migration constrains all supported Stripe subscription states', () => {
    for (const status of [
        'incomplete',
        'incomplete_expired',
        'trialing',
        'active',
        'past_due',
        'canceled',
        'unpaid',
        'paused'
    ]) {
        assert.ok(source.includes(`'${status}'`), `missing Stripe status ${status}`);
    }
    assert.match(source, /stripe_customer_id text unique/i);
    assert.match(source, /stripe_subscription_id text unique/i);
    assert.match(source, /event_id text primary key/i);
});