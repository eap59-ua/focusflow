import { describe, expect, it, vi } from "vitest";

import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import { GetGmailStatus } from "@/application/use-cases/gmail/GetGmailStatus";
import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeRepoWith(integration: GmailIntegration | null) {
  const findByUserId = vi.fn(async () => integration);
  const repo: GmailIntegrationRepositoryPort = {
    save: vi.fn(),
    findByUserId,
    deleteByUserId: vi.fn(),
  };
  return { repo, findByUserId };
}

describe("GetGmailStatus use case", () => {
  it("devuelve { connected: false } cuando no hay integración", async () => {
    const { repo, findByUserId } = makeRepoWith(null);
    const useCase = new GetGmailStatus({ gmailIntegrationRepo: repo });

    const result = await useCase.execute({ userId: USER_ID });

    expect(findByUserId).toHaveBeenCalledWith(USER_ID);
    expect(result).toEqual({ connected: false });
  });

  it("devuelve { connected: true, googleAccountEmail, connectedAt } cuando existe", async () => {
    const integration = GmailIntegration.create({
      userId: USER_ID,
      googleAccountEmail: "test@gmail.com",
      accessToken: EncryptedToken.fromBase64(
        Buffer.from("a").toString("base64"),
      ),
      refreshToken: EncryptedToken.fromBase64(
        Buffer.from("r").toString("base64"),
      ),
      scope: "openid email",
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    const { repo } = makeRepoWith(integration);
    const useCase = new GetGmailStatus({ gmailIntegrationRepo: repo });

    const result = await useCase.execute({ userId: USER_ID });

    expect(result).toEqual({
      connected: true,
      googleAccountEmail: "test@gmail.com",
      connectedAt: integration.connectedAt,
    });
  });
});
