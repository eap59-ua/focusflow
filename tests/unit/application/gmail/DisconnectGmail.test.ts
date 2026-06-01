import { describe, expect, it, vi } from "vitest";

import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import { DisconnectGmail } from "@/application/use-cases/gmail/DisconnectGmail";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeRepo() {
  const save = vi.fn(async () => undefined);
  const findByUserId = vi.fn(async () => null);
  const deleteByUserId = vi.fn(async () => undefined);
  const repo: GmailIntegrationRepositoryPort = {
    save,
    findByUserId,
    deleteByUserId,
  };
  return { repo, deleteByUserId };
}

describe("DisconnectGmail use case", () => {
  it("delega en repo.deleteByUserId", async () => {
    const { repo, deleteByUserId } = makeRepo();
    const useCase = new DisconnectGmail({ gmailIntegrationRepo: repo });

    await useCase.execute({ userId: USER_ID });

    expect(deleteByUserId).toHaveBeenCalledTimes(1);
    expect(deleteByUserId).toHaveBeenCalledWith(USER_ID);
  });

  it("es idempotente: si el repo no lanza al borrar inexistente, el use case tampoco lanza", async () => {
    const { repo } = makeRepo();
    const useCase = new DisconnectGmail({ gmailIntegrationRepo: repo });

    await expect(useCase.execute({ userId: USER_ID })).resolves.toBeUndefined();
  });
});
