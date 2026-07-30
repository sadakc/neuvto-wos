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
// See docs/operations/EMAIL_AND_DOMAINS.md.

type Captured = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  authorization: string;
};

const captured: Captured[] = [];
const PORT = Number(Bun.env.STUB_PORT ?? "8787");

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
      return Response.json({ id: `stub-${crypto.randomUUID()}` });
    }

    // Anything else is the dispatcher calling a route Resend does not have.
    return Response.json({ message: "not found" }, { status: 404 });
  },
});

console.log(`resend-stub listening on :${PORT}`);
