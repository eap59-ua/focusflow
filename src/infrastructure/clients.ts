import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";

let prismaSingleton: PrismaClient | undefined;
let redisSingleton: Redis | undefined;

export function getPrismaClient(): PrismaClient {
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

export function getRedisClient(): Redis {
  if (!redisSingleton) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error(
        "REDIS_URL no está definida. Revisa tu .env antes de arrancar el servidor.",
      );
    }
    redisSingleton = new Redis(url, { maxRetriesPerRequest: null });
  }
  return redisSingleton;
}
