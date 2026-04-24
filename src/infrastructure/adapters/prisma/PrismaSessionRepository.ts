import type { PrismaClient } from "@prisma/client";

import type { SessionRepositoryPort } from "@/application/ports/SessionRepositoryPort";
import { Session } from "@/domain/session/Session";
import { SessionId } from "@/domain/session/SessionId";

export class PrismaSessionRepository implements SessionRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async save(session: Session): Promise<void> {
    await this.prisma.session.upsert({
      where: { id: session.id.value },
      create: {
        id: session.id.value,
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
      update: {
        expiresAt: session.expiresAt,
      },
    });
  }

  async findById(id: SessionId): Promise<Session | null> {
    const row = await this.prisma.session.findUnique({
      where: { id: id.value },
    });
    if (!row) return null;
    return Session.restore({
      id: SessionId.create(row.id),
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    });
  }

  async deleteById(id: SessionId): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: id.value } });
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return result.count;
  }
}
