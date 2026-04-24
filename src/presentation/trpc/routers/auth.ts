import { TRPCError } from "@trpc/server";

import { registerUserInputSchema } from "@/application/use-cases/auth/RegisterUser.schema";
import { EmailAlreadyRegisteredError } from "@/domain/user/errors/EmailAlreadyRegisteredError";
import { InvalidDisplayNameError } from "@/domain/user/errors/InvalidDisplayNameError";
import { InvalidEmailError } from "@/domain/user/errors/InvalidEmailError";
import { WeakPasswordError } from "@/domain/user/errors/WeakPasswordError";

import { publicProcedure, router } from "../server";

export const authRouter = router({
  register: publicProcedure
    .input(registerUserInputSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const user = await ctx.container.registerUser.execute(input);
        return {
          id: user.id,
          email: user.email.value,
          displayName: user.displayName,
          createdAt: user.createdAt.toISOString(),
        };
      } catch (err) {
        if (err instanceof EmailAlreadyRegisteredError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        if (
          err instanceof InvalidEmailError ||
          err instanceof WeakPasswordError ||
          err instanceof InvalidDisplayNameError
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),
});
