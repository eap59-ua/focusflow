import type { PrismaClient } from "@prisma/client";

import { RegisterUser } from "@/application/use-cases/auth/RegisterUser";

import { PrismaUserRepository } from "./adapters/prisma/PrismaUserRepository";
import { BcryptPasswordHasher } from "./adapters/security/BcryptPasswordHasher";

export interface Container {
  readonly registerUser: RegisterUser;
}

export function buildContainer(prisma: PrismaClient): Container {
  const userRepo = new PrismaUserRepository(prisma);
  const hasher = new BcryptPasswordHasher();
  const registerUser = new RegisterUser({ userRepo, hasher });
  return { registerUser };
}
