import type { BriefingGeneratorPort } from "@/application/ports/BriefingGeneratorPort";
import type { BriefingRepositoryPort } from "@/application/ports/BriefingRepositoryPort";
import { Briefing } from "@/domain/briefing/Briefing";
import type { EmailMessage } from "@/domain/email-message/EmailMessage";

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

    const briefing = Briefing.create({
      userId: input.userId,
      summary: generated.summary,
      emailsConsidered: considered.length,
      emailsTruncated: truncatedCount,
      tokensUsedInput: generated.tokensUsedInput,
      tokensUsedOutput: generated.tokensUsedOutput,
      modelUsed: generated.modelUsed,
      promptVersion: this.deps.promptVersion,
    });
    await this.deps.briefingRepo.save(briefing);

    return { briefingId: briefing.id };
  }
}
