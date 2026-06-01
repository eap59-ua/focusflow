import type { BriefingGeneratorPort } from "@/application/ports/BriefingGeneratorPort";
import type { BriefingRepositoryPort } from "@/application/ports/BriefingRepositoryPort";
import type { LoggerPort } from "@/application/ports/LoggerPort";
import { Briefing } from "@/domain/briefing/Briefing";
import { BriefingTooShortError } from "@/domain/briefing/errors/BriefingTooShortError";
import type { EmailMessage } from "@/domain/email-message/EmailMessage";

interface GeneratedBriefing {
  readonly summary: string;
  readonly tokensUsedInput: number;
  readonly tokensUsedOutput: number;
  readonly modelUsed: string;
}

const DEFAULT_MAX_INPUT_TOKENS = 8000;
const CHARS_PER_TOKEN = 4;
const EMPTY_INBOX_SUMMARY =
  "No tienes emails nuevos esta mañana. Disfruta del día sin distracciones — todo está bajo control.";
const EMPTY_INBOX_MODEL = "none";

export interface GenerateBriefingDependencies {
  readonly briefingGenerator: BriefingGeneratorPort;
  readonly briefingRepo: BriefingRepositoryPort;
  readonly promptVersion: string;
  readonly maxInputTokens?: number;
  readonly logger?: LoggerPort;
}

export interface GenerateBriefingInput {
  readonly userId: string;
  readonly emails: readonly EmailMessage[];
}

export interface GenerateBriefingOutput {
  readonly briefingId: string;
}

function emailCharCount(email: EmailMessage): number {
  return email.subject.length + email.snippet.length + email.bodyText.length;
}

export class GenerateBriefing {
  private readonly maxInputTokens: number;

  constructor(private readonly deps: GenerateBriefingDependencies) {
    this.maxInputTokens = deps.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  }

  async execute(input: GenerateBriefingInput): Promise<GenerateBriefingOutput> {
    if (input.emails.length === 0) {
      const empty = Briefing.create({
        userId: input.userId,
        summary: EMPTY_INBOX_SUMMARY,
        emailsConsidered: 0,
        emailsTruncated: 0,
        tokensUsedInput: 0,
        tokensUsedOutput: 0,
        modelUsed: EMPTY_INBOX_MODEL,
        promptVersion: this.deps.promptVersion,
      });
      await this.deps.briefingRepo.save(empty);
      this.deps.logger?.info({
        event: "briefing_generated",
        userId: input.userId,
        briefingId: empty.id,
        emailsConsidered: 0,
        emailsTruncated: 0,
        tokensUsedInput: 0,
        tokensUsedOutput: 0,
        modelUsed: EMPTY_INBOX_MODEL,
        promptVersion: this.deps.promptVersion,
        placeholder: true,
      });
      return { briefingId: empty.id };
    }

    const charBudget = this.maxInputTokens * CHARS_PER_TOKEN;
    const considered: EmailMessage[] = [];
    let runningChars = 0;
    let truncatedCount = 0;

    for (let i = 0; i < input.emails.length; i++) {
      const email = input.emails[i]!;
      const charsForThis = emailCharCount(email);
      if (runningChars + charsForThis > charBudget && considered.length > 0) {
        truncatedCount = input.emails.length - considered.length;
        break;
      }
      runningChars += charsForThis;
      considered.push(email);
    }

    const generated = await this.deps.briefingGenerator.generate(considered);

    let briefing: Briefing;
    let usedFallback = false;
    try {
      briefing = Briefing.create({
        userId: input.userId,
        summary: generated.summary,
        emailsConsidered: considered.length,
        emailsTruncated: truncatedCount,
        tokensUsedInput: generated.tokensUsedInput,
        tokensUsedOutput: generated.tokensUsedOutput,
        modelUsed: generated.modelUsed,
        promptVersion: this.deps.promptVersion,
      });
    } catch (err) {
      // S4: si OpenAI devuelve un summary vacío o demasiado corto,
      // Briefing.create lanza BriefingTooShortError. En vez de propagar (lo que
      // dispararía retries y dejaría al usuario sin briefing del día), se
      // persiste un briefing de fallback explicativo. NO se reintenta.
      if (!(err instanceof BriefingTooShortError)) {
        throw err;
      }
      usedFallback = true;
      briefing = this.fallbackBriefing(
        input.userId,
        considered.length,
        truncatedCount,
        generated,
      );
    }

    await this.deps.briefingRepo.save(briefing);

    this.deps.logger?.info({
      event: "briefing_generated",
      userId: input.userId,
      briefingId: briefing.id,
      emailsConsidered: considered.length,
      emailsTruncated: truncatedCount,
      tokensUsedInput: generated.tokensUsedInput,
      tokensUsedOutput: generated.tokensUsedOutput,
      modelUsed: generated.modelUsed,
      promptVersion: this.deps.promptVersion,
      placeholder: false,
      fallback: usedFallback,
    });

    return { briefingId: briefing.id };
  }

  private fallbackBriefing(
    userId: string,
    emailsConsidered: number,
    emailsTruncated: number,
    generated: GeneratedBriefing,
  ): Briefing {
    const plural = emailsConsidered === 1 ? "email" : "emails";
    return Briefing.create({
      userId,
      summary:
        `Hoy procesé ${emailsConsidered} ${plural} de tu inbox, pero el generador de IA ` +
        `produjo un resumen demasiado corto (posiblemente por baja relevancia). ` +
        `Revisa tu inbox directamente si esperabas algo importante.`,
      emailsConsidered,
      emailsTruncated,
      tokensUsedInput: generated.tokensUsedInput,
      tokensUsedOutput: generated.tokensUsedOutput,
      modelUsed: generated.modelUsed.trim().length > 0 ? generated.modelUsed : "fallback",
      promptVersion: this.deps.promptVersion,
    });
  }
}
