import { router } from "../server";

import { authRouter } from "./auth";
import { gmailRouter } from "./gmail";

export const appRouter = router({
  auth: authRouter,
  gmail: gmailRouter,
});

export type AppRouter = typeof appRouter;
