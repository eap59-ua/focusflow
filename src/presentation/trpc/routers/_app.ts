import { router } from "../server";

import { authRouter } from "./auth";
import { gmailRouter } from "./gmail";
import { schedulingRouter } from "./scheduling";

export const appRouter = router({
  auth: authRouter,
  gmail: gmailRouter,
  scheduling: schedulingRouter,
});

export type AppRouter = typeof appRouter;
