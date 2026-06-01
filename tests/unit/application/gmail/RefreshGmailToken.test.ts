import { describe, expect, it, vi } from "vitest";

import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import type { OAuthClientPort } from "@/application/ports/OAuthClientPort";
import type { TokenEncryptionPort } from "@/application/ports/TokenEncryptionPort";
import { RefreshGmailToken } from "@/application/use-cases/gmail/RefreshGmailToken";
import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";
import { GmailIntegrationNotFoundError } from "@/domain/gmail-integration/errors/GmailIntegrationNotFoundError";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeIntegration(): GmailIntegration {
  return GmailIntegration.create({
    userId: USER_ID,
    googleAccountEmail: "user@gmail.com",
    accessToken: EncryptedToken.fromBase64(
      Buffer.from("enc-old-access").toString("base64"),
    ),
    refreshToken: EncryptedToken.fromBase64(
      Buffer.from("enc-refresh").toString("base64"),
    ),
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    tokenExpiresAt: new Date("2026-04-25T10:00:00Z"),
  });
}

function makeDeps(
  overrides: Partial<{
    findByUserId: GmailIntegrationRepositoryPort["findByUserId"];
    save: GmailIntegrationRepositoryPort["save"];
    decrypt: TokenEncryptionPort["decrypt"];
    encrypt: TokenEncryptionPort["encrypt"];
    refreshAccessToken: OAuthClientPort["refreshAccessToken"];
  }> = {},
) {
  const findByUserId = vi.fn(
    overrides.findByUserId ?? (async () => makeIntegration()),
  );
  const save = vi.fn(overrides.save ?? (async () => undefined));
  const deleteByUserId = vi.fn(async () => undefined);
  const decrypt = vi.fn(
    overrides.decrypt ?? (async () => "plaintext-refresh-token"),
  );
  const encrypt = vi.fn(
    overrides.encrypt ??
      (async () => Buffer.from("enc-new-access").toString("base64")),
  );
  const refreshAccessToken = vi.fn(
    overrides.refreshAccessToken ??
      (async () => ({ accessToken: "new-access", expiresInSeconds: 3600 })),
  );

  const gmailIntegrationRepo: GmailIntegrationRepositoryPort = {
    save,
    findByUserId,
    deleteByUserId,
  };
  const tokenEncryption: TokenEncryptionPort = { encrypt, decrypt };
  const oauthClient: OAuthClientPort = {
    generateAuthUrl: vi.fn(() => ""),
    exchangeCode: vi.fn(),
    refreshAccessToken,
  };

  return {
    deps: { gmailIntegrationRepo, tokenEncryption, oauthClient },
    findByUserId,
    save,
    decrypt,
    encrypt,
    refreshAccessToken,
  };
}

describe("RefreshGmailToken use case", () => {
  it("happy path: load → decrypt(refresh) → google refresh → encrypt(access) → save con lastRefreshedAt actualizado", async () => {
    const { deps, findByUserId, decrypt, refreshAccessToken, encrypt, save } =
      makeDeps();
    const useCase = new RefreshGmailToken(deps);

    const before = Date.now();
    const { integration } = await useCase.execute({ userId: USER_ID });
    const after = Date.now();

    expect(findByUserId).toHaveBeenCalledWith(USER_ID);
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).toHaveBeenCalledWith("plaintext-refresh-token");
    expect(encrypt).toHaveBeenCalledWith("new-access");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(integration);

    expect(integration.lastRefreshedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(integration.lastRefreshedAt.getTime()).toBeLessThanOrEqual(after);
    expect(integration.tokenExpiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 3600 * 1000,
    );
  });

  it("falla con GmailIntegrationNotFoundError si no hay integración del user", async () => {
    const { deps, decrypt, refreshAccessToken, encrypt, save } = makeDeps({
      findByUserId: async () => null,
    });
    const useCase = new RefreshGmailToken(deps);

    await expect(useCase.execute({ userId: USER_ID })).rejects.toBeInstanceOf(
      GmailIntegrationNotFoundError,
    );

    expect(decrypt).not.toHaveBeenCalled();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("propaga errores del oauthClient sin corromper la DB (no save)", async () => {
    const googleErr = new Error("google: refresh_token_revoked");
    const { deps, save, encrypt } = makeDeps({
      refreshAccessToken: async () => {
        throw googleErr;
      },
    });
    const useCase = new RefreshGmailToken(deps);

    await expect(useCase.execute({ userId: USER_ID })).rejects.toBe(googleErr);
    expect(encrypt).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("propaga errores de save", async () => {
    const dbErr = new Error("db down");
    const { deps } = makeDeps({
      save: async () => {
        throw dbErr;
      },
    });
    const useCase = new RefreshGmailToken(deps);

    await expect(useCase.execute({ userId: USER_ID })).rejects.toBe(dbErr);
  });
});
