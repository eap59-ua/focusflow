import type { PrismaClient } from "@prisma/client";

import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";

interface GmailIntegrationRow {
  id: string;
  userId: string;
  googleAccountEmail: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  scope: string;
  tokenExpiresAt: Date;
  connectedAt: Date;
  lastRefreshedAt: Date;
}

function toDomain(row: GmailIntegrationRow): GmailIntegration {
  return GmailIntegration.restore({
    id: row.id,
    userId: row.userId,
    googleAccountEmail: row.googleAccountEmail,
    accessToken: EncryptedToken.fromBase64(row.accessTokenEncrypted),
    refreshToken: EncryptedToken.fromBase64(row.refreshTokenEncrypted),
    scope: row.scope,
    tokenExpiresAt: row.tokenExpiresAt,
    connectedAt: row.connectedAt,
    lastRefreshedAt: row.lastRefreshedAt,
  });
}

export class PrismaGmailIntegrationRepository
  implements GmailIntegrationRepositoryPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async save(integration: GmailIntegration): Promise<void> {
    await this.prisma.gmailIntegration.upsert({
      where: { userId: integration.userId },
      create: {
        id: integration.id,
        userId: integration.userId,
        googleAccountEmail: integration.googleAccountEmail,
        accessTokenEncrypted: integration.accessToken.toBase64(),
        refreshTokenEncrypted: integration.refreshToken.toBase64(),
        scope: integration.scope,
        tokenExpiresAt: integration.tokenExpiresAt,
        connectedAt: integration.connectedAt,
        lastRefreshedAt: integration.lastRefreshedAt,
      },
      update: {
        googleAccountEmail: integration.googleAccountEmail,
        accessTokenEncrypted: integration.accessToken.toBase64(),
        refreshTokenEncrypted: integration.refreshToken.toBase64(),
        scope: integration.scope,
        tokenExpiresAt: integration.tokenExpiresAt,
        lastRefreshedAt: integration.lastRefreshedAt,
      },
    });
  }

  async findByUserId(userId: string): Promise<GmailIntegration | null> {
    const row = await this.prisma.gmailIntegration.findUnique({
      where: { userId },
    });
    if (!row) return null;
    return toDomain(row);
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.gmailIntegration.deleteMany({ where: { userId } });
  }
}
