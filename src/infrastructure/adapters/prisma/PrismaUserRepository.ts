import type { PrismaClient } from "@prisma/client";

import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";

export class PrismaUserRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: Email): Promise<User | null> {
    const row = await this.prisma.user.findUnique({
      where: { email: email.value },
    });
    return row ? this.toDomain(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  private toDomain(row: {
    id: string;
    email: string;
    hashedPassword: string;
    displayName: string;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return User.restore({
      id: row.id,
      email: Email.create(row.email),
      hashedPassword: HashedPassword.fromHash(row.hashedPassword),
      displayName: row.displayName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async save(user: User): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email.value,
        hashedPassword: user.hashedPassword,
        displayName: user.displayName,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      update: {
        email: user.email.value,
        hashedPassword: user.hashedPassword,
        displayName: user.displayName,
        updatedAt: user.updatedAt,
      },
    });
  }
}
