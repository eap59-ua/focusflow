import { router } from "../server";

import { authRouter } from "./auth";

export const appRouter = router({
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
