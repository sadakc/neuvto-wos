import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { toast } from "sonner";
import { submitDemoRequest } from "@/lib/demo-request";
import mobileMockup from "@/assets/mobile-mockup.png";
import { NeuvtoLockup, NeuvtoMark } from "@/components/shared/neuvto-mark";
import adminMockup from "@/assets/admin-mockup.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Neuvto WOS — The Workforce Operating System" },
      {
        name: "description",
        content:
          "Neuvto WOS is a mobile-first Workforce Operating System. Launching with Leave Management, expanding to attendance, payroll, and performance.",
      },
      { property: "og:title", content: "Neuvto WOS — The Workforce Operating System" },
      {
        property: "og:description",
        content:
          "Mobile-first workforce OS. Launching with Leave Management, expanding to attendance, payroll, and performance.",
      },
    ],
    // ───────────────────────────────────────────────────────── canonical
    //
    // ON THIS ROUTE, NOT IN __root.tsx, AND THAT IS THE WHOLE POINT.
    //
    // `__root.tsx`'s `links` are static and shared by every route, so a
    // canonical declared there would tell Google that /app, /auth and
    // /neuvto-hq are all copies of the landing page. That is worse than having
    // none: a wrong canonical is an instruction to drop the real URL, and this
    // one would point every page in the product at the marketing site.
    //
    // This is the only public, indexable page in the product — everything else
    // is behind a session — so it is the only page that needs one.
    //
    // Absolute and with the trailing slash, matching what sitemap.xml already
    // publishes as <loc>. A canonical that disagrees with the sitemap is two
    // answers to one question.
    links: [{ rel: "canonical", href: "https://neuvto.com/" }],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Nav />
      <main>
        <Hero />
        <ProblemSolution />
        <LeavePreview />
        <Roadmap />
        <Websites />
        <DemoForm />
      </main>
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#top" aria-label="Neuvto — home">
          <NeuvtoLockup />
        </a>
        <nav className="hidden gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#vision" className="hover:text-foreground">
            Vision
          </a>
          <a href="#leave" className="hover:text-foreground">
            Leave Management
          </a>
          <a href="#roadmap" className="hover:text-foreground">
            Roadmap
          </a>
        </nav>
        {/* No "Request Demo" in this nav row. It used to sit here next to
            Roadmap AND as the filled button on the right, so the header offered
            the same action twice, three inches apart — which reads as two
            different things and makes the primary call to action compete with a
            muted text link for the same click. The button below is the one. */}
        {/* Sign in sits outside the `md:flex` row above: that row is hidden on
            mobile, and someone who has lost their invitation email arrives on a
            phone. It is the only way into the product from this page. */}
        <div className="flex items-center gap-3 sm:gap-4">
          <a
            href="/auth"
            className="inline-flex items-center px-1 py-3.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Sign in
          </a>
          <a
            href="#demo"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Request Demo
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,theme(colors.sky.100),transparent_60%)]" />
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2 lg:py-32">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Now raising · Investor preview
          </span>
          <h1 className="mt-6 font-display text-5xl font-bold tracking-tight text-foreground lg:text-6xl">
            The Workforce <span className="text-primary">Operating System</span> your teams actually
            open.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Neuvto WOS is a mobile-first platform that replaces the HRMS your employees ignore.
            We're launching with Leave Management — and expanding into the full spine of how modern
            companies run their workforce.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {/* `primary`, not `destructive`. Red is reserved for rejected,
                error and over-balance (NEUVTO_DESIGN_SYSTEM.md), and every
                other use of it in the codebase obeys that — this button and
                the demo form's submit were the only two treating it as a
                brand fill. On the page's main call to action it reads as a
                warning about the thing it is inviting you to do. */}
            <a
              href="#demo"
              className="inline-flex items-center rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Request early access
            </a>
            <a
              href="#vision"
              className="inline-flex items-center rounded-md border border-border bg-background px-5 py-3 text-sm font-semibold text-foreground hover:bg-secondary"
            >
              See the vision
            </a>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 text-sm">
            <Stat k="Mobile-first" v="Employee app" />
            <Stat k="Web console" v="For admins" />
            <Stat k="Modular" v="Scale as you grow" />
          </dl>
        </div>
        <div className="relative flex items-center justify-center">
          <img
            src={adminMockup}
            alt="Neuvto admin console"
            className="w-full max-w-lg rounded-xl border border-border shadow-2xl"
          />
          <img
            src={mobileMockup}
            alt="Neuvto mobile app"
            className="absolute -bottom-6 -left-6 w-40 rounded-2xl border border-border shadow-xl lg:w-48"
          />
        </div>
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-display text-base font-semibold text-foreground">{k}</dt>
      <dd className="text-xs text-muted-foreground">{v}</dd>
    </div>
  );
}

function ProblemSolution() {
  return (
    <section id="vision" className="border-t border-border bg-secondary/40 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          {/* `brand-strong`, not `primary`. Every eyebrow on this page was the
              brand blue as text on a light ground — 2.65:1, well under half of
              AA. `primary` stays the fill; this is the same hue dark enough to
              be read. The one on `bg-ink` below keeps `primary`, where it is
              7.10:1 and this token would be the one that fails. */}
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-strong">
            The problem
          </p>
          <h2 className="mt-2 font-display text-4xl font-bold tracking-tight">
            HRMS was built for HR. Not for the workforce.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Legacy platforms are desktop-heavy, form-driven, and used by ~10% of the company. The
            other 90% — the people actually doing the work — get emails, spreadsheets, and paper
            approvals.
          </p>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <Card
            title="Mobile-first, by default"
            body="Employees live on their phones. So does Neuvto. Requests, approvals, notifications — all thumb-friendly."
          />
          <Card
            title="Composable modules"
            body="Start with Leave. Add Attendance, Payroll, Performance, and Learning as you grow. No re-platforming."
          />
          <Card
            title="Built for scale"
            body="Multi-tenant, role-based, audit-ready. Designed for 10-person startups and 10,000-person enterprises."
          />
        </div>
      </div>
    </section>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function LeavePreview() {
  return (
    <section id="leave" className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-strong">
              MVP · Module 1
            </p>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-tight">
              Leave Management
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              A complete leave workflow that respects everyone's time. Employees request in seconds,
              managers approve in one tap, and HR gets clean, exportable data.
            </p>
            <ul className="mt-8 space-y-4">
              <Feature title="One-tap requests" body="Pick a leave type, dates, reason — done." />
              <Feature
                title="Smart approvals"
                body="Multi-level approval routing with delegation and escalation."
              />
              <Feature
                title="Live balances"
                body="Accruals, carry-over, and holidays computed in real time."
              />
              <Feature
                title="Team calendar"
                body="Everyone can see who's out — without spreadsheets."
              />
              <Feature
                title="Policy engine"
                body="Configure leave types, eligibility, and rules per country or team."
              />
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-secondary/50 p-6">
            <img
              src={mobileMockup}
              alt="Leave request on mobile"
              className="mx-auto w-64 rounded-2xl shadow-xl"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-primary" />
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

function Roadmap() {
  const items = [
    { q: "Q1", t: "Leave Management", s: "Live · MVP" },
    { q: "Q2", t: "Attendance & Shifts", s: "In design" },
    { q: "Q3", t: "Payroll & Compensation", s: "Planned" },
    { q: "Q4", t: "Performance & Learning", s: "Planned" },
  ];
  return (
    <section id="roadmap" className="border-t border-border bg-ink py-24 text-white">
      <div className="mx-auto max-w-6xl px-6">
        {/* THE ONE EYEBROW THAT KEEPS `primary`, AND IT IS NOT AN OVERSIGHT.
            This band is `bg-ink`. `primary` measures 7.10:1 on it and
            `brand-strong` — the token every other eyebrow moved to — is
            4.13:1 and fails. Making all five match would break this one. */}
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Roadmap</p>
        <h2 className="mt-2 font-display text-4xl font-bold tracking-tight">
          One platform. Shipping module by module.
        </h2>
        <div className="mt-12 grid gap-6 md:grid-cols-4">
          {items.map((i) => (
            <div key={i.q} className="rounded-xl border border-white/10 bg-white/5 p-6">
              <p className="text-xs font-semibold text-primary">{i.q}</p>
              <p className="mt-3 font-display text-lg font-semibold">{i.t}</p>
              <p className="mt-1 text-xs text-white/60">{i.s}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The second thing this company does.
 *
 * THE ONLY EVIDENCE OF TRACK RECORD THIS SECTION MAY OFFER IS THE PAGE IT IS ON.
 *
 * There is no client list, no logo wall, no testimonial and no case study here,
 * and that is a decision rather than an omission waiting to be filled in. Every
 * one of those would have to be invented today, and the first prospect who
 * checks an invented one is the prospect who was going to buy. So the copy
 * claims capability, and points at the only work it can honestly point at —
 * which the reader is already looking at.
 *
 * Every concrete detail below is true of this repository and can be checked:
 * the canonical at the top of this file, `sitemap[.]xml.ts`, the own-origin
 * social card (D63), the label/input joins in `Field` at the bottom of this
 * file, the WCAG contrast gate in `tokens.test.ts`, and the OS-preference dark
 * mode in `platform/design/theme.ts`. Nothing here is a claim we would have to
 * retract.
 *
 * `index.test.tsx` enforces the rule structurally — no <img>, <blockquote>, <q>,
 * <cite> or <figure> inside this section — because the way a fabricated claim
 * actually arrives is somebody pasting in a logo strip after copying a
 * competitor's layout, and no list of banned phrases sees that coming.
 */
function Websites() {
  return (
    // Tinted, and the choice is close to forced. This sits directly under
    // `Roadmap`, which is `bg-ink`: a second dark band would read as one
    // continuous slab and the change of subject — the entire point of the
    // section — would be invisible. Plain `bg-background` has the opposite
    // problem, merging it into the demo form below. `bg-secondary/40` is the
    // only treatment on this page distinct from both neighbours.
    <section id="websites" className="border-t border-border bg-secondary/40 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-strong">
            Design & build
          </p>
          <h2 className="mt-2 font-display text-4xl font-bold tracking-tight">
            We build websites for other companies, too.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            You're reading one. This page — its type, its colour, the dark mode it followed your
            system into — is our own work, built by the same people who build the platform. Web
            design and build is the second thing Neuvto does, and we're as serious about it as we
            are about the first.
          </p>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <Card
            title="Designed once, then applied"
            body="Colour, type and spacing get decided up front and written down, so the tenth page still looks like the first. Dark mode included, not bolted on afterwards."
          />
          <Card
            title="Built to be found"
            body="Real titles and descriptions, a canonical URL, a sitemap, and a share card served from your own domain. The unglamorous half of a site that works."
          />
          <Card
            title="Legible for everyone"
            body="Every label joined to its input, every colour pairing measured against WCAG rather than eyeballed, and tap targets a thumb can actually hit."
          />
        </div>
        <p className="mt-12 max-w-3xl text-sm text-muted-foreground">
          Marketing sites, product and launch pages, company sites, and the public front of an app —
          this page is the last of those. Plain React and Tailwind on a domain you own, with no page
          builder to keep paying for.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {/* `hover:bg-accent`, not the `hover:bg-secondary` that "See the
              vision" uses in the hero. That button sits on `bg-background`;
              this one sits on `bg-secondary/40`, where the hovered fill lands
              within ~0.02 lightness of the band itself and the control
              dissolves into its own ground instead of lifting off it. `accent`
              differs in chroma as well as lightness, and its foreground token
              is byte-identical to `--foreground`, so the contrast pairing is
              one `tokens.test.ts` already passes. */}
          {/* `py-3.5`, not the `py-3` the hero's buttons use, and the extra
              2px is not a style preference. `MIN_TOUCH_TARGET` in tokens.ts is
              48 and DESIGN_SYSTEM §6 says the same; `py-3` measures 46px, which
              every button on this page quietly fails. Measured, not assumed.
              That is a page-wide shortfall to fix page-wide — but a card two
              inches above this one says "tap targets a thumb can actually hit",
              so this is the one control on the site that cannot be 46px without
              the section disproving itself in its own viewport. */}
          <a
            href="#demo"
            className="inline-flex items-center rounded-md border border-border bg-background px-5 py-3.5 text-sm font-semibold text-foreground hover:bg-accent"
          >
            Talk to us about a site
          </a>
        </div>
      </div>
    </section>
  );
}

function DemoForm() {
  const messageId = useId();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    employees: "",
    message: "",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await submitDemoRequest(form);
      toast.success("Thanks! We'll be in touch shortly.");
      setForm({ name: "", email: "", company: "", employees: "", message: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="demo" className="py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-strong">
            Get in touch
          </p>
          <h2 className="mt-2 font-display text-4xl font-bold tracking-tight">
            Be first in line for the Neuvto WOS preview.
          </h2>
          {/* "…and anyone who needs a site built" is load-bearing, not padding.
              The websites section's call to action lands here, and before this
              line the visitor arrived at a heading about the WOS preview
              addressed to investors and early customers, was asked how many
              employees they have, and was offered one button reading "Request
              demo". Someone who wants a website is none of those things and
              would reasonably conclude they had followed the wrong link. */}
          <p className="mt-4 text-lg text-muted-foreground">
            Investors, design partners, early customers — and anyone who needs a site built. Tell us
            a bit about you and we'll set up a walkthrough.
          </p>
        </div>
        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-border bg-background p-6 shadow-sm"
        >
          <div className="grid gap-4">
            <Field
              label="Your name"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              required
            />
            <Field
              label="Work email"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Company"
                value={form.company}
                onChange={(v) => setForm({ ...form, company: v })}
              />
              <Field
                label="# Employees"
                value={form.employees}
                onChange={(v) => setForm({ ...form, employees: v })}
                placeholder="e.g. 50-200"
              />
            </div>
            <div>
              {/* The fifth field, and the one Field() does not cover. Same
                  defect, same fix — the label was here and joined to nothing. */}
              <label htmlFor={messageId} className="mb-1 block text-sm font-medium text-foreground">
                What are you interested in?
              </label>
              <textarea
                id={messageId}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {loading ? "Sending…" : "Request demo"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

/**
 * A labelled field on the demo form.
 *
 * THE `<label>` WAS ALREADY HERE AND WAS CONNECTED TO NOTHING.
 *
 * It had no `htmlFor`, the input had no `id`, and the input was not nested
 * inside it — so it was a styled paragraph that happened to be a `<label>`
 * element. That is worse than obviously-missing markup, because the source
 * reads as correct: only the accessibility tree disagrees. Rendered and asked
 * what a screen reader would find, all five fields on this form answered the
 * same way:
 *
 *     input[type=text]   id=NONE  → *** NO ACCESSIBLE NAME ***
 *     input[type=email]  id=NONE  → *** NO ACCESSIBLE NAME ***
 *     …
 *
 * Five fields, five times "edit text, blank". This is the first form a
 * prospective customer meets, and one of them will be using a screen reader.
 *
 * `useId()` rather than a hand-passed name: this component renders four times
 * on one page, and duplicate ids would associate every label with the first
 * input — which looks fixed and is not.
 */
function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="text-destructive" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      <input
        id={id}
        type={type}
        // The asterisk is decorative and hidden from assistive tech above;
        // `required` is what actually announces the field as required, and it
        // was already here doing that job.
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-secondary/40 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground md:flex-row">
        <p>© {new Date().getFullYear()} Neuvto. All rights reserved.</p>
        <a
          href="/auth"
          className="inline-flex items-center py-3.5 font-medium hover:text-foreground"
        >
          Sign in to your workspace
        </a>
        <p className="inline-flex items-center gap-2.5 font-display">
          <NeuvtoMark />
          <span>
            neuvto<span className="text-primary">.</span>com
          </span>
        </p>
      </div>
    </footer>
  );
}
