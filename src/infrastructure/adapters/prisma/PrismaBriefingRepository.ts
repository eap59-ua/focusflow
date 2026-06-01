import type { PrismaClient } from "@prisma/client";

import type { BriefingRepositoryPort } from "@/application/ports/BriefingRepositoryPort";
import { Briefing } from "@/domain/briefing/Briefing";

interface BriefingRow {
  id: string;
  userId: string;
  summary: string;
  emailsConsidered: number;
  emailsTruncated: number;
  tokensUsedInput: number;
  tokensUsedOutput: number;
  modelUsed: string;
  promptVersion: string;
  createdAt: Date;
}

function toDomain(row: BriefingRow): Briefing {
  return Briefing.restore({
    id: row.id,
    userId: row.userId,
    summary: row.summary,
    emailsConsidered: row.emailsConsidered,
    emailsTruncated: row.emailsTruncated,
    tokensUsedInput: row.tokensUsedInput,
    tokensUsedOutput: row.tokensUsedOutput,
    modelUsed: row.modelUsed,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt,
  });
}

export class PrismaBriefingRepository implements BriefingRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async save(briefing: Briefing): Promise<void> {
    await this.prisma.briefing.upsert({
      where: { id: briefing.id },
      create: {
        id: briefing.id,
        userId: briefing.userId,
        summary: briefing.summary,
        emailsConsidered: briefing.emailsConsidered,
        emailsTruncated: briefing.emailsTruncated,
        tokensUsedInput: briefing.tokensUsedInput,
        tokensUsedOutput: briefing.tokensUsedOutput,
        modelUsed: briefing.modelUsed,
        promptVersion: briefing.promptVersion,
        createdAt: briefing.createdAt,
      },
      update: {
        summary: briefing.summary,
        emailsConsidered: briefing.emailsConsidered,
        emailsTruncated: briefing.emailsTruncated,
        tokensUsedInput: briefing.tokensUsedInput,
        tokensUsedOutput: briefing.tokensUsedOutput,
        modelUsed: briefing.modelUsed,
        promptVersion: briefing.promptVersion,
      },
    });
  }

  async findById(id: string): Promise<Briefing | null> {
    const row = await this.prisma.briefing.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findLatestByUserId(userId: string): Promise<Briefing | null> {
    const row = await this.prisma.briefing.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }
}
