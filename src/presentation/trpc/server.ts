import { initTRPC, TRPCError } from "@trpc/server";

import type { User } from "@/domain/user/User";

import type { AppContext } from "./context";

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export async function requireUser(ctx: AppContext): Promise<User> {
  if (!ctx.sessionId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  try {
    const { user } = await ctx.container.getCurrentUser.execute({
      sessionId: ctx.sessionId,
    });
    return user;
  } catch {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
}

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const user = await requireUser(ctx);
  return next({ ctx: { ...ctx, user } });
});
