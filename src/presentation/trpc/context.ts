import type { PrismaClient } from "@prisma/client";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { parse as parseCookie } from "cookie";

import { getPrismaClient, getRedisClient } from "@/infrastructure/clients";
import { buildContainer, type Container } from "@/infrastructure/container";

export interface AppContext {
  readonly prisma: PrismaClient;
  readonly container: Container;
  readonly sessionId: string | null;
  readonly resHeaders: Headers;
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
  const redis = getRedisClient();
  const container = buildContainer({ prisma, redis });
  const sessionId = extractSessionId(opts.req);
  return {
    prisma,
    container,
    sessionId,
    resHeaders: opts.resHeaders,
  };
}

export function getServerContainer(): Container {
  return buildContainer({ prisma: getPrismaClient(), redis: getRedisClient() });
}
