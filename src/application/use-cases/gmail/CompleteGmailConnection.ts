import type { BriefingSchedulerPort } from "@/application/ports/BriefingSchedulerPort";
import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import type { OAuthClientPort } from "@/application/ports/OAuthClientPort";
import type { OAuthStateStorePort } from "@/application/ports/OAuthStateStorePort";
import type { TokenEncryptionPort } from "@/application/ports/TokenEncryptionPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";
import { OAuthStateMismatchError } from "@/domain/gmail-integration/errors/OAuthStateMismatchError";

export interface CompleteGmailConnectionDependencies {
  readonly oauthStateStore: OAuthStateStorePort;
  readonly oauthClient: OAuthClientPort;
  readonly tokenEncryption: TokenEncryptionPort;
  readonly gmailIntegrationRepo: GmailIntegrationRepositoryPort;
  readonly userRepo: UserRepositoryPort;
  readonly scheduler: BriefingSchedulerPort;
  readonly defaultBriefingHour: number;
  readonly defaultBriefingTimezone: string;
}

export interface CompleteGmailConnectionInput {
  readonly userId: string;
  readonly code: string;
  readonly state: string;
}

export interface CompleteGmailConnectionOutput {
  readonly integration: GmailIntegration;
}

export class CompleteGmailConnection {
  constructor(private readonly deps: CompleteGmailConnectionDependencies) {}

  async execute(
    input: CompleteGmailConnectionInput,
  ): Promise<CompleteGmailConnectionOutput> {
    const consumed = await this.deps.oauthStateStore.consume(input.state);
    if (!consumed || consumed.userId !== input.userId) {
      throw new OAuthStateMismatchError();
    }

    const exchange = await this.deps.oauthClient.exchangeCode(input.code);

    const accessTokenBase64 = await this.deps.tokenEncryption.encrypt(
      exchange.accessToken,
    );
    const refreshTokenBase64 = await this.deps.tokenEncryption.encrypt(
      exchange.refreshToken,
    );

    const integration = GmailIntegration.create({
      userId: input.userId,
      googleAccountEmail: exchange.googleAccountEmail,
      accessToken: EncryptedToken.fromBase64(accessTokenBase64),
      refreshToken: EncryptedToken.fromBase64(refreshTokenBase64),
      scope: exchange.scope,
      tokenExpiresAt: new Date(Date.now() + exchange.expiresInSeconds * 1000),
    });
    await this.deps.gmailIntegrationRepo.save(integration);

    const user = await this.deps.userRepo.findById(input.userId);
    if (user) {
      const enabled = user.enableBriefing(
        this.deps.defaultBriefingHour,
        this.deps.defaultBriefingTimezone,
      );
      await this.deps.userRepo.save(enabled);
      await this.deps.scheduler.scheduleForUser(enabled);
    }

    return { integration };
  }
}
