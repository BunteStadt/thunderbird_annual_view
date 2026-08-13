# SaaS setup

The SaaS shell is a Vite React application hosted by the Cloudflare Worker. Authentication and account management use Clerk. Subscription presentation and customer billing controls use Clerk Billing. Google Calendar remains a separate, read-only OAuth integration.

## Environment

Create a local `.env` from `.env.example` and set:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

The publishable key is safe for browser use, but do not put Clerk secret keys or payment credentials in frontend environment variables. The Worker serves the health endpoint, static assets, and authenticated Google Calendar routes; it does not contain a local database or direct payment-provider integration.

For `wrangler dev`, create `.dev.vars` from `.dev.vars.example` and provide the
Worker-only Clerk values:

```text
APP_URL=http://localhost:8787
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_JWT_KEY=...
```

## Clerk

1. Create or select a Clerk application.
2. Enable the sign-in methods required by the product.
3. Add the local and production web origins to the Clerk allowed origins.
4. Set the application's publishable key in `VITE_CLERK_PUBLISHABLE_KEY`.
5. Configure the sign-in and account URLs used by the application: `/login`, `/account`, and `/app`.

The application uses Clerk's React provider and components for sign-in, the user menu, and session state. Protected account and calendar routes render the sign-in surface when no Clerk session is available.

## Clerk Billing

Enable Billing in the Clerk dashboard, create the monthly and annual plans used by the product, and configure the plan entitlements required by the application. The pricing page renders Clerk's `PricingTable`; the account page renders Clerk's subscription details control. Keep product names, prices, currency, and cancellation language synchronized with the public legal and pricing copy.

Billing is intentionally configured and processed through Clerk Billing. This repository does not call payment APIs directly and does not expose payment webhooks or payment credentials.

## Google Calendar

The Worker retrieves the signed-in user's Google OAuth access token through the
Clerk Backend API and calls Google Calendar server-side. The browser receives
only normalized calendar and event data. The Google connection must grant only:

```text
https://www.googleapis.com/auth/calendar.readonly
```

Configure Google as an OAuth connection in Clerk, request the Calendar read-only
scope, and enable the Google Calendar API in the linked Google Cloud project.
The Clerk user must sign in with or connect the Google account whose calendars
should be displayed.

Clerk sign-in and Google Calendar consent are separate concerns. A Clerk session
authorizes the Worker request; Clerk's stored Google OAuth grant authorizes the
Worker's Google API calls. Calendar events are fetched for display and are not
written to a Year View database.

## Commands

```bash
npm run build:saas
npm run dev
```

Use the demo route to verify the annual view without authentication. Use `/login`, `/pricing`, `/account`, and `/app` to verify the Clerk flows with a configured development instance.
