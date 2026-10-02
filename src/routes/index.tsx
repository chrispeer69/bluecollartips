import { createFileRoute, Link } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import {
  ArrowRight,
  BellRing,
  BookOpen,
  CalendarDays,
  CircleCheck,
  CreditCard,
  Crown,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  MessageSquareText,
  Palette,
  Printer,
  QrCode,
  ShieldCheck,
  Star,
  ThumbsUp,
  Wallet,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Blue Collar Tips — More 5-Star Reviews. Better-Paid Crews." },
      {
        name: "description",
        content:
          "One QR code at the end of every job. Customers rate, review, and tip your field crew in seconds — five-star customers go to Google, everything else comes to you first.",
      },
      {
        property: "og:title",
        content: "Blue Collar Tips — More 5-Star Reviews. Better-Paid Crews.",
      },
      {
        property: "og:description",
        content:
          "Ratings, reviews, and tips for field service companies — branded as yours, live in a day.",
      },
      { property: "og:url", content: "https://bluecollartips.app/" },
    ],
    links: [{ rel: "canonical", href: "https://bluecollartips.app/" }],
  }),
  component: Index,
});

const INDUSTRIES = [
  "Towing & Roadside",
  "HVAC",
  "Plumbing",
  "Electrical",
  "Landscaping",
  "Cleaning",
  "Moving",
  "Delivery",
  "Install & Repair",
  "Pest Control",
  "Auto Service",
  "Roofing",
];

const NAV = [
  { id: "how", label: "How it works" },
  { id: "features", label: "Features" },
  { id: "pay", label: "Tips & payouts" },
  { id: "guides", label: "Guides" },
];

function scrollTo(id: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

function Index() {
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <SiteHeader />
      <main>
        <Hero />
        <IndustryStrip />
        <Outcomes />
        <HowItWorks />
        <Features />
        <Payouts />
        <WhiteLabel />
        <Guides />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ───────────────────────── Header ───────────────────────── */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[oklch(0.2_0.06_252)]/85 text-white backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
        <Link to="/" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="display text-[17px] font-bold tracking-tight">Blue Collar Tips</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-white/70 md:flex">
          {NAV.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              onClick={scrollTo(n.id)}
              className="transition hover:text-white"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-white/80 transition hover:text-white sm:inline-block"
          >
            Sign in
          </Link>
          <Link
            to="/auth"
            search={{ signup: "company" }}
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-white shadow-[0_6px_20px_-6px_oklch(0.7_0.18_55/0.7)] transition hover:brightness-110"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

function LogoMark() {
  return (
    <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-secondary to-[oklch(0.62_0.2_45)] font-bold text-white shadow-md">
      <span className="display text-sm">B</span>
      <Star className="absolute -right-1 -top-1 h-3.5 w-3.5 fill-white text-white" aria-hidden />
    </span>
  );
}

/* ───────────────────────── Hero ───────────────────────── */

function Hero() {
  return (
    <section className="lp-hero relative isolate overflow-hidden text-white">
      <div className="lp-grid absolute inset-0 -z-10" aria-hidden />
      <div
        className="absolute -right-40 -top-40 -z-10 h-[520px] w-[520px] rounded-full bg-secondary/30 blur-[120px]"
        aria-hidden
      />
      <div
        className="absolute -bottom-48 -left-32 -z-10 h-[420px] w-[420px] rounded-full bg-[oklch(0.55_0.15_250)]/40 blur-[120px]"
        aria-hidden
      />

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-24 pt-16 md:pt-24 lg:grid-cols-[1.1fr_0.9fr] lg:pb-32">
        <div className="lp-rise">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary lp-pulse" />
            Ratings · Reviews · Tips — one QR code
          </span>
          <h1 className="display mt-6 text-[2.6rem] font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-[4.1rem]">
            Every finished job
            <br />
            becomes a{" "}
            <span className="relative whitespace-nowrap text-secondary">
              5-star review.
              <svg
                className="absolute -bottom-2 left-0 h-3 w-full text-secondary/60"
                viewBox="0 0 300 12"
                preserveAspectRatio="none"
                aria-hidden
              >
                <path
                  d="M2 9 C 80 2, 200 2, 298 7"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/75">
            Your crew shows one QR code at the end of the job. Customers rate, review, and tip in
            seconds — no app, no account. Happy customers head straight to your Google page.
            Everyone else talks to <em className="not-italic text-white">you</em> first.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              to="/auth"
              search={{ signup: "company" }}
              className="group inline-flex items-center gap-2 rounded-xl bg-secondary px-6 py-3.5 font-semibold text-white shadow-[0_10px_30px_-8px_oklch(0.7_0.18_55/0.8)] transition hover:brightness-110"
            >
              Launch your company
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how"
              onClick={scrollTo("how")}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3.5 font-semibold text-white transition hover:bg-white/10"
            >
              See how it works
            </a>
          </div>
          <ul className="mt-10 grid max-w-xl gap-x-6 sm:grid-cols-2 gap-y-2.5 text-sm text-white/70">
            {[
              "No app for customers to download",
              "A rating never requires a tip",
              "Card tips secured by Stripe",
              "Your logo, your colors",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CircleCheck className="h-4 w-4 shrink-0 text-secondary" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <PhoneMockup />
      </div>
    </section>
  );
}

function PhoneMockup() {
  return (
    <div
      className="relative mx-auto w-full max-w-[330px] lp-rise [animation-delay:150ms]"
      role="img"
      aria-label="Example customer page: rate your technician, add a tip, and leave a Google review"
    >
      {/* Floating notifications */}
      <div className="lp-float absolute -left-52 top-24 z-20 hidden w-56 rounded-2xl border border-white/10 bg-white p-3 text-foreground shadow-2xl md:block">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-secondary/15">
            <Star className="h-4.5 w-4.5 fill-secondary text-secondary" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold">New 5-star rating</p>
            <p className="truncate text-[11px] text-muted-foreground">
              “Fast, friendly, saved my night.”
            </p>
          </div>
        </div>
      </div>
      <div className="lp-float absolute -right-44 bottom-24 z-20 hidden w-48 rounded-2xl border border-white/10 bg-white p-3 text-foreground shadow-2xl [animation-delay:1.5s] md:block">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500/15">
            <Wallet className="h-4.5 w-4.5 text-emerald-600" />
          </span>
          <div>
            <p className="text-xs font-semibold">+$20.00 tip</p>
            <p className="text-[11px] text-muted-foreground">Paid by card · Stripe</p>
          </div>
        </div>
      </div>

      {/* Phone */}
      <div className="relative rounded-[2.6rem] border border-white/15 bg-[oklch(0.14_0.03_255)] p-2.5 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)]">
        <div className="absolute left-1/2 top-3.5 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black" />
        <div className="overflow-hidden rounded-[2.1rem] bg-[oklch(0.985_0.005_240)] text-foreground">
          <div className="bg-gradient-to-br from-primary to-[oklch(0.42_0.11_250)] px-5 pb-12 pt-10 text-white">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
              Your Company Name
            </p>
            <p className="display mt-1 text-lg font-bold">How did we do?</p>
          </div>
          <div className="-mt-8 px-4 pb-5">
            <div className="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-black/5">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-secondary to-[oklch(0.6_0.19_40)] text-sm font-bold text-white">
                  MT
                </div>
                <div>
                  <p className="text-sm font-semibold">Marcus T.</p>
                  <p className="text-[11px] text-muted-foreground">Roadside technician</p>
                </div>
              </div>
              <div className="mt-4 flex justify-between">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star
                    key={i}
                    className="lp-star h-8 w-8 fill-secondary text-secondary"
                    style={{ animationDelay: `${600 + i * 120}ms` }}
                  />
                ))}
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Add a tip (optional)
              </p>
              <div className="mt-2 grid grid-cols-4 gap-1.5 text-xs font-semibold">
                {["$5", "$10", "$20", "Other"].map((a) => (
                  <span
                    key={a}
                    className={
                      a === "$20"
                        ? "rounded-lg bg-primary py-2 text-center text-white"
                        : "rounded-lg border border-border py-2 text-center"
                    }
                  >
                    {a}
                  </span>
                ))}
              </div>
              <span className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-secondary py-2.5 text-xs font-semibold text-white">
                <Lock className="h-3.5 w-3.5" /> Send rating &amp; tip
              </span>
            </div>
            <span className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-border bg-white py-2.5 text-xs font-semibold">
              <GoogleG /> Share it on Google
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.7-4.9h-4v3.1A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"
      />
    </svg>
  );
}

/* ───────────────────────── Industry strip ───────────────────────── */

function IndustryStrip() {
  const row = [...INDUSTRIES, ...INDUSTRIES];
  return (
    <section className="border-b border-border bg-background py-7" aria-label="Industries">
      <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Built for the crews who keep things running
      </p>
      <div className="lp-marquee-mask overflow-hidden">
        <div className="lp-marquee flex w-max gap-3">
          {row.map((name, i) => (
            <span
              key={`${name}-${i}`}
              aria-hidden={i >= INDUSTRIES.length}
              className="whitespace-nowrap rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground/80"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Outcomes (for owners) ───────────────────────── */

function Outcomes() {
  const items = [
    {
      icon: ThumbsUp,
      title: "More reviews where they count",
      body: "Five-star customers are handed straight to your Google, Yelp, or Facebook page while the moment is fresh — not three days later in an email they'll ignore.",
    },
    {
      icon: BellRing,
      title: "Hear about problems first",
      body: "Every rating and comment lands in your dashboard with the employee and job attached, so you can make it right before it turns into a public one-star.",
    },
    {
      icon: Crown,
      title: "Keep your best people",
      body: "Recognition your techs can see, plus real tips on top of their pay. Good work gets noticed by name — and that's how you hold on to the crew you trained.",
    },
  ];
  return (
    <section className="mx-auto max-w-6xl px-5 py-24">
      <SectionHead
        eyebrow="Why owners use it"
        title={
          <>
            Your best work happens in driveways and on the shoulder.{" "}
            <span className="text-secondary">Nobody sees it.</span>
          </>
        }
        body="Blue Collar Tips captures the customer's reaction at the exact moment they're happiest — and turns it into reviews, feedback, and pay."
      />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {items.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="group relative overflow-hidden rounded-2xl border border-border bg-card p-7 transition hover:-translate-y-1 hover:shadow-xl"
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-secondary to-primary opacity-0 transition group-hover:opacity-100" />
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary text-white">
              <Icon className="h-6 w-6" />
            </span>
            <h3 className="mt-5 text-xl font-bold">{title}</h3>
            <p className="mt-2.5 leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── How it works ───────────────────────── */

function HowItWorks() {
  const steps = [
    {
      icon: QrCode,
      title: "Show the QR",
      body: "Every employee gets a personal QR code and link. Put it on a sticker, the clipboard, the invoice, or text it after the job.",
    },
    {
      icon: Star,
      title: "Customer rates & tips",
      body: "They tap 1–5 stars, add a comment if they like, and tip by card if they want to. About 30 seconds, no sign-up.",
    },
    {
      icon: LayoutDashboard,
      title: "You see everything",
      body: "Ratings, comments, and tips roll up by employee and location. Five-star customers are prompted to post publicly.",
    },
  ];
  return (
    <section id="how" className="scroll-mt-20 bg-muted/60 py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead eyebrow="How it works" title="Three steps. Nothing to install." center />
        <ol className="relative mt-16 grid gap-10 md:grid-cols-3 md:gap-6">
          <div
            className="absolute left-[16.6%] right-[16.6%] top-8 hidden h-0.5 bg-[repeating-linear-gradient(90deg,var(--secondary)_0_10px,transparent_10px_18px)] md:block"
            aria-hidden
          />
          {steps.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="relative text-center">
              <div className="relative mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary text-white shadow-lg ring-8 ring-[oklch(0.955_0.008_240)]">
                <Icon className="h-7 w-7" />
                <span className="absolute -right-2.5 -top-2.5 grid h-7 w-7 place-items-center rounded-full bg-secondary text-xs font-bold text-white">
                  {i + 1}
                </span>
              </div>
              <h3 className="mt-6 text-xl font-bold">{title}</h3>
              <p className="mx-auto mt-2 max-w-xs leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────────────── Features bento ───────────────────────── */

function Features() {
  return (
    <section id="features" className="scroll-mt-20 mx-auto max-w-6xl px-5 py-24">
      <SectionHead
        eyebrow="Everything in the box"
        title="Built for the field — not a generic survey tool."
        body="The details that matter when you have crews in the field, a dispatch board, and payroll every Friday."
      />
      <div className="mt-14 grid gap-5 md:grid-cols-6">
        <Tile
          className="md:col-span-4"
          dark
          icon={LayoutDashboard}
          title="An owner dashboard that tells the truth"
        >
          See every rating, comment, and tip by employee and location. Spot your stars, coach the
          rest, and catch problems while you can still fix them.
          <MiniChart />
        </Tile>
        <Tile className="md:col-span-2" icon={Printer} title="Branded QR codes & posters">
          A personal QR and link for every employee. Download the PNG or print a branded poster for
          the truck.
        </Tile>
        <Tile className="md:col-span-2" icon={Crown} title="VIP customer follow-up">
          Track who was asked for a review, who clicked through to Google, and who actually posted.
        </Tile>
        <Tile className="md:col-span-2" icon={FileSpreadsheet} title="Dispatch import">
          Upload your TowBook export or any CSV and ratings are matched to the driver who ran the
          job.
        </Tile>
        <Tile className="md:col-span-2" icon={CalendarDays} title="Weekly tip payroll report">
          Saturday-to-Friday tip totals per employee, ready to print and hand to payroll.
        </Tile>
        <Tile className="md:col-span-3" icon={MessageSquareText} title="Automatic thank-yous">
          Send a thank-you by email or text after every rating, using your own wording.
        </Tile>
        <Tile className="md:col-span-3" icon={Wallet} title="Cash & app tips, tracked too">
          Employees can log cash, Venmo, Cash App, Zelle, or PayPal tips so your records stay
          complete.
        </Tile>
      </div>
    </section>
  );
}

function Tile({
  icon: Icon,
  title,
  children,
  className = "",
  dark = false,
}: {
  icon: typeof Star;
  title: string;
  children: ReactNode;
  className?: string;
  dark?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-7 transition hover:-translate-y-0.5 hover:shadow-xl ${
        dark
          ? "border-transparent bg-gradient-to-br from-primary to-[oklch(0.24_0.07_252)] text-white"
          : "border-border bg-card"
      } ${className}`}
    >
      <span
        className={`grid h-11 w-11 place-items-center rounded-xl ${
          dark ? "bg-white/10 text-secondary" : "bg-secondary/12 text-secondary"
        }`}
      >
        <Icon className="h-5.5 w-5.5" />
      </span>
      <h3 className="mt-5 text-lg font-bold">{title}</h3>
      <div className={`mt-2 leading-relaxed ${dark ? "text-white/70" : "text-muted-foreground"}`}>
        {children}
      </div>
    </div>
  );
}

function MiniChart() {
  const rows = [
    { name: "Marcus T.", stars: 4.9, w: "96%" },
    { name: "Dana R.", stars: 4.8, w: "92%" },
    { name: "Luis G.", stars: 4.6, w: "84%" },
    { name: "Kevin P.", stars: 4.1, w: "68%" },
  ];
  return (
    <div className="mt-6 space-y-2.5 rounded-xl bg-white/5 p-4 ring-1 ring-white/10" aria-hidden>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
        Example · average rating
      </p>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-3 text-sm">
          <span className="w-20 shrink-0 text-white/80">{r.name}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
            <span
              className="lp-bar block h-full rounded-full bg-secondary"
              style={{ width: r.w }}
            />
          </span>
          <span className="w-8 text-right font-semibold text-white">{r.stars}</span>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Payouts ───────────────────────── */

function Payouts() {
  return (
    <section id="pay" className="scroll-mt-20 bg-muted/60 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-2">
        <div>
          <SectionHead
            eyebrow="Tips & payouts"
            title="The tip goes to the person who earned it."
            body="Card tips run through Stripe and split automatically. Your company doesn't handle the money, and customers never have to tip to leave a rating."
          />
          <ul className="mt-8 space-y-3.5">
            {[
              "Employee keeps 90% of every card tip",
              "Customers pay securely by card through Stripe",
              "Tips are always optional — ratings stand on their own",
              "Payout history and printable statements for every employee",
            ].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-secondary" aria-hidden />
                <span className="font-medium">{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl border border-border bg-card p-8 shadow-xl">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">Example card tip</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" /> Stripe secured
            </span>
          </div>
          <p className="display mt-3 text-6xl font-bold tracking-tight">$20.00</p>
          <div className="mt-8 flex h-4 overflow-hidden rounded-full">
            <span className="bg-secondary" style={{ width: "90%" }} />
            <span className="bg-primary" style={{ width: "10%" }} />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-secondary/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                To your employee
              </p>
              <p className="display mt-1 text-3xl font-bold">$18.00</p>
              <p className="text-sm text-muted-foreground">90%</p>
            </div>
            <div className="rounded-2xl bg-primary/8 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                Platform fee
              </p>
              <p className="display mt-1 text-3xl font-bold">$2.00</p>
              <p className="text-sm text-muted-foreground">10%</p>
            </div>
          </div>
          <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="h-4 w-4" aria-hidden /> Cash and app tips are logged for records
            only.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── White label ───────────────────────── */

function WhiteLabel() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24">
      <div className="lp-hero relative isolate overflow-hidden rounded-3xl px-8 py-14 text-white md:px-14">
        <div className="lp-grid absolute inset-0 -z-10 opacity-60" aria-hidden />
        <div
          className="absolute -right-20 -top-20 -z-10 h-72 w-72 rounded-full bg-secondary/30 blur-[90px]"
          aria-hidden
        />
        <div className="grid items-center gap-10 md:grid-cols-[1.3fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80">
              <Palette className="h-3.5 w-3.5 text-secondary" /> White-label ready
            </span>
            <h2 className="display mt-5 text-3xl font-bold leading-tight sm:text-4xl">
              Your customers see your brand. Not ours.
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-white/70">
              Launch it with your company name, logo, colors, and support contact. Customers see
              your brand from the QR scan to the thank-you — the platform handles ratings, tips, and
              payouts in the background.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3" aria-hidden>
            {[
              "bg-secondary",
              "bg-[oklch(0.55_0.17_150)]",
              "bg-[oklch(0.55_0.2_25)]",
              "bg-[oklch(0.6_0.15_230)]",
              "bg-white",
              "bg-[oklch(0.5_0.18_300)]",
            ].map((c, i) => (
              <div key={c} className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <div className={`h-12 rounded-xl ${c}`} />
                <div className="mt-2 h-1.5 w-3/4 rounded-full bg-white/20" />
                <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-white/10" />
                <span className="sr-only">Brand theme {i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Guides ───────────────────────── */

function Guides() {
  return (
    <section id="guides" className="scroll-mt-20 mx-auto max-w-6xl px-5 pb-24">
      <SectionHead eyebrow="Free owner guides" title="Do tips the right way." />
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <GuideCard
          to="/guides/tip-pooling"
          title="Tip pooling guide"
          body="How tip pools work for field crews, who can share in them, and the rules to watch."
        />
        <GuideCard
          to="/guides/fica-tip-credit"
          title="FICA tip credit guide"
          body="What the FICA tip credit is, who qualifies, and how reported tips can lower your tax bill."
        />
      </div>
    </section>
  );
}

function GuideCard({
  to,
  title,
  body,
}: {
  to: "/guides/tip-pooling" | "/guides/fica-tip-credit";
  title: string;
  body: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-5 rounded-2xl border border-border bg-card p-6 transition hover:-translate-y-0.5 hover:border-secondary/50 hover:shadow-lg"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-secondary/12 text-secondary">
        <BookOpen className="h-6 w-6" />
      </span>
      <div className="flex-1">
        <h3 className="flex items-center gap-2 text-lg font-bold">
          {title}
          <ArrowRight className="h-4 w-4 text-secondary transition group-hover:translate-x-1" />
        </h3>
        <p className="mt-1.5 text-muted-foreground">{body}</p>
      </div>
    </Link>
  );
}

/* ───────────────────────── Final CTA ───────────────────────── */

function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden bg-gradient-to-br from-secondary to-[oklch(0.6_0.2_42)] text-white">
      <div className="lp-grid absolute inset-0 -z-10 opacity-30" aria-hidden />
      <div className="mx-auto max-w-4xl px-5 py-20 text-center">
        <div className="flex justify-center gap-1" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="h-7 w-7 fill-white text-white" />
          ))}
        </div>
        <h2 className="display mt-6 text-4xl font-bold leading-tight sm:text-5xl">
          Put a QR code on every truck this week.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-white/85">
          Set up your company, add your crew, and start collecting ratings, reviews, and tips on the
          very next job.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link
            to="/auth"
            search={{ signup: "company" }}
            className="group inline-flex items-center gap-2 rounded-xl bg-[oklch(0.2_0.06_252)] px-7 py-4 font-semibold text-white shadow-xl transition hover:brightness-125"
          >
            Launch your company
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/auth"
            search={{ signup: "employee" }}
            className="inline-flex items-center rounded-xl border border-white/40 px-7 py-4 font-semibold text-white transition hover:bg-white/10"
          >
            I'm an employee
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Footer ───────────────────────── */

function SiteFooter() {
  return (
    <footer className="bg-[oklch(0.17_0.05_252)] py-12 text-sm text-white/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-5 md:flex-row">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <div>
            <p className="display font-bold text-white">Blue Collar Tips</p>
            <p className="text-xs">
              A product of <span className="text-white/80">Blue Collar AI, Inc.</span>
            </p>
          </div>
        </div>
        <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <Link to="/guides/tip-pooling" className="hover:text-white">
            Tip pooling
          </Link>
          <Link to="/guides/fica-tip-credit" className="hover:text-white">
            FICA tip credit
          </Link>
          <Link to="/privacy" className="hover:text-white">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-white">
            Terms
          </Link>
          <Link to="/auth" className="hover:text-white">
            Sign in
          </Link>
        </nav>
        <p className="text-xs">
          © {new Date().getFullYear()} Blue Collar AI, Inc. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

/* ───────────────────────── Shared ───────────────────────── */

function SectionHead({
  eyebrow,
  title,
  body,
  center = false,
}: {
  eyebrow: string;
  title: ReactNode;
  body?: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary">{eyebrow}</p>
      <h2 className="display mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-[2.6rem]">
        {title}
      </h2>
      {body && <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{body}</p>}
    </div>
  );
}
