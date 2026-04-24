import { describe, expect, it } from "vitest";

import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { InvalidDisplayNameError } from "@/domain/user/errors/InvalidDisplayNameError";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validInput(overrides: Partial<{ displayName: string }> = {}) {
  return {
    email: Email.create("user@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$abcdefghijklmnopqrstuv"),
    displayName: "Jane Doe",
    ...overrides,
  };
}

describe("User aggregate", () => {
  it("User.create con datos válidos construye el agregado con id UUID y timestamps", () => {
    const user = User.create(validInput());

    expect(user.id).toMatch(UUID_V4);
    expect(user.email.value).toBe("user@example.com");
    expect(user.displayName).toBe("Jane Doe");
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
    expect(user.createdAt.getTime()).toBe(user.updatedAt.getTime());
  });

  it("genera ids distintos en llamadas sucesivas", () => {
    const a = User.create(validInput());
    const b = User.create(validInput());
    expect(a.id).not.toBe(b.id);
  });

  it("acepta displayName de longitud 100 (límite exacto)", () => {
    const name = "a".repeat(100);
    const user = User.create(validInput({ displayName: name }));
    expect(user.displayName).toBe(name);
  });

  it("rechaza displayName vacío", () => {
    expect(() => User.create(validInput({ displayName: "" }))).toThrow(
      InvalidDisplayNameError,
    );
  });

  it("rechaza displayName que solo contiene espacios", () => {
    expect(() => User.create(validInput({ displayName: "   " }))).toThrow(
      InvalidDisplayNameError,
    );
  });

  it("rechaza displayName de longitud 101", () => {
    const name = "a".repeat(101);
    expect(() => User.create(validInput({ displayName: name }))).toThrow(
      InvalidDisplayNameError,
    );
  });

  it("User.restore reconstruye el agregado con los props dados sin ejecutar invariantes", () => {
    const createdAt = new Date("2026-01-01T10:00:00.000Z");
    const updatedAt = new Date("2026-01-02T10:00:00.000Z");
    const user = User.restore({
      id: "11111111-2222-3333-4444-555555555555",
      email: Email.create("persisted@example.com"),
      hashedPassword: HashedPassword.fromHash("$2a$10$persisted"),
      displayName: "Persisted",
      createdAt,
      updatedAt,
    });

    expect(user.id).toBe("11111111-2222-3333-4444-555555555555");
    expect(user.email.value).toBe("persisted@example.com");
    expect(user.displayName).toBe("Persisted");
    expect(user.createdAt).toBe(createdAt);
    expect(user.updatedAt).toBe(updatedAt);
  });
});
