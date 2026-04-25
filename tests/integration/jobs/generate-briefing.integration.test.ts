// @vitest-environment node
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Queue, QueueEvents, type Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BriefingGeneratorPort } from "@/application/ports/BriefingGeneratorPort";
import { GenerateBriefing } from "@/application/use-cases/briefing/GenerateBriefing";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { PrismaBriefingRepository } from "@/infrastructure/adapters/prisma/PrismaBriefingRepository";
import { PrismaUserRepository } from "@/infrastructure/adapters/prisma/PrismaUserRepository";
import { MORNING_BRIEFING_PROMPT_VERSION } from "@/infrastructure/openai/prompts/morning-briefing";
import {
  QUEUE_NAMES,
  buildGenerateBriefingQueue,
  buildGenerateBriefingWorker,
  type GenerateBriefingJobResult,
  type SerializedEmail,
} from "@/jobs";

let prisma: PrismaClient;
let userRepo: PrismaUserRepository;
let briefingRepo: PrismaBriefingRepository;
let redis: Redis;
let queue: Queue;
let queueEvents: QueueEvents;
let worker: Worker | null = null;
let userId: string;

const SUMMARY =
  "Hoy tienes 3 reuniones importantes y dos respuestas pendientes a clientes clave para revisar.";

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no definida");
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL no definida");

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  userRepo = new PrismaUserRepository(prisma);
  briefingRepo = new PrismaBriefingRepository(prisma);
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  queue = buildGenerateBriefingQueue(redis);
  queueEvents = new QueueEvents(QUEUE_NAMES.GENERATE_BRIEFING, { connection: redis });
  await queueEvents.waitUntilReady();
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

  const user = User.create({
    email: Email.create("worker-briefing@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake"),
    displayName: "Worker User",
  });
  await userRepo.save(user);
  userId = user.id;
});

function makeFakeGenerator(): BriefingGeneratorPort & {
  generate: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn(async () => ({
    summary: SUMMARY,
    tokensUsedInput: 1234,
    tokensUsedOutput: 567,
    modelUsed: "gpt-4o-mini",
  }));
  return { generate };
}

function makeSerializedEmail(label: string): SerializedEmail {
  return {
    id: label,
    messageIdHeader: `<${label}@example.com>`,
    threadId: "t",
    subject: `Asunto ${label}`,
    fromEmail: "alice@example.com",
    fromName: "Alice",
    toEmails: ["me@gmail.com"],
    snippet: "snippet",
    receivedAt: "2026-04-25T08:00:00.000Z",
    bodyText: "body",
  };
}

describe("Worker generate-briefing (integration con BullMQ + Postgres + Redis reales)", () => {
  it("happy path: deserializa emails, genera briefing, persiste, devuelve briefingId", async () => {
    const generator = makeFakeGenerator();
    const useCase = new GenerateBriefing({
      briefingGenerator: generator,
      briefingRepo,
      promptVersion: MORNING_BRIEFING_PROMPT_VERSION,
    });
    worker = buildGenerateBriefingWorker({
      generateBriefing: useCase,
      connection: redis,
    });
    await worker.waitUntilReady();

    const job = await queue.add("gen-test", {
      userId,
      emails: [makeSerializedEmail("a"), makeSerializedEmail("b")],
    });

    const rawResult = await job.waitUntilFinished(queueEvents, 15_000);
    const result = rawResult as GenerateBriefingJobResult;

    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(generator.generate.mock.calls[0]![0]).toHaveLength(2);

    const row = await prisma.briefing.findUnique({
      where: { id: result.briefingId },
    });
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(userId);
    expect(row!.summary).toBe(SUMMARY);
    expect(row!.emailsConsidered).toBe(2);

    await worker.close();
    worker = null;
  });

  it("emails vacíos: NO invoca generator pero igual persiste Briefing placeholder", async () => {
    const generator = makeFakeGenerator();
    const useCase = new GenerateBriefing({
      briefingGenerator: generator,
      briefingRepo,
      promptVersion: MORNING_BRIEFING_PROMPT_VERSION,
    });
    worker = buildGenerateBriefingWorker({
      generateBriefing: useCase,
      connection: redis,
    });
    await worker.waitUntilReady();

    const job = await queue.add("gen-empty", { userId, emails: [] });
    const rawResult = await job.waitUntilFinished(queueEvents, 15_000);
    const result = rawResult as GenerateBriefingJobResult;

    expect(generator.generate).not.toHaveBeenCalled();
    const row = await prisma.briefing.findUnique({
      where: { id: result.briefingId },
    });
    expect(row).not.toBeNull();
    expect(row!.modelUsed).toBe("none");

    await worker.close();
    worker = null;
  });

  it("zero-retention: ningún rastro de bodyText/snippet de emails crudos en la DB tras procesar el job", async () => {
    const generator = makeFakeGenerator();
    const useCase = new GenerateBriefing({
      briefingGenerator: generator,
      briefingRepo,
      promptVersion: MORNING_BRIEFING_PROMPT_VERSION,
    });
    worker = buildGenerateBriefingWorker({
      generateBriefing: useCase,
      connection: redis,
    });
    await worker.waitUntilReady();

    const sensitive: SerializedEmail = {
      id: "s-1",
      messageIdHeader: "<s@x.com>",
      threadId: "t",
      subject: "S",
      fromEmail: "a@x.com",
      fromName: null,
      toEmails: [],
      snippet: "TOKEN-SECRETO-XYZ-123",
      receivedAt: "2026-04-25T08:00:00.000Z",
      bodyText: "PAYLOAD-CONFIDENCIAL-ABC",
    };

    const job = await queue.add("gen-sensitive", {
      userId,
      emails: [sensitive],
    });
    await job.waitUntilFinished(queueEvents, 15_000);

    const allBriefings = await prisma.briefing.findMany();
    for (const b of allBriefings) {
      expect(b.summary).not.toContain("TOKEN-SECRETO-XYZ-123");
      expect(b.summary).not.toContain("PAYLOAD-CONFIDENCIAL-ABC");
    }

    await worker.close();
    worker = null;
  });
});
