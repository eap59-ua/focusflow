import { PrismaClient } from "@prisma/client";

import { buildContainer, type Container } from "@/infrastructure/container";

export interface AppContext {
  readonly prisma: PrismaClient;
  readonly container: Container;
}

let prismaSingleton: PrismaClient | undefined;

function getPrismaClient(): PrismaClient {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
}

export function createContext(): AppContext {
  const prisma = getPrismaClient();
  const container = buildContainer(prisma);
  return { prisma, container };
}
