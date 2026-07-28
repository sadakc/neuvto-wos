# NEUVTO WOS — API Standards

**Version:** 1.0 · **Status:** Active · **Applies to:** all platform services and business modules

Binding on every endpoint. A module that deviates is a defect, not a variation.

---

## 1. Two surfaces, one contract

The stack is TanStack Start, whose native transport is **server functions**, not REST controllers. But `06_LEAVE_MANAGEMENT.md` §API Specifications commits to versioned REST, and a native mobile client (Phase 2) and third-party integrations will need it.

**Resolution — define the contract once, expose it twice:**

```
src/modules/leave/contracts/    Zod schemas + TS types   ← single source of truth
src/modules/leave/handlers/     Pure functions (ctx, input) => output
src/modules/leave/server.ts     Server functions  →  wrap handlers (web app)
src/routes/api/v1/leave/*.ts    REST routes       →  wrap the same handlers
```

A handler never knows which surface called it. Business logic exists once. Adding REST later is wiring, not a rewrite.

**Rule:** no business logic in a server function or a route file. They validate, authenticate, call a handler, and serialise.

---

## 2. Envelope

Every response, success or failure:

```json
{ "success": true,  "data": { }, "error": null, "timestamp": "2026-07-28T10:30:00Z" }
{ "success": false, "data": null, "error": { "code": "INSUFFICIENT_BALANCE",
    "message": "You requested 5 days but have only 3 days available",
    "details": { "requested": 5, "available": 3 } },
  "timestamp": "2026-07-28T10:30:00Z" }
```

- `message` is **user-facing** — it may be shown verbatim in the UI. Write it for an employee, not an engineer.
- `details` is machine-readable and optional. Never put internal state, SQL, or stack traces in it.
- `timestamp` is always ISO-8601 UTC.

---

## 3. Casing — `snake_case`

**Decision:** all JSON fields are `snake_case`.

`06_LEAVE_MANAGEMENT.md` uses `camelCase` (line 931) while `03_PLATFORM_ARCHITECTURE.md` uses `snake_case` (line 919). They conflict. `snake_case` wins because it matches Postgres column names end to end, so no mapping layer exists to drift or leak.

TypeScript interfaces use `snake_case` for API payload types. Internal-only types may use `camelCase`.

---

## 4. URLs

```
/api/v1/{resource}                    collection
/api/v1/{resource}/{id}               instance
/api/v1/{resource}/{id}/{action}      state transition
```

- Resources are **plural nouns**, kebab-case: `/leave-requests`, `/approval-requests`
- Actions are **verbs**, only for transitions that aren't CRUD: `/leave-requests/{id}/cancel`
- Never a verb in a collection path. `/get-leave-requests` is wrong.
- Query params are `snake_case`: `?status=approved&from_date=2026-08-01`

**Platform vs module namespacing** mirrors the architecture:

```
/api/v1/approvals/...        platform — Approval Engine
/api/v1/notifications/...    platform
/api/v1/organizations/...    platform
/api/v1/leave/...            module
/api/v1/attendance/...       module (Phase 2)
```

A module never exposes an endpoint for a platform capability. Leave has no `/api/v1/leave/approvals` — approvals live at `/api/v1/approvals` with `entity_type=leave_request`.

---

## 5. Status codes

| Code | Use                                                                            |
| ---- | ------------------------------------------------------------------------------ |
| 200  | Successful read or update                                                      |
| 201  | Resource created — include `Location`                                          |
| 400  | Malformed request, failed schema validation                                    |
| 401  | Missing or invalid token                                                       |
| 403  | Authenticated but not permitted, **or resource belongs to another tenant**     |
| 404  | Resource does not exist _and_ the caller could legitimately have accessed it   |
| 409  | State conflict — overlapping leave, already-decided approval                   |
| 422  | Well-formed but violates a business rule — insufficient balance, notice period |
| 429  | Rate limited                                                                   |
| 500  | Unhandled. Never leak internals.                                               |

**Tenant isolation rule:** a cross-tenant request returns **403, never 404**. A 404 confirms an ID doesn't exist in your tenant; a 403 reveals nothing. Consistency here prevents enumeration.

**400 vs 422:** 400 means the request was malformed (missing field, bad date format). 422 means it parsed fine but broke a rule (not enough balance). Clients branch on this — 400 is a bug, 422 is a message to show the user.

---

## 6. Error codes

Stable `SCREAMING_SNAKE_CASE` identifiers. **Never renamed once shipped** — clients branch on them.

**Platform**

```
UNAUTHENTICATED · FORBIDDEN · TENANT_MISMATCH · NOT_FOUND
VALIDATION_FAILED · RATE_LIMITED · INTERNAL_ERROR · MODULE_NOT_ENABLED
```

**Approval Engine**

```
NO_APPROVAL_CHAIN · APPROVER_UNRESOLVED · ALREADY_DECIDED
NOT_YOUR_APPROVAL · SELF_APPROVAL_FORBIDDEN
```

**Leave**

```
INSUFFICIENT_BALANCE · OVERLAPPING_REQUEST · RETROACTIVE_NOT_ALLOWED
NOTICE_PERIOD_NOT_MET · NON_WORKING_DAYS_ONLY · EXCEEDS_MAX_PER_REQUEST
LEAVE_TYPE_ARCHIVED · REQUEST_ALREADY_STARTED
```

Every error code appears in exactly one handler. Grep must find its origin in one place.

---

## 7. Pagination

Offset-based, per `06` line 986:

```
GET /api/v1/leave-requests?limit=20&offset=0
```

```json
{
  "success": true,
  "data": [],
  "pagination": { "total": 137, "limit": 20, "offset": 0, "has_more": true },
  "timestamp": "..."
}
```

Default `limit` 20, maximum 100. A `limit` over 100 is clamped, not rejected. Every collection endpoint paginates — no exceptions, because "we only ever have a few" stops being true at customer 30.

---

## 8. Authentication and tenancy

- `Authorization: Bearer {supabase_jwt}` on every endpoint except health checks
- **Tenant is derived from the token, never from the request.** An `organization_id` in a body or query string is ignored — accepting one is a vulnerability.
- Every handler receives a `ctx` carrying `user_id`, `organization_id`, and `roles`. It never reads auth state itself.
- RLS is the enforcement backstop. Handler-level permission checks are defence in depth, not a substitute.

---

## 9. Mutations

**Validation order** — cheapest first, so expensive checks never run on invalid input:

```
1. Schema (Zod)          → 400 VALIDATION_FAILED
2. Authn                 → 401
3. Authz + tenancy       → 403
4. Existence             → 404
5. Business rules        → 422
6. Execute (transaction)
```

**Transactions:** any mutation touching more than one table runs in a single database transaction. A leave submission that writes a request, decrements a balance, and creates an approval either fully happens or fully doesn't. Partial writes are how balances drift.

**Idempotency:** mutations accept an optional `Idempotency-Key` header. Replay within 24 hours returns the original response rather than acting twice. Required on anything a mobile client might retry on a flaky connection.

---

## 10. Dates and numbers

- Dates: `YYYY-MM-DD`. Timestamps: ISO-8601 UTC with `Z`.
- **Never** send a timestamp where a date is meant. A leave day is a calendar date; timezone-shifting it moves someone's holiday.
- Day counts are `numeric`, serialised as JSON numbers, never strings. Half-day support arrives later and integers would block it.
- Money, if it ever appears: integer minor units. Never floats.

---

## 11. Versioning

- `/api/v1/` from day one.
- **Additive changes** (new optional field, new endpoint) do not bump the version.
- **Breaking changes** (removing or renaming a field, changing a type, tightening validation) require `/api/v2/` with `v1` supported for at least 6 months.
- Adding a value to an enum is **breaking** for clients that switch exhaustively. Treat it as such.

---

## 12. Checklist for every new endpoint

- [ ] Zod schema in `contracts/`, exported type derived from it
- [ ] Logic in a handler, not in the route or server function
- [ ] Envelope shape correct on success and failure
- [ ] Tenant from token only
- [ ] Cross-tenant returns 403
- [ ] Errors use an existing code, or a new one added to §6
- [ ] Collections paginate
- [ ] Multi-table writes wrapped in a transaction
- [ ] Audit log entry written for any state change
- [ ] `verify_rls.sql` and `verify_invariants.sql` still pass
