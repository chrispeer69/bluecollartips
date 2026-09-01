import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/guides/fica-tip-credit")({
  head: () => ({
    meta: [
      { title: "FICA Tip Credit (Section 45B): Employer's Guide — Blue Collar Tips" },
      {
        name: "description",
        content:
          "How service business owners claim the Section 45B FICA tip credit on Form 8846 — eligibility, the math, recordkeeping, and common mistakes.",
      },
      { property: "og:title", content: "FICA Tip Credit (Section 45B): Employer's Guide" },
      {
        property: "og:description",
        content:
          "A practical guide to the FICA tip credit for towing and service business owners: who qualifies, how to calculate it, and how to document tips.",
      },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://bluecollartips.app/guides/fica-tip-credit" },
    ],
    links: [
      { rel: "canonical", href: "https://bluecollartips.app/guides/fica-tip-credit" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "FICA Tip Credit (Section 45B): Employer's Guide",
          description:
            "How service business owners claim the Section 45B FICA tip credit on Form 8846.",
          author: { "@type": "Organization", name: "Blue Collar Tips" },
          publisher: { "@type": "Organization", name: "Blue Collar Tips" },
          mainEntityOfPage: "https://bluecollartips.app/guides/fica-tip-credit",
        }),
      },
    ],
  }),
  component: FicaTipCreditGuide,
});

function FicaTipCreditGuide() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary font-bold text-primary-foreground">
              B
            </div>
            <span className="font-semibold">Blue Collar Tips</span>
          </Link>
          <Link
            to="/auth"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        <span className="inline-block rounded-full bg-secondary/15 px-3 py-1 text-xs font-medium text-secondary">
          Guide
        </span>
        <h1 className="display mt-6 text-4xl font-bold leading-tight md:text-5xl">
          FICA tip credit: an employer's guide to Section 45B
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          If your team takes tips, the IRS will give you back most of the payroll tax you
          paid on them. Here's how the Section 45B credit works and how to claim it without
          leaving money on the table.
        </p>

        <section className="mt-12 space-y-4">
          <h2 className="text-2xl font-semibold">What is the FICA tip credit?</h2>
          <p>
            The FICA tip credit — formally the credit for employer social security and
            Medicare taxes paid on certain employee tips, under Internal Revenue Code
            Section 45B — refunds employers the 7.65% FICA tax they paid on the portion of
            employee tips above the federal minimum wage of $5.15/hour (the rate frozen for
            this calculation). It's a dollar-for-dollar credit against income tax, not a
            deduction.
          </p>
          <p>
            It was originally written for restaurants, but the statute applies to any
            employer in a business "where tipping is customary" for food or beverage. Many
            towing, valet, salon, delivery, and personal service operators don't qualify
            on the food-and-beverage test — but if your company also runs a cafe, food
            truck, or beverage service alongside the field work, the tipped portion of
            that side qualifies. Always confirm eligibility with your CPA.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-2xl font-semibold">Who can claim it</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>You're a business where tipping for food or beverages is customary.</li>
            <li>You paid employer FICA on tips your employees received.</li>
            <li>The tips are reported (cash, card, or pooled).</li>
            <li>Wages plus tips bring the employee above $5.15/hour for the period.</li>
          </ul>
          <p>
            S-corps, partnerships, and sole proprietors all qualify — the credit flows
            through to the owner's personal return via Schedule K-1.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-2xl font-semibold">How the math works</h2>
          <p>The calculation, per employee, per pay period:</p>
          <div className="rounded-lg border border-border bg-card p-6 text-sm">
            <ol className="list-decimal space-y-2 pl-6">
              <li>Take total tips reported by the employee.</li>
              <li>
                Calculate the "shortfall": $5.15 × hours worked, minus actual hourly wages
                paid. If wages already exceed $5.15/hr, the shortfall is zero.
              </li>
              <li>Subtract the shortfall from reported tips. This is the creditable tip amount.</li>
              <li>Multiply by 7.65% (6.2% Social Security + 1.45% Medicare).</li>
            </ol>
          </div>
          <p>
            Example: a driver earns $15/hr base wage and reports $400 in tips during a pay
            period. Wages already exceed $5.15/hr, so the shortfall is $0. The full $400
            is creditable. Credit = $400 × 7.65% = <strong>$30.60</strong> for that employee,
            that period. Across a 20-person crew over a year, this routinely lands in the
            $5,000–$25,000 range.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-2xl font-semibold">How to claim it: Form 8846</h2>
          <p>
            File <strong>IRS Form 8846</strong> (Credit for Employer Social Security and
            Medicare Taxes Paid on Certain Employee Tips) with your annual return. The form
            is short — four lines — but it depends on accurate per-employee tip totals for
            the year.
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li><strong>Line 1:</strong> Tips received by employees for services on which you paid or owed FICA.</li>
            <li><strong>Line 2:</strong> Tips not subject to the credit (the shortfall portion).</li>
            <li><strong>Line 3:</strong> Creditable tips (Line 1 − Line 2).</li>
            <li><strong>Line 4:</strong> Multiply Line 3 by 7.65%.</li>
          </ul>
          <p>
            The credit is part of the General Business Credit (Form 3800). Unused credit
            carries back 1 year and forward 20.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-2xl font-semibold">The recordkeeping problem</h2>
          <p>
            The credit lives or dies on tip documentation. The IRS expects a per-employee,
            per-period record of tips received — including cash and P2P (Venmo, Cash App,
            Zelle) tips that never touched payroll. Most service businesses lose the credit
            not because they don't qualify, but because cash tips were never logged in a
            way an auditor can read.
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Card tips: captured automatically by the processor — easy.</li>
            <li>Cash tips: must be reported by the employee (Form 4070 or equivalent).</li>
            <li>P2P tips: same as cash — employee-reported, employer-logged.</li>
          </ul>
          <p>
            Blue Collar Tips captures every tip — card, cash, and P2P — with a per-driver
            ledger, timestamp, and customer rating link. When tax time comes, your CPA can
            pull a per-employee tip report in one click and drop the totals straight into
            Form 8846.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-2xl font-semibold">Common mistakes</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Not claiming it at all.</strong> Many small operators assume the
              credit is only for big chains. It isn't.
            </li>
            <li>
              <strong>Double-dipping the deduction.</strong> If you claim the credit, you
              cannot also deduct the same FICA tax as a business expense. Your CPA will
              add it back.
            </li>
            <li>
              <strong>Excluding cash tips.</strong> Unreported cash tips can't be claimed —
              but they also can't be the reason you skip the whole credit on reported tips.
            </li>
            <li>
              <strong>Missing prior-year credits.</strong> You can amend up to three years
              back with Form 1040-X / 1120-X if the credit was missed.
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            This guide is informational, not tax advice. Talk to a CPA who knows IRC § 45B
            before filing.
          </p>
        </section>

        <section className="mt-12 rounded-lg border border-border bg-card p-6">
          <h2 className="text-xl font-semibold">Make tip documentation automatic</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Blue Collar Tips logs every card, cash, and P2P tip per driver — the exact record
            your CPA needs for Form 8846.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground hover:opacity-90"
            >
              Get started
            </Link>
            <Link
              to="/guides/tip-pooling"
              className="rounded-md border border-border bg-background px-6 py-3 font-medium hover:bg-muted"
            >
              Read: tip pooling guide
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Blue Collar Tips
      </footer>
    </div>
  );
}