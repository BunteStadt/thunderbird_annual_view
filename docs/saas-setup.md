# Annual View SaaS Setup

This guide records the setup sequence for the Annual View SaaS application. It
uses Supabase for authentication and the subscription database, Google Cloud
for Google OAuth and Calendar access, Stripe for test subscriptions, and
Cloudflare Workers for the application server and static assets.

The commands below use placeholders. Never commit `.env.local` or `.dev.vars`,
and never put secret values in documentation, source control, or chat.

## 1. Install dependencies

From the repository root:

```sh
npm install
```

The repository already contains the SaaS frontend, Worker routes, Supabase
migration, and Stripe integration.

## 2. Create the Supabase project

1. Open the Supabase dashboard and create a project.
2. Choose a project name and a region close to the expected users.
3. Store the database password securely.
4. Open **Project Settings > API** and keep these values available:
   - Project URL
   - Publishable key
   - Service-role key or secret key

The publishable key may be used by the browser. The service-role key is a
server-only secret and must never be included in the frontend build.

## 3. Apply the database migration

1. In Supabase, open **SQL Editor**.
2. Create a new query.
3. Copy the complete contents of
   `supabase/migrations/20260806210000_saas_billing.sql` into the editor.
4. Click **Run**.
5. In **Table Editor**, confirm that these tables exist:
   - `subscriptions`
   - `stripe_webhook_events`

The migration enables row-level security. Authenticated users can read only
their own subscription row. Browser clients cannot write subscriptions or
webhook records; the Worker uses the service-role key for those operations.

## 4. Create Google OAuth credentials

Google login is configured through Supabase, but the OAuth application is
created in Google Cloud.

1. Open Google Cloud Console and create or select a project.
2. Enable **Google Calendar API** in **APIs & Services > Library**.
3. Open **OAuth consent screen**.
4. Choose **External** for a normal public web application.
5. Set the application name and support/contact email addresses.
6. Add the Calendar read-only scope:

   ```text
   https://www.googleapis.com/auth/calendar.readonly
   ```

7. Add the Google accounts used for testing as test users.
8. In **APIs & Services > Credentials**, create an **OAuth client ID** for a
   **Web application**.
9. Add this authorized redirect URI:

   ```text
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

10. Copy the Google client ID and client secret into Supabase under
    **Authentication > Providers > Google** and enable the provider.

Google may show an unverified-app warning while the consent screen is in test
mode. That is expected for local testing. The app may require Google's review
before general public use because Calendar access is a sensitive scope.

## 5. Configure Supabase URLs

In Supabase, open **Authentication > URL Configuration**.

For local testing, use:

```text
Site URL:
http://localhost:8788
```

Add this redirect URL:

```text
http://localhost:8788/auth/callback
```

If using the Vite-only frontend on port 5173, also add:

```text
http://localhost:5173/auth/callback
```

Add the final HTTPS production callback after the Cloudflare URL or custom
domain is known.

## 6. Create the Stripe test product

1. Open the Stripe Dashboard.
2. Turn on **Test mode**.
3. Open **Product catalog > Add product**.
4. Create a product for Annual View.
5. Add two recurring prices to the product:
   - Currency: EUR; amount `2.00`; interval: monthly
   - Currency: EUR; amount `12.00`; interval: yearly
6. Copy both **Price IDs**, which start with `price_`.
7. Configure the Stripe Billing Portal.
8. Configure automatic tax for the test account.
9. Configure cancellation at the end of the paid period.

Use the Price IDs, not the Product ID, in `STRIPE_PRICE_MONTHLY_ID` and
`STRIPE_PRICE_ANNUAL_ID`.

## 7. Create local environment files

The repository ignores these files by default. From the repository root:

```sh
cp .env.example .env.local
cp .dev.vars.example .dev.vars
```

`.env.local` contains only browser-safe Supabase configuration:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<supabase-publishable-key>
```

`.dev.vars` contains Worker configuration:

```dotenv
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<supabase-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
STRIPE_SECRET_KEY=<stripe-test-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-local-webhook-secret>
STRIPE_PRICE_MONTHLY_ID=<stripe-monthly-price-id>
STRIPE_PRICE_ANNUAL_ID=<stripe-annual-price-id>
APP_URL=http://localhost:8788
```

The service-role key, Stripe secret key, and webhook secret must remain server
side. Do not paste a completed `.dev.vars` file into an issue, pull request, or
chat message.

The SaaS Vite configuration loads environment files from the repository root.
This is important because the Vite source root is `src/hosts/saas` while the
local environment files live at the repository root.

## 8. Run the local application

For the public frontend only:

```sh
npm run dev:saas
```

For the complete frontend and Worker API:

```sh
npm run build:saas
npx wrangler dev --port 8788
```

Open:

```text
http://localhost:8788
```

Check the Worker health endpoint:

```sh
curl http://localhost:8788/api/health
```

Expected response:

```json
{"status":"ok"}
```

## 9. Forward Stripe test webhooks

Install the Stripe CLI, then authenticate it:

```sh
stripe login
```

In a separate terminal, forward test webhooks to the local Worker:

```sh
stripe listen --forward-to http://localhost:8788/api/stripe/webhook
```

The CLI prints a temporary webhook signing secret. Put that value in
`STRIPE_WEBHOOK_SECRET` in `.dev.vars`, then restart Wrangler. Keep the Stripe
listener running during checkout tests.

## 10. Test login and checkout

1. Open `http://localhost:8788`.
2. Sign in with Google.
3. Approve the read-only Calendar permission.
4. Open the subscription page and start checkout.
5. Enter a billing address. Automatic tax requires an address.
6. Use Stripe's test card:

   ```text
   Number: 4242 4242 4242 4242
   Expiry: any future date
   CVC: any three digits
   ```

7. Complete checkout.
8. Confirm the Stripe CLI shows a successful webhook delivery.
9. In Supabase **Table Editor > subscriptions**, confirm the current user has a
   row with `status` set to `active`.
10. Refresh the application and open the calendar.

The Worker verifies webhook signatures, records processed event IDs, ignores
duplicate events, and synchronizes subscription state into Supabase.

## 11. Validation commands

Run the focused SaaS checks:

```sh
npm run typecheck:saas
node --test test/hosts/saas/*.test.js
npm run build:saas
```

Run the full repository checks before deployment:

```sh
npm run typecheck:saas
node --test
npm run build:web
npm run build:thunderbird
npm run build:saas
npx wrangler deploy --dry-run
```

Existing Vite and Node module-type warnings are non-fatal if the commands still
complete successfully.

## 12. Cloudflare deployment

Authenticate Wrangler:

```sh
npx wrangler login
npx wrangler whoami
```

Deploy the Worker and static assets:

```sh
npm run deploy:saas
```

For production, configure separate production values for Supabase, Stripe, and
`APP_URL`. Store server-only values as Cloudflare Worker secrets. Do not use
Stripe test keys or the local webhook secret in production.

After deployment:

1. Add the production callback URL to Supabase.
2. Add the production site URL and callback URL to Google/Supabase settings.
3. Register `https://<production-host>/api/stripe/webhook` in Stripe.
4. Subscribe the endpoint to the supported checkout, subscription, and invoice
   lifecycle events.
5. Store the production Stripe signing secret in Cloudflare.
6. Test the complete lifecycle before accepting real payments.

## Current status

The local setup has been verified through Google login and a Stripe test
checkout. The database migration is applied, the Worker health endpoint works,
and the checkout flow handles billing-address collection for automatic tax.

Production deployment, live Stripe configuration, legal text, and browser
end-to-end automation still need to be completed before launch.
