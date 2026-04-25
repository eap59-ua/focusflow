import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";

export interface GetGmailStatusDependencies {
  readonly gmailIntegrationRepo: GmailIntegrationRepositoryPort;
}

export interface GetGmailStatusInput {
  readonly userId: string;
}

export type GetGmailStatusOutput =
  | { readonly connected: false }
  | {
      readonly connected: true;
      readonly googleAccountEmail: string;
      readonly connectedAt: Date;
    };

export class GetGmailStatus {
  constructor(private readonly deps: GetGmailStatusDependencies) {}

  async execute(input: GetGmailStatusInput): Promise<GetGmailStatusOutput> {
    const integration = await this.deps.gmailIntegrationRepo.findByUserId(
      input.userId,
    );
    if (!integration) {
      return { connected: false };
    }
    return {
      connected: true,
      googleAccountEmail: integration.googleAccountEmail,
      connectedAt: integration.connectedAt,
    };
  }
}
