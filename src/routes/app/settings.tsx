/**
 * Settings, which is now a place rather than a page.
 *
 * It used to be one scroll: company identity, working calendar, departments,
 * holidays, module switches, and then every enabled module's configuration
 * appended underneath in one undifferentiated column. The module system had
 * always kept those blocks inside their own folders — `adminSections` on the
 * manifest — and this screen threw that apart again at render time.
 *
 * Split in two, along the line Sada drew:
 *
 *  - `/app/settings` — what the whole organisation shares whatever modules it
 *    runs. Departments is the clearest case: the column exists on a leave report
 *    and a salary register alike, and a workspace with two department lists has
 *    two answers to who works where.
 *  - `/app/settings/<module>` — one module's own configuration, and nothing
 *    else's.
 *
 * This file is the layout over both, and deliberately holds almost nothing. The
 * heading belongs to each page, because "Workspace settings" and "Payroll" are
 * not the same title, and the administrator gate belongs to each page because a
 * gate rendered by a parent is a gate a new sibling can forget to inherit.
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/app/settings")({
  ssr: false,
  head: () => ({ meta: [{ title: "Settings — Neuvto WOS" }] }),
  component: () => <Outlet />,
});
