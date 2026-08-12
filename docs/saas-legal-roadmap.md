# SaaS legal and privacy roadmap

Status: 12.08.2026

This is a practical launch checklist for the Year View SaaS operated by one person. It is not legal advice. The public legal pages intentionally contain no internal TODO placeholders; facts that depend on the final operator details, provider accounts, tax status, or legal assessment belong here instead of being guessed in website copy.

## Current implementation snapshot

The repository currently provides the following legal and data-processing surface:

- Public Privacy, Terms, and Imprint pages are available at `/privacy`, `/terms`, and `/imprint`.
- The public legal pages currently identify Richard Pergens, Stephanstraße 6, 52064 Aachen, Germany, and `info@yearview.org`.
- The Privacy Policy and Terms are currently marked effective `08.08.2026`; this roadmap is now updated on `12.08.2026`, so the dates are not yet synchronised.
- Clerk provides sign-in, account access, and the Billing UI. The pricing page renders Clerk's `PricingTable`; the account page provides subscription management and sign-out, but no in-app account-deletion control.
- The Worker authenticates protected Google routes with Clerk, obtains the user's Google OAuth token server-side, fetches calendars and events, and returns normalized data to the browser. Google access tokens are not sent to the browser.
- The Worker does not persist calendar data in an application database or server cache. Browser preferences and demo/imported ICS data may remain in browser storage.
- The Worker currently has no application-level rate limiting or per-user Google API quota guard. Cloudflare request and error logging behaviour, sampling, access, and retention still require production verification.
- No local subscription database, direct payment API integration, payment webhook, or payment credential is present in this repository. The actual payment processor configured behind Clerk Billing is not yet recorded in the provider register.

## Before accepting real payments

### Operator, tax, and website facts

- Confirm the operator's exact name and address and keep them consistent across the imprint, terms, invoices, Clerk Billing configuration, and support contact.
- Confirm the operator's tax status with the responsible tax office or adviser. Add a VAT identification number only if one actually exists.
- Confirm whether a data protection officer or editorially responsible person is required.
- Identify the competent German data protection supervisory authority and keep its contact details available.

### Providers, contracts, and transfers

Maintain a provider register containing at least:

| Provider | Role to verify | Data involved | Review items |
| --- | --- | --- | --- |
| Clerk | Authentication, account management, and configured Billing services | account identity, authentication state, subscription/customer data | DPA/terms, subprocessors, regions, transfer safeguards, Billing configuration |
| Payment processor configured through Clerk | Payment processing and transaction records; exact provider not yet recorded | payment, billing, tax, refund, dispute, and subscription data | Provider identity, controller/processor roles, DPA/terms, subprocessors, regions, transfer safeguards, retention, refunds, tax records |
| Cloudflare | Hosting, Worker/static assets, and configured observability | request metadata and service traffic | DPA, logs, retention, regions, subprocessors |
| Google | Independent provider/controller for Google's account and API processing; Year View remains responsible for its own requested display processing | OAuth authorization, calendar lists, and event data | Google terms, OAuth consent configuration, transfer basis, scope, revocation |

Before launch:

- Accept or retain the applicable DPA/terms for each provider that acts as a processor.
- Record subprocessors, processing locations, transfer mechanisms, and the date of the last review.
- Keep a short transfer assessment for providers with non-EEA access or processing.
- Do not describe an independent provider as an Article 28 processor for processing where it acts as its own controller.

### Accountability documents

Keep these documents privately, even if they are not all published:

- a short record of processing activities,
- a technical and organizational measures document,
- a retention schedule for account, billing, support, security, and operational data,
- a provider and DPA register,
- an incident and data-breach response checklist,
- a simple record of privacy requests and their completion.

### Manual rights and deletion process

An automated export is not required for the first hobby release if a usable manual process exists:

1. Receive requests at `info@yearview.org` and verify the requester's identity.
2. Export or describe the account and subscription data held by Year View or its configured providers.
3. Handle deletion, restriction, correction, or objection requests.
4. Use Clerk's account-management and deletion capabilities where applicable.
5. Ask the configured Billing provider about accounting, tax, dispute, and retention limits.
6. Explain that the SaaS Worker fetches Google Calendar data using the user's Clerk-managed Google OAuth grant, returns normalized display data, and provides a supported revocation path.
7. Record the request, response date, and any statutory retention reason.

Do not promise immediate deletion where accounting, tax, fraud-prevention, dispute, or security retention applies.

### Consumer checkout and withdrawal

Before the first B2C payment:

- Add application-level rate limiting and abuse monitoring for authenticated Google routes, with a documented per-user or equivalent quota policy.
- Verify that Clerk Billing shows the product, price, currency, tax treatment, billing interval, cancellation effect, payment method, and required legal links.
- Verify that the final order action uses unambiguous payment wording.
- Keep the Terms and Privacy Policy available before checkout.
- Provide durable order/contract confirmation through the configured Billing flow.
- If service delivery begins during a withdrawal period, collect the legally required request and acknowledgement in a suitable way.
- Keep withdrawal instructions and the email contact working.
- Record the configured payment processor and retain evidence of a successful checkout, confirmation, cancellation, and withdrawal test.

## Recommended improvements

- Add an authenticated account-deletion path if the Clerk-hosted account controls do not cover the required process.
- Add a documented machine-readable export process for Year View account data where applicable.
- Store the version and acceptance time of legal documents only if the final data-minimisation assessment supports it.
- Add browser tests for legal links, Clerk auth states, Billing return behavior, account access, mobile layout, and keyboard use.
- Review Cloudflare log sampling, retention, access permissions, and error/request metadata periodically.
- Schedule a quarterly provider, subprocessor, transfer, and legal-text review.
- Obtain a one-time review of the Terms, Privacy Policy, withdrawal flow, and tax setup before scaling beyond the hobby use case.

## Current open items

- final operator and tax facts,
- provider DPA and transfer register,
- exact payment processor and its contractual/data-protection documentation,
- records of processing, TOM, retention, and incident documents,
- manual privacy-request and deletion procedure,
- application-level rate limiting and abuse-monitoring policy,
- final Clerk Billing checkout and withdrawal verification,
- synchronised legal-document versions and effective dates,
- production Clerk, Google OAuth, and Cloudflare configuration review.

## Data Act and cloud switching question

Check whether the Data Act rules for switching between data processing services
apply to this specific SaaS before relying on them. The applicability and any
provider-specific duties should be confirmed against the actual Clerk,
Cloudflare, and payment-provider contracts; do not treat the provider register
alone as that assessment.

If the Data Act applies, document at least:

- what Year View and provider data can be exported,
- the export format and interface,
- the transition period and support,
- any switching charges and their legal basis,
- deletion at the end of the switch.

For the initial hobby service, a documented manual export and deletion process
is the lowest-complexity starting point. A technical migration API is optional
until there is a real customer or provider-switching need, unless a legal review
finds that the Data Act requires more.

## Current status

Completed or present in the website and repository:

- Public Privacy, Terms, and Imprint pages are available.
- The public legal pages identify the current operator, address, and privacy
 contact, with no internal TODO placeholders.
- The public Privacy Policy and Terms are marked effective `08.08.2026`.
- Clerk sign-in, account access, PricingTable, and subscription management are
 wired into the SaaS shell.
- Google Calendar access is read-only, handled through Clerk OAuth, and fetched
 server-side by the Worker; Google access tokens are not sent to the browser.
- Calendar data is not persisted in a Year View application database or server
 cache. Browser preferences and demo/imported ICS data may remain in browser
 storage.

Still open and required before real payments:

- final operator and tax facts,
- provider DPA, subprocessor, transfer, and role register,
- exact payment processor and its contractual/data-protection documentation,
- VVT, TOM, retention, and incident documents,
- manual privacy-request, export, deletion, and Google-access-revocation
 procedure,
- application-level rate limiting and abuse-monitoring policy for Google routes,
- final Clerk Billing checkout, confirmation, cancellation, and withdrawal
 verification,
- synchronised legal-document versions and effective dates,
- production Clerk, Google OAuth, Cloudflare logging, and security review.
