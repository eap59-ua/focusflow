// @vitest-environment node
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Queue, QueueEvents, type Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { SendBriefingEmail } from "@/application/use-cases/briefing/SendBriefingEmail";
import { Briefing } from "@/domain/briefing/Briefing";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { NodemailerEmailSender } from "@/infrastructure/adapters/email/NodemailerEmailSender";
import { PrismaBriefingRepository } from "@/infrastructure/adapters/prisma/PrismaBriefingRepository";
import { PrismaUserRepository } from "@/infrastructure/adapters/prisma/PrismaUserRepository";
import { HtmlBriefingEmailRenderer } from "@/infrastructure/email/HtmlBriefingEmailRenderer";
import {
  QUEUE_NAMES,
  buildSendBriefingEmailQueue,
  buildSendBriefingEmailWorker,
  type SendBriefingEmailJobResult,
} from "@/jobs";

const MAILPIT_API = "http://localhost:8025/api/v1";

interface MailpitMessage {
  ID: string;
  From: { Address: string; Name: string };
  To: Array<{ Address: string; Name: string }>;
  Subject: string;
}

async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_API}/messages`, { method: "DELETE" });
}

async function listMailpitMessages(): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT_API}/messages`);
  if (!res.ok) throw new Error(`Mailpit list failed: ${res.status}`);
  const data = (await res.json()) as { messages?: MailpitMessage[] };
  return data.messages ?? [];
}

async function getMailpitMessage(id: string): Promise<{
  HTML: string;
  Text: string;
  Subject: string;
}> {
  const res = await fetch(`${MAILPIT_API}/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit get failed: ${res.status}`);
  return (await res.json()) as { HTML: string; Text: string; Subject: string };
}

let prisma: PrismaClient;
let userRepo: PrismaUserRepository;
let briefingRepo: PrismaBriefingRepository;
let redis: Redis;
let queue: Queue;
let queueEvents: QueueEvents;
let worker: Worker | null = null;
let sendUseCase: SendBriefingEmail;
let userId: string;
let briefingId: string;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no definida");
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL no definida");

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  userRepo = new PrismaUserRepository(prisma);
  briefingRepo = new PrismaBriefingRepository(prisma);
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  queue = buildSendBriefingEmailQueue(redis);
  queueEvents = new QueueEvents(QUEUE_NAMES.SEND_BRIEFING_EMAIL, {
    connection: redis,
  });
  await queueEvents.waitUntilReady();

  const emailSender = new NodemailerEmailSender({
    host: "localhost",
    port: 1025,
    secure: false,
  });
  sendUseCase = new SendBriefingEmail({
    briefingRepo,
    userRepo,
    renderer: new HtmlBriefingEmailRenderer(),
    emailSender,
    fromAddress: { email: "test@focusflow.local", name: "FocusFlow Test" },
  });
});

afterAll(async () => {
  await worker?.close();
  await queueEvents.close();
  await queue.close();
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(async () => {
  await queue.obliterate({ force: true }).catch(() => undefined);
  await prisma.briefing.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await clearMailpit();

  const user = User.create({
    email: Email.create("recipient@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake"),
    displayName: "Recipient User",
  });
  await userRepo.save(user);
  userId = user.id;

  const briefing = Briefing.create({
    userId,
    summary:
      "**Lo más urgente**: revisar la propuesta del cliente Acme antes de las 11:00 y firmar el contrato pendiente.",
    emailsConsidered: 7,
    emailsTruncated: 2,
    tokensUsedInput: 1500,
    tokensUsedOutput: 300,
    modelUsed: "gpt-4o-mini",
    promptVersion: "v1.0.0",
  });
  await briefingRepo.save(briefing);
  briefingId = briefing.id;
});

describe("SendBriefingEmail E2E (Mailpit + Postgres + nodemailer)", () => {
  it("uso directo del use case: envía a Mailpit con HTML+texto, subject correcto", async () => {
    const delivery = await sendUseCase.execute({ briefingId });

    expect(delivery.briefingId).toBe(briefingId);
    expect(delivery.recipientEmail).toBe("recipient@example.com");
    expect(delivery.messageId).toMatch(/.+@.+/);

    const messages = await listMailpitMessages();
    expect(messages).toHaveLength(1);
    const msg = messages[0]!;
    expect(msg.Subject).toMatch(/briefing matutino/i);
    expect(msg.To[0]?.Address).toBe("recipient@example.com");
    expect(msg.From.Address).toBe("test@focusflow.local");

    const detail = await getMailpitMessage(msg.ID);
    expect(detail.HTML).toContain("Recipient User");
    expect(detail.HTML).toContain("<strong>Lo más urgente</strong>");
    expect(detail.HTML).toContain("2 omitidos");
    expect(detail.Text).toContain("Recipient User");
    expect(detail.Text).toContain("Acme");
  });

  it("worker E2E: encolar job → procesar → email entregado a Mailpit", async () => {
    worker = buildSendBriefingEmailWorker({
      sendBriefingEmail: sendUseCase,
      connection: redis,
    });
    await worker.waitUntilReady();

    const job = await queue.add("send-test", { briefingId });
    const rawResult = await job.waitUntilFinished(queueEvents, 15_000);
    const result = rawResult as SendBriefingEmailJobResult;
    expect(result.messageId).toMatch(/.+@.+/);

    const messages = await listMailpitMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.Subject).toMatch(/briefing matutino/i);

    await worker.close();
    worker = null;
  });

  it("zero-retention: la tabla briefings no contiene contenido de emails crudos (smoke check)", async () => {
    await sendUseCase.execute({ briefingId });
    const allBriefings = await prisma.briefing.findMany();
    expect(allBriefings).toHaveLength(1);
    // Las únicas filas en briefings son del briefing generado (no emails crudos).
    expect(allBriefings[0]!.summary).toContain("Lo más urgente");
  });
});
