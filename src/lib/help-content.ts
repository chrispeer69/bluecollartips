// Help-center articles shown to tenants (company admins) and employees.
// Plain text with blank-line paragraphs; lines starting with "- " render as
// bullets and lines starting with "1. " as numbered steps.

export type HelpArticle = {
  id: string;
  title: string;
  audience: ("admin" | "employee")[];
  body: string;
};

export type HelpSection = {
  id: string;
  title: string;
  articles: HelpArticle[];
};

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    articles: [
      {
        id: "first-week",
        title: "Set up your company in 15 minutes",
        audience: ["admin"],
        body: `Here is the order that gets you live fastest.

1. Company settings → Branding: upload your logo and pick your two brand colors. Customers see these on every rating and tip page.
2. Company settings → Public review destinations: save your Google, Yelp and Facebook review URLs, then select the one positive customers should visit. For Google, use the "write a review" link from your Google Business Profile.
3. Card tips need no setup: every one is split 90% to the employee and a flat 10% Blue Collar Tips fee.
4. Employees → Add employee: enter each tech or driver's name, email and phone. Each one gets a personal QR code and tip link.
5. Print the QR codes (Employees → QR) and put them on trucks, invoices or business cards.
6. Optional: connect TowBook / GoHighLevel so a rating link is texted automatically when a job closes (see Integrations).

You can do all of this from the Overview page links or the left navigation.`,
      },
      {
        id: "how-it-works",
        title: "How a customer rates and tips",
        audience: ["admin", "employee"],
        body: `A customer scans an employee's QR code or taps a texted link. They land on a page branded to your company that shows the employee's name.

They tap a star rating, optionally leave a comment (with one-tap suggested comments), and can leave a tip by card, Apple Pay or Google Pay. Their name and phone are pre-filled when the link came from dispatch, so most customers finish in under 30 seconds.

After the tip step, customers who rated at or above your "positive rating" threshold (default 4 stars) are sent to the one public-review URL configured by the company.

Low ratings are flagged and appear under Ratings & feedback → Discrepancy flags so you can follow up before they turn into a public complaint.`,
      },
      {
        id: "roles",
        title: "Roles: company admin vs employee vs platform",
        audience: ["admin", "employee"],
        body: `- Company admin: runs the workspace. Adds employees, sets branding and tip split, sees every rating and tip, requests company payouts, and opens support tickets on behalf of the company.
- Employee (driver / tech): has their own dashboard with their QR code, tips, ratings, earnings wallet and payout account. They can also open support tickets.
- Blue Collar Tips (platform): operates the service, processes card payments, reviews and pays out withdrawal requests, and answers support tickets.

One person can be an admin in one company and an employee in another. Use the workspace switcher at the top of the left navigation.`,
      },
    ],
  },
  {
    id: "employees",
    title: "Employees, invites & QR codes",
    articles: [
      {
        id: "add-employee",
        title: "Add an employee and get them signed in",
        audience: ["admin"],
        body: `1. Go to Employees → Add employee. Enter their display name (what customers see), email and mobile number.
2. Their QR code and tip link are created immediately — you can print and use them before the employee ever signs in.
3. To give them dashboard access, go to Employees → Employee & admin invite codes and create an employee invite. Text or email them the link. When they sign up with it they are joined to your company automatically.
4. Alternatively, share your permanent company join code (on the Overview page). Anyone who signs up with it lands in Pending join requests for you to approve.

If an employee leaves, set their status to inactive. Their QR code stops accepting new ratings and tips, but their history stays for your records.`,
      },
      {
        id: "qr-codes",
        title: "Printing and using QR codes",
        audience: ["admin", "employee"],
        body: `Every employee has a personal QR code (Employees → QR, or QR & share on the employee dashboard). It is branded with your logo and colors.

Where they work best:
- A sticker inside the truck door or on the dash, at eye level for the customer.
- Printed on the invoice or receipt.
- A small card the employee hands over at the end of the job.

The code never changes for that employee, so you can print once. If a customer cannot scan, the employee can text them the link from their dashboard (QR & share → Text my tip link).`,
      },
      {
        id: "crews",
        title: "Locations and crews",
        audience: ["admin"],
        body: `Under Employees → Locations / crews you can create yards, branches or crews and assign employees to them. This is for your own reporting — it does not change what customers see.`,
      },
    ],
  },
  {
    id: "integrations",
    title: "TowBook, GoHighLevel & webhooks",
    articles: [
      {
        id: "dispatch-link",
        title: "Automatically text a rating link when a job closes",
        audience: ["admin"],
        body: `Blue Collar Tips exposes a webhook your dispatch software (TowBook via GoHighLevel, or anything that can call a URL) hits when a job is completed. It returns a one-time rating link for that exact job, driver and customer, which your automation then texts to the customer.

What to send: your company slug, the job ID, the driver (name, email, phone or slug — any one that matches an employee), and the customer's name, phone and email.

What you get back: a link that pre-fills the customer's details, is tied to the right employee, and expires after 10 days (configurable 1–30).

If the driver name dispatch sends does not match an employee, the rating still comes in as a company-level rating. Under Ratings & feedback you will see "Dispatch said: <name>" with a one-click Assign button so you can attribute it afterwards. Keeping employee names in Blue Collar Tips identical to the names in your dispatch software avoids this.

Ask Blue Collar Tips support for the webhook URL and secret for your company — open a ticket under "TowBook / GHL / webhooks".`,
      },
      {
        id: "outbound-webhook",
        title: "Send new ratings to your CRM",
        audience: ["admin"],
        body: `Under Company settings you can keep the existing review webhook for review.submitted events and configure a separate tip webhook for tip.received events. The review workflow remains isolated. Tip events include the contact, employee, job ID, amount and payment time so a separate GHL workflow can stop pending follow-ups and update the contact.`,
      },
    ],
  },
  {
    id: "money",
    title: "Tips, money & payouts",
    articles: [
      {
        id: "money-flow",
        title: "Where the money goes — the full flow",
        audience: ["admin", "employee"],
        body: `1. A customer tips by card on the rating page. The charge is processed by Stripe into the Blue Collar Tips platform account.
2. The tip is split automatically the moment it succeeds: 90% to the employee and a flat 10% Blue Collar Tips fee. The company keeps no share. Every tip stores its own split, so the ledger is auditable to the penny.
3. The employee's share lands in their Earnings wallet. A tip with no employee waits under Unassigned company tips until an admin assigns it.
4. Either party can request a withdrawal once their available balance is at or above the platform minimum (default $25). They choose the payout method on file: bank transfer, Cash App, Venmo, Zelle, PayPal or check.
5. Blue Collar Tips reviews and pays each request within the processing window (0–5 days, shown on the wallet), then marks it paid with a reference number you can see in your request history.

Tips that are disputed or refunded are removed from the available balance. A tip that arrived without an employee (company-level page, or dispatch sent an unknown driver) sits under Unassigned company tips until an admin assigns it — only then does the employee's share become withdrawable.

Manual tips (cash, or a tip the employee logs themselves) are bookkeeping only. Blue Collar Tips never held that money, so no split is taken and they do not fund the wallet.`,
      },
      {
        id: "company-payout",
        title: "Requesting a company payout",
        audience: ["admin"],
        body: `1. Tips & payments → Company wallet → Company payout details: add where you want to be paid. Bank details are encrypted at rest.
2. Enter a withdrawal amount between the platform minimum and your available balance, then Request.
3. One request can be open at a time. You will see it move through pending → approved → paid. When it is paid, the method and reference number appear in your history.

The available balance only counts successful card tips that are finalized (assigned to an employee or explicitly kept by the company), not disputed, and not refunded.`,
      },
      {
        id: "employee-payout",
        title: "Employee withdrawals",
        audience: ["admin", "employee"],
        body: `Employees manage their own money from their dashboard: Earnings & withdrawals shows the wallet, and Payout account is where they add a bank account or app handle. Admins can view an employee's wallet (Employees → View dashboard) but cannot request a payout on their behalf.

As an admin you can see every employee's earned, pending and paid-out totals under Tips & payments → Employee earnings & payouts, which is the fastest way to answer "did my tech get paid?"`,
      },
      {
        id: "disputes-refunds",
        title: "Disputes, refunds and cash tips",
        audience: ["admin", "employee"],
        body: `- Refund: Tips & payments → Tip disputes & refunds. Refunding a card tip returns the full amount to the customer through Stripe and removes it from both wallets.
- Dispute: flag a tip you believe is wrong (wrong employee, duplicate, suspected fraud). It is held out of balances until cleared.
- Cash / manual tips: employees can log a cash tip for their records. Admins verify or dispute these under the employee's activity. They never affect wallets.`,
      },
      {
        id: "statements",
        title: "Statements and exporting for your bookkeeper",
        audience: ["admin", "employee"],
        body: `Tips & payments → Recent customer payments has a date filter, totals for the range, and a Download CSV button. The CSV includes the date, customer, employee, gross, employee share, company share, platform fee, status and Stripe ID for every payment — everything your accountant needs.

Employees have the same on their dashboard under Earnings & withdrawals → Payout statement.`,
      },
      {
        id: "fees",
        title: "What Blue Collar Tips costs",
        audience: ["admin"],
        body: `There is no subscription. Blue Collar Tips keeps a flat 10% of each card tip; card processing is included. Ratings, feedback, QR codes, texting links and the dashboards are free to use. Cash and manual tips are never charged.`,
      },
    ],
  },
  {
    id: "ratings",
    title: "Ratings, reviews & feedback",
    articles: [
      {
        id: "attribute-review",
        title: "A rating shows the company name instead of the employee",
        audience: ["admin"],
        body: `That rating came through a company-level link — either your general company page or a dispatch job whose driver did not match an employee.

Go to Ratings & feedback. Each rating has an Employee picker; choose the right person and it is re-attributed immediately (their stats update too). If dispatch sent a name, you will see "Dispatch said: …" with an Assign shortcut.

To stop it happening: make sure employee names in Blue Collar Tips match your dispatch software exactly, or have dispatch send the employee's phone or email as well.`,
      },
      {
        id: "public-reviews",
        title: "Getting more Google reviews",
        audience: ["admin"],
        body: `After the tip step, a customer at or above your positive-rating threshold is sent to the destination selected under Company settings → Public review destinations. Google, Yelp and Facebook links remain saved, but the customer sees only the selected destination. For Google, use your direct "write a review" link from Google Business Profile.

Ratings below the threshold are not redirected; they see a thank-you page and are flagged for you to handle privately.`,
      },
    ],
  },
  {
    id: "account",
    title: "Account & sign-in",
    articles: [
      {
        id: "signin",
        title: "Signing in and password resets",
        audience: ["admin", "employee"],
        body: `Sign in at bluecollartips.app/auth with your email and password, or with Google if you signed up that way. Use "Forgot password" to get a reset link by email.

If you cannot receive email, open a support ticket from someone else's account in your company, or contact us from the public site, and we will verify you another way.`,
      },
      {
        id: "switch-workspace",
        title: "I belong to more than one company",
        audience: ["admin", "employee"],
        body: `Use the Workspace selector at the top of the left navigation to switch between companies. Each workspace has its own employees, wallet and settings.`,
      },
    ],
  },
  {
    id: "support",
    title: "Getting help",
    articles: [
      {
        id: "open-ticket",
        title: "Open a support ticket",
        audience: ["admin", "employee"],
        body: `Use the Contact support form on this page. Pick a category, tell us what you expected and what happened, and include the employee or customer name and the date if it is about a specific tip or rating.

You will get replies in the ticket thread here and by email. Status meanings:
- Waiting on Blue Collar Tips — we owe you a reply.
- Waiting on you — we asked a question or need you to try something.
- Resolved — we believe it is fixed; reply if not and it reopens.

Urgent issues (money missing, customers cannot pay) — mark the priority Urgent.`,
      },
    ],
  },
];

export function searchHelp(query: string, audience: "admin" | "employee"): HelpSection[] {
  const q = query.trim().toLowerCase();
  return HELP_SECTIONS.map((s) => ({
    ...s,
    articles: s.articles.filter(
      (a) =>
        a.audience.includes(audience) &&
        (!q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)),
    ),
  })).filter((s) => s.articles.length > 0);
}
