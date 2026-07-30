# NEUVTO WOS — Analytics

**Version:** 1.0 · **Status:** Active · Covers **D25**

Activation cannot be measured retroactively. If an event is not emitted while the code is
written, the data does not exist and no amount of later work recovers it. That is why this
document exists before the build rather than after it.

---

## 1 · Where events live (D25)

In the database, not a third-party SaaS.

```sql
create table public.analytics_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  user_id         uuid references auth.users(id)    on delete set null,
  event           text not null,
  properties      jsonb not null default '{}',
  occurred_at     timestamptz not null default now()
);
create index on analytics_events (organization_id, event, occurred_at desc);
create index on analytics_events (event, occurred_at desc);
```

Org-scoped under RLS like every other table. Retained 90 days (Data Standards §2).

**Why not PostHog or Amplitude.** Sending employee behavioural data to another company makes
that company a processor: another DPA to sign, another entry in the processor inventory,
another disclosure under DPDP, and customer HR data leaving infrastructure you control. In
exchange you get dashboards you can replicate with SQL over a table this simple. At your
scale that trade is clearly wrong. Revisit if the volume ever justifies it.

---

## 2 · The rule that keeps this honest

**Never emit what you can derive.**

| Question                    | Derive from                                   | Do NOT emit           |
| --------------------------- | --------------------------------------------- | --------------------- |
| Approval cycle time         | `approval_requests.created_at → completed_at` | `approval.cycle_time` |
| Weekly active organisations | any row with `created_at` in the window       | `org.weekly_active`   |
| Leave days taken this month | `leave_requests`                              | `leave.days_taken`    |
| Employees per organisation  | `profiles`                                    | `org.employee_count`  |

An emitted metric that duplicates queryable state is a second version of the truth, and the
two drift. Emit events for things that happen and leave no trace; derive everything else.

---

## 3 · Naming

`noun.verb`, past tense, `snake_case` nouns: `leave_request.submitted`,
`organization.created`, `employees.imported`.

**Event names are as permanent as error codes.** Renaming one breaks every historical
comparison, because old rows keep the old name. Choose carefully; do not rename.

`properties` carries context, never personal data. `{"leave_type": "Casual", "days": 4}` —
never an employee name or email. The `user_id` column is the identifier, and it is erasable.

---

## 4 · Events

### Activation — did a new customer reach value?

| Event                       | Emitted when             | Properties                               |
| --------------------------- | ------------------------ | ---------------------------------------- |
| `organization.created`      | Signup completes         | `plan`, `industry`                       |
| `employees.imported`        | CSV import finishes      | `count`, `failed_count`                  |
| `leave_type.configured`     | First leave type saved   | `name`                                   |
| `approval_chain.configured` | Approval chain saved     | `levels`                                 |
| `leave_request.submitted`   | Any submission           | `days`, `leave_type`, `levels_required`  |
| `leave_request.approved`    | Final approval completes | `days`, `levels_used`, `hours_to_decide` |

**Activation is defined concretely:** an organisation is activated when it has imported
employees, configured at least one leave type, and completed one leave request end to end.

That definition is the point. "Activated users" without a definition is a number nobody can
challenge or act on — and an investor who asks what it means and gets a vague answer draws
the obvious conclusion. This one is checkable in SQL and honest.

### Adoption — what actually gets used?

| Event            | Emitted when                              | Properties                        |
| ---------------- | ----------------------------------------- | --------------------------------- |
| `user.signed_in` | Session starts                            | `role`, `device` (mobile/desktop) |
| `feature.used`   | A significant screen or action is reached | `module`, `feature`               |

`feature.used` is what tells you whether the team calendar was worth building. Emit it on
meaningful actions, not every page view — noise makes the table expensive and the answers
no better.

### Funnel — where do prospects fall out?

| Event                    | Emitted when                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `demo_request.submitted` | Landing page form — **the `demo_requests` table already captures this**; emit for a single funnel view |
| `organization.signed_up` | Account created                                                                                        |
| `organization.activated` | Activation criteria met (above)                                                                        |
| `organization.converted` | First payment                                                                                          |

The interesting number is demo → signup and signup → activated. If organisations sign up
and never activate, the problem is onboarding, and that is fixable. If they never sign up,
the problem is the landing page or the pitch.

### Operational — is the product actually working?

| Event             | Emitted when           | Properties                          |
| ----------------- | ---------------------- | ----------------------------------- |
| `api.request`     | Every API call         | `endpoint`, `status`, `duration_ms` |
| `email.delivered` | Resend confirms        | `template`                          |
| `email.failed`    | Resend reports failure | `template`, `reason`                |

`email.failed` deserves attention: a silently failed approval email means an approver never
learns a request is waiting, and the employee assumes their leave is being processed. That
looks like a product failure and is invisible without this event.

Error rates come from Sentry, not from here — do not duplicate.

---

## 5 · How to emit

One platform helper, called from handlers:

```ts
// src/platform/analytics/track.ts
await track(ctx, "leave_request.submitted", { days: 4, leave_type: "Casual" });
```

Rules:

- Fire-and-forget. **Analytics must never fail a user action** — wrap it so a failed insert
  logs and moves on. Nobody's leave request should fail because a metrics write did.
- Called from handlers, never from components. A component-level event fires on re-render.
- Never in a loop over rows. `employees.imported` carries `count: 200`; it is not 200 events.

---

## 6 · Reading it

Plain SQL. Activated organisations this month:

```sql
select count(distinct organization_id)
from analytics_events
where event = 'organization.activated'
  and occurred_at >= date_trunc('month', now());
```

Signup-to-activation funnel:

```sql
select
  count(*) filter (where event = 'organization.signed_up')  as signed_up,
  count(*) filter (where event = 'organization.activated')  as activated
from analytics_events
where occurred_at >= now() - interval '90 days';
```

A small admin dashboard over these queries is worth building once the numbers matter. It is
not MVP work — the events are, because they cannot be added retroactively and the dashboard
can.

---

## 7 · Instrumentation checklist per build step

Each step in `docs/product/NEUVTO_MVP_BUILD_SPEC.md` that ships a user-facing action:

- [ ] Which events from §4 does this step make possible?
- [ ] Emitted from the handler, not the component
- [ ] Properties carry no personal data
- [ ] Failure of `track()` cannot fail the user's action
- [ ] Nothing emitted that could be derived from existing tables
