import type { EmailFetcherPort } from "@/application/ports/EmailFetcherPort";
import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import type { TokenEncryptionPort } from "@/application/ports/TokenEncryptionPort";
import type { RefreshGmailToken } from "@/application/use-cases/gmail/RefreshGmailToken";
import type { EmailMessage } from "@/domain/email-message/EmailMessage";
import { GmailIntegrationNotFoundError } from "@/domain/gmail-integration/errors/GmailIntegrationNotFoundError";

const DEFAULT_QUERY = "in:inbox newer_than:1d";
const DEFAULT_MAX_RESULTS = 50;
const REFRESH_SKEW_SECONDS = 60;

export interface FetchInboxEmailsDependencies {
  readonly gmailIntegrationRepo: GmailIntegrationRepositoryPort;
  readonly tokenEncryption: TokenEncryptionPort;
  readonly emailFetcher: EmailFetcherPort;
  readonly refreshGmailToken: RefreshGmailToken;
  readonly clock?: () => Date;
  readonly defaultQuery?: string;
  readonly maxResults?: number;
}

export interface FetchInboxEmailsInput {
  readonly userId: string;
  readonly since?: Date;
}

export interface FetchInboxEmailsOutput {
  readonly emails: readonly EmailMessage[];
  readonly integrationId: string;
}

export class FetchInboxEmails {
  private readonly clock: () => Date;
  private readonly defaultQuery: string;
  private readonly maxResults: number;

  constructor(private readonly deps: FetchInboxEmailsDependencies) {
    this.clock = deps.clock ?? (() => new Date());
    this.defaultQuery = deps.defaultQuery ?? DEFAULT_QUERY;
    this.maxResults = deps.maxResults ?? DEFAULT_MAX_RESULTS;
  }

  async execute(input: FetchInboxEmailsInput): Promise<FetchInboxEmailsOutput> {
    let integration = await this.deps.gmailIntegrationRepo.findByUserId(
      input.userId,
    );
    if (!integration) {
      throw new GmailIntegrationNotFoundError();
    }

    if (integration.isAccessTokenExpired(this.clock(), REFRESH_SKEW_SECONDS)) {
      await this.deps.refreshGmailToken.execute({ userId: input.userId });
      integration = await this.deps.gmailIntegrationRepo.findByUserId(
        input.userId,
      );
      if (!integration) {
        throw new GmailIntegrationNotFoundError();
      }
    }

    const accessToken = await this.deps.tokenEncryption.decrypt(
      integration.accessToken.toBase64(),
    );

    const query = input.since
      ? `in:inbox after:${Math.floor(input.since.getTime() / 1000)}`
      : this.defaultQuery;

    const fetched = await this.deps.emailFetcher.fetchInbox({
      accessToken,
      query,
      maxResults: this.maxResults,
    });

    const seen = new Set<string>();
    const deduped: EmailMessage[] = [];
    for (const email of fetched) {
      if (!seen.has(email.messageIdHeader)) {
        seen.add(email.messageIdHeader);
        deduped.push(email);
      }
    }

    return { emails: deduped, integrationId: integration.id };
  }
}
