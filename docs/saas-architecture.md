# SaaS architecture

## Scope

The SaaS host is a React/Vite website around the shared Year View calendar. It provides public product pages, a no-sign-in demo, Clerk authentication, Clerk Billing UI, account management, legal pages, and a protected Google Calendar view.

The Thunderbird add-on and SaaS website are separate hosts. They reuse the platform-neutral calendar core but keep their own bootstraps and integrations.

## Runtime layers

1. **Shared calendar core** in `src/core/`
   - calendar provider contracts and service
   - Google, Thunderbird, dummy, empty, and ICS providers
   - event normalization, caching, filtering, and date utilities
   - annual grid and shared UI slots

2. **SaaS shell** in `src/hosts/saas/`
   - Clerk provider and auth state
   - lightweight pathname router
   - public pages and shared site chrome
   - Worker-backed Google Calendar adapter and SaaS-specific calendar connect control
   - Cloudflare Worker/static asset host configuration

3. **Platform hosts**
   - `src/hosts/thunderbird/` supplies Thunderbird APIs and extension wiring.
   - `src/hosts/saas/` supplies the authenticated website shell, browser storage, and Worker API client.

## SaaS page structure

The SaaS entry point is intentionally small:

```text
src/hosts/saas/src/
├── main.tsx                 # ClerkProvider, route selection, global shell
├── components/              # Link, header, footer, and reusable landing UI
├── pages/                   # Landing, login, pricing, account, legal, 404
├── legal/                   # Legal page content
├── year-view.tsx            # SaaS calendar host bootstrap
└── saas-google-provider.ts  # Google provider adapter
```

`main.tsx` keeps the current lightweight pathname router. A routing dependency is not required until the product needs nested routes, route parameters, or data-loader conventions.

## Authentication and billing boundary

Clerk is the identity provider. `ClerkProvider`, `SignIn`, `UserButton`, `useAuth`, and `useUser` are used in the SaaS React shell. `/account` and `/app` require a Clerk session; `/`, `/demo`, `/login`, `/pricing`, and legal pages remain public.

Clerk Billing owns the pricing and subscription UI. The pricing page renders Clerk's `PricingTable`, and the account page renders Clerk's subscription details control. This repository does not contain a local subscription database, direct payment API calls, payment webhooks, or payment credentials.

## Google Calendar boundary

Google Calendar is a separate authorization step after Clerk sign-in. The Worker
gets the user's Google OAuth access token through Clerk's Backend API and calls
Google directly. The browser sends its Clerk bearer token to the Worker and
receives normalized calendar and event data; Google access tokens never reach the
browser.

The SaaS Google adapter is deliberately thin:

```text
SaaS page -> SaaS Google provider -> Worker Google routes -> Clerk OAuth token -> Google Calendar API
```

The shared renderer receives the resulting provider through the existing calendar-service registration mechanism and remains unaware of Clerk or Google account details.

## Hosting and environment

The Cloudflare Worker serves `/api/health`, `/api/google/calendars`,
`/api/google/events`, and static assets. The SaaS frontend requires
`VITE_CLERK_PUBLISHABLE_KEY`; the Worker requires its Clerk secret, publishable,
and JWT keys. Google OAuth is configured as a Clerk connection with the
`calendar.readonly` scope.

Do not place Clerk secret keys, Google client secrets, payment credentials, or long-lived tokens in frontend environment variables. Do not add server-side calendar persistence without revisiting the data-flow and privacy decisions.

## Verification

```sh
npm run build:saas
npm test
```

A configured Clerk instance and Google OAuth application are required to verify the real sign-in, Billing, and Calendar consent flows. The `/demo` route remains useful without those external services.
