// A stand-in for Resend, for verifying the delivery loop without a live key and
// without sending real mail to real people.
//
// It answers /emails the way Resend does and keeps what it was sent, so the
// verification can assert on the exact bytes that would have gone out — the
// recipient, the rendered subject, the rendered body. Asserting only that the
// row flipped to 'sent' would pass just as happily while mailing gibberish.
//
//   bun neuvto-harness/tools/resend-stub.ts &
//   curl localhost:8787/__captured
//
// IT ALSO RELAYS INTO MAILPIT, so a developer can simply read their mail.
//
// Sada provisioned a customer locally, went looking for the invitation in
// Mailpit, and found nothing — reasonably, since Mailpit only ever receives what
// Supabase Auth sends it over SMTP, and product mail goes out over Resend's HTTP
// API instead. Two delivery paths, one inbox, and the one people check was the
// one that could never show a product email.
//
// The relay is here rather than in the dispatcher on purpose: production code
// should not carry a branch that exists for a test. See
// docs/operations/EMAIL_AND_DOMAINS.md.

type Captured = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  authorization: string;
};

const captured: Captured[] = [];
const PORT = Number(Bun.env.STUB_PORT ?? "8787");

// Mailpit's SMTP port on the local Supabase stack. Empty disables the relay,
// which is what the harness wants: it asserts on `captured`, and delivering
// besides would just fill an inbox nobody reads.
const SMTP_HOST = Bun.env.MAILPIT_SMTP_HOST ?? "";
const SMTP_PORT = Number(Bun.env.MAILPIT_SMTP_PORT ?? "54325");

/**
 * Hands the message to Mailpit over SMTP, spoken by hand.
 *
 * Deliberately no dependency: Mailpit accepts anything, this is nine lines, and
 * a mail library in the harness would be a package to keep current for the sake
 * of a development convenience. Failure is logged and swallowed — the stub's
 * real job is capturing what was sent, and a relay problem must not make the
 * dispatcher think delivery failed.
 */
async function relayToMailpit(m: Omit<Captured, "authorization">): Promise<void> {
  if (!SMTP_HOST) return;

  const rcpt = m.to[0] ?? "";
  const address = rcpt.includes("<") ? rcpt.replace(/.*<|>.*/g, "") : rcpt;
  const sender = m.from.includes("<") ? m.from.replace(/.*<|>.*/g, "") : m.from;

  try {
    const socket = await Bun.connect({
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      socket: { data() {}, error() {} },
    });

    // Mailpit never refuses, so this pipelines the whole conversation rather
    // than waiting on each reply. A real MTA would need the round trips.
    const body =
      `From: ${m.from}\r\nTo: ${rcpt}\r\nSubject: ${m.subject}\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n\r\n${m.html}\r\n.\r\n`;

    socket.write(
      `EHLO neuvto-stub\r\nMAIL FROM:<${sender}>\r\nRCPT TO:<${address}>\r\nDATA\r\n${body}QUIT\r\n`,
    );
    await Bun.sleep(50);
    socket.end();
  } catch (e) {
    console.warn(`relay to Mailpit failed (captured anyway): ${e}`);
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/__captured") {
      return Response.json(captured);
    }

    if (url.pathname === "/__reset") {
      captured.length = 0;
      return Response.json({ ok: true });
    }

    // Resend refuses an unauthenticated send, and so does this — otherwise the
    // stub would pass a dispatcher that forgot to send its key at all.
    if (url.pathname === "/emails" && req.method === "POST") {
      const authorization = req.headers.get("Authorization") ?? "";
      if (!authorization.startsWith("Bearer ") || authorization.length < 12) {
        return Response.json({ message: "Missing API key" }, { status: 401 });
      }

      const body = (await req.json()) as Omit<Captured, "authorization">;
      captured.push({ ...body, authorization });
      await relayToMailpit(body);
      return Response.json({ id: `stub-${crypto.randomUUID()}` });
    }

    // Anything else is the dispatcher calling a route Resend does not have.
    return Response.json({ message: "not found" }, { status: 404 });
  },
});

console.log(
  `resend-stub listening on :${PORT}` +
    (SMTP_HOST ? ` · relaying to Mailpit at ${SMTP_HOST}:${SMTP_PORT}` : " · capture only"),
);
