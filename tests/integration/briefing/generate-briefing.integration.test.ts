// @vitest-environment node
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BriefingGeneratorPort } from "@/application/ports/BriefingGeneratorPort";
import { GenerateBriefing } from "@/application/use-cases/briefing/GenerateBriefing";
import { EmailMessage } from "@/domain/email-message/EmailMessage";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { PrismaBriefingRepository } from "@/infrastructure/adapters/prisma/PrismaBriefingRepository";
import { PrismaUserRepository } from "@/infrastructure/adapters/prisma/PrismaUserRepository";
import { MORNING_BRIEFING_PROMPT_VERSION } from "@/infrastructure/openai/prompts/morning-briefing";

let prisma: PrismaClient;
let briefingRepo: PrismaBriefingRepository;
let userRepo: PrismaUserRepository;
let userId: string;

const SUMMARY =
  "Hoy tienes 3 reuniones importantes y dos respuestas pendientes a clientes clave para revisar.";

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no definida");
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  briefingRepo = new PrismaBriefingRepository(prisma);
  userRepo = new PrismaUserRepository(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.briefing.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  const user = User.create({
    email: Email.create("briefing-user@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake"),
    displayName: "Briefing User",
  });
  await userRepo.save(user);
  userId = user.id;
});

function makeEmail(label: string): EmailMessage {
  return EmailMessage.create({
    id: label,
    messageIdHeader: `<${label}@example.com>`,
    threadId: `t-${label}`,
    subject: `Asunto ${label}`,
    fromEmail: "alice@example.com",
    fromName: "Alice",
    toEmails: ["me@gmail.com"],
    snippet: "snippet",
    receivedAt: new Date("2026-04-25T08:00:00Z"),
    bodyText: `Cuerpo del email ${label}`,
  });
}

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

describe("GenerateBriefing end-to-end (Postgres real + FakeBriefingGenerator)", () => {
  it("happy path: persiste Briefing en DB con métricas y promptVersion", async () => {
    const generator = makeFakeGenerator();
    const useCase = new GenerateBriefing({
      briefingGenerator: generator,
      briefingRepo,
      promptVersion: MORNING_BRIEFING_PROMPT_VERSION,
    });

    const { briefingId } = await useCase.execute({
      userId,
      emails: [makeEmail("a"), makeEmail("b")],
    });

    expect(generator.generate).toHaveBeenCalledTimes(1);
    const row = await prisma.briefing.findUnique({ where: { id: briefingId } });
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(userId);
    expect(row!.summary).toBe(SUMMARY);
    expect(row!.emailsConsidered).toBe(2);
    expect(row!.emailsTruncated).toBe(0);
    expect(row!.tokensUsedInput).toBe(1234);
    expect(row!.tokensUsedOutput).toBe(567);
    expect(row!.modelUsed).toBe("gpt-4o-mini");
    expect(row!.promptVersion).toBe(MORNING_BRIEFING_PROMPT_VERSION);
  });

  it("emails vacíos: NO llama generator, persiste placeholder con métricas en 0", async () => {
    const generator = makeFakeGenerator();
    const useCase = new GenerateBriefing({
      briefingGenerator: generator,
      briefingRepo,
      promptVersion: MORNING_BRIEFING_PROMPT_VERSION,
    });

    const { briefingId } = await useCase.execute({ userId, emails: [] });

    expect(generator.generate).not.toHaveBeenCalled();
    const row = await prisma.briefing.findUnique({ where: { id: briefingId } });
    expect(row).not.toBeNull();
    expect(row!.emailsConsidered).toBe(0);
    expect(row!.tokensUsedInput).toBe(0);
    expect(row!.modelUsed).toBe("none");
    expect(row!.summary.length).toBeGreaterThanOrEqual(50);
  });

  it("PrismaBriefingRepository.findLatestByUserId devuelve el más reciente", async () => {
    const useCase = new GenerateBriefing({
      briefingGenerator: makeFakeGenerator(),
      briefingRepo,
      promptVersion: MORNING_BRIEFING_PROMPT_VERSION,
    });

    const first = await useCase.execute({ userId, emails: [makeEmail("a")] });
    await new Promise((r) => setTimeout(r, 10));
    const second = await useCase.execute({ userId, emails: [makeEmail("b")] });

    const latest = await briefingRepo.findLatestByUserId(userId);
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(second.briefingId);
    expect(latest!.id).not.toBe(first.briefingId);
  });

  it("PrismaBriefingRepository.findById reconstruye Briefing desde DB", async () => {
    const useCase = new GenerateBriefing({
      briefingGenerator: makeFakeGenerator(),
      briefingRepo,
      promptVersion: MORNING_BRIEFING_PROMPT_VERSION,
    });
    const { briefingId } = await useCase.execute({
      userId,
      emails: [makeEmail("a")],
    });

    const found = await briefingRepo.findById(briefingId);
    expect(found).not.toBeNull();
    expect(found!.summary).toBe(SUMMARY);
    expect(found!.tokensUsedInput).toBe(1234);
    expect(found!.modelUsed).toBe("gpt-4o-mini");
  });

  it("zero-retention: la tabla briefings NO contiene contenido de emails crudos", async () => {
    const useCase = new GenerateBriefing({
      briefingGenerator: makeFakeGenerator(),
      briefingRepo,
      promptVersion: MORNING_BRIEFING_PROMPT_VERSION,
    });

    const sensitiveEmail = EmailMessage.create({
      id: "sensitive-1",
      messageIdHeader: "<sensitive@example.com>",
      threadId: "t",
      subject: "PALABRA-MAGICA-12345",
      fromEmail: "secret@example.com",
      fromName: "Secret",
      toEmails: ["me@gmail.com"],
      snippet: "INFORMACION-CONFIDENCIAL",
      receivedAt: new Date("2026-04-25T08:00:00Z"),
      bodyText: "DATOS-PRIVADOS-XYZ",
    });

    await useCase.execute({ userId, emails: [sensitiveEmail] });

    const allBriefings = await prisma.briefing.findMany();
    for (const b of allBriefings) {
      expect(b.summary).not.toContain("PALABRA-MAGICA-12345");
      expect(b.summary).not.toContain("INFORMACION-CONFIDENCIAL");
      expect(b.summary).not.toContain("DATOS-PRIVADOS-XYZ");
    }
  });
});
