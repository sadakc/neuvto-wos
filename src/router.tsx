import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installModules } from "@/platform/modules";
import { MODULES } from "@/modules/registry";

// Manifests are validated here, once, at startup. A malformed one — a duplicate
// route, two modules claiming the same approval entity type — fails loudly on
// boot rather than as a blank sidebar somebody debugs an afternoon later.
//
// This is the only place the platform learns which modules exist, and it learns
// it from the registry rather than by importing any of them.
installModules(MODULES);

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
