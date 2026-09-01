# Blue Collar Tips: Product Purpose and User Workflows

## 1. What this website is

Blue Collar Tips is a multi-company rating and tipping platform for towing companies and other field-service businesses.

Its main purpose is to help a company collect customer feedback and public reviews after a job. Tipping is an additional feature. A customer must always be able to leave a rating without paying a tip.

The basic flow is:

1. A company adds an employee.
2. The employee receives a unique public tip-page link and QR code.
3. At the end of a job, the employee shows the QR code or sends the link to the customer.
4. The customer opens the page without creating an account.
5. The customer rates the employee, optionally leaves feedback, and optionally leaves a tip.
6. The employee and company see the result in their dashboards.
7. A five-star customer can be directed to the company's external review pages.

The application is multi-tenant: one installation supports many companies, while each company sees only its own employees and records.

## 2. The four user types

### Customer

A customer does not create an account or sign in.

The customer can:

- Scan an employee's QR code or open their public link.
- See the employee and company branding.
- Leave a 1–5 star rating.
- Leave optional written feedback and contact details.
- Choose an optional tip amount.
- Pay by card when Stripe is configured.
- Follow a configured personal payment-app option when available.
- Follow Google, Yelp, or Facebook review links after a positive experience.

The customer cannot see dashboards, other customers, employee earnings, or company records.

### Employee (called `driver` internally)

An employee is a worker who completes jobs and receives ratings or tips. The database and some source code use the older term `driver`, but the UI generally says employee.

The employee can:

- Sign in with email/password or Google.
- View and share their personal tip link.
- Display, download, or print their QR code.
- See their ratings, feedback, and tip history.
- See gross tips and the calculated employee share.
- Log cash, Venmo, Cash App, Zelle, PayPal, or other off-platform tips manually.
- See the amount owed to the company/platform from manually received tips.
- Configure SMS notifications.
- Begin Stripe account onboarding when Stripe is configured.
- Confirm or dispute manual-tip records where the workflow allows it.
- Print a payout statement.

Employee statuses are:

- `pending`: created or invited, but not yet approved for normal use.
- `active`: approved and available in the customer workflow.
- `deactivated`: retained for historical records but no longer active.

### Company admin

A company admin manages one company. Typical users are an owner, manager, dispatcher, or office employee.

The company admin can:

- Add employees and send invitation links.
- Invite another company admin.
- Approve, deactivate, or reactivate employees.
- Assign employees to locations or crews.
- View every employee's QR code and public tip link.
- Download QR images and print branded employee posters.
- View company-wide ratings, feedback, and tip totals.
- See the company's calculated share of tips.
- Manage company name, logo, colors, and support details.
- Configure Google, Yelp, and Facebook review links.
- Configure automatic thank-you email/SMS templates.
- Send an employee's tip link to a customer by SMS when Twilio is configured.
- Review reconciliation statistics for manual tips.
- View and resolve discrepancy flags.
- Flag, clear, or refund disputed tips where supported.
- View printable employee payout statements.

A company admin cannot manage an unrelated company unless separately assigned to it.

### Platform super admin

The super admin operates the entire Blue Collar Tips platform.

The super admin can:

- Create and onboard companies.
- Invite the first admin for a company.
- Switch between company dashboards for support or inspection.
- View platform-wide companies, users, gross tips, and platform share.
- Inspect integration status.
- Suspend or reactivate a tenant.
- Use company-admin and employee views for support.

This role should be limited to trusted platform operators.

## 3. Onboarding workflows

### Adding a company

1. A super admin creates the company.
2. The system creates its unique slug, for example `blue-collar-demo`.
3. The super admin generates an invitation for the company owner or manager.
4. The company admin follows the invitation and creates or links an account.
5. The company admin configures branding, review links, locations, and employees.

### Adding an employee

1. A company admin opens the Employees section.
2. The admin enters the employee's name and optional email, phone, and employee ID.
3. The employee profile is created as `pending`.
4. An invitation link is generated. Email delivery occurs only when Resend is configured; the link can always be copied manually.
5. The employee signs up or signs in and accepts the invitation.
6. The company admin marks the employee `active` when ready.
7. The employee's public URL and QR code become the customer-facing entry point.

## 4. QR-code workflow

Every employee has a public URL in this format:

```text
https://bluecollartips.app/{company-slug}/d/{employee-slug}
```

For local testing it uses the local origin:

```text
http://localhost:3000/{company-slug}/d/{employee-slug}
```

The QR code contains only this URL. It is generated in the browser with `qrcode.react`; it does not require an external QR service, account, API key, Supabase, or Mini QR.

Company admins see a QR gallery in the Employees section. Selecting an employee provides options to copy the link, download a PNG, open a pre-filled message, or print a branded poster. Employees see the same QR information on their own dashboard.

Important local-testing note: a QR code containing `localhost` works only on the computer running the application. A phone cannot interpret `localhost` as that computer. To scan from a phone during development, use a LAN-accessible URL or a secure tunnel and generate the QR from that origin.

## 5. Rating and review workflow

1. The customer opens the employee's public page.
2. The customer selects 1–5 stars and may add comments/contact details.
3. The rating is stored against the employee and company.
4. The employee and company dashboards update.
5. Low ratings remain internal for follow-up.
6. A five-star result can show configured external review links.
7. If enabled and contact information was provided, the system attempts a thank-you email or SMS.

External review links must be entered by the company admin. The application cannot create or control a company's Google/Yelp/Facebook listing.

## 6. Tip and money workflow

The default accounting split is:

- Employee: 80%
- Company: 10%
- Blue Collar Tips platform: 10%

PostgreSQL calculates and records these three ledger amounts whenever a tip is stored.

Example: a $10 tip records $8 for the employee, $1 for the company, and $1 for the platform.

### Card tips

When Stripe is fully configured, the customer can submit a card tip from the public page. Stripe handles card data; the application must never store raw card numbers.

The app currently contains Stripe payment, webhook, onboarding, refund, and reporting code. Real payment behavior still depends on the chosen Stripe Connect account structure, valid Stripe credentials, webhook configuration, connected-account onboarding, and end-to-end test-mode verification.

Database split calculations are an internal ledger. They do not, by themselves, move money between bank accounts. Stripe configuration determines the real movement and payout of funds.

### Cash and payment-app tips

Cash, Venmo, Cash App, Zelle, PayPal, and similar payments happen outside Blue Collar Tips. The employee receives that money directly and logs it manually.

The app records the same 80/10/10 accounting split. Because the platform did not receive the money, the employee owes the company and platform shares. The dashboard displays that obligation for reconciliation.

Automatic deduction of this obligation from a future Stripe payout should not be considered complete until the exact legal/payment model and Stripe Connect implementation have been approved and tested.

## 7. Disputes, verification, and reconciliation

The system stores whether manual tips are verified, disputed, flagged, refunded, or unresolved.

Employees can review applicable manual-tip records. Company admins can inspect unverified percentages, follow up offline, create discrepancy flags, add notes, and resolve issues. The application tracks the workflow; it is not an HR disciplinary system and does not independently prove whether cash changed hands.

Card refunds should be sent through Stripe. A database status change alone must not be treated as a completed financial refund.

## 8. Authentication

The application uses its own PostgreSQL-backed users and sessions; it does not use Supabase Auth.

Supported paths are:

- Email and password.
- Google OAuth when Google credentials are configured.
- Password reset by email when Resend is configured.
- Company/employee invitation links.

Google OAuth requires separate authorized callback URLs for local and production environments.

## 9. Services and environment configuration

### Required for the core app

- PostgreSQL (`DATABASE_URL`)
- A strong session/auth secret
- Public application URL/origin

### Optional until that feature is tested

- Google OAuth client ID and secret: Google sign-in
- Resend API key and sender address: invitations, resets, and email notifications
- Twilio account details and sending number: SMS delivery
- Stripe keys and webhook secret: card payments, connected accounts, and refunds

The app should still start locally without optional providers, but their related delivery/payment actions will be unavailable or fail gracefully.

## 10. Local testing personas

The local seed command creates example users for workflow testing:

```bash
npm run db:seed
```

All seeded users use this local-only password:

```text
password123
```

Seeded accounts include:

- `admin@bluecollartips.local`: company admin
- `mike@bluecollartips.local`: employee
- `sarah@bluecollartips.local`: employee
- `james@bluecollartips.local`: employee

These credentials must never be used in production.

## 11. What is operational now vs. what still needs launch work

### Implemented in the application

- PostgreSQL database and migrations
- PostgreSQL-backed authentication and sessions
- Email/password login and Google OAuth code path
- Multi-company roles and access control
- Company and employee onboarding/invitations
- Public employee rating/tip pages
- Ratings and feedback storage
- Employee QR generation, download, and print views
- Manual tip ledger and 80/10/10 database split
- Admin and employee dashboards
- Locations/crews, review links, thank-you templates
- Reconciliation, flags, disputes, and payout reports
- Direct Resend, Twilio, and Stripe integration code paths
- Local Docker database and test seed data

### Required before production launch

- Add production secrets to Railway rather than committing `.env`.
- Run all migrations against the Railway PostgreSQL database.
- Configure the production domain and HTTPS.
- Configure and verify Google OAuth callback URLs.
- Configure Resend and verify the sending domain.
- Configure Twilio, including applicable consent/compliance requirements.
- Finalize the Stripe Connect money-flow architecture with the account owner.
- Configure Stripe test mode, webhook delivery, connected accounts, and refunds.
- Perform end-to-end tests using real browser sessions and test payments.
- Decide exactly when a pending employee's public page becomes available.
- Establish company policies for cash reporting, disputes, refunds, and payouts.
- Review privacy policy, terms, tax treatment, and payment compliance with qualified advisers.
- Replace all local seed accounts and sample company data.

## 12. Recommended launch sequence

1. Validate roles, invitations, ratings, QR codes, and manual tips locally.
2. Deploy the app and PostgreSQL database to a Railway staging environment.
3. Configure staging Google login and email delivery.
4. Configure Stripe in test mode and verify every successful/failed/refunded payment path.
5. Configure and test SMS only after consent language and sender registration are ready.
6. Run acceptance testing with one real company and several test employees.
7. Confirm financial reconciliation and payout reports with the business owner.
8. Complete legal/compliance review.
9. Deploy production credentials and run a controlled pilot.

## 13. One-sentence explanation for each user

- Customer: “Scan, rate the worker, and optionally tip—no account needed.”
- Employee: “Share your QR code and track your own ratings and earnings.”
- Company admin: “Manage employees and review the company's ratings, tips, QR codes, and exceptions.”
- Super admin: “Operate all companies and monitor the Blue Collar Tips platform.”

