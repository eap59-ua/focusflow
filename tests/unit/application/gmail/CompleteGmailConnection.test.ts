import { describe, expect, it, vi } from "vitest";

import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import type { OAuthClientPort } from "@/application/ports/OAuthClientPort";
import type { OAuthStateStorePort } from "@/application/ports/OAuthStateStorePort";
import type { TokenEncryptionPort } from "@/application/ports/TokenEncryptionPort";
import { CompleteGmailConnection } from "@/application/use-cases/gmail/CompleteGmailConnection";
import { OAuthStateMismatchError } from "@/domain/gmail-integration/errors/OAuthStateMismatchError";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const STATE = "abcd1234";
const CODE = "auth-code-from-google";

function fakeExchangeResult() {
  return {
    accessToken: "ya29.plaintext-access",
    refreshToken: "1//plaintext-refresh",
    expiresInSeconds: 3600,
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    googleAccountEmail: "user@gmail.com",
  };
}

function makeDeps(
  overrides: Partial<{
    consume: OAuthStateStorePort["consume"];
    exchangeCode: OAuthClientPort["exchangeCode"];
    encrypt: TokenEncryptionPort["encrypt"];
    save: GmailIntegrationRepositoryPort["save"];
  }> = {},
) {
  const consume = vi.fn(
    overrides.consume ?? (async () => ({ userId: USER_ID })),
  );
  const exchangeCode = vi.fn(
    overrides.exchangeCode ?? (async () => fakeExchangeResult()),
  );
  // Producimos un base64 distinto para cada llamada para distinguir access vs refresh.
  let encryptCall = 0;
  const encrypt = vi.fn(
    overrides.encrypt ??
      (async (plain: string) => {
        encryptCall += 1;
        return Buffer.from(`enc-${encryptCall}-${plain}`).toString("base64");
      }),
  );
  const decrypt = vi.fn(async () => "");
  const save = vi.fn(overrides.save ?? (async () => undefined));
  const findByUserId = vi.fn(async () => null);
  const deleteByUserId = vi.fn(async () => undefined);

  const oauthStateStore: OAuthStateStorePort = {
    save: vi.fn(async () => undefined),
    consume,
  };
  const oauthClient: OAuthClientPort = {
    generateAuthUrl: vi.fn(() => ""),
    exchangeCode,
    refreshAccessToken: vi.fn(),
  };
  const tokenEncryption: TokenEncryptionPort = { encrypt, decrypt };
  const gmailIntegrationRepo: GmailIntegrationRepositoryPort = {
    save,
    findByUserId,
    deleteByUserId,
  };
  const userRepo: import("@/application/ports/UserRepositoryPort").UserRepositoryPort =
    {
      findByEmail: vi.fn(),
      findById: vi.fn(async () => null),
      findAllWithBriefingEnabled: vi.fn(async () => []),
      save: vi.fn(),
    };
  const scheduler: import("@/application/ports/BriefingSchedulerPort").BriefingSchedulerPort =
    {
      scheduleForUser: vi.fn(),
      unscheduleForUser: vi.fn(),
      triggerNow: vi.fn(),
    };

  return {
    deps: {
      oauthStateStore,
      oauthClient,
      tokenEncryption,
      gmailIntegrationRepo,
      userRepo,
      scheduler,
      defaultBriefingHour: 8,
      defaultBriefingTimezone: "Europe/Madrid",
    },
    consume,
    exchangeCode,
    encrypt,
    save,
  };
}

describe("CompleteGmailConnection use case", () => {
  it("happy path: consume → exchange → encrypt(access+refresh) → save GmailIntegration con tokens cifrados", async () => {
    const { deps, consume, exchangeCode, encrypt, save } = makeDeps();
    const useCase = new CompleteGmailConnection(deps);

    const { integration } = await useCase.execute({
      userId: USER_ID,
      code: CODE,
      state: STATE,
    });

    expect(consume).toHaveBeenCalledWith(STATE);
    expect(exchangeCode).toHaveBeenCalledWith(CODE);

    expect(encrypt).toHaveBeenCalledTimes(2);
    expect(encrypt).toHaveBeenNthCalledWith(1, "ya29.plaintext-access");
    expect(encrypt).toHaveBeenNthCalledWith(2, "1//plaintext-refresh");

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(integration);

    expect(integration.userId).toBe(USER_ID);
    expect(integration.googleAccountEmail).toBe("user@gmail.com");
    expect(integration.scope).toContain("gmail.readonly");
    // Tokens guardados son los DEVUELTOS por encrypt (ya cifrados), no los plaintext.
    expect(integration.accessToken.toBase64()).not.toContain("ya29");
    expect(integration.refreshToken.toBase64()).not.toContain("plaintext");
  });

  it("encripta antes de save (orden de llamadas)", async () => {
    const order: string[] = [];
    const consume = vi.fn(async () => ({ userId: USER_ID }));
    const exchangeCode = vi.fn(async () => fakeExchangeResult());
    const encrypt = vi.fn(async (plain: string) => {
      order.push("encrypt");
      return Buffer.from(`e-${plain}`).toString("base64");
    });
    const save = vi.fn(async () => {
      order.push("save");
    });

    const { deps } = makeDeps();
    const useCase = new CompleteGmailConnection({
      ...deps,
      oauthStateStore: { ...deps.oauthStateStore, consume },
      oauthClient: { ...deps.oauthClient, exchangeCode },
      tokenEncryption: { ...deps.tokenEncryption, encrypt },
      gmailIntegrationRepo: { ...deps.gmailIntegrationRepo, save },
    });

    await useCase.execute({ userId: USER_ID, code: CODE, state: STATE });

    // Las dos llamadas a encrypt deben preceder a save.
    expect(order).toEqual(["encrypt", "encrypt", "save"]);
  });

  it("falla con OAuthStateMismatchError si consume devuelve null", async () => {
    const { deps, consume, exchangeCode, encrypt, save } = makeDeps({
      consume: async () => null,
    });
    const useCase = new CompleteGmailConnection(deps);

    await expect(
      useCase.execute({ userId: USER_ID, code: CODE, state: STATE }),
    ).rejects.toBeInstanceOf(OAuthStateMismatchError);

    expect(consume).toHaveBeenCalled();
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("falla con OAuthStateMismatchError si el state pertenece a otro user", async () => {
    const { deps, consume, exchangeCode, encrypt, save } = makeDeps({
      consume: async () => ({ userId: "otro-user-distinto" }),
    });
    const useCase = new CompleteGmailConnection(deps);

    await expect(
      useCase.execute({ userId: USER_ID, code: CODE, state: STATE }),
    ).rejects.toBeInstanceOf(OAuthStateMismatchError);

    expect(consume).toHaveBeenCalled();
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("propaga errores de exchangeCode sin llamar a encrypt ni save", async () => {
    const exchangeError = new Error("google: invalid_grant");
    const { deps, encrypt, save } = makeDeps({
      exchangeCode: async () => {
        throw exchangeError;
      },
    });
    const useCase = new CompleteGmailConnection(deps);

    await expect(
      useCase.execute({ userId: USER_ID, code: CODE, state: STATE }),
    ).rejects.toBe(exchangeError);

    expect(encrypt).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("propaga errores de save sin tragárselos", async () => {
    const saveError = new Error("db down");
    const { deps } = makeDeps({
      save: async () => {
        throw saveError;
      },
    });
    const useCase = new CompleteGmailConnection(deps);

    await expect(
      useCase.execute({ userId: USER_ID, code: CODE, state: STATE }),
    ).rejects.toBe(saveError);
  });

  it("calcula tokenExpiresAt = now + expiresInSeconds (con tolerancia 1s)", async () => {
    const { deps } = makeDeps();
    const useCase = new CompleteGmailConnection(deps);

    const before = Date.now();
    const { integration } = await useCase.execute({
      userId: USER_ID,
      code: CODE,
      state: STATE,
    });
    const after = Date.now();

    const expiresMs = integration.tokenExpiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + 3600 * 1000);
  });
});
