import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { InvalidBriefingHourError } from "@/domain/user/errors/InvalidBriefingHourError";
import { InvalidBriefingTimezoneError } from "@/domain/user/errors/InvalidBriefingTimezoneError";
import { UserNotFoundError } from "@/domain/user/errors/UserNotFoundError";

import { protectedProcedure, router } from "../server";

const updatePreferencesInput = z.object({
  hour: z.number().int().min(0).max(23),
  timezone: z.string().min(1),
  enabled: z.boolean(),
});

export const schedulingRouter = router({
  getPreferences: protectedProcedure.query(({ ctx }) => {
    const user = ctx.user;
    return {
      hour: user.briefingHour,
      timezone: user.briefingTimezone,
      enabled: user.briefingEnabled,
    };
  }),

  updatePreferences: protectedProcedure
    .input(updatePreferencesInput)
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.container.updateBriefingPreferences.execute({
          userId: ctx.user.id,
          hour: input.hour,
          timezone: input.timezone,
          enabled: input.enabled,
        });
        return { ok: true as const };
      } catch (err) {
        if (err instanceof InvalidBriefingHourError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        if (err instanceof InvalidBriefingTimezoneError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        if (err instanceof UserNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      }
    }),

  triggerNow: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.container.triggerBriefingForUser.execute({
      userId: ctx.user.id,
    });
    return { ok: true as const, flowId: result.flowId };
  }),
});
