import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import { reportError, installGlobalErrorHandlers } from "@/platform/observability/report";
import { CONSOLE_PATH } from "@/platform/console-path";
import { resolveTheme, THEME_STORAGE_KEY } from "@/platform/design/theme";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    void reportError(error, "boundary", { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Neuvto WOS — Workforce Operating System" },
      { property: "og:title", content: "Neuvto WOS — Workforce Operating System" },
      { name: "twitter:title", content: "Neuvto WOS — Workforce Operating System" },
      {
        name: "description",
        content:
          "Neuvto WOS is a mobile-first Workforce Operating System. Launching with Leave Management, expanding to attendance, payroll, and performance.",
      },
      {
        property: "og:description",
        content:
          "Mobile-first Workforce OS. Launching with Leave Management, expanding to attendance, payroll, and performance.",
      },
      {
        name: "twitter:description",
        content:
          "Mobile-first Workforce OS. Launching with Leave Management, expanding to attendance, payroll, and performance.",
      },

      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2738ba3e-7fcb-4e41-b990-1d3ddb5a1733/id-preview-b316bebf--c74d04ee-25dd-4be1-a46e-f8973fe8c5d4.lovable.app-1784785091719.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2738ba3e-7fcb-4e41-b990-1d3ddb5a1733/id-preview-b316bebf--c74d04ee-25dd-4be1-a46e-f8973fe8c5d4.lovable.app-1784785091719.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },

      // D1 promised a PWA-installable app and nothing implemented it: Add to
      // Home Screen gave a Safari shell with browser chrome. These three plus
      // the manifest are what make it open fullscreen, like an app.
      //
      // No service worker, deliberately. Offline is not claimed anywhere, and a
      // cache serving a stale leave balance is worse than no cache — somebody
      // books days they have already spent.
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Neuvto" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "theme-color", content: "#0ea5e9" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      // Preferred by every current browser; the .ico stays for the ones that
      // ask for /favicon.ico without reading the document at all.
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/**
 * Applies the theme before the first paint.
 *
 * Inline in <head> and not in a React effect, because an effect runs after the
 * browser has already painted — which is a white flash on every load for every
 * dark-mode user, and the app now defaults to dark.
 *
 * The rule itself is `resolveTheme`, stringified rather than rewritten. It used
 * to be written twice: once in TypeScript where it could be tested, once by
 * hand inside this template string where it could not. Two copies of a rule
 * that must agree is one copy plus a bug waiting for someone to edit only the
 * first. Stringifying keeps a single tested implementation, at the cost of one
 * constraint — `resolveTheme` may not reference anything outside itself, which
 * theme.test.ts asserts by reading its own source.
 *
 * `matchMedia` is still watched, but only matters where the OS is what decides
 * (the landing page, sign-in): an explicit choice and the app's Nocturne
 * default both ignore it, and `resolveTheme` is what knows that.
 */
const APPLY_THEME = `(function(){try{
  var resolve=${resolveTheme.toString()};
  var consolePath=${JSON.stringify(CONSOLE_PATH)};
  var key=${JSON.stringify(THEME_STORAGE_KEY)};
  var read=function(){try{return localStorage.getItem(key)}catch(e){return null}};
  var m=window.matchMedia('(prefers-color-scheme: dark)');
  var set=function(){
    var t=resolve(location.pathname,read(),m.matches,consolePath);
    document.documentElement.classList.toggle('dark',t==='dark');
    document.documentElement.style.colorScheme=t;
  };
  set();
  m.addEventListener('change',set);
}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: APPLY_THEME adds className="dark" before React
    // hydrates, so the server HTML and the client DOM differ by design. Without
    // this, React logs a hydration mismatch on every single page load — which
    // buries real errors in noise.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: APPLY_THEME }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // A boundary only catches errors thrown during render. An error in an event
  // handler, a setTimeout, or an unawaited promise reaches neither — and in this
  // app those are most of what breaks, because most of it is async calls to
  // Postgres. Installed once at the root, torn down on unmount so a test can
  // control it.
  useEffect(() => installGlobalErrorHandlers(), []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
