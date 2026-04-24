import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "@/presentation/trpc/context";
import { requireUser } from "@/presentation/trpc/server";
import { SessionExpiredError } from "@/domain/session/errors/SessionExpiredError";
import { SessionNotFoundError } from "@/domain/session/errors/SessionNotFoundError";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";

function makeUser(): User {
  return User.create({
    email: Email.create("auth@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake"),
    displayName: "Auth User",
  });
}

function makeCtx(
  sessionId: string | null,
  getCurrentUserImpl: () => Promise<{ user: User }>,
): AppContext {
  return {
    sessionId,
    resHeaders: new Headers(),
    prisma: {} as AppContext["prisma"],
    container: {
      getCurrentUser: { execute: vi.fn(getCurrentUserImpl) },
    } as unknown as AppContext["container"],
  };
}

describe("requireUser (base de protectedProcedure)", () => {
  it("lanza UNAUTHORIZED cuando no hay sessionId en el contexto", async () => {
    const ctx = makeCtx(null, async () => {
      throw new Error("should not be called");
    });

    await expect(requireUser(ctx)).rejects.toThrow(TRPCError);
    await expect(requireUser(ctx)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("lanza UNAUTHORIZED si GetCurrentUser falla con SessionNotFoundError", async () => {
    const ctx = makeCtx("any-id", async () => {
      throw new SessionNotFoundError();
    });

    await expect(requireUser(ctx)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("lanza UNAUTHORIZED si GetCurrentUser falla con SessionExpiredError", async () => {
    const ctx = makeCtx("any-id", async () => {
      throw new SessionExpiredError();
    });

    await expect(requireUser(ctx)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("devuelve el user cuando hay sessionId y GetCurrentUser resuelve", async () => {
    const user = makeUser();
    const ctx = makeCtx("any-id", async () => ({ user }));

    await expect(requireUser(ctx)).resolves.toBe(user);
  });
});
