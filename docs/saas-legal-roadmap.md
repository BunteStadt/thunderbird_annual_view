# SaaS legal and privacy roadmap

Stand: 08.08.2026

This roadmap is a practical launch checklist for the Year View SaaS operated by
one person as a hobby project. It is not legal advice. Operating without a
registered company does not by itself remove obligations relating to consumer
contracts, taxes, privacy, or provider contracts.

The public legal pages intentionally contain no internal TODO placeholders. Facts
that depend on the final provider accounts, tax status, or legal assessment are
tracked here instead of being guessed in the website text.

## 1. Absolutely necessary before accepting real payments

These items are launch blockers for a public B2C subscription. They can mostly be
completed with documents and manual procedures; they do not all require new code.

### Operator, tax, and website facts

- Confirm the operator's exact name and address, and keep the details consistent
  across the Imprint, Terms, invoices, Stripe, and payment provider account.
- Confirm the operator's tax status with the responsible tax office or adviser.
  Add a VAT identification number only if one actually exists. Do not claim a
  small-business VAT treatment without checking whether it applies.
- Confirm whether a separate data protection officer is legally required. If so,
  publish the required contact details.
- Identify the competent German data protection supervisory authority and keep its
  contact details available for privacy requests and complaints.
- Confirm whether the website contains journalistic-editorial content requiring a
  separate responsible person under § 18 MStV.

### Providers, contracts, and transfers

Create a small provider register containing at least:

| Provider | Actual role | Data | Region / sub-processors | Contract / transfer safeguard |
| --- | --- | --- | --- | --- |
| Supabase | processor or other role to verify | Auth and subscription records | verify in project settings and DPA | obtain and retain DPA |
| Cloudflare | hosting/Worker/observability processor where applicable | request metadata and service traffic | verify account configuration and logs | obtain and retain DPA |
| Stripe | role differs by processing purpose | customer, subscription, billing and tax data | verify Stripe account setup | retain applicable DPA/terms |
| Google | separate provider/controller for Google account and API processing | OAuth and Calendar API data | verify Google terms and project setup | document transfer basis |

Before launch:

- Accept or sign the applicable AVV/DPA for each provider that acts as a
  processor.
- Record the provider's sub-processors, processing locations, transfer mechanism,
  and the date of the last review.
- Keep a short transfer assessment for every provider with non-EEA access or
  processing. Use an adequacy decision or SCC-based safeguards where applicable.
- Do not describe a provider as an Art. 28 processor if its relevant processing is
  actually independent-controller processing.

### Minimum accountability documents

Keep these documents privately, even if they are not all published:

- a short Verzeichnis von Verarbeitungstätigkeiten (VVT),
- a TOM document covering access control, transport encryption, secrets, logging,
  backups, incident response, and deletion,
- a retention schedule for account, billing, support, security, and webhook data,
- a provider/DPA register,
- an incident and data-breach response checklist,
- a simple record of privacy requests and their completion.

### Manual rights and deletion process

An automated export is not required for the first hobby release. The following
manual process is sufficient as an initial operating procedure if it is actually
usable:

1. Receive requests at `info@yearview.org` and verify the requester's identity.
2. Export or describe the account and subscription data held by Year View.
3. Handle deletion, restriction, correction, or objection requests.
4. Delete the Supabase user and associated subscription record where permitted.
5. Ask Stripe about deletion limits and retain only legally required billing data.
6. Revoke or remove Google access where the operator controls a relevant token or
   integration record.
7. Record the request, response date, and any statutory retention reason.

Publish a realistic response channel and do not promise immediate deletion where
accounting, tax, fraud-prevention, dispute, or security retention applies.

### Consumer checkout and withdrawal

Before the first B2C payment:

- Verify that the final checkout shows product, price, VAT treatment, billing
  interval, cancellation effect, payment method, and the required legal links.
- Verify that the final order button uses an unambiguous payment wording.
- Keep the Terms and Privacy Policy available for saving before checkout.
- Provide a durable order/contract confirmation after checkout.
- If service delivery begins during the withdrawal period, collect the required
  express request and acknowledgement in a legally suitable way. The current
  consent checkbox is not by itself proof that this specific withdrawal
  acknowledgement has been collected.
- Keep the model withdrawal instructions and email contact working.

## 2. Recommended but optional for the hobby project

These improvements reduce manual work or operational risk but do not need to
block a small initial launch if the manual process above is reliable.

### Product and engineering improvements

- Add an authenticated account-deletion endpoint and UI.
- Add a self-service data export in JSON or another documented machine-readable
  format.
- Store a version, timestamp, and user identifier for the accepted Terms and
  Privacy Policy, subject to the final data-minimisation decision.
- Configure Stripe Checkout `consent_collection` and explicit legal URLs if this
  matches the final checkout and consumer-law design.
- Add an export/deletion status page or support ticket workflow.
- Add rate limiting and abuse monitoring to public Worker endpoints.
- Reduce Cloudflare log sampling and retention to the minimum needed for
  operations, and document the resulting setting.
- Add automated browser tests for legal links, consent gating, checkout return,
  account access, and mobile presentation.

### Operational improvements

- Schedule a quarterly provider, subprocessor, transfer, and legal-text review.
- Keep a dated change log for legal pages and provider contract changes.
- Run a restore test for any production backup available through Supabase or
  another provider.
- Add a lightweight security review for OAuth token handling and secret rotation.
- Obtain a one-time review of the Terms, Privacy Policy, withdrawal flow, and tax
  setup from a German lawyer or tax adviser before scaling beyond the hobby use
  case.

## 3. Data Act and cloud switching question

The applicability of the Data Act's rules for switching between data processing
services should be checked for this specific SaaS before relying on them. The
cloud skill used for this review contains several 2026 implementation claims
marked for verification; those claims are not treated as settled facts here.

If the Data Act applies, document at least:

- what data can be exported,
- the export format and interface,
- the transition period and support,
- any switching charges and their legal basis,
- deletion at the end of the switch.

For the initial hobby service, a documented manual export and deletion process is
the lowest-complexity starting point. A technical migration API is optional until
there is a real customer or provider-switching need, unless a legal review finds
that the Data Act requires more.

## 4. Current status

Completed in the website text:

- Removed internal launch instructions from the Imprint and Privacy Policy.
- Removed the unverified VAT placeholder from the Imprint.
- Added a clear privacy contact.
- Replaced the placeholder supervisory-authority wording with a neutral rights
  statement.
- Updated the effective date of the legal pages to 08.08.2026.
- Clarified that withdrawal can be exercised by an unambiguous statement and that
  the model wording is optional.

Still open and required before real payments:

- final operator/tax facts,
- provider DPA and transfer register,
- VVT, TOM, retention and incident documents,
- manual privacy-request and deletion procedure,
- final checkout and withdrawal verification.
