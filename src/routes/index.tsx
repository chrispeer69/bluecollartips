import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Blue Collar Tips — Get Recognized. Get Tipped More." },
      {
        name: "description",
        content:
          "Recognition and tipping for any field service employee. Company-supported technology that turns great work into more feedback — and more tips.",
      },
      { property: "og:title", content: "Blue Collar Tips — Get Recognized. Get Tipped More." },
      {
        property: "og:description",
        content: "The feedback loop that turns good work into more tips — for any field service crew.",
      },
      { property: "og:url", content: "https://bluecollartips.app/" },
    ],
    links: [{ rel: "canonical", href: "https://bluecollartips.app/" }],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-bold">
              B
            </div>
            <span className="font-semibold">Blue Collar Tips</span>
          </div>
          <Link
            to="/auth"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-20">
          <span className="inline-block rounded-full bg-secondary/15 px-3 py-1 text-xs font-medium text-secondary">
          For every field service crew
        </span>
        <h1 className="display mt-6 text-5xl font-bold leading-tight md:text-6xl">
          Get recognized.
          <br />
          <span className="text-secondary">Get tipped more.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Built for field service crews backed by companies that celebrate good work.
          One QR at the end of the job — rate, review, tip in a tap. Feedback drives
          tips, and tips follow great work. Towing, HVAC, plumbing, landscaping,
          cleaning, delivery, install & repair — show up, do it right, get noticed.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/auth"
            className="rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground hover:opacity-90"
          >
            Get started
          </Link>
          <a
            href="#how"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("how")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="rounded-md border border-border bg-card px-6 py-3 font-medium hover:bg-muted"
          >
            How it works
          </a>
          <Link
            to="/guides/tip-pooling"
            className="rounded-md border border-border bg-card px-6 py-3 font-medium hover:bg-muted"
          >
            Tip pooling guide
          </Link>
          <Link
            to="/guides/fica-tip-credit"
            className="rounded-md border border-border bg-card px-6 py-3 font-medium hover:bg-muted"
          >
            FICA tip credit guide
          </Link>
        </div>

        <div id="how" className="mt-24 grid gap-6 md:grid-cols-3">
          {[
            {
              t: "1. Show the QR",
              d: "Employee shows a personal QR code at the end of every job — sticker, clipboard, or business card.",
            },
            {
              t: "2. Rate & tip",
              d: "Customer rates 1–5 stars, leaves optional feedback, and can tip via card or P2P.",
            },
            {
              t: "3. Split & track",
              d: "Every tip splits 80/10/10 automatically. Employees and admins see live earnings.",
            },
          ].map((s) => (
            <div key={s.t} className="rounded-lg border border-border bg-card p-6">
              <h2 className="font-semibold">{s.t}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>

        <section className="mt-24 rounded-lg border border-border bg-card p-8">
          <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            White-label ready
          </span>
          <h2 className="mt-4 text-2xl font-semibold">Run it under your own brand</h2>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            Blue Collar Tips is fully white-label. Any company can launch it with their
            own name, logo, colors, and support contact — customers see your brand end
            to end while the platform handles ratings, tips, splits, and payouts in the
            background.
          </p>
        </section>
      </main>
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <p>
          Blue Collar Tips is a product of{" "}
          <span className="font-medium text-foreground">Blue Collar AI, Inc.</span>
        </p>
        <p className="mt-1">
          © {new Date().getFullYear()} Blue Collar AI, Inc. All rights reserved.
        </p>
        <p className="mt-3 flex justify-center gap-4">
          <Link to="/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link to="/terms" className="hover:underline">
            Terms
          </Link>
        </p>
      </footer>
    </div>
  );
}
