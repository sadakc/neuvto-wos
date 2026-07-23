
# NEUVTO WOS — Investor Landing Page

## Goal
Ship a modern, mobile-first SaaS landing page positioning NEUVTO as a **Workforce Operating System** (not an HRMS), showcasing the Leave Management MVP, the future module roadmap, and capturing demo requests — ready to deploy to `neuvto.com`.

## Design Direction
- **Theme:** Clean, professional, modern SaaS (think Linear / Vercel polish)
- **Palette:** Sky Blue (`#0EA5E9`) primary, Black (`#0A0A0A`) foreground, Red (`#EF4444`) accent/CTA
- **Typography:** Space Grotesk (headings) + Inter (body) — modern tech feel
- **Approach:** Mobile-first responsive, with explicit callouts that employees use mobile and admins use web
- Tokens defined in `src/styles.css` via `@theme` (oklch) — no hardcoded colors in components

## Page Sections
1. **Sticky nav** — Logo · Product · Modules · Roadmap · Request Demo (red CTA)
2. **Hero** — "The Workforce Operating System" · subheading contrasting WOS vs HRMS · dual CTA (Request Demo / See Leave Module) · mobile phone + admin dashboard mockup side-by-side
3. **Problem** — Disconnected HR tools pain points (3 cards)
4. **What is NEUVTO WOS** — One platform, many modules; configurable; shared data
5. **Leave Management MVP** — Feature grid: apply on mobile, approvals, balances, policies, calendar, reports; annotated mockups showing employee mobile view + admin web view
6. **Mobile-first + Admin-web split** — Split section: "Employees on Mobile · Admins on Web"
7. **Roadmap** — Timeline/grid of future modules (Attendance, Payroll, Shifts, Visitor, Incident, Asset, Documents, Compliance, AI)
8. **Why NEUVTO** — Differentiators vs traditional HRMS
9. **Target verticals** — SMB, Physical Security, Ops, HR/Finance
10. **Request Demo form** — Name, work email, company, employees, message → stored in Supabase
11. **Footer** — Contact, socials, legal placeholders

## Route & SEO
- Single route: `src/routes/index.tsx` (replace placeholder)
- Unique `head()`: title "NEUVTO WOS — The Workforce Operating System", meta description, og/twitter tags
- Semantic HTML (single H1, proper section landmarks)

## Backend / Data Capture
You said you'll connect your existing Supabase — until it's wired to this Lovable project, the demo form has no destination.

**Recommended path (fastest for the investor pitch):** Enable Lovable Cloud now. I'll create a `demo_requests` table with RLS + anon INSERT policy, and the form will work immediately. When you connect your own Supabase later, we migrate the table (single SQL file) and swap the client — no UI rework.

Table shape:
```
demo_requests(id uuid pk, name text, email text, company text,
              employees text, message text, created_at timestamptz)
```
- RLS enabled
- Grants: `INSERT` to `anon` (form submissions), `SELECT/ALL` to `service_role` only
- Client-side Zod validation (email, length limits, trim)

If you'd rather I wait for your own Supabase, say so and I'll ship the page with the form disabled/"Coming soon".

## GoDaddy DNS + GitHub — Instructions (delivered after build)
I'll provide a step-by-step reply covering:

**GoDaddy DNS → Lovable custom domain**
1. In Lovable: Project Settings → Domains → Connect Domain → `neuvto.com`
2. In GoDaddy: My Products → `neuvto.com` → DNS → Manage Zones
3. Add records:
   - `A` · Host `@` · Value `185.158.133.1`
   - `A` · Host `www` · Value `185.158.133.1`
   - `TXT` · Host `_lovable` · Value (from Lovable dialog)
4. Remove any conflicting A/CNAME on `@` or `www`
5. Wait for propagation (usually minutes, up to 72h) — SSL is auto-provisioned

**GitHub → `sadakc/Neuvto`**
Lovable can't import an existing repo, so:
1. In Lovable chat: `+` menu → GitHub → Connect project → authorize Lovable GitHub App
2. Choose to create a new repo (e.g. `Neuvto-web`) under your `sadakc` account
3. After sync, if you want everything under the existing `Neuvto` repo, clone both locally and copy files across, then push
4. From then on it's 2-way sync — pushes to GitHub reflect in Lovable and vice versa

## Out of Scope (for this first cut)
- Auth, dashboards, actual Leave module app screens (only static mockups on landing)
- Multi-page site (About, Pricing, Blog) — single-page pitch first
- i18n, analytics wiring, cookie consent

## Technical Details
- Stack: TanStack Start + React 19 + Tailwind v4 + shadcn (already in template)
- New files: `src/routes/index.tsx` (rewrite), section components under `src/components/landing/*`, `src/lib/demo-request.functions.ts` (server fn using publishable Supabase client with anon insert)
- Migration: single `create table` + grants + RLS + policy
- Form: react-hook-form + zod + shadcn Form/Input/Button/Textarea + sonner toast
- Icons: lucide-react
- Images: generated hero mockups via `imagegen` (mobile app screen + admin web dashboard), saved to `src/assets/`

## Open Question Before Building
**Do you want me to enable Lovable Cloud now so the demo form actually captures leads for the investor demo?** (Recommended — you can migrate to your own Supabase later.) If yes, I'll proceed as planned. If no, I'll ship the form as a non-functional visual only.
