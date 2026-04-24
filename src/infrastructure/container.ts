import type { PrismaClient } from "@prisma/client";

import { GetCurrentUser } from "@/application/use-cases/auth/GetCurrentUser";
import { LoginUser } from "@/application/use-cases/auth/LoginUser";
import { LogoutUser } from "@/application/use-cases/auth/LogoutUser";
import { RegisterUser } from "@/application/use-cases/auth/RegisterUser";

import { PrismaSessionRepository } from "./adapters/prisma/PrismaSessionRepository";
import { PrismaUserRepository } from "./adapters/prisma/PrismaUserRepository";
import { BcryptPasswordHasher } from "./adapters/security/BcryptPasswordHasher";

const DEFAULT_SESSION_LIFETIME_DAYS = 30;

export interface Container {
  readonly registerUser: RegisterUser;
  readonly loginUser: LoginUser;
  readonly logoutUser: LogoutUser;
  readonly getCurrentUser: GetCurrentUser;
}

function readSessionLifetimeDays(): number {
  const raw = process.env.SESSION_LIFETIME_DAYS;
  if (!raw) return DEFAULT_SESSION_LIFETIME_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `SESSION_LIFETIME_DAYS inválido: "${raw}". Debe ser un número positivo.`,
    );
  }
  return parsed;
}

export function buildContainer(prisma: PrismaClient): Container {
  const userRepo = new PrismaUserRepository(prisma);
  const sessionRepo = new PrismaSessionRepository(prisma);
  const hasher = new BcryptPasswordHasher();
  const sessionLifetimeDays = readSessionLifetimeDays();

  const registerUser = new RegisterUser({ userRepo, hasher });
  const loginUser = new LoginUser({
    userRepo,
    hasher,
    sessionRepo,
    sessionLifetimeDays,
  });
  const logoutUser = new LogoutUser({ sessionRepo });
  const getCurrentUser = new GetCurrentUser({
    sessionRepo,
    userRepo,
    clock: () => new Date(),
  });

  return { registerUser, loginUser, logoutUser, getCurrentUser };
}
