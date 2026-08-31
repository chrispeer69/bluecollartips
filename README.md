# Blue Collar Tips

Lovable.ai Build Prompt — Blue Collar AI Tip Platform

Project Overview

Build a multi-tenant SaaS web app called Blue Collar AI that serves as both a review/reputation-generation tool and a tip platform for towing companies (and similar blue-collar service businesses). The platform is sold to towing companies as tenants. The first tenant is Roadside Towing.

Core flow: a driver finishes a job → shows the customer a QR code or link → customer rates the service 1-5 stars, optionally leaves feedback, optionally tips via card, Apple Pay, Google Pay (in-app, processed by Stripe) or via the driver's personal Venmo/CashApp/Zelle (logged manually) → customer is invited to leave a Google review → revenue splits automatically on any tip → driver and company see real-time and historical ratings, feedback, and earnings → weekly automated payout every Wednesday.

This is a promotional and reputation tool first, tipping mechanism second — the rating/review capture must never be hidden behind or gated by the tip flow.

1. Multi-Tenancy & White-Labeling

Platform owner: Blue Collar AI (super-admin level, sees all tenants, all revenue, all drivers, platform-wide settings).

Each towing company is a tenant/company account with its own:

Logo, primary/secondary brand colors, company name, support contact info

Own subdomain or branded URL path (e.g. app.bluecollar.ai/roadside-towing)

Own driver roster, own dashboard, own tip history

Own Stripe Connect account hierarchy (see Section 4)

Roadside Towing is tenant #1, built and seeded as the first live company — but treat it as a normal tenant, not a hardcoded special case. The codebase must support onboarding additional towing companies without custom dev work.

Revenue split is fixed platform-wide at 80% driver / 10% towing company / 10% Blue Collar AI — not configurable per tenant in this version. Build the split logic as a single constant/config value so it's trivial to change later if needed, but do not expose it as an admin setting.

2. User Roles

Blue Collar AI Super Admin — onboards new towing companies, views platform-wide analytics and revenue, manages global settings.

Company Admin (e.g. Roadside Towing office staff) — manages their own drivers, views company-level tip analytics, handles the cash-tip verification/flagging workflow, sees their company's 10% revenue.

Driver — has their own account, personal tip link + QR code, personal earnings dashboard, logs cash tips.

Customer/Tipper — no account required. Lands on a public, no-login tip page branded to the specific company/driver, pays a tip.

3. Driver Onboarding (Both Methods Required)

Method A — Admin-created: Company Admin manually enters a new driver's name, email, phone, employee ID. System sends the driver an invite link (email and/or SMS) to set a password and complete their profile (photo optional, Stripe Express onboarding).

Method B — Self-service: Driver can sign up directly with a company invite code or company-specific signup link. Account is created in a pending state and requires Company Admin approval before the driver can go live and receive tips.

Either path ends with the driver completing Stripe Express onboarding (identity verification, bank account linking) before their tip link becomes active — a driver cannot collect tips until Stripe onboarding is complete.

Once active, the driver gets:

A unique personal tip URL (e.g. app.bluecollar.ai/roadside-towing/d/john-smith-4821)

An auto-generated QR code linking to that URL, viewable/downloadable/printable from their app (for a phone case sticker, clipboard, etc.)

4. Payment Processing

Recommended approach — be explicit about this in the build, don't oversell capability:

Primary rail: Stripe Connect (Express accounts) — each driver gets their own connected Express account under their company's Stripe Connect platform account.

Customer tip page accepts credit/debit card, Apple Pay, and Google Pay via Stripe Checkout or Stripe Payment Element.

Use Stripe Connect destination charges with application_fee_amount (or equivalent split logic) so that on every transaction: 80% routes to the driver's connected account, 10% to the company's connected account, 10% stays with the Blue Collar AI platform account — automatically, at the moment of payment.

Stripe handles PCI compliance, fraud checks, and identity verification for payouts — do not build custom card handling.

Secondary option: personal P2P app links (Venmo, CashApp, Zelle, PayPal). These platforms do not offer public APIs for accepting payments into a third-party platform on a customer's behalf, so do not attempt real-time API integration with them. Instead:

On the tip page, show the driver's personal Venmo/CashApp/Zelle/PayPal handle as a deep-link button (opens the respective app with the driver's handle pre-filled where the platform supports deep linking) as an alternative to the in-app Stripe payment.

Any tip sent this way happens outside the platform and must be manually logged by the driver as a "P2P tip" in the app (similar to the cash tip flow below), since Blue Collar AI never sees that money.

Weekly payout to drivers (their 80% share) happens via Stripe's automated payout schedule (or a scheduled Stripe Transfer + Payout) configured for every Wednesday morning. Company's 10% and Blue Collar AI's 10% are settled to their respective Stripe balances continuously and can be withdrawn on their own schedule.

All Stripe-processed tips land in the platform's Stripe Connect structure — there is no need for "one bank account" manual reconciliation; Stripe's ledger is the source of truth, and the app's dashboard is a reporting layer on top of it.

5. Cash Tips & P2P Tips (Manual Logging)

Driver has a clearly visible "Log a Cash Tip" (and "Log a P2P Tip") action in the app.

Required fields: customer name (or description), amount, date/time, job reference if available, payment method (cash / Venmo / CashApp / Zelle / other).

On submission, the system automatically calculates and records the same 80/10/10 split for that logged tip, and adds it to the driver's tip ledger exactly like a Stripe-processed tip.

Important distinction: for cash/P2P tips, the driver owes the company+platform's 20% themselves, since Blue Collar AI never touched that money. The driver's weekly automated payout should net this against their logged cash/P2P tip obligations (i.e., the 20% owed on cash/P2P tips is deducted from their next Stripe payout, or — if insufficient Stripe-processed tips exist to cover it — flagged for the Company Admin to collect via another method). Build this as a clear running balance: "Owed to company/platform from cash tips: $X."

Policy & verification workflow:

Company Admin dashboard includes a Cash Tip Verification module: list of completed jobs/customers eligible for a follow-up call, with a simple call-log entry (date called, who called, customer's stated answer: "no tip" / "tipped via [method]" / "tipped $X cash").

If a customer states they gave a cash tip and no matching cash tip entry exists from that driver within a reasonable window, the system auto-flags the driver's profile (e.g. "Discrepancy Flag — [date] — [details]").

Company Admin can view all flags per driver, add notes, and mark a flag as resolved or as a confirmed policy violation (for offline disciplinary action — the app does not need to handle HR/termination logic, just tracking and flagging).

Include an in-app, read-only Policy & Procedures page describing the cash tip reporting requirement and the verification call process, so drivers have visibility into the rules.

6. Driver Dashboard (Core Feature)

Each driver, logged into their own account, must be able to see:

Real-time tip feed — every tip received, in order, each with: customer name (if provided), amount, date/time, payment method (card/Apple Pay/Google Pay/Venmo/CashApp/Zelle/cash), driver's net amount (80%), company's cut (10%), platform's cut (10%).

Running balances:

Total tips this week / this month / this year / all-time (gross and net-to-driver)

Next payout amount and date (next Wednesday)

Payout history (past Wednesdays, amounts, status)

Cash/P2P tip balance owed to company/platform (per Section 5)

My QR Code & Link page — view, download, and share their personal tip URL and QR code.

Log a Cash/P2P Tip action, accessible from the dashboard at any time.

Discrepancy Flags (if any) — visible to the driver so they know if they've been flagged, with status.

7. Company Admin Dashboard

Driver roster: add/invite drivers, approve self-service signups, view each driver's Stripe onboarding status (active/pending/incomplete), deactivate drivers.

Company-wide tip analytics: total tips, by driver, by week/month/year, company's 10% revenue accrued.

Cash Tip Verification module (Section 5).

Branding settings: upload logo, set brand colors, set company display name (feeds the white-label tip pages and driver dashboards for that company).

Export tip/revenue data (CSV) for accounting.

8. Blue Collar AI Super Admin Dashboard

Onboard new towing companies (create tenant, set up their Stripe Connect platform sub-account, branding defaults).

Platform-wide revenue view: total tips across all tenants, Blue Collar AI's 10% accrued across all companies.

Per-tenant drill-down: same visibility a Company Admin has, for any company, for support purposes.

Global driver/company search.

9. Sending the Link to the Customer (SMS, Text-to-Send, QR, Business Card)

The driver's unique tip/review link (Section 3) must be deliverable to the customer through multiple channels, not just shown in person:

A. SMS send (manual trigger, current phase):

Driver can trigger from their own app: enter or select the customer's phone number, tap send, app fires an SMS containing the link.

Company Admin can also trigger from the company dashboard: same capability, useful if office staff is closing out the job.

Default SMS copy (editable per company in Company Admin branding settings): "Thanks for choosing [Company Name]! Please rate your experience and let us know how we did: [link]"

Use an SMS provider — Twilio is the standard recommendation for this (reliable, well-documented, pay-per-message, easy Stripe-adjacent stack fit) — but Lovable should confirm/propose based on what's easiest to wire up in their environment.

Future phase (do not build now, but design for it): TowBook integration will auto-trigger this SMS at the moment a job is marked complete in TowBook, with no manual step required. Build the manual trigger (driver app button + admin dashboard button) as a clean function/service that a future TowBook webhook can call directly — i.e., the "send tip/review SMS for job X to phone Y" action should be one reusable backend function, not duplicated logic, so wiring in an automatic trigger later is a small change.

B. In-person QR code:

Driver can simply show their phone screen with their personal QR code (already covered in Section 3) for the customer to scan with their phone camera.

C. Printable QR code / business card:

The QR code (Section 3) must be available in a clean, print-ready format (e.g. downloadable high-res PNG or simple printable card layout) so drivers or the company can have physical business cards made with the driver's QR code on them, to hand out at the job site.

10. Public Customer Page — Promotional + Tip Combined (No Login Required)

This page is not just a tip collector — it is the core promotional/review-generation tool of the platform. Every driver's link/QR code leads here.

Loads from the driver's unique URL/QR code.

Branded entirely to the driver's company (logo, colors, company name) — customer should immediately recognize which towing company this is.

Shows driver's name/photo (optional).

Combined screen, in this order:

1-5 star rating widget — rates the driver's/company's service for this job. Required to be simple and fast (tap stars).

Optional short feedback text field on the same screen (e.g. "Anything you'd like to share?") — captured regardless of rating.

Tip section, same screen: preset amount buttons (e.g. $5/$10/$20/$50) plus custom amount, optional customer name field, then payment method selection — Pay with Card / Apple Pay / Google Pay (Stripe) as the primary prominent option, with Venmo / CashApp / Zelle / PayPal shown as secondary deep-link buttons clearly labeled (e.g. "Prefer Venmo? Tap here — note: driver will confirm receipt manually"). Tip is optional; rating is not blocked by skipping the tip.

Submit — captures rating + feedback + tip (if any) together.

After submission (confirmation screen):

Thank-you message, company-branded.

Test Pilot Phase (current build): review/rating stays fully internal to the platform — do not build a Google review redirect or require a Google Business URL field yet. Just a clean thank-you confirmation.

Future phase (do not build now, but design data model to support it): once the internal review system is validated, a "Leave us a Google Review" button will be added here, linking to a per-company Google Business/Place URL configured in Company Admin. Leave a placeholder/commented-out hook in the code so this is a small addition later, not a rebuild.

Mobile-first design — assume nearly all customers will be on a phone scanning a QR code roadside.

12. Ratings & Reviews Data (New)

Every submission (rating, feedback text, tip or no-tip) is stored against both the driver and the job/customer interaction.

Driver Dashboard must show: average star rating (all-time, this month), total number of ratings, recent feedback comments, trend over time.

Company Admin Dashboard must show: company-wide average rating, per-driver rating breakdown/leaderboard, all feedback text in a reviewable list, ability to flag/respond internally to negative feedback (1-2 star) for follow-up — this ties into the existing Cash Tip Verification call workflow (Section 5), since a low rating with no tip is also a natural prompt for a customer follow-up call.

Blue Collar AI Super Admin Dashboard must show: platform-wide rating trends across all tenants, ability to drill into any company's ratings for support/quality purposes.

Low-rating alerts: optionally notify Company Admin in-app when a driver receives a 1-2 star rating, so they can follow up with the customer promptly (good service recovery, also supports the verification-call policy already built for cash tips).

13. Branding (Default/Tenant #1)

App name: Blue Collar AI (platform brand, shown subtly in footer/admin areas)

Tenant #1 branding: Roadside Towing — use a clean, rugged, professional service-industry look (dark blues/oranges or similar tow-truck-industry palette; Lovable should propose a logo concept and color scheme if none is supplied, with the understanding that branding is editable per company in Company Admin settings).

14. Technical Notes for Lovable

Use Stripe Connect (Express) for all real payment processing — do not attempt to build custom payment rails for Venmo/CashApp/Zelle, since they have no public merchant API. These remain manual-confirmation deep-links only.

Use Twilio (or Lovable's recommended equivalent) for SMS delivery of the tip/review link. Build the "send link via SMS" action as a single reusable backend function callable from both the driver app and Company Admin dashboard, so a future TowBook auto-trigger integration can call the same function without rework.

Design the data model multi-tenant from day one: Company → Drivers → Tips, with a platform-level (Blue Collar AI) layer above all companies.

Build the 80/10/10 split as a single configurable constant in the backend logic (even though not exposed in UI), so it can be changed centrally later.

Weekly payout automation (Wednesday mornings) should be a scheduled job against Stripe's payout/transfer APIs.

Please ask me clarifying questions about anything ambiguous in this spec before or during the build — especially around: exact Stripe Connect charge-type implementation, SMS/email provider for invites, and any state-specific tip/labor law considerations I should be aware of (I am not a lawyer and this hasn't been legally reviewed).

Open Questions for Lovable to Ask the User (anticipated)

Which states will this operate in (relevant to wage/tip law and Stripe Connect availability)?

Should customers be able to leave a tip anonymously, or is a name always required for record-keeping/verification calls?

Should drivers be able to see other drivers' tip data within their company, or strictly their own only?

Minimum/maximum tip amounts?

Should there be a "thank you" SMS/email sent to the customer after tipping?

What happens if a driver is deactivated mid-week with an unpaid balance — manual payout, hold, or forfeiture?

For the future TowBook auto-trigger: does TowBook offer webhooks/API access on job-completion status, or will this require polling/manual export integration?

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://bluecollartips.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/05701b3e-3a66-4d5a-a379-571a0cb002f8).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
