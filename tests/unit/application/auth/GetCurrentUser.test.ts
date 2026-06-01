import { describe, expect, it, vi } from "vitest";

import type { SessionRepositoryPort } from "@/application/ports/SessionRepositoryPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { GetCurrentUser } from "@/application/use-cases/auth/GetCurrentUser";
import { Session } from "@/domain/session/Session";
import { SessionId } from "@/domain/session/SessionId";
import { SessionExpiredError } from "@/domain/session/errors/SessionExpiredError";
import { SessionNotFoundError } from "@/domain/session/errors/SessionNotFoundError";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";

const VALID_SESSION_ID =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const USER_ID = "11111111-2222-3333-4444-555555555555";

function makeUser(): User {
  return User.create({
    email: Email.create("user@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake"),
    displayName: "Jane",
  });
}

function makeFreshSession(userId: string): Session {
  return Session.restore({
    id: SessionId.create(VALID_SESSION_ID),
    userId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-12-31T23:59:59.000Z"),
  });
}

function makeExpiredSession(userId: string): Session {
  return Session.restore({
    id: SessionId.create(VALID_SESSION_ID),
    userId,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    expiresAt: new Date("2025-12-31T23:59:59.000Z"),
  });
}

function makeDeps(
  overrides: Partial<{
    sessionFindById: SessionRepositoryPort["findById"];
    sessionDeleteById: SessionRepositoryPort["deleteById"];
    userFindById: UserRepositoryPort["findById"];
    clock: () => Date;
  }> = {},
) {
  const sessionFindById = vi.fn(
    overrides.sessionFindById ?? (async () => null),
  );
  const sessionDeleteById = vi.fn(
    overrides.sessionDeleteById ?? (async () => undefined),
  );
  const sessionSave = vi.fn(async () => undefined);
  const sessionDeleteExpired = vi.fn(async () => 0);
  const userFindById = vi.fn(overrides.userFindById ?? (async () => null));
  const userFindByEmail = vi.fn(async () => null);
  const userSave = vi.fn(async () => undefined);
  const clock = vi.fn(
    overrides.clock ?? (() => new Date("2026-06-01T00:00:00.000Z")),
  );

  const sessionRepo: SessionRepositoryPort = {
    save: sessionSave,
    findById: sessionFindById,
    deleteById: sessionDeleteById,
    deleteExpired: sessionDeleteExpired,
  };
  const userRepo: UserRepositoryPort = {
    findByEmail: userFindByEmail,
    findById: userFindById,
    findAllWithBriefingEnabled: vi.fn(async () => []),
    save: userSave,
  };
  return {
    sessionRepo,
    userRepo,
    clock,
    sessionFindById,
    sessionDeleteById,
    userFindById,
  };
}

describe("GetCurrentUser use case", () => {
  it("happy path: devuelve el user cuando la sesión es válida y no expirada", async () => {
    const user = makeUser();
    const session = makeFreshSession(user.id);
    const deps = makeDeps({
      sessionFindById: async () => session,
      userFindById: async () => user,
    });
    const useCase = new GetCurrentUser(deps);

    const out = await useCase.execute({ sessionId: VALID_SESSION_ID });

    expect(out.user.id).toBe(user.id);
    expect(deps.userFindById).toHaveBeenCalledWith(user.id);
    expect(deps.sessionDeleteById).not.toHaveBeenCalled();
  });

  it("lanza SessionNotFoundError si el sessionId tiene formato inválido", async () => {
    const deps = makeDeps();
    const useCase = new GetCurrentUser(deps);

    await expect(
      useCase.execute({ sessionId: "not-valid-hex" }),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(deps.sessionFindById).not.toHaveBeenCalled();
  });

  it("lanza SessionNotFoundError si la sesión no existe en DB", async () => {
    const deps = makeDeps({ sessionFindById: async () => null });
    const useCase = new GetCurrentUser(deps);

    await expect(
      useCase.execute({ sessionId: VALID_SESSION_ID }),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(deps.userFindById).not.toHaveBeenCalled();
    expect(deps.sessionDeleteById).not.toHaveBeenCalled();
  });

  it("lanza SessionExpiredError y borra la sesión cuando ya expiró", async () => {
    const user = makeUser();
    const expired = makeExpiredSession(user.id);
    const deps = makeDeps({
      sessionFindById: async () => expired,
      userFindById: async () => user,
      clock: () => new Date("2026-06-01T00:00:00.000Z"),
    });
    const useCase = new GetCurrentUser(deps);

    await expect(
      useCase.execute({ sessionId: VALID_SESSION_ID }),
    ).rejects.toBeInstanceOf(SessionExpiredError);
    expect(deps.sessionDeleteById).toHaveBeenCalledTimes(1);
    expect(deps.userFindById).not.toHaveBeenCalled();
  });

  it("lanza SessionNotFoundError y borra la sesión si el user ya no existe pese a sesión válida", async () => {
    const session = makeFreshSession(USER_ID);
    const deps = makeDeps({
      sessionFindById: async () => session,
      userFindById: async () => null,
    });
    const useCase = new GetCurrentUser(deps);

    await expect(
      useCase.execute({ sessionId: VALID_SESSION_ID }),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(deps.sessionDeleteById).toHaveBeenCalledTimes(1);
  });
});
