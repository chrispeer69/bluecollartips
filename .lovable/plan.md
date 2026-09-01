# Blue Collar Tips — Full Project Audit (read-only, no changes made)

Latest build: `build OK`. Live: https://bluecollartips.app (also Railway: bluecollartips-production.up.railway.app).

## 1. Intended product

Multi-tenant SaaS where field-service employees (towing, HVAC, plumbing) collect customer ratings, feedback, and tips through a personal QR code / short link. Ratings feed a feedback→tip loop; card tips run through Stripe Connect destination charges with a per-company revenue split; manual/P2P tips are self-reported and reconciled by admins. Companies are tenants with their own branding, locations, review links, thank-you templates, and employee roster.

## 2. Roles

| Role | Source | Powers |
|---|---|---|
| `super_admin` | `user_roles.role` (company_id null) | Create/suspend tenants, platform overview, act on any company (tenant switcher `dashboard/admin.tsx:141-168`) |
| `company_admin` | `user_roles` scoped to company | Roster, branding, locations, invites, thank-you templates, review links, reconciliation, disputes/refunds, SMS |
| `driver` (employee) | `user_roles` + `drivers` row | Own dashboard, QR, manual tip log, Stripe Connect onboarding, earnings/payout export, SMS a tip link, confirm/dispute cash tips, notify prefs |
| Customer | anonymous | Public tip page, rating submit, card/P2P tip, review syndication, unsubscribe |

Roles live in a separate `user_roles` table with SECURITY DEFINER helpers `has_role`, `has_company_role`, `is_company_admin` — correct pattern.

## 3. Routes & screens (`src/routes/`)

Public: `index.tsx` (landing), `auth.tsx` (sign in / register company / join as employee / forgot password), `reset-password.tsx`, `terms.tsx`, `privacy.tsx`, `guides.tip-pooling.tsx`, `guides.fica-tip-credit.tsx`, `join.$code.tsx` (invite preview via `peekInvite`), `$companySlug/d/$driverSlug.tsx` (public tip/rating page), `unsubscribe.tsx`, `sitemap[.]xml.ts`.

Auth-gated (client-side only): `dashboard/index.tsx` (role router), `dashboard/admin.tsx` (1364 lines), `dashboard/driver.tsx`, `print.employee.$id.tsx` (poster + payout statement, auto `window.print()`).

Server endpoints: `api/public/webhooks/stripe.ts`, `api/public/webhooks/ghl.ts`, `email/unsubscribe.ts`, `lovable/email/{auth/webhook,auth/preview,transactional/send,transactional/preview,queue/process,suppression}`.

Admin panels: roster + add employee, QR modal, branding, locations/crews, review syndication links, thank-you template editor, feedback list, discrepancy flags, invites (copy link/revoke), tip disputes & refunds, reconciliation table, SMS tip link, platform overview (super admin only).
Employee panels: stat cards, QR + fullscreen QR + PNG download, log manual tip, tips table, ratings, Stripe Connect status, SMS panel, unverified/dispute panel, earnings + CSV export + print statement, notify prefs.

## 4. Database (`public` schema)

Tables: `companies`, `profiles`, `user_roles`, `drivers`, `locations`, `invites`, `ratings`, `tips`, `discrepancy_flags`, `cash_tip_verifications`, `sms_deliveries`, `email_deliveries`, `rating_rate_limits`, plus email infra (`email_send_log`, `email_send_state`, `email_unsubscribe_tokens`, `suppressed_emails`).
Enums: `app_role`, `driver_status`, `flag_status`, `tip_source`.
Functions: `apply_tip_split`, `handle_new_user`, `has_role`, `has_company_role`, `is_company_admin`, `prevent_driver_sensitive_updates`, `enqueue_email`, `read_email_batch`, `delete_email`, `move_to_dlq`, `email_queue_dispatch`, `email_queue_wake`.
Triggers: `on_auth_user_created` (auth.users), `trg_tip_split` (INSERT+UPDATE on tips), `prevent_driver_sensitive_updates_trg`.
RLS: enabled with 17 policies; company-scoped via `is_company_admin`. `rating_rate_limits` has 0 policies (server-only, correct). 18 migrations in `supabase/migrations/`.
Current data: 3 companies, 1 driver, 4 ratings, 5 tips, 5 invites, 3 profiles, 0 locations, 0 SMS/email delivery rows.
Splits in DB: Roadside Towing 90/0/10; other two tenants 90/5/5.

## 5. Auth flow

`/auth` → Supabase email+password → `claimRole` (invite code) or `registerCompany` → `getMyRoleContext` → `/dashboard` dispatch. Password reset via Supabase recovery + `/reset-password`. Server functions authenticate with `requireSupabaseAuth`; bearer attached globally by `attachSupabaseAuth` registered in `src/start.ts:24` (verified present). Privileged writes go through service-role `supabaseAdmin` with manual RBAC checks in each function.

## 6. Integrations

- Stripe Connect Express: `src/lib/stripe.server.ts`, `stripe.functions.ts`, refunds in `disputes.functions.ts:171`, webhook `api/public/webhooks/stripe.ts`.
- Twilio via Lovable connector gateway: `sms.functions.ts:69`, `notify.server.ts:47`, `thankyou.server.ts:79`, `invites.functions.ts:125`.
- Transactional email: `src/lib/email/invite.server.ts` → RPC `enqueue_email` → `lovable/email/queue/process.ts`; templates `invite.tsx`, `notice.tsx` in `email-templates/registry.ts`. Supabase auth emails (`signup`, `magic-link`, `recovery`, `auth-invite`, `email-change`, `reauthentication`) are a **separate** pipeline via `lovable/email/auth/webhook.ts`.
- GHL: inbound lookup endpoint `api/public/webhooks/ghl.ts` (HMAC verified) returning a driver tip URL.
- pg_cron `process-email-queue` (every 5s, self-arming/disarming).

## 7. Environment variables

Hard-required: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
Feature-gated: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `LOVABLE_API_KEY`, `TWILIO_API_KEY`, `TWILIO_FROM_NUMBER`, `GHL_WEBHOOK_SECRET`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `LOVABLE_SEND_URL`.
URL fallbacks (wrong-domain risk): `APP_BASE_URL` (`admin.functions.ts:8`, `invites.functions.ts:7` → falls back to `roadsidetips.lovable.app`), `APP_PUBLIC_URL` (`sms.functions.ts:51` → falls back to `app.bluecollar.ai`).
Project `.env` currently holds only the 6 Supabase public vars — no Stripe, Twilio, or GHL values.

## 8. Status by feature

### Fully working
Multi-tenancy + RBAC; auth + invites (email + SMS when Twilio configured); employee roster and status; branding; locations/crews CRUD; public rating + feedback page; manual tip logging; dynamic split trigger; reconciliation (confirm/dispute cash tips, discrepancy flags, unverified ratio); disputes & refunds workflow; payout statements (CSV + print); QR display/fullscreen/PNG/poster route; thank-you SMS+email templates; review syndication on 5★; rate limiting (5 ratings/IP/hour); unsubscribe + suppression; email queue with DLQ; SEO metadata, sitemap, robots, legal pages; RLS + grants.

### Partially implemented / config-blocked
- Card tips: code complete but **no Stripe keys set anywhere** → `getStripe()` returns null, card panel shows "not enabled", webhook returns 400.
- SMS: all send paths silently return `status: "skipped"` when Twilio/LOVABLE keys are absent; `sms_deliveries` is empty (0 rows) — never exercised in production.
- Email: templates and queue exist but `email_send_log` and `email_deliveries` are both empty — no delivery evidence yet.
- GHL: inbound endpoint only; no outbound GHL workflow trigger from the app.
- `print.employee.$id.tsx` has no client session gate (relies on server-fn authz only).

### Mocked / UI-only
None found. No TODO/FIXME/mock markers anywhere in `src/lib`, `src/routes`, `src/components`; every button has a real handler. The only intentional deferral: P2P (Venmo/CashApp/Zelle/PayPal/cash) tips are **customer-reported**, logged unverified — no money moves in-app (`public.functions.ts:122-124`).

### Missing
- No server-side route guard (`beforeLoad`) anywhere; no `_authenticated/` subtree.
- No super-admin bootstrap path despite the comment at `auth.functions.ts:25` — `claimRole` always throws without an invite code (`:66-68`).
- No `notify_email` opt-in column (only `drivers.notify_sms`); email notifications are unconditional.
- No storage buckets — logos are URL-only, no upload; no employee photo upload.
- No end-to-end live Stripe test; no Connect payout verification for a real employee.
- No automated tests, no CI.
- Unused shadcn UI scaffold (sidebar, carousel, chart, command, menubar, etc.) inflating the bundle.

### Known bugs / discrepancies
1. **Stripe application fee is 20%** (`stripe.functions.ts:117`) while the tenant split gives the platform only 10% (Roadside) or 5% (others). Card tips overcharge the platform's share and the destination transfer doesn't match `apply_tip_split`.
2. **`SPLIT` constant is stale**: `constants.ts:3` says 80/10/10; DB says 90/0/10 and 90/5/5. It's used in `dashboard/driver.tsx:282` to tell the employee "you owe X to the company/platform" — that number is wrong.
3. Duplicate tenant rows: two companies named "Roadside Towing" (`roadside-towing` 90/0/10 with 1 driver; `roadside-towing-pt7` 90/5/5 with 0 drivers) — the second is stray test data.
4. Fallback base URLs (`roadsidetips.lovable.app`, `app.bluecollar.ai`) will produce broken invite/tip links unless `APP_BASE_URL` / `APP_PUBLIC_URL` are set — neither is in `.env`.
5. `thankyou.server.ts:14-21` template rendering does no escaping of interpolated values.
6. Auth-gate flash: dashboards mount before the client session check resolves.

## 9. Deployment requirements

Lovable Cloud deploy: set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`; point the Stripe endpoint at `/api/public/webhooks/stripe` subscribing `payment_intent.succeeded` + Connect `account.updated`; set `APP_BASE_URL` and `APP_PUBLIC_URL` to `https://bluecollartips.app`; confirm Twilio/GHL secrets; run a live $1 tip and one Connect onboarding.
Railway deploy: build via `vite build`, start `node .output/server/index.mjs` (`railway.json`), Nitro pinned to `node-server`. Requires its own `SUPABASE_SERVICE_ROLE_KEY` — Lovable Cloud does not expose one, so Railway must point at a self-hosted Supabase project seeded from `supabase/migrations/`, and webhooks must target the Railway domain.

## Next step

Approve and I'll save this as a versioned document in the project (e.g. `docs/AUDIT.md`) plus a downloadable copy — no code changes. Tell me if you also want me to fix items 1–4 in the same pass.
