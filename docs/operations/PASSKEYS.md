# Face and fingerprint sign-in (passkeys)

**Version:** 1.0 · **Status:** Active · **Applies to:** every environment's Supabase Auth settings

D79. People can sign in with Face ID, Touch ID, Windows Hello or their phone's fingerprint
sensor, as well as the email code. Underneath it is a **passkey**: the W3C WebAuthn standard.
The device creates a private key that never leaves it and unlocks it with the face or finger;
Neuvto stores only the public half, in Supabase Auth.

**Cost: nothing.** Passkeys are part of Supabase Auth on every plan, including Free.

---

## What a person does

1. Signs in once with the email code, as today.
2. Opens **Sign-in and security** (their initials, top right, or Home's tabs) and presses
   **Set up on this device**. The phone or laptop asks for their face or finger.
3. From then on, the sign-in page offers **Sign in with face or fingerprint**. No email is
   typed: the device knows whose passkey it holds.

They can set up several devices and remove any of them from the same page. The email code
never goes away, so a lost phone costs one email, never the account.

A deactivated person's passkey still completes the sign-in ceremony and then reaches nothing,
exactly as their email code would (D52). Proved by `neuvto-harness/tests/verify_passkeys.ts`.

---

## Switching it on in an environment

Local: already on, in `supabase/config.toml` (`[auth.passkey]`, relying party `localhost`,
origin `http://localhost:8080`). The local dev server must therefore run on port 8080 for a
real device to work against it.

**Production and the hosted QA/UAT projects are set by hand, once, in the Supabase dashboard.**
`config.toml` is never pushed to a hosted project (see the warning at the top of its `[auth]`
block), so this is not something a deploy does.

1. Supabase dashboard → the project → **Authentication → Passkeys**.
2. Turn on **Enable Passkey authentication**.
3. **Relying Party Display Name:** `Neuvto`
4. **Relying Party ID:** `neuvto.com`
5. **Relying Party Origins:** `https://neuvto.com,https://www.neuvto.com`
6. Save.

> **The relying party ID can never change afterwards.** Every passkey is cryptographically
> bound to `neuvto.com`. Change it and every enrolled face and fingerprint stops working at
> once, and everybody has to set theirs up again. This is the one setting in this file that
> is cheap today and very expensive later.

A QA or UAT project served from another hostname needs its own relying party ID matching
that hostname. A passkey made on one environment does not work on another; that is correct.

If the setting is off in an environment, the sign-in button still appears on capable devices,
and pressing it says _"Face and fingerprint sign-in isn't switched on yet. Use an email code
for now."_ Nothing breaks; nobody is locked out.

---

## Three things to know

**It is marked experimental by Supabase.** The API may change without notice. The opt-in
lives in `src/platform/auth/passkeys.ts`, not in the Lovable-generated client, and
`passkeys.test.ts` pins it against the installed `@supabase/supabase-js`. When upgrading that
package, run `bun run test` and `bun run harness`; both cover passkeys.

**Administrators' TOTP (D21) is unchanged.** A passkey is a stronger proof than a TOTP code,
and whether it should satisfy D21 on its own is a decision for later, not one this change
made quietly.

**Moving off Supabase (`architecture/PORTABILITY.md`).** Passkeys are a standard bound to the
domain, not to Supabase, but the public keys live in Supabase Auth's own tables. A move to
another auth provider would ask everybody to set their device up again once. That is an
inconvenience, not a lockout, because the email code carries on working.
