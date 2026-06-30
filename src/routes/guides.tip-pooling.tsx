import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/guides/tip-pooling")({
  head: () => ({
    meta: [
      { title: "Tip Pooling for Field Service Teams — Blue Collar AI" },
      {
        name: "description",
        content:
          "How automated tip pooling works for towing and field service teams: the 80/10/10 split, legal guardrails, and why automation beats spreadsheets.",
      },
      { property: "og:title", content: "Tip Pooling for Field Service Teams" },
      {
        property: "og:description",
        content:
          "A practical guide to automated tip pooling and the 80/10/10 split for towing and field service companies.",
      },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://roadsidetips.lovable.app/guides/tip-pooling" },
    ],
    links: [
      { rel: "canonical", href: "https://roadsidetips.lovable.app/guides/tip-pooling" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "Tip Pooling for Field Service Teams",
          description:
            "How automated tip pooling and the 80/10/10 split work for towing and field service companies.",
          author: { "@type": "Organization", name: "Blue Collar AI" },
          publisher: { "@type": "Organization", name: "Blue Collar AI" },
          mainEntityOfPage: "https://roadsidetips.lovable.app/guides/tip-pooling",
        }),
      },
    ],
  }),
  component: TipPoolingGuide,
});

function TipPoolingGuide() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary font-bold text-primary-foreground">
              B
            </div>
            <span className="font-semibold">Blue Collar AI</span>
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
          Tip pooling for field service teams
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          How automated tip distribution keeps towing and field service crews paid fairly,
          legally, and without the end-of-week spreadsheet headache.
        </p>

        <section className="mt-12 space-y-4">
          <h2 className="text-2xl font-semibold">What is tip pooling?</h2>
          <p>
            Tip pooling is the practice of collecting tips into a shared pot and distributing
            them by an agreed formula — instead of letting each individual keep only what a
            specific customer handed them. For field service work like towing, roadside
            assistance, junk removal, appliance install, and HVAC, pooling smooths out the
            randomness: the driver who happens to get the high-end call doesn't out-earn the
            crew working the late shift by 5x.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-2xl font-semibold">Why automate it?</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>No manual math.</strong> Manual pools fail on payday — someone forgot to
              record a cash tip, percentages are off, the spreadsheet has a typo.
            </li>
            <li>
              <strong>Audit trail.</strong> Every tip is logged with timestamp, customer
              rating, and split — which matters if the DOL or a state labor board asks.
            </li>
            <li>
              <strong>Driver trust.</strong> When drivers can see the formula and watch
              their earnings update in real time, the "where did my tip go?" conversation
              disappears.
            </li>
            <li>
              <strong>Faster payouts.</strong> Automated splits hit driver accounts the same
              day instead of waiting for the next payroll cycle.
            </li>
          </ul>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-2xl font-semibold">The 80/10/10 split</h2>
          <p>
            Blue Collar AI uses an 80/10/10 split as the default for towing companies, and
            it's the model we recommend for most field service crews:
          </p>
          <div className="rounded-lg border border-border bg-card p-6">
            <ul className="space-y-2 text-sm">
              <li>
                <strong className="text-secondary">80% to the driver</strong> who did the job.
                The person the customer interacted with gets the majority share, every time.
              </li>
              <li>
                <strong className="text-secondary">10% to the company</strong> to offset
                processing fees, dispatch overhead, and the cost of running the tip
                program.
              </li>
              <li>
                <strong className="text-secondary">10% to the platform</strong> (Blue Collar
                AI) — covers Stripe processing, SMS thank-yous, reputation tooling, and the
                infrastructure that makes the split happen automatically.
              </li>
            </ul>
          </div>
          <p>
            The split is enforced at the database layer — when a tip clears, the cents are
            divided and posted to each ledger atomically. No driver can be shorted by a
            bug, and no admin can quietly adjust a past split without leaving a record.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-2xl font-semibold">Legal and operational guardrails</h2>
          <p>
            The federal Fair Labor Standards Act (FLSA) lets non-tipped employers run
            mandatory tip pools as long as managers, supervisors, and owners are excluded
            from the pool. State law often goes further — California, Massachusetts, New
            York, and Oregon all have stricter rules about who can share in tips and how
            the pool is documented. Two things matter in practice:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Document the formula in writing</strong> and have drivers acknowledge
              it during onboarding. Blue Collar AI captures this at invite time.
            </li>
            <li>
              <strong>Keep an immutable record of every tip and split.</strong> A scanned
              spreadsheet won't hold up; a per-tip ledger will.
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            This guide is informational, not legal advice. Run your pool design past
            employment counsel in your state.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-2xl font-semibold">Cash tips and reconciliation</h2>
          <p>
            Card tips through Stripe split automatically. Cash and P2P tips (Venmo, Cash
            App, Zelle, PayPal) are logged manually by the driver and reconciled against the
            customer's rating activity. We flag any driver whose unverified-tip ratio
            crosses 20% so admins can spot reporting drift early — without burying the
            driver in paperwork.
          </p>
        </section>

        <section className="mt-12 rounded-lg border border-border bg-card p-6">
          <h2 className="text-xl font-semibold">Ready to automate it?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Spin up a tenant for your towing or field service company and start splitting
            tips on the next job.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground hover:opacity-90"
            >
              Get started
            </Link>
            <Link
              to="/"
              className="rounded-md border border-border bg-background px-6 py-3 font-medium hover:bg-muted"
            >
              Back to home
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Blue Collar AI
      </footer>
    </div>
  );
}