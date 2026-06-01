import { describe, expect, it, vi } from "vitest";

import type { BriefingGeneratorPort } from "@/application/ports/BriefingGeneratorPort";
import type { BriefingRepositoryPort } from "@/application/ports/BriefingRepositoryPort";
import { GenerateBriefing } from "@/application/use-cases/briefing/GenerateBriefing";
import { Briefing } from "@/domain/briefing/Briefing";
import { BriefingTooShortError } from "@/domain/briefing/errors/BriefingTooShortError";
import { EmailMessage } from "@/domain/email-message/EmailMessage";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const PROMPT_VERSION = "v1.0.0";

function makeEmail(opts: {
  id?: string;
  subjectLen?: number;
  bodyLen?: number;
} = {}): EmailMessage {
  const id = opts.id ?? "msg-1";
  return EmailMessage.create({
    id,
    messageIdHeader: `<${id}@x.com>`,
    threadId: "t",
    subject: "S".repeat(opts.subjectLen ?? 10),
    fromEmail: "alice@example.com",
    fromName: "Alice",
    toEmails: ["me@gmail.com"],
    snippet: "snippet",
    receivedAt: new Date("2026-04-25T08:00:00Z"),
    bodyText: "B".repeat(opts.bodyLen ?? 100),
  });
}

function makeDeps(
  overrides: Partial<{
    generate: BriefingGeneratorPort["generate"];
    save: BriefingRepositoryPort["save"];
    findById: BriefingRepositoryPort["findById"];
    findLatestByUserId: BriefingRepositoryPort["findLatestByUserId"];
    maxInputTokens: number;
  }> = {},
) {
  const generate = vi.fn(
    overrides.generate ??
      (async () => ({
        summary:
          "Hoy tienes 3 reuniones importantes y dos respuestas pendientes a clientes clave.",
        tokensUsedInput: 1200,
        tokensUsedOutput: 250,
        modelUsed: "gpt-4o-mini",
      })),
  );
  const save = vi.fn(overrides.save ?? (async () => undefined));
  const findById = vi.fn(overrides.findById ?? (async () => null));
  const findLatestByUserId = vi.fn(
    overrides.findLatestByUserId ?? (async () => null),
  );

  const generator: BriefingGeneratorPort = { generate };
  const repo: BriefingRepositoryPort = {
    save,
    findById,
    findLatestByUserId,
  };

  return {
    deps: {
      briefingGenerator: generator,
      briefingRepo: repo,
      promptVersion: PROMPT_VERSION,
      maxInputTokens: overrides.maxInputTokens,
    },
    generate,
    save,
  };
}

describe("GenerateBriefing use case", () => {
  it("happy path con emails: llama generator, persiste Briefing con métricas", async () => {
    const { deps, generate, save } = makeDeps();
    const useCase = new GenerateBriefing(deps);

    const result = await useCase.execute({
      userId: USER_ID,
      emails: [makeEmail({ id: "a" }), makeEmail({ id: "b" })],
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0]).toHaveLength(2);
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0] as Briefing;
    expect(saved.userId).toBe(USER_ID);
    expect(saved.emailsConsidered).toBe(2);
    expect(saved.emailsTruncated).toBe(0);
    expect(saved.tokensUsedInput).toBe(1200);
    expect(saved.tokensUsedOutput).toBe(250);
    expect(saved.modelUsed).toBe("gpt-4o-mini");
    expect(saved.promptVersion).toBe(PROMPT_VERSION);
    expect(result.briefingId).toBe(saved.id);
  });

  it("emails vacíos: NO llama generator, persiste Briefing placeholder con métricas en 0", async () => {
    const { deps, generate, save } = makeDeps();
    const useCase = new GenerateBriefing(deps);

    await useCase.execute({ userId: USER_ID, emails: [] });

    expect(generate).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0] as Briefing;
    expect(saved.emailsConsidered).toBe(0);
    expect(saved.emailsTruncated).toBe(0);
    expect(saved.tokensUsedInput).toBe(0);
    expect(saved.tokensUsedOutput).toBe(0);
    expect(saved.modelUsed).toBe("none");
    expect(saved.summary.length).toBeGreaterThanOrEqual(50);
  });

  it("trunca cuando la suma de chars excede maxInputTokens*4", async () => {
    const { deps, generate, save } = makeDeps({ maxInputTokens: 100 });
    const useCase = new GenerateBriefing(deps);
    const heavy = Array.from({ length: 5 }, (_, i) =>
      makeEmail({ id: `m${i}`, bodyLen: 200 }),
    );

    await useCase.execute({ userId: USER_ID, emails: heavy });

    const consideredArg = generate.mock.calls[0]![0] as readonly EmailMessage[];
    expect(consideredArg.length).toBeLessThan(5);
    const saved = save.mock.calls[0]![0] as Briefing;
    expect(saved.emailsConsidered).toBe(consideredArg.length);
    expect(saved.emailsTruncated).toBe(5 - consideredArg.length);
  });

  it("propaga error del generator sin persistir", async () => {
    const oaiError = new Error("openai 429 rate limit");
    const { deps, save } = makeDeps({
      generate: async () => {
        throw oaiError;
      },
    });
    const useCase = new GenerateBriefing(deps);

    await expect(
      useCase.execute({ userId: USER_ID, emails: [makeEmail()] }),
    ).rejects.toBe(oaiError);
    expect(save).not.toHaveBeenCalled();
  });

  it("generator devuelve summary corto → BriefingTooShortError, no persiste", async () => {
    const { deps, save } = makeDeps({
      generate: async () => ({
        summary: "muy corto",
        tokensUsedInput: 10,
        tokensUsedOutput: 5,
        modelUsed: "gpt-4o-mini",
      }),
    });
    const useCase = new GenerateBriefing(deps);

    await expect(
      useCase.execute({ userId: USER_ID, emails: [makeEmail()] }),
    ).rejects.toBeInstanceOf(BriefingTooShortError);
    expect(save).not.toHaveBeenCalled();
  });

  it("propaga error de save", async () => {
    const dbErr = new Error("db down");
    const { deps } = makeDeps({
      save: async () => {
        throw dbErr;
      },
    });
    const useCase = new GenerateBriefing(deps);

    await expect(
      useCase.execute({ userId: USER_ID, emails: [makeEmail()] }),
    ).rejects.toBe(dbErr);
  });

  it("retorna briefingId que coincide con el del briefing persistido", async () => {
    const { deps, save } = makeDeps();
    const useCase = new GenerateBriefing(deps);

    const { briefingId } = await useCase.execute({
      userId: USER_ID,
      emails: [makeEmail()],
    });
    const saved = save.mock.calls[0]![0] as Briefing;
    expect(briefingId).toBe(saved.id);
  });

  it("emails dentro del budget: no trunca, todos pasan al generator", async () => {
    const { deps, generate, save } = makeDeps();
    const useCase = new GenerateBriefing(deps);
    await useCase.execute({
      userId: USER_ID,
      emails: [makeEmail({ id: "a" }), makeEmail({ id: "b" }), makeEmail({ id: "c" })],
    });
    expect(generate.mock.calls[0]![0]).toHaveLength(3);
    const saved = save.mock.calls[0]![0] as Briefing;
    expect(saved.emailsTruncated).toBe(0);
  });
});
