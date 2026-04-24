import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { buildContainer, type Container } from "@/infrastructure/container";

export interface AppContext {
  readonly prisma: PrismaClient;
  readonly container: Container;
}

let prismaSingleton: PrismaClient | undefined;

function getPrismaClient(): PrismaClient {
  if (!prismaSingleton) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL no está definida. Revisa tu .env antes de arrancar el servidor.",
      );
    }
    const adapter = new PrismaPg({ connectionString });
    prismaSingleton = new PrismaClient({ adapter });
  }
  return prismaSingleton;
}

export function createContext(): AppContext {
  const prisma = getPrismaClient();
  const container = buildContainer(prisma);
  return { prisma, container };
}
