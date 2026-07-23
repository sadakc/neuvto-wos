import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { submitDemoRequest } from "@/lib/demo.functions";
import mobileMockup from "@/assets/mobile-mockup.png";
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
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Nav />
      <Hero />
      <ProblemSolution />
      <LeavePreview />
      <Roadmap />
      <DemoForm />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#top" className="font-display text-xl font-bold tracking-tight">
          neuvto<span className="text-primary">.</span>
        </a>
        <nav className="hidden gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#vision" className="hover:text-foreground">Vision</a>
          <a href="#leave" className="hover:text-foreground">Leave Management</a>
          <a href="#roadmap" className="hover:text-foreground">Roadmap</a>
          <a href="#demo" className="hover:text-foreground">Request Demo</a>
        </nav>
        <a
          href="#demo"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Request Demo
        </a>
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
          <h1 className="mt-6 font-display text-5xl font-bold tracking-tight text-ink lg:text-6xl">
            The Workforce <span className="text-primary">Operating System</span> your teams actually open.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Neuvto WOS is a mobile-first platform that replaces the HRMS your employees ignore.
            We're launching with Leave Management — and expanding into the full spine of how
            modern companies run their workforce.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#demo"
              className="inline-flex items-center rounded-md bg-destructive px-5 py-3 text-sm font-semibold text-destructive-foreground shadow-sm hover:bg-destructive/90"
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
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">The problem</p>
          <h2 className="mt-2 font-display text-4xl font-bold tracking-tight">
            HRMS was built for HR. Not for the workforce.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Legacy platforms are desktop-heavy, form-driven, and used by ~10% of the company.
            The other 90% — the people actually doing the work — get emails, spreadsheets, and
            paper approvals.
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
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">MVP · Module 1</p>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-tight">Leave Management</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              A complete leave workflow that respects everyone's time. Employees request in seconds,
              managers approve in one tap, and HR gets clean, exportable data.
            </p>
            <ul className="mt-8 space-y-4">
              <Feature title="One-tap requests" body="Pick a leave type, dates, reason — done." />
              <Feature title="Smart approvals" body="Multi-level approval routing with delegation and escalation." />
              <Feature title="Live balances" body="Accruals, carry-over, and holidays computed in real time." />
              <Feature title="Team calendar" body="Everyone can see who's out — without spreadsheets." />
              <Feature title="Policy engine" body="Configure leave types, eligibility, and rules per country or team." />
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

function DemoForm() {
  const submit = useServerFn(submitDemoRequest);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", company: "", employees: "", message: "" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await submit({ data: form });
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
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Get in touch</p>
          <h2 className="mt-2 font-display text-4xl font-bold tracking-tight">
            Be first in line for the Neuvto WOS preview.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Investors, design partners, and early customers — tell us a bit about you and we'll
            set up a walkthrough.
          </p>
        </div>
        <form onSubmit={onSubmit} className="rounded-xl border border-border bg-background p-6 shadow-sm">
          <div className="grid gap-4">
            <Field label="Your name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <Field label="Work email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company" value={form.company} onChange={(v) => setForm({ ...form, company: v })} />
              <Field label="# Employees" value={form.employees} onChange={(v) => setForm({ ...form, employees: v })} placeholder="e.g. 50-200" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">What are you interested in?</label>
              <textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex items-center justify-center rounded-md bg-destructive px-5 py-3 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            >
              {loading ? "Sending…" : "Request demo"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

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
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      <input
        type={type}
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
        <p className="font-display">
          neuvto<span className="text-primary">.</span>com
        </p>
      </div>
    </footer>
  );
}
