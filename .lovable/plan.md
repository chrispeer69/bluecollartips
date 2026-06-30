
# Blue Collar AI — Phase 2 Completion Plan

Goal: take the existing scaffold (auth, schema, public tip page, role-aware dashboards, dev tooling) to a feature-complete v1 covering Stripe Connect payouts, SMS/QR delivery, manual cash/P2P reconciliation, and the remaining admin/super-admin surfaces.

## 1. Stripe Connect (card tips, 80/10/10 split)

- Add `stripe` SDK + enable Stripe via the Stripe connector tool; require `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- DB migration:
  - `drivers.stripe_account_id`, `drivers.stripe_charges_enabled`, `drivers.stripe_payouts_enabled`.
  - `companies.stripe_platform_fee_bps` (default 1000 = 10%) for future tunability — split itself stays 80/10/10 per `apply_tip_split` trigger.
  - `tips.stripe_payment_intent_id`, `tips.stripe_transfer_id`, `tips.stripe_status`.
- Server functions (`src/lib/stripe.functions.ts`):
  - `createDriverOnboardingLink` (driver-initiated): creates/reuses Express account, returns AccountLink URL.
  - `getStripeStatus`: refreshes `charges_enabled`/`payouts_enabled` from Stripe.
  - `createTipPaymentIntent({ driverId, amountCents, rating, feedback, customerName? })`: on the public page, creates a PaymentIntent with `transfer_data.destination = driver.stripe_account_id`, `application_fee_amount = 20%` (company 10 + platform 10 reconciled post-transfer via a separate `Transfer` to the company's connected account if/when companies onboard; for v1 the 10% company share accrues to a `pending_company_payout` ledger row).
- Public webhook route `src/routes/api/public/webhooks/stripe.ts`:
  - Verifies signature with `STRIPE_WEBHOOK_SECRET`.
  - On `payment_intent.succeeded`: inserts a `tips` row (`source='card'`, `verified=true`), trigger auto-fills the 80/10/10 split.
  - On `account.updated`: refreshes driver Stripe status flags.
- Public tip page: when driver has `charges_enabled`, show Stripe Elements card form alongside existing P2P/cash deep links; otherwise hide card option and keep manual path.

## 2. SMS + QR link delivery (Twilio)

- Add Twilio credentials via secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
- DB migration: `sms_deliveries` table (`driver_id`, `to_phone`, `body`, `twilio_sid`, `status`, `error`, `sent_by_user_id`).
- Server function `sendTipLinkSms({ driverId, customerPhone, customerName? })`:
  - Auth required, must belong to driver's company (or be the driver).
  - Builds short branded message with the driver's public URL (`https://<host>/<companySlug>/d/<driverSlug>`).
  - Posts to Twilio REST API; logs delivery row.
- Driver dashboard: "Text my tip link" form (phone + optional name) → calls SMS fn, shows last 10 deliveries.
- Admin dashboard: bulk SMS sender — pick driver, paste list of phones, batched send with per-row status.
- QR: each driver dashboard already has personal QR; add per-driver printable PDF link (server fn returns SVG-rendered card) — defer printable PDF if time-boxed; SVG download is in.

## 3. Manual cash / P2P reconciliation (20% rule)

- Logic already inserts unverified manual tip rows. Add a periodic reconciliation surface:
  - View "Unverified tips" on driver dashboard with two actions: **Confirm received** (sets `verified=true`, writes `cash_tip_verifications` row) or **Dispute**.
  - Admin "Reconciliation" tab: lists drivers whose unverified-share > 20% of last 30d tip count → auto-creates a `discrepancy_flags` row (`reason='cash_overage'`) with link to driver detail.
- Server functions in `src/lib/reconciliation.functions.ts`:
  - `confirmCashTip`, `disputeCashTip`, `listUnverifiedTipsForDriver`, `runDailyReconciliation` (idempotent; callable on demand and from a scheduled job later).

## 4. Invites + driver self-service onboarding

- `invites` table already exists. Add admin UI to create/revoke invite codes (one-time use, expires 14 days, ties to driver row).
- Update `claimRole` to consume invite → links auth user to `drivers.user_id` and inserts `user_roles` row.
- Public `/join/<code>` route renders the invite landing → routes to `/auth` with the code prefilled.

## 5. Super-admin surfaces

- New tab "Platform" on super-admin dashboard:
  - Tenants list with create/edit/suspend.
  - Platform earnings ledger (sum of `platform_amount_cents`).
  - Pending company payouts ledger (sum of `company_amount_cents` per tenant).
- Server fns `getPlatformOverview`, `createTenant`, `suspendTenant`.

## 6. UI / polish

- Replace placeholder gradients with the established rugged service-industry tokens already in `src/styles.css`.
- Add toast notifications (sonner is in shadcn) for all mutations.
- Driver dashboard: weekly earnings chart (recharts), broken down by source.
- Admin dashboard: stat cards (tip volume 7/30d, rating average, unverified%), feedback inbox with filter chips.
- Public tip page: confirm screen after submit, with "Text yourself a receipt" option.

## 7. Security + housekeeping

- RLS audit: ensure new tables (`sms_deliveries`, any added columns) have policies + GRANTs.
- All new privileged server fns gated by `requireSupabaseAuth` + role check via `has_role` / `has_company_role`.
- Stripe webhook route under `/api/public/webhooks/stripe` with HMAC signature verification.
- Add `lovable_docs` zod schemas on every server fn input.

## 8. Out of scope for this pass (call out to user)

- Native printable PDF QR sheets (SVG download instead).
- pg_cron scheduling of `runDailyReconciliation` (manual button + ready for cron later).
- Multi-currency.
- Customer accounts / saved cards.

## Technical notes

- Stack: TanStack Start + Lovable Cloud (Supabase). All app-internal logic via `createServerFn`; only Stripe + Twilio webhooks use server routes.
- 80/10/10 enforced by existing `apply_tip_split` DB trigger — application code never computes the split.
- Dev super-admin auto-login and Dev Nav already shipped — both stay dev-only.

---

Approve this and I'll execute it section by section, surfacing the Stripe connector + Twilio secret prompts as I go.
