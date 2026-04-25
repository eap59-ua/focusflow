import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";

const DEFAULT_SKEW_SECONDS = 30;

export interface GmailIntegrationProps {
  readonly id: string;
  readonly userId: string;
  readonly googleAccountEmail: string;
  readonly accessToken: EncryptedToken;
  readonly refreshToken: EncryptedToken;
  readonly scope: string;
  readonly tokenExpiresAt: Date;
  readonly connectedAt: Date;
  readonly lastRefreshedAt: Date;
}

export interface CreateGmailIntegrationInput {
  readonly userId: string;
  readonly googleAccountEmail: string;
  readonly accessToken: EncryptedToken;
  readonly refreshToken: EncryptedToken;
  readonly scope: string;
  readonly tokenExpiresAt: Date;
}

export interface RefreshAccessTokenInput {
  readonly accessToken: EncryptedToken;
  readonly tokenExpiresAt: Date;
  readonly now: Date;
}

export class GmailIntegration {
  private constructor(private readonly props: GmailIntegrationProps) {}

  static create(input: CreateGmailIntegrationInput): GmailIntegration {
    const now = new Date();
    return new GmailIntegration({
      id: crypto.randomUUID(),
      userId: input.userId,
      googleAccountEmail: input.googleAccountEmail,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      scope: input.scope,
      tokenExpiresAt: input.tokenExpiresAt,
      connectedAt: now,
      lastRefreshedAt: now,
    });
  }

  static restore(props: GmailIntegrationProps): GmailIntegration {
    return new GmailIntegration(props);
  }

  isAccessTokenExpired(now: Date, skewSeconds: number = DEFAULT_SKEW_SECONDS): boolean {
    const expiresAtMs = this.props.tokenExpiresAt.getTime();
    return now.getTime() + skewSeconds * 1000 >= expiresAtMs;
  }

  withRefreshedAccessToken(input: RefreshAccessTokenInput): GmailIntegration {
    return new GmailIntegration({
      ...this.props,
      accessToken: input.accessToken,
      tokenExpiresAt: input.tokenExpiresAt,
      lastRefreshedAt: input.now,
    });
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get googleAccountEmail(): string {
    return this.props.googleAccountEmail;
  }

  get accessToken(): EncryptedToken {
    return this.props.accessToken;
  }

  get refreshToken(): EncryptedToken {
    return this.props.refreshToken;
  }

  get scope(): string {
    return this.props.scope;
  }

  get tokenExpiresAt(): Date {
    return this.props.tokenExpiresAt;
  }

  get connectedAt(): Date {
    return this.props.connectedAt;
  }

  get lastRefreshedAt(): Date {
    return this.props.lastRefreshedAt;
  }
}
