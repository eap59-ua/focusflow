import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "@/presentation/trpc/context";
import { appRouter } from "@/presentation/trpc/routers/_app";
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

interface CtxOverrides {
  sessionId?: string | null;
  user?: User | null;
  getGmailStatus?: { execute: (i: { userId: string }) => Promise<unknown> };
  disconnectGmail?: { execute: (i: { userId: string }) => Promise<void> };
}

function makeCtx(overrides: CtxOverrides = {}): AppContext {
  const user = overrides.user ?? makeUser();
  const sessionId: string | null =
    "sessionId" in overrides
      ? (overrides.sessionId ?? null)
      : "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const getCurrentUser = {
    execute: vi.fn(async () => {
      if (!user) throw new Error("no user");
      return { user };
    }),
  };
  const getGmailStatus = overrides.getGmailStatus ?? {
    execute: vi.fn(async () => ({ connected: false })),
  };
  const disconnectGmail = overrides.disconnectGmail ?? {
    execute: vi.fn(async () => undefined),
  };

  return {
    sessionId,
    resHeaders: new Headers(),
    prisma: {} as AppContext["prisma"],
    container: {
      getCurrentUser,
      getGmailStatus,
      disconnectGmail,
    } as unknown as AppContext["container"],
  };
}

describe("gmail tRPC router", () => {
  describe("status (query)", () => {
    it("UNAUTHORIZED si no hay sessionId", async () => {
      const ctx = makeCtx({ sessionId: null });
      await expect(
        appRouter.createCaller(ctx).gmail.status(),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("devuelve { connected: false } si no hay integración", async () => {
      const ctx = makeCtx({
        getGmailStatus: {
          execute: vi.fn(async () => ({ connected: false })),
        },
      });
      const result = await appRouter.createCaller(ctx).gmail.status();
      expect(result).toEqual({ connected: false });
    });

    it("devuelve email + connectedAt en ISO si hay integración", async () => {
      const connectedAt = new Date("2026-04-25T10:00:00Z");
      const ctx = makeCtx({
        getGmailStatus: {
          execute: vi.fn(async () => ({
            connected: true,
            googleAccountEmail: "user@gmail.com",
            connectedAt,
          })),
        },
      });
      const result = await appRouter.createCaller(ctx).gmail.status();
      expect(result).toEqual({
        connected: true,
        googleAccountEmail: "user@gmail.com",
        connectedAt: connectedAt.toISOString(),
      });
    });
  });

  describe("disconnect (mutation)", () => {
    it("UNAUTHORIZED si no hay sessionId", async () => {
      const ctx = makeCtx({ sessionId: null });
      await expect(
        appRouter.createCaller(ctx).gmail.disconnect(),
      ).rejects.toBeInstanceOf(TRPCError);
    });

    it("invoca disconnectGmail con el userId del user autenticado", async () => {
      const user = makeUser();
      const disconnectExec = vi.fn(async () => undefined);
      const ctx = makeCtx({
        user,
        disconnectGmail: { execute: disconnectExec },
      });
      const result = await appRouter.createCaller(ctx).gmail.disconnect();
      expect(disconnectExec).toHaveBeenCalledWith({ userId: user.id });
      expect(result).toEqual({ ok: true });
    });

    it("es idempotente: si el use case no lanza, la mutation responde ok", async () => {
      const ctx = makeCtx({
        disconnectGmail: { execute: vi.fn(async () => undefined) },
      });
      await expect(
        appRouter.createCaller(ctx).gmail.disconnect(),
      ).resolves.toEqual({ ok: true });
    });
  });
});
