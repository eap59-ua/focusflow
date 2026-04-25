import OpenAI from "openai";

import type {
  BriefingGenerationResult,
  BriefingGeneratorPort,
} from "@/application/ports/BriefingGeneratorPort";
import type { EmailMessage } from "@/domain/email-message/EmailMessage";
import { buildMorningBriefingPrompt } from "@/infrastructure/openai/prompts/morning-briefing";

const NOT_CONFIGURED_MSG =
  "OPENAI_API_KEY no está configurada. Añádela al .env. Ver docs/pending-external-setup.md.";

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_TOKENS = 1500;

export interface OpenAIBriefingGeneratorConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly client?: OpenAI;
}

export class OpenAIBriefingGenerator implements BriefingGeneratorPort {
  constructor(private readonly config: OpenAIBriefingGeneratorConfig) {}

  private buildClient(): OpenAI {
    if (this.config.client) return this.config.client;
    if (!this.config.apiKey) {
      throw new Error(NOT_CONFIGURED_MSG);
    }
    return new OpenAI({ apiKey: this.config.apiKey });
  }

  async generate(
    emails: readonly EmailMessage[],
  ): Promise<BriefingGenerationResult> {
    const client = this.buildClient();
    const { system, user } = buildMorningBriefingPrompt(emails);

    const response = await client.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: DEFAULT_MAX_TOKENS,
    });

    const summary = response.choices[0]?.message?.content?.trim() ?? "";
    const usage = response.usage;

    return {
      summary,
      tokensUsedInput: usage?.prompt_tokens ?? 0,
      tokensUsedOutput: usage?.completion_tokens ?? 0,
      modelUsed: response.model,
    };
  }
}
