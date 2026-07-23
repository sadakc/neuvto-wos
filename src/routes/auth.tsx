import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : "",
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Neuvto WOS" },
      { name: "description", content: "Sign in to Neuvto WOS to manage your workforce operating system." },
      { property: "og:title", content: "Sign in — Neuvto WOS" },
      { property: "og:description", content: "Sign in to Neuvto WOS." },
      { name: "twitter:title", content: "Sign in — Neuvto WOS" },
      { name: "twitter:description", content: "Sign in to Neuvto WOS." },
    ],
  }),
  component: AuthPage,
});

function safeNext(next: string) {
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function AuthPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) {
        window.location.href = safeNext(next);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) window.location.href = safeNext(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [next]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "sign-up") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}${safeNext(next)}` },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = safeNext(next);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    try {
      const returnUrl = `${window.location.origin}${safeNext(next)}`;
      const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: returnUrl });
      if (result.error) throw result.error;
      if (result.redirected) return;
      window.location.href = safeNext(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === "sign-in" ? "Sign in to Neuvto" : "Create your Neuvto account"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {mode === "sign-in"
          ? "Sign in to manage your Neuvto WOS workspace and connect agent integrations."
          : "Create an account to access Neuvto WOS."}
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={handleGoogle}
        className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-60"
      >
        Continue with Google
      </button>

      <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleEmail} className="flex flex-col gap-3">
        <label className="text-sm font-medium">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="text-sm font-medium">
          Password
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="mt-2 inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {mode === "sign-in" ? "No account? Create one" : "Already have an account? Sign in"}
      </button>
    </main>
  );
}
