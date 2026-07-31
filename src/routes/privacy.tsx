import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Blue Collar Tips" },
      {
        name: "description",
        content:
          "How Blue Collar Tips collects, uses, and protects customer, employee, and company data across ratings, tips, email, and SMS.",
      },
      { property: "og:title", content: "Privacy Policy — Blue Collar Tips" },
      { property: "og:description", content: "How we handle customer, employee, and company data." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://roadsidetips.lovable.app/privacy" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://roadsidetips.lovable.app/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Back
        </Link>
        <h1 className="display mt-4 text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated {new Date().toLocaleDateString("en-US", { dateStyle: "long" })}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          This page is maintained by Blue Collar AI, Inc. to explain how Blue Collar Tips handles
          data. It describes our current practices, not an independent audit or certification.
        </p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-base font-semibold text-foreground">What we collect</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="text-foreground">Customers:</span> star rating, optional written
                feedback, and optionally your name, phone number, and email if you ask for a
                thank-you message or receipt.
              </li>
              <li>
                <span className="text-foreground">Employees:</span> name, work email, phone, photo,
                assigned company and location, optional peer-to-peer payment handles, and payout
                status from Stripe.
              </li>
              <li>
                <span className="text-foreground">Companies:</span> company name, branding, contact
                details, review links, and tip-split configuration.
              </li>
              <li>
                <span className="text-foreground">Technical:</span> a one-way hashed form of the
                submitting IP address, used only to limit abusive or automated rating submissions.
              </li>
            </ul>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">How we use it</h2>
            <p className="mt-2">
              To record ratings and tips, calculate and route payouts, send invites, tip
              notifications, thank-you messages and receipts, show dashboards and payout statements
              to the employee and their company, and protect the service from abuse. We do not sell
              personal data and we do not send marketing email from this platform.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">Who we share it with</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Stripe, Inc. — card payment processing and employee payouts.</li>
              <li>Twilio and our messaging provider — SMS delivery.</li>
              <li>Our email delivery provider — invites, notifications, and receipts.</li>
              <li>Our cloud hosting and database provider — application hosting and storage.</li>
              <li>The employing company — its own employees' ratings, tips, and totals.</li>
            </ul>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">Access controls</h2>
            <p className="mt-2">
              Data is scoped per company: company admins see only their own team, employees see only
              their own ratings and earnings, and access is enforced at the database level. Data is
              encrypted in transit. Payment card details never touch our servers — they are entered
              directly into Stripe.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">Messaging and opt-out</h2>
            <p className="mt-2">
              SMS is sent only for service purposes. Reply STOP to any message to opt out, or HELP
              for help. Every email includes an unsubscribe link for non-essential messages.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">Retention and your rights</h2>
            <p className="mt-2">
              Ratings and tip records are retained while the company's account is active and as long
              as required for financial recordkeeping. Abuse-prevention records are kept briefly and
              then deleted. To access, correct, or delete your data, email us and we will respond
              within a reasonable period.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">Contact</h2>
            <p className="mt-2">
              Blue Collar AI, Inc. —{" "}
              <span className="text-foreground">notify@bluecollarai.online</span>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}