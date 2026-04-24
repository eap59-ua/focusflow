import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createContext } from "@/presentation/trpc/context";
import { appRouter } from "@/presentation/trpc/routers/_app";

const handler = (req: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
