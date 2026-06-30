import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Blue Collar AI — Tips & Reputation for Service Pros" },
      {
        name: "description",
        content:
          "A tip and review platform built for towing companies and blue-collar service teams. Capture ratings, collect tips, and grow your reputation.",
      },
      { property: "og:title", content: "Blue Collar AI — Tips & Reputation for Service Pros" },
      {
        property: "og:description",
        content: "Tips and reviews for towing companies and field service teams.",
      },
      { property: "og:url", content: "/" },
    ],
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
            <span className="font-semibold">Blue Collar AI</span>
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
          For towing & field service
        </span>
        <h1 className="display mt-6 text-5xl font-bold leading-tight md:text-6xl">
          Get paid in tips.
          <br />
          <span className="text-secondary">Get found on Google.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          A simple QR code at the end of every job. Customers rate your service, leave feedback,
          and tip — all in one tap. Drivers get paid, companies build reputation.
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
            className="rounded-md border border-border bg-card px-6 py-3 font-medium hover:bg-muted"
          >
            How it works
          </a>
        </div>

        <div id="how" className="mt-24 grid gap-6 md:grid-cols-3">
          {[
            {
              t: "1. Show the QR",
              d: "Driver shows a personal QR code at the end of every job — sticker, clipboard, or business card.",
            },
            {
              t: "2. Rate & tip",
              d: "Customer rates 1–5 stars, leaves optional feedback, and can tip via card or P2P.",
            },
            {
              t: "3. Split & track",
              d: "Every tip splits 80/10/10 automatically. Drivers and admins see live earnings.",
            },
          ].map((s) => (
            <div key={s.t} className="rounded-lg border border-border bg-card p-6">
              <h2 className="font-semibold">{s.t}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </main>
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Blue Collar AI
      </footer>
    </div>
  );
}
