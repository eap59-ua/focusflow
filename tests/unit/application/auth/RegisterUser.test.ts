import { describe, expect, it, vi } from "vitest";

import type { PasswordHasherPort } from "@/application/ports/PasswordHasherPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { RegisterUser } from "@/application/use-cases/auth/RegisterUser";
import { Email } from "@/domain/user/Email";
import type { User } from "@/domain/user/User";
import { EmailAlreadyRegisteredError } from "@/domain/user/errors/EmailAlreadyRegisteredError";
import { InvalidEmailError } from "@/domain/user/errors/InvalidEmailError";
import { WeakPasswordError } from "@/domain/user/errors/WeakPasswordError";

function makeDeps(
  overrides: Partial<{
    findByEmail: UserRepositoryPort["findByEmail"];
    findById: UserRepositoryPort["findById"];
    save: UserRepositoryPort["save"];
    hash: PasswordHasherPort["hash"];
    verify: PasswordHasherPort["verify"];
  }> = {},
) {
  const findByEmail = vi.fn(overrides.findByEmail ?? (async () => null));
  const findById = vi.fn(overrides.findById ?? (async () => null));
  const save = vi.fn(overrides.save ?? (async () => undefined));
  const hash = vi.fn(overrides.hash ?? (async () => "$2a$10$hashed"));
  const verify = vi.fn(overrides.verify ?? (async () => true));

  const userRepo: UserRepositoryPort = { findByEmail, findById, save };
  const hasher: PasswordHasherPort = { hash, verify };
  return { userRepo, hasher, findByEmail, findById, save, hash, verify };
}

const validInput = {
  email: "user@example.com",
  password: "correcthorse",
  displayName: "Jane Doe",
};

describe("RegisterUser use case", () => {
  it("happy path: hashea la password, crea el usuario y lo persiste", async () => {
    const deps = makeDeps();
    const useCase = new RegisterUser(deps);

    const user = await useCase.execute(validInput);

    expect(user.email.value).toBe("user@example.com");
    expect(user.displayName).toBe("Jane Doe");
    expect(deps.findByEmail).toHaveBeenCalledWith(expect.any(Email));
    expect(deps.hash).toHaveBeenCalledWith("correcthorse");
    expect(deps.save).toHaveBeenCalledWith(user);
  });

  it("falla con InvalidEmailError si el email no tiene formato válido", async () => {
    const deps = makeDeps();
    const useCase = new RegisterUser(deps);

    await expect(
      useCase.execute({ ...validInput, email: "not-an-email" }),
    ).rejects.toBeInstanceOf(InvalidEmailError);

    expect(deps.hash).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("falla con WeakPasswordError si la password tiene menos de 8 caracteres", async () => {
    const deps = makeDeps();
    const useCase = new RegisterUser(deps);

    await expect(
      useCase.execute({ ...validInput, password: "short" }),
    ).rejects.toBeInstanceOf(WeakPasswordError);

    expect(deps.hash).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("falla con EmailAlreadyRegisteredError cuando findByEmail devuelve un usuario existente", async () => {
    const existing = { id: "existing-user-id" } as unknown as User;
    const deps = makeDeps({ findByEmail: async () => existing });
    const useCase = new RegisterUser(deps);

    await expect(useCase.execute(validInput)).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );

    expect(deps.hash).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });
});
