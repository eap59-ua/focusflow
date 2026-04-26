// @vitest-environment node
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Queue, type Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BriefingGeneratorPort } from "@/application/ports/BriefingGeneratorPort";
import type {
  EmailFetcherPort,
  FetchInboxParams,
} from "@/application/ports/EmailFetcherPort";
import type {
  OAuthClientPort,
  OAuthRefreshResult,
} from "@/application/ports/OAuthClientPort";
import { GenerateBriefing } from "@/application/use-cases/briefing/GenerateBriefing";
import { SendBriefingEmail } from "@/application/use-cases/briefing/SendBriefingEmail";
import { FetchInboxEmails } from "@/application/use-cases/email/FetchInboxEmails";
import { RefreshGmailToken } from "@/application/use-cases/gmail/RefreshGmailToken";
import { TriggerBriefingForUser } from "@/application/use-cases/scheduling/TriggerBriefingForUser";
import { EmailMessage } from "@/domain/email-message/EmailMessage";
import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { NodemailerEmailSender } from "@/infrastructure/adapters/email/NodemailerEmailSender";
import { PrismaBriefingRepository } from "@/infrastructure/adapters/prisma/PrismaBriefingRepository";
import { PrismaGmailIntegrationRepository } from "@/infrastructure/adapters/prisma/PrismaGmailIntegrationRepository";
import { PrismaUserRepository } from "@/infrastructure/adapters/prisma/PrismaUserRepository";
import { HtmlBriefingEmailRenderer } from "@/infrastructure/email/HtmlBriefingEmailRenderer";
import { MORNING_BRIEFING_PROMPT_VERSION } from "@/infrastructure/openai/prompts/morning-briefing";
import { BullMQBriefingScheduler } from "@/infrastructure/scheduling/BullMQBriefingScheduler";
import { AesGcmTokenEncryption } from "@/infrastructure/security/AesGcmTokenEncryption";
import {
  buildBriefingTriggerQueue,
  buildBriefingTriggerWorker,
  buildGenerateBriefingQueue,
  buildGenerateBriefingWorker,
  buildGmailInboxSyncQueue,
  buildGmailInboxSyncWorker,
  buildSendBriefingEmailQueue,
  buildSendBriefingEmailWorker,
} from "@/jobs";

const MAILPIT_API = "http://localhost:8025/api/v1";

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_API}/messages`, { method: "DELETE" });
}

async function listMailpitMessages(): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT_API}/messages`);
  const data = (await res.json()) as { messages?: MailpitMessage[] };
  return data.messages ?? [];
}

async function waitForMailpitMessage(timeoutMs: number): Promise<MailpitMessage[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const messages = await listMailpitMessages();
    if (messages.length > 0) return messages;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

class FakeEmailFetcher implements EmailFetcherPort {
  constructor(private readonly emails: readonly EmailMessage[]) {}
  async fetchInbox(_: FetchInboxParams): Promise<readonly EmailMessage[]> {
    return this.emails;
  }
}

class FakeOAuthClient implements OAuthClientPort {
  generateAuthUrl(): string {
    return "";
  }
  async exchangeCode(): Promise<never> {
    throw new Error("not used");
  }
  async refreshAccessToken(): Promise<OAuthRefreshResult> {
    return { accessToken: "fresh", expiresInSeconds: 3600 };
  }
}

class FakeBriefingGenerator implements BriefingGeneratorPort {
  generate = vi.fn(async () => ({
    summary:
      "Hoy tienes 2 reuniones importantes y un par de respuestas pendientes a clientes clave para revisar.",
    tokensUsedInput: 800,
    tokensUsedOutput: 200,
    modelUsed: "gpt-4o-mini",
  }));
}

let prisma: PrismaClient;
let redis: Redis;
let userRepo: PrismaUserRepository;
let gmailRepo: PrismaGmailIntegrationRepository;
let briefingRepo: PrismaBriefingRepository;
let encryption: AesGcmTokenEncryption;
let renderer: HtmlBriefingEmailRenderer;
let emailSender: NodemailerEmailSender;
let scheduler: BullMQBriefingScheduler;
let triggerQueue: Queue;
let syncQueue: Queue;
let genQueue: Queue;
let sendQueue: Queue;
const workers: Worker[] = [];
let userId: string;

beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!dbUrl || !redisUrl || !tokenKey) {
    throw new Error("envs faltantes (DATABASE_URL/REDIS_URL/TOKEN_ENCRYPTION_KEY)");
  }
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  userRepo = new PrismaUserRepository(prisma);
  gmailRepo = new PrismaGmailIntegrationRepository(prisma);
  briefingRepo = new PrismaBriefingRepository(prisma);
  encryption = new AesGcmTokenEncryption(tokenKey);
  renderer = new HtmlBriefingEmailRenderer();
  emailSender = new NodemailerEmailSender({
    host: "localhost",
    port: 1025,
    secure: false,
  });

  triggerQueue = buildBriefingTriggerQueue(redis);
  syncQueue = buildGmailInboxSyncQueue(redis);
  genQueue = buildGenerateBriefingQueue(redis);
  sendQueue = buildSendBriefingEmailQueue(redis);

  scheduler = new BullMQBriefingScheduler({
    briefingTriggerQueue: triggerQueue,
    connection: redis,
  });
});

afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()));
  await scheduler.close();
  await triggerQueue.close();
  await syncQueue.close();
  await genQueue.close();
  await sendQueue.close();
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(async () => {
  await Promise.all([
    triggerQueue.obliterate({ force: true }).catch(() => undefined),
    syncQueue.obliterate({ force: true }).catch(() => undefined),
    genQueue.obliterate({ force: true }).catch(() => undefined),
    sendQueue.obliterate({ force: true }).catch(() => undefined),
  ]);
  await prisma.briefing.deleteMany();
  await prisma.gmailIntegration.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await clearMailpit();

  const user = User.create({
    email: Email.create("flowtest@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake"),
    displayName: "Flow Tester",
  }).enableBriefing(8, "Europe/Madrid");
  await userRepo.save(user);
  userId = user.id;

  const accessTokenEncrypted = await encryption.encrypt("ya29.fake-access");
  const refreshTokenEncrypted = await encryption.encrypt("1//fake-refresh");
  const integration = GmailIntegration.create({
    userId,
    googleAccountEmail: "flowtest@gmail.com",
    accessToken: EncryptedToken.fromBase64(accessTokenEncrypted),
    refreshToken: EncryptedToken.fromBase64(refreshTokenEncrypted),
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    tokenExpiresAt: new Date(Date.now() + 3_600_000),
  });
  await gmailRepo.save(integration);
});

function makeEmail(label: string): EmailMessage {
  return EmailMessage.create({
    id: label,
    messageIdHeader: `<${label}@flow.test>`,
    threadId: "t",
    subject: `Asunto ${label}`,
    fromEmail: "alice@example.com",
    fromName: "Alice",
    toEmails: ["me@gmail.com"],
    snippet: "snippet",
    receivedAt: new Date(Date.now() - 60_000),
    bodyText: `Cuerpo ${label}`,
  });
}

function buildAndStartWorkers(): void {
  const fakeFetcher = new FakeEmailFetcher([makeEmail("a"), makeEmail("b")]);
  const fakeOAuth = new FakeOAuthClient();
  const fakeGenerator = new FakeBriefingGenerator();

  const fetchInboxEmails = new FetchInboxEmails({
    gmailIntegrationRepo: gmailRepo,
    tokenEncryption: encryption,
    emailFetcher: fakeFetcher,
    refreshGmailToken: new RefreshGmailToken({
      gmailIntegrationRepo: gmailRepo,
      tokenEncryption: encryption,
      oauthClient: fakeOAuth,
    }),
  });
  const generateBriefing = new GenerateBriefing({
    briefingGenerator: fakeGenerator,
    briefingRepo,
    promptVersion: MORNING_BRIEFING_PROMPT_VERSION,
  });
  const sendBriefingEmail = new SendBriefingEmail({
    briefingRepo,
    userRepo,
    renderer,
    emailSender,
    fromAddress: { email: "test@focusflow.local", name: "FocusFlow Flow" },
  });
  const triggerBriefingForUser = new TriggerBriefingForUser({
    userRepo,
    scheduler,
  });

  workers.push(
    buildGmailInboxSyncWorker({
      fetchInboxEmails,
      connection: redis,
    }),
    buildGenerateBriefingWorker({
      generateBriefing,
      connection: redis,
    }),
    buildSendBriefingEmailWorker({
      sendBriefingEmail,
      connection: redis,
    }),
    buildBriefingTriggerWorker({
      triggerBriefingForUser,
      connection: redis,
    }),
  );
}

describe("Flow completo briefing-trigger → sync → generate → send (integration E2E)", () => {
  it("triggerNow encadena los 4 workers; aparece briefing en DB y email en Mailpit", async () => {
    buildAndStartWorkers();
    await Promise.all(workers.map((w) => w.waitUntilReady()));

    const { flowId } = await scheduler.triggerNow(userId);
    expect(flowId).toBeTruthy();

    const messages = await waitForMailpitMessage(20_000);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]!.Subject).toMatch(/briefing matutino/i);
    expect(messages[0]!.To[0]?.Address).toBe("flowtest@example.com");

    const briefings = await prisma.briefing.findMany({ where: { userId } });
    expect(briefings).toHaveLength(1);
    expect(briefings[0]!.summary).toContain("reuniones");
    expect(briefings[0]!.emailsConsidered).toBe(2);
    expect(briefings[0]!.modelUsed).toBe("gpt-4o-mini");
  }, 30_000);
});
