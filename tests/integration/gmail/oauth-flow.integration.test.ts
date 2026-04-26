import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  OAuthClientPort,
  OAuthExchangeResult,
  OAuthRefreshResult,
} from "@/application/ports/OAuthClientPort";
import { BeginGmailConnection } from "@/application/use-cases/gmail/BeginGmailConnection";
import { CompleteGmailConnection } from "@/application/use-cases/gmail/CompleteGmailConnection";
import { DisconnectGmail } from "@/application/use-cases/gmail/DisconnectGmail";
import { RefreshGmailToken } from "@/application/use-cases/gmail/RefreshGmailToken";
import { OAuthStateMismatchError } from "@/domain/gmail-integration/errors/OAuthStateMismatchError";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { RedisOAuthStateStore } from "@/infrastructure/adapters/oauth/RedisOAuthStateStore";
import { PrismaGmailIntegrationRepository } from "@/infrastructure/adapters/prisma/PrismaGmailIntegrationRepository";
import { PrismaUserRepository } from "@/infrastructure/adapters/prisma/PrismaUserRepository";
import { AesGcmTokenEncryption } from "@/infrastructure/security/AesGcmTokenEncryption";

const STATE_REDIS_PREFIX = "oauth:gmail:state:";

class FakeOAuthClient implements OAuthClientPort {
  generateAuthUrl = vi.fn(
    (state: string) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  );
  exchangeCode = vi.fn(async (_code: string): Promise<OAuthExchangeResult> => {
    throw new Error("exchangeCode not programmed");
  });
  refreshAccessToken = vi.fn(
    async (_refreshToken: string): Promise<OAuthRefreshResult> => {
      throw new Error("refreshAccessToken not programmed");
    },
  );
}

let prisma: PrismaClient;
let redis: Redis;
let userRepo: PrismaUserRepository;
let gmailRepo: PrismaGmailIntegrationRepository;
let stateStore: RedisOAuthStateStore;
let encryption: AesGcmTokenEncryption;
let oauthClient: FakeOAuthClient;

let testUserId: string;
let otherUserId: string;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida (¿se cargó .env.test?)");
  }
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL no está definida (¿se cargó .env.test?)");
  }
  const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!tokenKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY no está definida (¿.env.test?)");
  }

  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  userRepo = new PrismaUserRepository(prisma);
  gmailRepo = new PrismaGmailIntegrationRepository(prisma);
  stateStore = new RedisOAuthStateStore(redis);
  encryption = new AesGcmTokenEncryption(tokenKey);
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(async () => {
  await prisma.gmailIntegration.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  const keys = await redis.keys(`${STATE_REDIS_PREFIX}*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  oauthClient = new FakeOAuthClient();

  const userMain = User.create({
    email: Email.create("oauth-main@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake1"),
    displayName: "Main",
  });
  const userOther = User.create({
    email: Email.create("oauth-other@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake2"),
    displayName: "Other",
  });
  await userRepo.save(userMain);
  await userRepo.save(userOther);
  testUserId = userMain.id;
  otherUserId = userOther.id;
});

function makeBegin() {
  return new BeginGmailConnection({
    oauthStateStore: stateStore,
    oauthClient,
  });
}

const noopScheduler = {
  scheduleForUser: async () => undefined,
  unscheduleForUser: async () => undefined,
  triggerNow: async () => ({ flowId: "noop" }),
};

function makeComplete() {
  return new CompleteGmailConnection({
    oauthStateStore: stateStore,
    oauthClient,
    tokenEncryption: encryption,
    gmailIntegrationRepo: gmailRepo,
    userRepo,
    scheduler: noopScheduler,
    defaultBriefingHour: 8,
    defaultBriefingTimezone: "Europe/Madrid",
  });
}

function makeRefresh() {
  return new RefreshGmailToken({
    gmailIntegrationRepo: gmailRepo,
    tokenEncryption: encryption,
    oauthClient,
  });
}

function makeDisconnect() {
  return new DisconnectGmail({
    gmailIntegrationRepo: gmailRepo,
    userRepo,
    scheduler: noopScheduler,
  });
}

function fakeExchangePayload(): OAuthExchangeResult {
  return {
    accessToken: "ya29.PLAIN-ACCESS-TOKEN",
    refreshToken: "1//PLAIN-REFRESH-TOKEN",
    expiresInSeconds: 3600,
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    googleAccountEmail: "user@gmail.com",
  };
}

describe("OAuth Gmail flow (integration)", () => {
  it("Begin: persiste state en Redis con TTL >0 y devuelve la authorizeUrl con ese state", async () => {
    const { authorizeUrl } = await makeBegin().execute({ userId: testUserId });

    const stateMatch = authorizeUrl.match(/state=([0-9a-f]{64})/);
    expect(stateMatch).not.toBeNull();
    const state = stateMatch![1]!;

    const stored = await redis.get(STATE_REDIS_PREFIX + state);
    expect(stored).toBe(testUserId);

    const ttl = await redis.ttl(STATE_REDIS_PREFIX + state);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it("Complete happy path: persiste integración con tokens cifrados (decrypt verifica round-trip; DB no contiene plaintext)", async () => {
    oauthClient.exchangeCode = vi.fn(async () => fakeExchangePayload());

    const { authorizeUrl } = await makeBegin().execute({ userId: testUserId });
    const state = authorizeUrl.match(/state=([0-9a-f]{64})/)![1]!;

    const { integration } = await makeComplete().execute({
      userId: testUserId,
      code: "google-auth-code",
      state,
    });

    expect(integration.userId).toBe(testUserId);
    expect(integration.googleAccountEmail).toBe("user@gmail.com");

    const row = await prisma.gmailIntegration.findUnique({
      where: { userId: testUserId },
    });
    expect(row).not.toBeNull();
    expect(row!.accessTokenEncrypted).not.toContain("ya29");
    expect(row!.refreshTokenEncrypted).not.toContain("PLAIN");

    expect(await encryption.decrypt(row!.accessTokenEncrypted)).toBe(
      "ya29.PLAIN-ACCESS-TOKEN",
    );
    expect(await encryption.decrypt(row!.refreshTokenEncrypted)).toBe(
      "1//PLAIN-REFRESH-TOKEN",
    );

    // El state debe haberse consumido (ya no está en Redis).
    const stillThere = await redis.get(STATE_REDIS_PREFIX + state);
    expect(stillThere).toBeNull();
  });

  it("Complete con state inexistente: OAuthStateMismatchError, sin row en DB ni llamadas a exchange", async () => {
    oauthClient.exchangeCode = vi.fn(async () => fakeExchangePayload());

    await expect(
      makeComplete().execute({
        userId: testUserId,
        code: "any-code",
        state: "nonexistentstate",
      }),
    ).rejects.toBeInstanceOf(OAuthStateMismatchError);

    expect(oauthClient.exchangeCode).not.toHaveBeenCalled();
    expect(
      await prisma.gmailIntegration.findUnique({ where: { userId: testUserId } }),
    ).toBeNull();
  });

  it("Complete con state de otro user: OAuthStateMismatchError, sin row en DB", async () => {
    oauthClient.exchangeCode = vi.fn(async () => fakeExchangePayload());

    // Other user inicia el flujo, attacker (testUser) intenta consumir.
    const { authorizeUrl } = await makeBegin().execute({ userId: otherUserId });
    const state = authorizeUrl.match(/state=([0-9a-f]{64})/)![1]!;

    await expect(
      makeComplete().execute({
        userId: testUserId,
        code: "any-code",
        state,
      }),
    ).rejects.toBeInstanceOf(OAuthStateMismatchError);

    expect(oauthClient.exchangeCode).not.toHaveBeenCalled();
    expect(
      await prisma.gmailIntegration.findUnique({ where: { userId: testUserId } }),
    ).toBeNull();
    expect(
      await prisma.gmailIntegration.findUnique({ where: { userId: otherUserId } }),
    ).toBeNull();
  });

  it("Refresh: actualiza lastRefreshedAt y persiste un nuevo access token cifrado distinto al anterior", async () => {
    // Setup: dejar una integración conectada.
    oauthClient.exchangeCode = vi.fn(async () => fakeExchangePayload());
    const { authorizeUrl } = await makeBegin().execute({ userId: testUserId });
    const state = authorizeUrl.match(/state=([0-9a-f]{64})/)![1]!;
    await makeComplete().execute({
      userId: testUserId,
      code: "code",
      state,
    });

    const before = await prisma.gmailIntegration.findUnique({
      where: { userId: testUserId },
    });
    expect(before).not.toBeNull();

    // Programar refresh.
    oauthClient.refreshAccessToken = vi.fn(async () => ({
      accessToken: "ya29.NEW-ACCESS-TOKEN",
      expiresInSeconds: 3600,
    }));

    // Pequeña espera para garantizar lastRefreshedAt > previo.
    await new Promise((r) => setTimeout(r, 5));

    await makeRefresh().execute({ userId: testUserId });

    const after = await prisma.gmailIntegration.findUnique({
      where: { userId: testUserId },
    });
    expect(after).not.toBeNull();
    expect(after!.lastRefreshedAt.getTime()).toBeGreaterThan(
      before!.lastRefreshedAt.getTime(),
    );
    expect(after!.accessTokenEncrypted).not.toBe(before!.accessTokenEncrypted);
    expect(await encryption.decrypt(after!.accessTokenEncrypted)).toBe(
      "ya29.NEW-ACCESS-TOKEN",
    );
    // El refresh token no debe cambiar.
    expect(after!.refreshTokenEncrypted).toBe(before!.refreshTokenEncrypted);
    // Refresh fue llamado con el plaintext correcto.
    expect(oauthClient.refreshAccessToken).toHaveBeenCalledWith(
      "1//PLAIN-REFRESH-TOKEN",
    );
  });

  it("Disconnect: borra la integración del user", async () => {
    // Crear una integración primero.
    oauthClient.exchangeCode = vi.fn(async () => fakeExchangePayload());
    const { authorizeUrl } = await makeBegin().execute({ userId: testUserId });
    const state = authorizeUrl.match(/state=([0-9a-f]{64})/)![1]!;
    await makeComplete().execute({ userId: testUserId, code: "c", state });

    expect(
      await prisma.gmailIntegration.findUnique({ where: { userId: testUserId } }),
    ).not.toBeNull();

    await makeDisconnect().execute({ userId: testUserId });

    expect(
      await prisma.gmailIntegration.findUnique({ where: { userId: testUserId } }),
    ).toBeNull();
  });

  it("Disconnect idempotente: sin integración previa, no lanza", async () => {
    await expect(
      makeDisconnect().execute({ userId: testUserId }),
    ).resolves.toBeUndefined();
  });
});
