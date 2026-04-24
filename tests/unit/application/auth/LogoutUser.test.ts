import { describe, expect, it, vi } from "vitest";

import type { SessionRepositoryPort } from "@/application/ports/SessionRepositoryPort";
import { LogoutUser } from "@/application/use-cases/auth/LogoutUser";
import { SessionId } from "@/domain/session/SessionId";

const VALID_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeSessionRepo() {
  const save = vi.fn(async () => undefined);
  const findById = vi.fn(async () => null);
  const deleteById = vi.fn(async () => undefined);
  const deleteExpired = vi.fn(async () => 0);
  const repo: SessionRepositoryPort = {
    save,
    findById,
    deleteById,
    deleteExpired,
  };
  return { repo, save, findById, deleteById, deleteExpired };
}

describe("LogoutUser use case", () => {
  it("llama a deleteById con la sesión envuelta en SessionId VO", async () => {
    const { repo, deleteById } = makeSessionRepo();
    const useCase = new LogoutUser({ sessionRepo: repo });

    await useCase.execute({ sessionId: VALID_ID });

    expect(deleteById).toHaveBeenCalledTimes(1);
    expect(deleteById).toHaveBeenCalledWith(expect.any(SessionId));
    expect(deleteById).toHaveBeenCalledWith(
      expect.objectContaining({ value: VALID_ID }),
    );
  });

  it("es idempotente ante sessionId con formato inválido (no llama al repo, no lanza)", async () => {
    const { repo, deleteById } = makeSessionRepo();
    const useCase = new LogoutUser({ sessionRepo: repo });

    await expect(
      useCase.execute({ sessionId: "not-a-valid-hex" }),
    ).resolves.toBeUndefined();

    expect(deleteById).not.toHaveBeenCalled();
  });

  it("no lanza si la sesión ya no existe (delegado al adapter como idempotente)", async () => {
    const { repo, deleteById } = makeSessionRepo();
    const useCase = new LogoutUser({ sessionRepo: repo });

    await expect(
      useCase.execute({ sessionId: VALID_ID }),
    ).resolves.toBeUndefined();
    expect(deleteById).toHaveBeenCalled();
  });
});
