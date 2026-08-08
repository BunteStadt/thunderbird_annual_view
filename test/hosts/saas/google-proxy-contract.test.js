const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const providerSource = fs.readFileSync(
    path.resolve(__dirname, '../../../src/hosts/saas/src/saas-google-provider.ts'),
    'utf8'
);
const authSource = fs.readFileSync(
    path.resolve(__dirname, '../../../src/hosts/saas/src/auth.ts'),
    'utf8'
);
const workerSource = fs.readFileSync(
    path.resolve(__dirname, '../../../worker/index.ts'),
    'utf8'
);

test('SaaS sends the short-lived Google token directly to Google Calendar', () => {
    assert.match(providerSource, /fetch\(googleUrl/);
    assert.match(providerSource, /Authorization: `Bearer \$\{session\.provider_token\}`/);
    assert.doesNotMatch(providerSource, /X-Google-Access-Token|\/api\/google/);
});

test('OAuth does not request an offline refresh token and Worker has no Google route', () => {
    assert.doesNotMatch(authSource, /access_type:\s*["']offline["']/);
    assert.match(authSource, /prompt = "consent"/);
    assert.match(providerSource, /auth\.getSession\(\)/);
    assert.match(providerSource, /auth\.refreshSession\(\)/);
    assert.match(providerSource, /signInWithGoogle\("\/app", "none"\)/);
    assert.doesNotMatch(workerSource, /google-calendar|\/api\/google/);
});