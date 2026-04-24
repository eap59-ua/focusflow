import { describe, expect, it, vi } from "vitest";

import type { PasswordHasherPort } from "@/application/ports/PasswordHasherPort";
import type { SessionRepositoryPort } from "@/application/ports/SessionRepositoryPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { LoginUser } from "@/application/use-cases/auth/LoginUser";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { InvalidCredentialsError } from "@/domain/user/errors/InvalidCredentialsError";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makePersistedUser() {
  return User.create({
    email: Email.create("user@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake-hash"),
    displayName: "Jane",
  });
}

function makeDeps(
  overrides: Partial<{
    findByEmail: UserRepositoryPort["findByEmail"];
    findById: UserRepositoryPort["findById"];
    save: UserRepositoryPort["save"];
    hash: PasswordHasherPort["hash"];
    verify: PasswordHasherPort["verify"];
    sessionSave: SessionRepositoryPort["save"];
    sessionFindById: SessionRepositoryPort["findById"];
    sessionDeleteById: SessionRepositoryPort["deleteById"];
    sessionDeleteExpired: SessionRepositoryPort["deleteExpired"];
    sessionLifetimeDays: number;
  }> = {},
) {
  const findByEmail = vi.fn(overrides.findByEmail ?? (async () => null));
  const findById = vi.fn(overrides.findById ?? (async () => null));
  const userSave = vi.fn(overrides.save ?? (async () => undefined));
  const hash = vi.fn(overrides.hash ?? (async () => "$2a$10$fake-hash"));
  const verify = vi.fn(overrides.verify ?? (async () => true));
  const sessionSave = vi.fn(
    overrides.sessionSave ?? (async () => undefined),
  );
  const sessionFindById = vi.fn(
    overrides.sessionFindById ?? (async () => null),
  );
  const sessionDeleteById = vi.fn(
    overrides.sessionDeleteById ?? (async () => undefined),
  );
  const sessionDeleteExpired = vi.fn(
    overrides.sessionDeleteExpired ?? (async () => 0),
  );

  const userRepo: UserRepositoryPort = {
    findByEmail,
    findById,
    save: userSave,
  };
  const hasher: PasswordHasherPort = { hash, verify };
  const sessionRepo: SessionRepositoryPort = {
    save: sessionSave,
    findById: sessionFindById,
    deleteById: sessionDeleteById,
    deleteExpired: sessionDeleteExpired,
  };

  return {
    userRepo,
    hasher,
    sessionRepo,
    sessionLifetimeDays: overrides.sessionLifetimeDays ?? 30,
    findByEmail,
    verify,
    sessionSave,
  };
}

const validInput = { email: "user@example.com", password: "correcthorse" };

describe("LoginUser use case", () => {
  it("happy path: devuelve una Session nueva asociada al user y la persiste", async () => {
    const user = makePersistedUser();
    const deps = makeDeps({ findByEmail: async () => user });
    const useCase = new LoginUser(deps);

    const { session } = await useCase.execute(validInput);

    expect(session.userId).toBe(user.id);
    expect(session.id.value).toMatch(/^[0-9a-f]{64}$/);
    expect(deps.findByEmail).toHaveBeenCalledWith(expect.any(Email));
    expect(deps.verify).toHaveBeenCalledWith(
      "correcthorse",
      user.hashedPassword,
    );
    expect(deps.sessionSave).toHaveBeenCalledWith(session);
  });

  it("fija expiresAt = createdAt + sessionLifetimeDays (cargado de config, no hardcoded)", async () => {
    const user = makePersistedUser();
    const deps = makeDeps({
      findByEmail: async () => user,
      sessionLifetimeDays: 7,
    });
    const useCase = new LoginUser(deps);

    const { session } = await useCase.execute(validInput);

    const diff =
      session.expiresAt.getTime() - session.createdAt.getTime();
    expect(diff).toBe(7 * MS_PER_DAY);
  });

  it("falla con InvalidCredentialsError cuando el email no está registrado", async () => {
    const deps = makeDeps({ findByEmail: async () => null });
    const useCase = new LoginUser(deps);

    await expect(useCase.execute(validInput)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.sessionSave).not.toHaveBeenCalled();
  });

  it("falla con InvalidCredentialsError cuando la password no coincide (no filtra si el email existe)", async () => {
    const user = makePersistedUser();
    const deps = makeDeps({
      findByEmail: async () => user,
      verify: async () => false,
    });
    const useCase = new LoginUser(deps);

    await expect(useCase.execute(validInput)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(deps.sessionSave).not.toHaveBeenCalled();
  });

  it("falla con InvalidCredentialsError si el email tiene formato inválido (no revela causa específica)", async () => {
    const deps = makeDeps();
    const useCase = new LoginUser(deps);

    await expect(
      useCase.execute({ email: "not-an-email", password: "x" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(deps.findByEmail).not.toHaveBeenCalled();
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.sessionSave).not.toHaveBeenCalled();
  });
});
