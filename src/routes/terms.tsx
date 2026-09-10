import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Blue Collar Tips" },
      {
        name: "description",
        content:
          "Terms of Service for Blue Collar Tips, the field-service rating and tipping platform from Blue Collar AI, Inc.",
      },
      { property: "og:title", content: "Terms of Service — Blue Collar Tips" },
      { property: "og:description", content: "The terms governing use of the Blue Collar Tips platform." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://bluecollartips.app/terms" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://bluecollartips.app/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Back
        </Link>
        <h1 className="display mt-4 text-3xl font-bold">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated {new Date().toLocaleDateString("en-US", { dateStyle: "long" })}
        </p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-base font-semibold text-foreground">1. Who we are</h2>
            <p className="mt-2">
              Blue Collar Tips is operated by Blue Collar AI, Inc. ("we", "us"). By creating an
              account, inviting employees, or submitting a rating or tip, you agree to these terms.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">2. Accounts and roles</h2>
            <p className="mt-2">
              Companies register a tenant account and are responsible for the employees they invite,
              the accuracy of the information they enter, and the conduct of their team on the
              platform. Employees are responsible for keeping their login credentials and payout
              details secure.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">3. Tips and payments</h2>
            <p className="mt-2">
              Tips are voluntary payments made by customers. Card payments are processed by Stripe,
              Inc. Tips are recorded between the employee, the company, and the platform according
              to the percentages configured for the company at the time of the tip. Card funds are
              collected in the platform Stripe account and distributed separately. Cash and
              peer-to-peer tips logged in the app are self-reported and are not processed or
              guaranteed by us.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">4. Ratings and feedback</h2>
            <p className="mt-2">
              Customer ratings and feedback must be honest and lawful. We may remove content that is
              abusive, fraudulent, defamatory, or submitted to manipulate results, and we may rate
              limit or block submissions we believe are automated or abusive.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">5. Messaging</h2>
            <p className="mt-2">
              By providing a phone number you consent to receive service-related text messages such
              as invites, tip notifications, and receipts. Message and data rates may apply. Reply
              STOP to opt out or HELP for help.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">6. Acceptable use</h2>
            <p className="mt-2">
              Don't misuse the service: no reverse engineering, scraping, interference with the
              platform, impersonation of another employee or company, or use of the service for
              unlawful purposes.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">7. Termination</h2>
            <p className="mt-2">
              We may suspend or terminate accounts that violate these terms. You may stop using the
              service at any time and request deletion of your account data.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">8. Disclaimers and liability</h2>
            <p className="mt-2">
              The service is provided "as is" without warranties of any kind. To the maximum extent
              permitted by law, our aggregate liability arising from your use of the service is
              limited to the amounts you paid us in the twelve months before the claim.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">9. Contact</h2>
            <p className="mt-2">
              Questions about these terms: <span className="text-foreground">notify@bluecollarai.online</span>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
