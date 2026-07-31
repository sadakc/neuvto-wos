/**
 * A link to a page owned by a module.
 *
 * Module pages are served by the single catch-all route `/app/$`, so TanStack
 * does not know `/app/leave/apply` as a route and will not type a plain `to`.
 * That is the trade taken in step 6 for keeping a module in one folder.
 *
 * This confines the cost to one component rather than scattering
 * `params={{ _splat }}` through every module. The path is still a string —
 * a typo produces the page-not-found state rather than a compile error, which
 * is the honest limit of the approach.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function ModuleLink({
  path,
  className,
  children,
  ...rest
}: {
  /** Relative to /app, no leading slash — the same value a module declares. */
  path: string;
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentProps<"a">, "href" | "className" | "children">) {
  return (
    <Link to="/app/$" params={{ _splat: path.replace(/^\/+/, "") }} className={className} {...rest}>
      {children}
    </Link>
  );
}
