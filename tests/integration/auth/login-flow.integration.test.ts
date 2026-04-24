import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { buildContainer, type Container } from "@/infrastructure/container";
import type { AppContext } from "@/presentation/trpc/context";
import { appRouter } from "@/presentation/trpc/routers/_app";

const SESSION_COOKIE = "focusflow.session";
const SESSION_REGEX = new RegExp(
  `${SESSION_COOKIE.replace(".", "\\.")}=([0-9a-f]{64})`,
);

let prisma: PrismaClient;
let container: Container;

beforeAll(() => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida (¿.env.test cargado?)");
  }
  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });
  container = buildContainer(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

function makeCtx(sessionId: string | null = null): AppContext {
  return {
    prisma,
    container,
    sessionId,
    resHeaders: new Headers(),
  };
}

function extractSessionIdFromSetCookie(headers: Headers): string {
  const raw = headers.get("Set-Cookie");
  if (!raw) throw new Error("No Set-Cookie header present");
  const match = SESSION_REGEX.exec(raw);
  if (!match) throw new Error(`No session cookie found in: ${raw}`);
  return match[1];
}

async function register(input: {
  email: string;
  password: string;
  displayName: string;
}) {
  const ctx = makeCtx();
  await appRouter.createCaller(ctx).auth.register(input);
}

async function login(input: {
  email: string;
  password: string;
}): Promise<{ ctx: AppContext; sessionId: string }> {
  const ctx = makeCtx();
  await appRouter.createCaller(ctx).auth.login(input);
  const sessionId = extractSessionIdFromSetCookie(ctx.resHeaders);
  return { ctx, sessionId };
}

describe("login flow (integration)", () => {
  it("registro + login devuelve Set-Cookie y auth.me con la cookie reporta el user", async () => {
    await register({
      email: "flow@example.com",
      password: "correcthorsebattery",
      displayName: "Flow User",
    });

    const { ctx, sessionId } = await login({
      email: "flow@example.com",
      password: "correcthorsebattery",
    });

    expect(sessionId).toMatch(/^[0-9a-f]{64}$/);
    const setCookie = ctx.resHeaders.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");

    const row = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(row).not.toBeNull();

    const meCtx = makeCtx(sessionId);
    const me = await appRouter.createCaller(meCtx).auth.me();
    expect(me.email).toBe("flow@example.com");
    expect(me.displayName).toBe("Flow User");
  });

  it("login con password incorrecta lanza UNAUTHORIZED y no crea sesión", async () => {
    await register({
      email: "pw@example.com",
      password: "correcthorsebattery",
      displayName: "Pw User",
    });

    const ctx = makeCtx();
    await expect(
      appRouter.createCaller(ctx).auth.login({
        email: "pw@example.com",
        password: "wrongpassword",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(ctx.resHeaders.get("Set-Cookie")).toBeNull();
    const count = await prisma.session.count();
    expect(count).toBe(0);
  });

  it("logout borra la sesión, apendea Set-Cookie vacío y auth.me responde UNAUTHORIZED", async () => {
    await register({
      email: "logout@example.com",
      password: "correcthorsebattery",
      displayName: "Logout User",
    });
    const { sessionId } = await login({
      email: "logout@example.com",
      password: "correcthorsebattery",
    });

    const logoutCtx = makeCtx(sessionId);
    await appRouter.createCaller(logoutCtx).auth.logout();

    const setCookie = logoutCtx.resHeaders.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);

    const rowAfter = await prisma.session.findUnique({
      where: { id: sessionId },
    });
    expect(rowAfter).toBeNull();

    const meCtx = makeCtx(sessionId);
    await expect(
      appRouter.createCaller(meCtx).auth.me(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("sesión expirada en DB: auth.me responde UNAUTHORIZED y la sesión queda borrada", async () => {
    await register({
      email: "expired@example.com",
      password: "correcthorsebattery",
      displayName: "Expired User",
    });
    const { sessionId } = await login({
      email: "expired@example.com",
      password: "correcthorsebattery",
    });

    await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    });

    const meCtx = makeCtx(sessionId);
    await expect(
      appRouter.createCaller(meCtx).auth.me(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const rowAfter = await prisma.session.findUnique({
      where: { id: sessionId },
    });
    expect(rowAfter).toBeNull();
  });
});
