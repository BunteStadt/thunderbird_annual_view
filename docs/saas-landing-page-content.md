# SaaS landing page content brief

## Purpose

This document defines the positioning, message hierarchy, content, and section order for the Annual View SaaS landing page. It is a content plan, not an implementation specification.

The page should help visitors quickly understand that Annual View uses the events they already maintain in Google Calendar to reveal busy periods, open stretches, deadlines, and the shape of the months ahead. It is a read-only view, not another calendar or planning system to maintain.

## Confirmed positioning

### Audience

Annual View is for everyday Google Calendar users who need to coordinate dates across more than one month. Their plans may include:

- holidays and travel
- exams and school dates
- deadlines and milestones
- event requests
- longer or seasonal projects
- work and personal commitments

The audience is intentionally defined by a shared planning situation rather than a profession or demographic.

### Customer problem

The important dates already exist in Google Calendar, but standard month-by-month navigation makes their larger pattern difficult to understand. People have to click through several months, remember what they saw, and mentally compare distant commitments.

Google Calendar's year view does not provide enough event context for this kind of planning. Separate spreadsheets, paper planners, and project tools can provide an overview, but they require duplicate data entry and eventually fall out of sync.

The recurring questions are:

- What do the next few months look like?
- When is there enough space for a holiday or trip?
- Where could a new project or event fit?
- Which weeks and months are already busy?
- When are the quieter stretches?
- Which deadlines or important dates constrain the available options?

### Solution

Annual View turns existing Google Calendar events into a continuous, filterable long-range view. There is no need to recreate events or maintain another planning tool. Google Calendar remains the single source of truth.

Annual View does not calculate availability or recommend dates. It helps people visually recognize busy periods, open stretches, and important events so they can make their own planning decisions with better context.

### Core promise

**Understand the months ahead. Make the year feel manageable.**

The product mechanism is seeing a year of events at once. The customer outcome is clarity, orientation, and confidence when deciding where plans can fit.

### Differentiation

- Uses events already maintained in Google Calendar.
- Requires no duplicate event entry and no second planning system.
- Provides useful event context across the year, not only a grid of dates.
- Filters out noise so important and longer events are easier to see.
- Offers several layouts for different levels of planning detail.
- Remains read-only by design.

### Scope boundaries

The landing page must not imply that Annual View:

- creates, edits, or deletes events
- recommends the best date for an activity
- calculates free time or availability
- coordinates schedules between people
- replaces Google Calendar
- stores a separate copy of the user's calendar

## Conversion strategy

The landing page has two stages:

1. Let visitors understand and experience the product without commitment.
2. Invite convinced visitors to connect their own Google Calendar for EUR 1 per month.

The only primary hero CTA is **Try the demo**. The hero should not contain a pricing CTA or a second competing action. Pricing remains available in the top navigation.

After the product, outcomes, proof, and privacy model have been explained, the final CTA should disclose the price and lead to Google sign-in.

Recommended final CTA:

- Heading: **Ready to see your own year?**
- Supporting copy: **Connect your Google Calendar for EUR 1 per month. Cancel anytime.**
- Button: **Continue with Google**

## Navigation

Keep the navigation short and predictable:

- Annual View brand/home
- Pricing
- Privacy
- GitHub
- Sign in or Account
- Try the demo

**Try the demo** should be the visually dominant navigation action for signed-out visitors. GitHub may use the familiar GitHub icon with an accessible label.

## Recommended page structure

### 1. Hero: the outcome and the real product

**Goal:** Make the value understandable within a few seconds and lead visitors into the demo.

Use the existing full-year application screenshot. It already proves that the product is real and shows an entire year with color-coded events. The visual should be large enough for visitors to recognize busy clusters, quieter stretches, and the annual layout.

Recommended copy direction:

- Eyebrow: **Your Google Calendar, at year scale**
- Headline: **Understand the months ahead.**
- Supporting line: **See busy periods, open stretches, and important dates across your Google Calendar, without creating another plan to maintain.**
- Primary CTA: **Try the demo**
- Reassurance: **Read-only access. Events are never saved to our database.**

The product name should remain visible in the brand and page title, but it should not be the main hero headline. The headline should lead with the visitor's desired outcome.

Do not add a second hero CTA. Do not add a pricing link beside the demo button.

### 2. Problem recognition: planning beyond one month

**Goal:** Make visitors feel understood before explaining features.

Suggested heading:

**Some decisions need more than a month view.**

Explain the current frustration in plain language: important events are distributed across many months, repeatedly clicking forward loses context, and copying dates into another tool creates work and stale information.

Use a small set of recognizable planning questions rather than abstract benefit statements:

- When can the holiday fit between exams and existing events?
- Is there room for the new project or event request?
- Which upcoming weeks are already crowded?
- Where are the quieter stretches?
- Which deadlines must not disappear among everyday appointments?

This section should establish one shared problem across different lifestyles. It should not split the page into separate personas.

### 3. Solution: one source of truth, a better perspective

**Goal:** Explain why Annual View is different from another planner.

Suggested heading:

**Your calendar already has the details. Annual View reveals the pattern.**

Suggested message:

Annual View loads the events already in Google Calendar and arranges them for long-range planning. There is nothing to copy, recreate, or keep synchronized. Continue managing events in Google Calendar; open Annual View when a wider perspective is needed.

Present three concise benefits:

1. **Start with what is already there**  
   Connect Google Calendar and use existing events immediately.

2. **See busy and quiet periods**  
   Compare weeks and months without repeatedly navigating between them.

3. **Bring important dates forward**  
   Filter calendars, short appointments, and all-day events to reveal the commitments that shape the plan.

Avoid saying that Annual View finds, calculates, or recommends free time.

### 4. Interactive demo: prove the experience

**Goal:** Turn an unfamiliar layout into something visitors can understand by using it.

Suggested heading:

**Try the real Annual View.**

Suggested supporting copy:

**Explore a sample year, switch layouts, filter calendars, and scroll across year boundaries. No sign-in required.**

Embed the existing demo when practical and provide a clear **Open demo full-screen** action. The demo is the strongest product proof and should appear before detailed feature explanations.

The sample data should make the product benefit visible. Include realistic travel, exams, deadlines, holidays, projects, and everyday commitments with both busy clusters and quieter periods.

### 5. Outcomes and use cases: what becomes easier

**Goal:** Translate the interface into everyday decisions without narrowing the audience.

Suggested heading:

**See where the year gets busy, and where plans can breathe.**

Use three or four concrete scenarios:

- **Plan travel with context**  
  Compare holidays, exams, work commitments, and existing trips before choosing dates.

- **Place projects and events**  
  See which periods are already crowded before accepting a request or choosing a start date.

- **Keep deadlines visible**  
  Surface milestones and important all-day events without losing them among short appointments.

- **Understand the rhythm ahead**  
  Recognize demanding months, recurring patterns, and quieter stretches at a glance.

These are examples of the same core job, not separate product editions or audience segments.

### 6. Features: tools that support the outcome

**Goal:** Explain product depth after visitors understand why it matters.

Suggested heading:

**Change the view. Filter the noise.**

Group features by the problem they solve rather than presenting a long inventory.

#### Choose the right level of detail

- Compact view for the broad annual pattern
- Day-aligned view when weekday rhythm matters
- Four-week, two-week, and one-week rows for progressively more detail
- Continuous scrolling across year boundaries

#### Focus on what shapes the plan

- Select the calendars relevant to the current decision
- Show only all-day events when focusing on holidays, deadlines, and milestones
- Hide short appointments with duration filters
- Use week numbers, past-day treatment, and today's highlight for orientation

#### Keep familiar calendar context

- Multiple Google calendars in one view
- Existing calendar colors retained
- No event recreation or synchronization workflow

Do not give all five layouts equal visual weight if that makes the section repetitive. One broad view and one detailed view can demonstrate the range, while concise copy names the remaining modes.

### 7. Social proof: established usefulness

**Goal:** Show that the underlying annual-view product already helps real users.

Be explicit that the evidence comes from the open-source Thunderbird edition, not SaaS customers.

Suggested heading:

**An annual view people were missing.**

Suggested context:

**The open-source Thunderbird edition already helps 114 people use an annual calendar view and has received three 5-star ratings.**

Verify the exact marketplace metric before publication. If Thunderbird labels the number as daily users, use **114 daily users**. Otherwise use **114 users**.

Recommended quotes:

- "Great! Very useful!" - Firefox-Benutzer 02fb61, Thunderbird Add-ons <https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/reviews/1177605/>
- "Very nice tool. I really missed an annual view in Thunderbird." - LaughingT, Thunderbird Add-ons <https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/reviews/1177473/>
- Thanks for making this! -  NIronwolf am Feb. 13, 2026  <https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/reviews/1177523/>

Each quote should link to its permanent review. Do not include feature-request text in the testimonial presentation. Do not imply that the reviewers used Google Calendar or the paid SaaS edition.

### 8. Privacy and open source: trust through concrete boundaries

**Goal:** Resolve the main hesitation around connecting a personal calendar.

Suggested heading:

**Your calendar stays your calendar.**

Suggested lead:

**Annual View is built to look, not touch.**

Explain the boundaries precisely:

- Google access is read-only.
- Annual View cannot create, edit, or delete events.
- Calendar requests and responses are encrypted in transit.
- Events are securely requested from Google only when needed.
- Events are displayed in the browser.
- Events are never saved to the Annual View database or server cache.
- Google Calendar remains the source of truth.

Connect open source directly to verifiability:

**Annual View is open source, so its data handling does not have to be taken on faith. Inspect the code, follow development, or contribute on GitHub.**

Actions:

- **View source on GitHub**
- **Read the privacy policy**

Avoid the claims **calendar data never touches our servers** and **Annual View never reads or accesses your calendar**. Calendar responses pass through the Cloudflare Worker and the application must process event data to display it. The accurate promise is that events are processed only as needed for display and are not persistently stored by Annual View.

### 9. Final conversion: move from sample data to the user's year

**Goal:** Ask for the paid conversion only after value and trust are established.

Suggested copy:

- Eyebrow: **Your events. A clearer year.**
- Heading: **Ready to see your own year?**
- Supporting line: **Connect your Google Calendar for EUR 1 per month. Every current view and filter is included. Cancel anytime.**
- CTA: **Continue with Google**
- Reassurance: **Read-only access. VAT included. Access continues through the paid period after cancellation.**

This is the first place on the landing page where price should be part of the main conversion message. Do not add an intermediate **See pricing** CTA.

### 10. FAQ: answer the remaining purchase objections

**Goal:** Resolve practical concerns without interrupting the main story.

Recommended questions:

#### Can Annual View change my Google Calendar?

No. Access is read-only. Annual View cannot create, edit, or delete events.

#### Are my calendar events stored by Annual View?

No. Events are securely requested from Google when needed and displayed in the browser. They are not saved to the Annual View database or server cache.

#### Do I need to enter my events again?

No. Annual View uses events already maintained in Google Calendar, so there is no duplicate calendar to keep synchronized.

#### Does Annual View recommend free dates?

No. It gives you the long-range context to recognize busy periods and open stretches and make that decision yourself.

#### Can I choose which events I see?

Yes. Select calendars and use all-day and duration filters to focus on the events relevant to the current planning decision.

#### Is there a free trial?

There is no trial. The interactive demo lets visitors use the real interface with sample data before subscribing. The full service costs EUR 1 per month, VAT included, and can be cancelled anytime.

#### What happens when I cancel?

Access continues until the end of the paid period. Billing is managed securely through Stripe.

### 11. Footer

Include:

- Annual View name and concise descriptor
- Pricing
- Demo
- GitHub
- Privacy
- Terms
- Cancellation
- Imprint
- Sign in

Suggested descriptor:

**A clearer way to understand the months ahead.**

## Message hierarchy

When copy needs to be shortened, preserve ideas in this order:

1. Understand the months ahead and make the year manageable.
2. See busy periods, open stretches, and important dates.
3. Use events already maintained in Google Calendar.
4. No duplicate entry and no second plan to synchronize.
5. Filter noise and choose the right level of detail.
6. Read-only, no event storage, and open source.
7. EUR 1 per month after trying the demo.

Feature names should never displace the customer outcome from the headline or opening copy.

## Voice and copy principles

- Use ordinary language for everyday planning decisions.
- Lead with clarity and usefulness, then calm and confidence.
- Be specific about what visitors can see and do.
- Use **busy periods**, **open stretches**, **important dates**, and **months ahead** consistently.
- Describe Annual View as a view or perspective, not as another calendar.
- Keep privacy claims factual and inspectable.
- Avoid exaggerated productivity language, urgency, and fear of missing out.
- Avoid promising automation that the product does not provide.
- Use Google Calendar's full product name where the integration matters.

## Claims and facts to verify before publication

- Confirm that the subscription remains EUR 1 per month with VAT included.
- Confirm that there is no free trial.
- Confirm the exact Thunderbird marketplace label for the 114-user metric.
- Confirm permission to quote and link the public Thunderbird reviews as presented.
- Recheck the Worker data flow if caching, logging, analytics, or calendar persistence changes.
- Ensure the privacy policy uses the same precise event-processing language as the landing page.
- Confirm the final GitHub repository URL and use it consistently.

## Assets and evidence

Use:

- The existing full-year Annual View screenshot in the hero
- The existing interactive sample-data demo
- A small number of screenshots showing the range from broad to detailed views
- Permanent links to the two strongest Thunderbird reviews
- A visible GitHub link as both navigation and trust evidence

Do not use abstract calendar illustrations or stock imagery as the primary product visual. The actual interface communicates the value more credibly.

## Success criteria for the finished page

A first-time visitor should be able to answer these questions without visiting another page:

- What does Annual View do?
- Why is it more useful than clicking through Google Calendar month by month?
- Does it require duplicate event entry?
- Can it modify calendar events?
- Are calendar events stored by Annual View?
- Can the real interface be tried before paying?
- What does the service cost?
- Where can the source code be inspected?

The page succeeds when the visitor understands that Annual View is a low-friction, privacy-conscious perspective on the calendar they already maintain, then chooses either to try the demo or connect their own calendar.
