import { TRPCError } from "@trpc/server";
import { serialize as serializeCookie } from "cookie";

import { loginUserInputSchema } from "@/application/use-cases/auth/LoginUser.schema";
import { registerUserInputSchema } from "@/application/use-cases/auth/RegisterUser.schema";
import { EmailAlreadyRegisteredError } from "@/domain/user/errors/EmailAlreadyRegisteredError";
import { InvalidCredentialsError } from "@/domain/user/errors/InvalidCredentialsError";
import { InvalidDisplayNameError } from "@/domain/user/errors/InvalidDisplayNameError";
import { InvalidEmailError } from "@/domain/user/errors/InvalidEmailError";
import { WeakPasswordError } from "@/domain/user/errors/WeakPasswordError";

import { sessionCookieName } from "../context";
import { protectedProcedure, publicProcedure, router } from "../server";

const DEFAULT_LIFETIME_DAYS = 30;

function sessionLifetimeDays(): number {
  const raw = process.env.SESSION_LIFETIME_DAYS;
  if (!raw) return DEFAULT_LIFETIME_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIFETIME_DAYS;
}

function buildSessionCookie(value: string, maxAgeSeconds: number): string {
  return serializeCookie(sessionCookieName(), value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

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

  login: publicProcedure
    .input(loginUserInputSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { session } = await ctx.container.loginUser.execute(input);
        const maxAgeSeconds = sessionLifetimeDays() * 86400;
        ctx.resHeaders.append(
          "Set-Cookie",
          buildSessionCookie(session.id.value, maxAgeSeconds),
        );
        return { ok: true as const };
      } catch (err) {
        if (err instanceof InvalidCredentialsError) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: err.message });
        }
        throw err;
      }
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionId) {
      await ctx.container.logoutUser.execute({ sessionId: ctx.sessionId });
    }
    ctx.resHeaders.append("Set-Cookie", buildSessionCookie("", 0));
    return { ok: true as const };
  }),

  me: protectedProcedure.query(({ ctx }) => {
    const user = ctx.user;
    return {
      id: user.id,
      email: user.email.value,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    };
  }),
});
