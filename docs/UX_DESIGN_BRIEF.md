# UX design brief: estimate pages

Written: November 23, 2026. Audience: the architect design partner, designers and agents iterating on the beta UI. Companion to [Product strategy](PRODUCT_STRATEGY.md).

Use this brief as the design prompt for further iterations. Sections marked **implemented** describe the November 23 build; the rest is direction.

## Design prompt

> Design a friendly, card-based web tool that turns a property address and a short project description into a permitting and pre-construction cost range. Two audiences share one engine: residential builders, architects and small investors (professional view at `/`), and homeowners (plain-language view at `/homeowner`). Both are busy and non-technical about permitting. Favor buttons, tiles, chips and steppers over forms and tables. Collect enough to identify the permits a project triggers (project type, size, bedrooms, utilities, site work, site conditions, systems and upgrades) without the user ever seeing a spreadsheet. Show one clear range first; details live in the full report. Never present unknown or unread information as a clean result. Reference for tone and approachability: address-level permit pages from residential contractors, such as Kolmo's.

## Principles

1. **The address box is the front door.** Landing pages open on one large address field with live autocomplete across supported counties. No sign-in before value.
2. **Describe the build with taps, not typing.** Project type tiles; size presets with an exact-number field for professionals; bedroom and lot steppers; utility choices; site-work presets (Light / Typical / Heavy); toggle chips for site conditions; a grid of systems and upgrades (solar, heat pump, EV charger, electrical service, plumbing, roof, windows, deck, retaining wall, fence, battery or generator, water heater).
3. **One number first.** The basic estimate is a single range, with secondary lines for possible extra allowances, quote-needed items and map coverage. Nothing more is needed to decide whether to look deeper.
4. **Honest by design.** Quote-needed items are counted and excluded, never silently priced. Unread map layers are shown as "range may be low". Captured scope without checked rules (for example solar) is listed as "not separately estimated". These rules come from `AGENTS.md`.
5. **Professionals get the range; homeowners get the range in plain words.** Professionals see counts, not agency names, before the full report. Homeowners see who is involved, what the project will likely need and which professionals they may need, in plain language.
6. **The full report is the paid product.** Granular line items, code excerpts and fee schedule links are behind email capture.

## Flow (implemented)

1. Address → choose a suggestion (always a deliberate choice; no auto-pick).
2. Describe the project → **Get estimate**. Progress shows map layers being read.
3. Basic estimate card. Editing the project marks the range stale and disables the report button until it is re-run.
4. **Open the full report** →
   - signed out: email capture (email; optional business name and founding-directory opt-in for professionals) → one-time sign-in link → the report opens after the link, in the account workspace;
   - signed in, first report: opens directly;
   - signed in, second and later reports: pricing prompt with a **Continue free (beta)** button and a short pricing-feedback form.
5. The full report is the existing bid workspace, pre-filled from the description. Captured but unpriced scope shows as its own card.

## Pricing shown in the beta (implemented, placeholders)

Set in `web/src/pricing.ts`: professional single report $49, Pro $99/month (unlimited reports, saved bids, collaborators, branded reports, founding directory listing); homeowner full report $29. Every plan carries a "Free beta" tag. Pricing feedback (Seems fair / Too high / I'd pay more / Wouldn't pay, plus a note) is stored on the tester's account record as `pricing_feedback` in Supabase user metadata.

## Homeowner page (implemented, unlisted)

`/homeowner` is a separate page with its own copy and pricing, marked `noindex` and not linked from the professional page until the professional directory exists. It includes a "Local builders and architects — coming soon" teaser linking professionals to the founding-directory sign-up (`/?listing=1`).

## Open design questions for beta

- Do professionals want agency names before the report, or is the count enough to justify opening it?
- Is "Light / Typical / Heavy" site work understandable, or should it be framed by lot coverage or driveway length?
- Should homeowners see a full report designed for them, rather than the professional workspace?
- Where should investors land: the professional page, or a third framing?
- Mobile: the full report workspace is desktop-first; the estimate pages are mobile-first.
