import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { parse as parseCookie } from "cookie";

import { buildContainer, type Container } from "@/infrastructure/container";

export interface AppContext {
  readonly prisma: PrismaClient;
  readonly container: Container;
  readonly sessionId: string | null;
  readonly resHeaders: Headers;
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

export function sessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME ?? "focusflow.session";
}

export function extractSessionId(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const cookies = parseCookie(cookieHeader);
  return cookies[sessionCookieName()] ?? null;
}

export function createContext(opts: FetchCreateContextFnOptions): AppContext {
  const prisma = getPrismaClient();
  const container = buildContainer(prisma);
  const sessionId = extractSessionId(opts.req);
  return {
    prisma,
    container,
    sessionId,
    resHeaders: opts.resHeaders,
  };
}
