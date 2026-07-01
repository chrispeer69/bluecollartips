
## What I'll build

### 1. Payout statements (CSV + PDF)
- New server fns `getPayoutStatement({ driverId, from, to })` returning tips grouped by day with 80/10/10 splits and totals.
- Admin dashboard: "Export payouts" per employee → CSV (immediate) and PDF (client-side via `jspdf` — already lightweight, add if not present).
- Employee dashboard: "My earnings" tab with date-range picker + same CSV/PDF download.

### 2. Branded QR poster / print pack
- New route `/print/employee/$id` — server-rendered, print-optimized page with company logo, employee name, QR code (large), tagline, and short instructions. Uses existing `qrcode` lib.
- "Download poster (PDF)" button in admin `DriverQRModal` and employee dashboard — generated client-side with `jspdf` + `html2canvas` (or direct SVG→PDF).

### 3. Multi-location / crew grouping
- Migration: new `public.locations` table (id, company_id, name, address, created_at) with GRANTs + RLS (company admins CRUD, super admin all).
- Add `location_id uuid null` to `drivers` (nullable, FK to locations).
- Admin dashboard: "Locations" panel (create/edit/delete) and location dropdown on employee create/edit.
- Filter dashboards, ratings, tips, and payouts by location.

### 4. Employee notifications for new tips/ratings
- DB trigger on `tips` INSERT and `ratings` INSERT → enqueue email to the linked employee via existing `enqueue_email` transactional queue.
- New React Email templates `new-tip.tsx` and `new-rating.tsx` under `src/lib/email-templates/` + registry entry.
- Employee opt-in flag: add `notify_email boolean default true` to `drivers`. Toggle in employee dashboard settings.

### 5. Customer receipt email after card tip
- Extend Stripe webhook `payment_intent.succeeded` handler to send a `card-tip-receipt.tsx` template when `ratings.customer_email` is present (already collected).
- Registry entry + template with brand styling, amount, employee name, company, date.

### 6. Review syndication (Google, Yelp, Facebook)
- Migration: add `google_review_url text`, `yelp_review_url text`, `facebook_review_url text` to `companies`.
- Admin dashboard: "Review links" panel to configure them.
- Public tip page: on 5-star rating, show a "Share your review" step with clickable buttons to each configured platform (opens in new tab). Skip step if none configured.

### 7. Rate limiting (public tip page)
- New table `public.rating_rate_limits` (ip_hash text, driver_id uuid, window_start timestamptz, count int) with a composite index.
- Wrap `submitPublicRating` server fn: hash `x-forwarded-for` + driver id, upsert-increment for the current hour bucket, throw 429 if count > 5. Reset on new hour.
- Cleanup: daily pg_cron `DELETE FROM rating_rate_limits WHERE window_start < now() - interval '2 days'`.

## Technical notes
- New npm deps: `jspdf` (poster + payout PDF). No `html2canvas` — draw poster directly with jsPDF text/image APIs for crisp print.
- Email templates use existing infra (`scaffold_transactional_email` already ran). New templates only need registry additions; no infra rebuild.
- All new tables get `GRANT` + RLS in the same migration (company-scoped policies using `is_company_admin`).
- Rate-limit table uses `TO anon` grant for INSERT/UPDATE via SECURITY DEFINER server fn only — no direct anon access.
- Notification triggers use `public.enqueue_email` (already exists) so no service-role SQL needed.

## Files touched (approximate)
- Migrations: 1 (locations, rate limits, company review columns, drivers.location_id + notify_email, review-share fields on ratings if needed)
- Server fns: `payouts.functions.ts` (new), `locations.functions.ts` (new), extend `stripe.functions.ts`, `public.functions.ts` (rate limit + review URLs), `driver.functions.ts` (notify toggle)
- Routes: `src/routes/print.employee.$id.tsx` (new)
- Components: `LocationsPanel`, `ReviewLinksPanel`, `PayoutExport`, `PosterDownloadButton`, review-share step in public tip page
- Templates: `new-tip.tsx`, `new-rating.tsx`, `card-tip-receipt.tsx` + registry updates

Confirm and I'll build it end to end.
