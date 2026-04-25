import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";

export interface DisconnectGmailDependencies {
  readonly gmailIntegrationRepo: GmailIntegrationRepositoryPort;
}

export interface DisconnectGmailInput {
  readonly userId: string;
}

export class DisconnectGmail {
  constructor(private readonly deps: DisconnectGmailDependencies) {}

  async execute(input: DisconnectGmailInput): Promise<void> {
    await this.deps.gmailIntegrationRepo.deleteByUserId(input.userId);
  }
}
