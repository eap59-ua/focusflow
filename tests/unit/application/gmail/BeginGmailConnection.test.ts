import { describe, expect, it, vi } from "vitest";

import type { OAuthClientPort } from "@/application/ports/OAuthClientPort";
import type { OAuthStateStorePort } from "@/application/ports/OAuthStateStorePort";
import { BeginGmailConnection } from "@/application/use-cases/gmail/BeginGmailConnection";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeDeps(
  overrides: Partial<{
    save: OAuthStateStorePort["save"];
    consume: OAuthStateStorePort["consume"];
    generateAuthUrl: OAuthClientPort["generateAuthUrl"];
    exchangeCode: OAuthClientPort["exchangeCode"];
    refreshAccessToken: OAuthClientPort["refreshAccessToken"];
  }> = {},
) {
  const save = vi.fn(overrides.save ?? (async () => undefined));
  const consume = vi.fn(overrides.consume ?? (async () => null));
  const generateAuthUrl = vi.fn(
    overrides.generateAuthUrl ??
      ((state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
  );
  const exchangeCode = vi.fn(
    overrides.exchangeCode ??
      (async () => {
        throw new Error("not used in BeginGmailConnection");
      }),
  );
  const refreshAccessToken = vi.fn(
    overrides.refreshAccessToken ??
      (async () => {
        throw new Error("not used in BeginGmailConnection");
      }),
  );

  const oauthStateStore: OAuthStateStorePort = { save, consume };
  const oauthClient: OAuthClientPort = {
    generateAuthUrl,
    exchangeCode,
    refreshAccessToken,
  };
  return { oauthStateStore, oauthClient, save, generateAuthUrl };
}

describe("BeginGmailConnection use case", () => {
  it("genera state hex 64 chars, lo persiste con TTL 600 y devuelve la authorizeUrl del client", async () => {
    const deps = makeDeps();
    const useCase = new BeginGmailConnection(deps);

    const { authorizeUrl } = await useCase.execute({ userId: USER_ID });

    expect(deps.save).toHaveBeenCalledTimes(1);
    const [state, userIdArg, ttl] = deps.save.mock.calls[0]!;
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(userIdArg).toBe(USER_ID);
    expect(ttl).toBe(600);

    expect(deps.generateAuthUrl).toHaveBeenCalledTimes(1);
    const [stateForUrl, scopes] = deps.generateAuthUrl.mock.calls[0]!;
    expect(stateForUrl).toBe(state);
    expect(scopes).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);

    expect(authorizeUrl).toContain(`state=${state}`);
  });

  it("genera un state distinto en cada invocación", async () => {
    const deps = makeDeps();
    const useCase = new BeginGmailConnection(deps);

    await useCase.execute({ userId: USER_ID });
    await useCase.execute({ userId: USER_ID });

    const state1 = deps.save.mock.calls[0]![0];
    const state2 = deps.save.mock.calls[1]![0];
    expect(state1).not.toBe(state2);
  });
});
