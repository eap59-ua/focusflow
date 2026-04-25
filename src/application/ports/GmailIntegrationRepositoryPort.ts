import type { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";

export interface GmailIntegrationRepositoryPort {
  save(integration: GmailIntegration): Promise<void>;
  findByUserId(userId: string): Promise<GmailIntegration | null>;
  deleteByUserId(userId: string): Promise<void>;
}
