import { describe, expect, it, vi } from "vitest";

import type { EmailFetcherPort } from "@/application/ports/EmailFetcherPort";
import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import type { TokenEncryptionPort } from "@/application/ports/TokenEncryptionPort";
import { FetchInboxEmails } from "@/application/use-cases/email/FetchInboxEmails";
import type { RefreshGmailToken } from "@/application/use-cases/gmail/RefreshGmailToken";
import { EmailMessage } from "@/domain/email-message/EmailMessage";
import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";
import { GmailIntegrationNotFoundError } from "@/domain/gmail-integration/errors/GmailIntegrationNotFoundError";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function makeIntegration(opts: { expired?: boolean } = {}) {
  const expiresAt = opts.expired
    ? new Date(Date.now() - 60_000)
    : new Date(Date.now() + 60 * 60 * 1000);
  return GmailIntegration.create({
    userId: USER_ID,
    googleAccountEmail: "user@gmail.com",
    accessToken: EncryptedToken.fromBase64(
      Buffer.from("enc-access").toString("base64"),
    ),
    refreshToken: EncryptedToken.fromBase64(
      Buffer.from("enc-refresh").toString("base64"),
    ),
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    tokenExpiresAt: expiresAt,
  });
}

function makeEmail(messageIdHeader: string, id?: string): EmailMessage {
  return EmailMessage.create({
    id: id ?? messageIdHeader,
    messageIdHeader,
    threadId: "thread-1",
    subject: "Subject",
    fromEmail: "alice@example.com",
    fromName: "Alice",
    toEmails: ["me@gmail.com"],
    snippet: "snippet",
    receivedAt: new Date("2026-04-25T08:00:00Z"),
    bodyText: "body",
  });
}

interface FakeDeps {
  findByUserId: ReturnType<typeof vi.fn>;
  decrypt: ReturnType<typeof vi.fn>;
  fetchInbox: ReturnType<typeof vi.fn>;
  refreshExecute: ReturnType<typeof vi.fn>;
}

function makeUseCase(
  fakes: Partial<{
    integrationByUserId: () => Promise<GmailIntegration | null>;
    refreshedIntegration: () => Promise<GmailIntegration | null>;
    fetched: () => Promise<readonly EmailMessage[]>;
    decrypted: () => Promise<string>;
    refreshError: Error;
  }> = {},
): { useCase: FetchInboxEmails; deps: FakeDeps } {
  const callsFindByUserId = { count: 0 };
  const findByUserId = vi.fn(async (id: string) => {
    callsFindByUserId.count += 1;
    if (callsFindByUserId.count === 1) {
      return fakes.integrationByUserId
        ? await fakes.integrationByUserId()
        : makeIntegration();
    }
    return fakes.refreshedIntegration
      ? await fakes.refreshedIntegration()
      : makeIntegration();
  });
  const decrypt = vi.fn(
    async () => (fakes.decrypted ? await fakes.decrypted() : "plain-access-token"),
  );
  const fetchInbox = vi.fn(
    async () =>
      fakes.fetched
        ? await fakes.fetched()
        : ([makeEmail("<m1@example.com>")] as readonly EmailMessage[]),
  );
  const refreshExecute = vi.fn(async () => {
    if (fakes.refreshError) throw fakes.refreshError;
    return { integration: makeIntegration() };
  });

  const repo: GmailIntegrationRepositoryPort = {
    save: vi.fn(),
    findByUserId,
    deleteByUserId: vi.fn(),
  };
  const enc: TokenEncryptionPort = { encrypt: vi.fn(), decrypt };
  const fetcher: EmailFetcherPort = { fetchInbox };
  const refresh = { execute: refreshExecute } as unknown as RefreshGmailToken;

  const useCase = new FetchInboxEmails({
    gmailIntegrationRepo: repo,
    tokenEncryption: enc,
    emailFetcher: fetcher,
    refreshGmailToken: refresh,
  });

  return {
    useCase,
    deps: { findByUserId, decrypt, fetchInbox, refreshExecute },
  };
}

describe("FetchInboxEmails use case", () => {
  it("happy path: token vigente → no llama refresh → fetch + retorna emails", async () => {
    const { useCase, deps } = makeUseCase();
    const result = await useCase.execute({ userId: USER_ID });

    expect(deps.findByUserId).toHaveBeenCalledTimes(1);
    expect(deps.refreshExecute).not.toHaveBeenCalled();
    expect(deps.decrypt).toHaveBeenCalledTimes(1);
    expect(deps.fetchInbox).toHaveBeenCalledWith({
      accessToken: "plain-access-token",
      query: "in:inbox newer_than:1d",
      maxResults: 50,
    });
    expect(result.emails).toHaveLength(1);
    expect(result.integrationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("token expirado: dispara RefreshGmailToken y recarga la integración", async () => {
    const { useCase, deps } = makeUseCase({
      integrationByUserId: async () => makeIntegration({ expired: true }),
      refreshedIntegration: async () => makeIntegration(),
    });

    await useCase.execute({ userId: USER_ID });

    expect(deps.refreshExecute).toHaveBeenCalledWith({ userId: USER_ID });
    expect(deps.findByUserId).toHaveBeenCalledTimes(2);
    expect(deps.fetchInbox).toHaveBeenCalled();
  });

  it("sin integración: GmailIntegrationNotFoundError, no llama refresh ni fetch", async () => {
    const { useCase, deps } = makeUseCase({
      integrationByUserId: async () => null,
    });

    await expect(useCase.execute({ userId: USER_ID })).rejects.toBeInstanceOf(
      GmailIntegrationNotFoundError,
    );
    expect(deps.refreshExecute).not.toHaveBeenCalled();
    expect(deps.fetchInbox).not.toHaveBeenCalled();
  });

  it("refresh falla: propaga el error sin tocar fetch", async () => {
    const refreshErr = new Error("google: refresh_token_revoked");
    const { useCase, deps } = makeUseCase({
      integrationByUserId: async () => makeIntegration({ expired: true }),
      refreshError: refreshErr,
    });

    await expect(useCase.execute({ userId: USER_ID })).rejects.toBe(refreshErr);
    expect(deps.fetchInbox).not.toHaveBeenCalled();
  });

  it("dedup: emails con mismo messageIdHeader aparecen una sola vez en output", async () => {
    const { useCase } = makeUseCase({
      fetched: async () => [
        makeEmail("<dup@example.com>", "id-1"),
        makeEmail("<dup@example.com>", "id-2"),
        makeEmail("<unique@example.com>", "id-3"),
      ],
    });

    const result = await useCase.execute({ userId: USER_ID });
    expect(result.emails).toHaveLength(2);
    expect(result.emails.map((e) => e.messageIdHeader)).toEqual([
      "<dup@example.com>",
      "<unique@example.com>",
    ]);
  });

  it("si recibe `since`, construye query con after:<unix-seconds>", async () => {
    const { useCase, deps } = makeUseCase();
    const since = new Date("2026-04-24T08:00:00Z");
    await useCase.execute({ userId: USER_ID, since });

    const call = deps.fetchInbox.mock.calls[0]![0] as {
      query: string;
    };
    expect(call.query).toMatch(/^in:inbox after:\d+$/);
    expect(call.query).toBe(
      `in:inbox after:${Math.floor(since.getTime() / 1000)}`,
    );
  });
});
