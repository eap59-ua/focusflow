import { protectedProcedure, router } from "../server";

export const gmailRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const status = await ctx.container.getGmailStatus.execute({
      userId: ctx.user.id,
    });
    if (!status.connected) {
      return { connected: false as const };
    }
    return {
      connected: true as const,
      googleAccountEmail: status.googleAccountEmail,
      connectedAt: status.connectedAt.toISOString(),
    };
  }),

  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.container.disconnectGmail.execute({ userId: ctx.user.id });
    return { ok: true as const };
  }),
});
