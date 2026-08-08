# Calendar data flow decision

## Goal

Calendar event data should be fetched directly from Google to the user's browser
whenever possible. The Year View application should not proxy or persist Google
Calendar event data on its own server.

Subscription enforcement does not need to be completely strict at the Google API
request level. It is sufficient to check the user's subscription when they enter
or use the calendar application and then provide temporary access for the browser.

## Chosen workflow

```text
Browser signs in with Supabase
    -> application checks the user's subscription status
    -> application provides a short-lived Google Calendar access token
    -> browser calls Google Calendar API directly
    -> Google returns calendar data directly to the browser
```

The intended runtime path is therefore:

```text
Browser -> Google Calendar API -> Browser
```

Cloudflare and Supabase handle application concerns such as authentication,
subscription status, account management, and billing. They should not be in the
calendar event-data path after the temporary Google access token has been issued.

## Token rules

- The browser receives only a short-lived Google OAuth access token.
- The expected lifetime is approximately one hour, which is Google's normal
  access-token lifetime.
- A long-lived Google refresh token must never be sent to or stored in the browser.
- When the access token expires, the browser must obtain another short-lived token
  through the supported OAuth/session renewal flow.
- The Supabase session token and the Google Calendar access token are different
  credentials. A Supabase token authenticates the user to Year View; Google
  validates the Google token for Calendar access.

## Entitlement model

Supabase checks the user's subscription before granting access to the calendar
application or issuing/renewing the short-lived Google access token. This is a
soft entitlement boundary rather than a strict per-request proxy check.

A user who already has a valid Google access token may technically continue to use
it until it expires. The server cannot revoke an access token that is already in
the browser without using a proxy for every Google request. This trade-off is
accepted in favor of keeping calendar data out of the application server.

## Privacy statement supported by this design

Subject to verifying logging, analytics, error reporting, and authentication
behavior in production, the intended product statement is:

> Year View requests read-only Google Calendar access and fetches calendar data
> directly from Google to your browser. Calendar event data is not routed through
> or stored on the Year View application server.

This statement applies to the implemented SaaS direct-browser calendar flow.

## Important boundary

This flow is implemented for SaaS. The paid `/app` route checks the user's
subscription in Supabase before mounting the calendar application. The browser
then uses the short-lived Google provider token from the Supabase session for
direct Google Calendar requests. The Cloudflare Worker handles authentication,
subscription, and billing operations, but does not proxy Google Calendar data.
