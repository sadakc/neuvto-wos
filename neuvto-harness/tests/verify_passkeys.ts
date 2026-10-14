/**
 * NEUVTO WOS — face and fingerprint sign-in, end to end against the local
 * auth server (D79)
 *
 *     bun neuvto-harness/tests/verify_passkeys.ts
 *
 * A browser cannot be handed a fingerprint, so this plays the part of the
 * device: a software authenticator that creates a P-256 key and signs the
 * server's challenge exactly as a phone's secure enclave does, with the
 * attestation format ("none") a real platform authenticator sends. Everything
 * on the server side is real: GoTrue's passkey endpoints, its signature
 * check, the session it issues, and the database policies that session meets.
 *
 * What it proves, each with its negative case:
 *
 *   1. A signed-in person can register a passkey.
 *   2. That passkey alone, with no email, signs them in to the right account.
 *   3. A signature from a different key is refused.
 *   4. A passkey that has been removed signs nobody in.
 *   5. D52 holds: a DEACTIVATED person's passkey yields a session that reads
 *      nothing, exactly as their email code would.
 *
 * Skips, saying so, when the local auth server has passkeys switched off.
 * Requires the harness seed (alice, ravi) and the local Mailpit.
 */

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

const API = process.env.SUPABASE_API_URL ?? "http://127.0.0.1:54321";
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const MAIL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const ORIGIN = "http://localhost:8080";
const RP_ID = "localhost";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const fromB64url = (s: string) => Buffer.from(s, "base64url");

function fail(msg: string): never {
  console.error(`PASSKEY FAIL: ${msg}`);
  process.exit(1);
}
const ok = (msg: string) => console.log(`ok: ${msg}`);

async function auth(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API}/auth/v1${path}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function rest(path: string, token: string) {
  const res = await fetch(`${API}/rest/v1${path}`, {
    headers: { apikey: KEY, authorization: `Bearer ${token}` },
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as unknown };
}

// The same search scripts/harness.sh makes, which passes PSQL in when it runs this.
const PSQL =
  process.env.PSQL ||
  ["/opt/homebrew/opt/libpq/bin/psql", "/usr/local/opt/libpq/bin/psql", "/opt/homebrew/bin/psql"].find(
    (p) => Bun.file(p).size > 0,
  ) ||
  "psql";

async function psql(sql: string) {
  const proc = Bun.spawn([PSQL, DB, "-qtAc", sql], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) fail(`psql: ${await new Response(proc.stderr).text()}`);
  return out.trim();
}

/* ── a minimal CBOR encoder: maps, byte strings, text, small ints ─────────── */

function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  };
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (v instanceof Map) {
    const parts = [head(5, v.size)];
    for (const [k, val] of v) parts.push(cbor(k), cbor(val));
    return Buffer.concat(parts);
  }
  throw new Error(`cbor: unsupported ${typeof v}`);
}

/* ── the software authenticator ───────────────────────────────────────────── */

class Authenticator {
  readonly credentialId = randomBytes(32);
  readonly keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  private counter = 0;

  private coseKey(): Buffer {
    const jwk = this.keys.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    return cbor(
      new Map<number, unknown>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, fromB64url(jwk.x)],
        [-3, fromB64url(jwk.y)],
      ]),
    );
  }

  private authData(withCredential: boolean): Buffer {
    const rpIdHash = createHash("sha256").update(RP_ID).digest();
    // UP (user present) + UV (user verified: the face or the finger) [+ AT].
    const flags = 0x01 | 0x04 | (withCredential ? 0x40 : 0);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(++this.counter);
    if (!withCredential) return Buffer.concat([rpIdHash, Buffer.from([flags]), count]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(this.credentialId.length);
    return Buffer.concat([
      rpIdHash,
      Buffer.from([flags]),
      count,
      Buffer.alloc(16), // AAGUID: zero, as a software authenticator reports
      len,
      this.credentialId,
      this.coseKey(),
    ]);
  }

  create(challenge: string, userHandle?: string) {
    const clientData = Buffer.from(
      JSON.stringify({ type: "webauthn.create", challenge, origin: ORIGIN, crossOrigin: false }),
    );
    const attestationObject = cbor(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", this.authData(true)],
      ]),
    );
    void userHandle;
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientData),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  get(challenge: string, userHandle: string, signingKey: KeyObject = this.keys.privateKey) {
    const clientData = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }),
    );
    const authData = this.authData(false);
    const signed = Buffer.concat([authData, createHash("sha256").update(clientData).digest()]);
    const signature = sign("sha256", signed, signingKey); // DER, as WebAuthn requires
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

async function signInWithEmailCode(email: string): Promise<{ token: string; userId: string }> {
  const before = Date.now();
  let sent = await auth("/otp", { email, create_user: false });
  // GoTrue allows one code per address every couple of seconds.
  for (let i = 0; (sent.status === 429 || sent.status >= 500) && i < 10; i++) {
    await Bun.sleep(1000);
    sent = await auth("/otp", { email, create_user: false });
  }
  if (sent.status >= 300) fail(`could not request a code for ${email}: ${JSON.stringify(sent.json)}`);
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`);
    const msg = ((await res.json()) as { messages: Array<{ Created: string; Snippet: string }> })
      .messages[0];
    if (msg && Date.parse(msg.Created) >= before - 1000) {
      const code = /\b\d{6}\b/.exec(msg.Snippet)?.[0];
      if (code) {
        const v = await auth("/verify", { type: "email", email, token: code });
        if (!v.json.access_token) fail(`code did not verify for ${email}: ${JSON.stringify(v.json)}`);
        return {
          token: v.json.access_token as string,
          userId: (v.json.user as { id: string }).id,
        };
      }
    }
    await Bun.sleep(250);
  }
  fail(`no sign-in email reached Mailpit for ${email}`);
}

async function register(device: Authenticator, token: string) {
  const opts = await auth("/passkeys/registration/options", {}, token);
  if (opts.status >= 300) fail(`registration options refused: ${JSON.stringify(opts.json)}`);
  const o = opts.json as { challenge_id: string; options: { challenge: string; user: { id: string } } };
  const verified = await auth(
    "/passkeys/registration/verify",
    { challenge_id: o.challenge_id, credential: device.create(o.options.challenge, o.options.user.id) },
    token,
  );
  if (verified.status >= 300) fail(`registration refused: ${JSON.stringify(verified.json)}`);
  return { userHandle: o.options.user.id, passkeyId: (verified.json as { id: string }).id };
}

async function passkeySignIn(device: Authenticator, userHandle: string, key?: KeyObject) {
  const opts = await auth("/passkeys/authentication/options", {});
  if (opts.status >= 300) fail(`authentication options refused: ${JSON.stringify(opts.json)}`);
  const o = opts.json as { challenge_id: string; options: { challenge: string } };
  return auth("/passkeys/authentication/verify", {
    challenge_id: o.challenge_id,
    credential: device.get(o.options.challenge, userHandle, key),
  });
}

/* ── the proof ────────────────────────────────────────────────────────────── */

// After `supabase db reset` the auth container restarts, and for a few seconds
// the gateway answers "invalid response from the upstream server". Wait for it
// rather than reporting a cold start as a passkey failure.
for (let i = 0; ; i++) {
  const health = await fetch(`${API}/auth/v1/health`, { headers: { apikey: KEY } }).catch(() => null);
  if (health?.ok) break;
  if (i >= 60) fail("the local auth server never became healthy");
  await Bun.sleep(500);
}

const probe = await auth("/passkeys/authentication/options", {});
if (probe.json.error_code === "passkey_disabled" || probe.status === 404) {
  console.log("skip: passkeys are switched off on the local auth server");
  process.exit(0);
}

// 1 · register
const alice = await signInWithEmailCode("alice.admin@acme.test");
const phone = new Authenticator();
const { userHandle, passkeyId } = await register(phone, alice.token);
ok("a signed-in person registers a passkey");

// 2 · sign in with nothing but the device
const signedIn = await passkeySignIn(phone, userHandle);
const session = signedIn.json as { access_token?: string; user?: { id: string; email: string } };
if (!session.access_token) fail(`passkey sign-in issued no session: ${JSON.stringify(signedIn.json)}`);
if (session.user?.id !== alice.userId) fail("passkey signed in as somebody other than its owner");
const mine = await rest("/profiles?select=email&id=eq." + alice.userId, session.access_token);
if (!Array.isArray(mine.json) || (mine.json as unknown[]).length !== 1) {
  fail(`a passkey session could not read its own profile: ${JSON.stringify(mine.json)}`);
}
ok("the passkey alone, with no email, signs its owner in and reaches their workspace");

// 3 · a different key is refused
const impostor = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
const forged = await passkeySignIn(phone, userHandle, impostor);
if (forged.json.access_token) fail("a signature from a different key was accepted");
ok("a signature from a different key is refused");

// 5 · D52: deactivated means the session buys nothing. Done before removal so
// the same device is used; ravi gets his own.
const ravi = await signInWithEmailCode("ravi.emp@acme.test");
const ravisPhone = new Authenticator();
const ravis = await register(ravisPhone, ravi.token);
await psql(`update public.profiles set is_active = false where id = '${ravi.userId}'`);
// Restore BEFORE judging: fail() exits the process, which skips any finally
// block, and an earlier version of this file left Ravi deactivated that way.
let leaked: string | null = null;
try {
  const after = await passkeySignIn(ravisPhone, ravis.userHandle);
  const t = (after.json as { access_token?: string }).access_token;
  if (t) {
    const rows = await rest("/profiles?select=id", t);
    if (Array.isArray(rows.json) && (rows.json as unknown[]).length > 0) {
      leaked = "a deactivated person's passkey read profiles (D52)";
    }
  }
} finally {
  await psql(`update public.profiles set is_active = true where id = '${ravi.userId}'`);
  await fetch(`${API}/auth/v1/passkeys/${ravis.passkeyId}`, {
    method: "DELETE",
    headers: { apikey: KEY, authorization: `Bearer ${ravi.token}` },
  });
}
if (leaked) fail(leaked);
ok("a deactivated person's passkey reaches nothing (D52)");

// 4 · removal
const removed = await fetch(`${API}/auth/v1/passkeys/${passkeyId}`, {
  method: "DELETE",
  headers: { apikey: KEY, authorization: `Bearer ${alice.token}` },
});
if (removed.status >= 300) fail(`removing the passkey failed: ${removed.status}`);
const afterRemoval = await passkeySignIn(phone, userHandle);
if (afterRemoval.json.access_token) fail("a removed passkey still signed somebody in");
ok("a removed passkey signs nobody in");

console.log("passkeys verified");
