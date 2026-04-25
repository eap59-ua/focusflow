import type { EmailMessage } from "@/domain/email-message/EmailMessage";

export interface BriefingGenerationResult {
  readonly summary: string;
  readonly tokensUsedInput: number;
  readonly tokensUsedOutput: number;
  readonly modelUsed: string;
}

export interface BriefingGeneratorPort {
  generate(emails: readonly EmailMessage[]): Promise<BriefingGenerationResult>;
}
