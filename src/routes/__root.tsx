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
import { reportLovableError } from "../lib/lovable-error-reporting";

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
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
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
      { name: "theme-color", content: "#00b0ed" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
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
 * The design system defines dark tokens under a `.dark` class, but nothing was
 * ever setting it — so dark mode was defined and never reachable, and every
 * screen rendered light regardless of the viewer's preference.
 *
 * Runs before paint, inline in <head>, so the correct theme is applied on the
 * first frame. Doing this in a React effect instead produces a white flash on
 * every load for dark-mode users.
 */
const APPLY_THEME = `(function(){try{
  var m=window.matchMedia('(prefers-color-scheme: dark)');
  var set=function(dark){document.documentElement.classList.toggle('dark',dark)};
  set(m.matches);
  m.addEventListener('change',function(e){set(e.matches)});
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

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
