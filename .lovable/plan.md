## Plan: Persist demo requests via Lovable Cloud

Use Lovable Cloud (managed Supabase) to store leads from the landing page demo form. No credentials needed from you — it auto-provisions.

### Steps

1. **Enable Lovable Cloud** on the project (provisions DB, auth, storage, keys).
2. **Create `demo_requests` table** via migration:
   - `id uuid pk default gen_random_uuid()`
   - `name text not null`
   - `email text not null`
   - `company text`
   - `employees text`
   - `message text`
   - `created_at timestamptz default now()`
   - GRANTs: `INSERT` to `anon` + `authenticated` (public form); `SELECT/ALL` to `service_role` only.
   - Enable RLS; policy allowing anonymous INSERT only (no public read — leads stay private).
3. **Server function** `submitDemoRequest` in `src/lib/demo.functions.ts` using the generated Supabase client — validates input with Zod and inserts a row.
4. **Wire the form** in `src/routes/index.tsx` to call the server function via `useServerFn`, show success/error toasts, reset on success.
5. **Verify**: submit a test entry from the preview; confirm row appears in Cloud → Tables.

### Later switch to your own Supabase
When ready, we swap the two env vars (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) and re-run the migration on your project. Form code stays unchanged.

Approve to build.