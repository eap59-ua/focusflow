import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import type { OAuthClientPort } from "@/application/ports/OAuthClientPort";
import type { TokenEncryptionPort } from "@/application/ports/TokenEncryptionPort";
import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import type { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";
import { GmailIntegrationNotFoundError } from "@/domain/gmail-integration/errors/GmailIntegrationNotFoundError";

export interface RefreshGmailTokenDependencies {
  readonly gmailIntegrationRepo: GmailIntegrationRepositoryPort;
  readonly tokenEncryption: TokenEncryptionPort;
  readonly oauthClient: OAuthClientPort;
}

export interface RefreshGmailTokenInput {
  readonly userId: string;
}

export interface RefreshGmailTokenOutput {
  readonly integration: GmailIntegration;
}

export class RefreshGmailToken {
  constructor(private readonly deps: RefreshGmailTokenDependencies) {}

  async execute(input: RefreshGmailTokenInput): Promise<RefreshGmailTokenOutput> {
    const integration = await this.deps.gmailIntegrationRepo.findByUserId(
      input.userId,
    );
    if (!integration) {
      throw new GmailIntegrationNotFoundError();
    }

    const refreshTokenPlain = await this.deps.tokenEncryption.decrypt(
      integration.refreshToken.toBase64(),
    );
    const refreshed = await this.deps.oauthClient.refreshAccessToken(
      refreshTokenPlain,
    );
    const newAccessTokenBase64 = await this.deps.tokenEncryption.encrypt(
      refreshed.accessToken,
    );

    const now = new Date();
    const updated = integration.withRefreshedAccessToken({
      accessToken: EncryptedToken.fromBase64(newAccessTokenBase64),
      tokenExpiresAt: new Date(now.getTime() + refreshed.expiresInSeconds * 1000),
      now,
    });
    await this.deps.gmailIntegrationRepo.save(updated);

    return { integration: updated };
  }
}
