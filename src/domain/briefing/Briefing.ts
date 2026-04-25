import { BriefingTooShortError } from "@/domain/briefing/errors/BriefingTooShortError";
import { InvalidBriefingError } from "@/domain/briefing/errors/InvalidBriefingError";

const MIN_SUMMARY_LENGTH = 50;

export interface BriefingProps {
  readonly id: string;
  readonly userId: string;
  readonly summary: string;
  readonly emailsConsidered: number;
  readonly emailsTruncated: number;
  readonly tokensUsedInput: number;
  readonly tokensUsedOutput: number;
  readonly modelUsed: string;
  readonly promptVersion: string;
  readonly createdAt: Date;
}

export interface CreateBriefingInput {
  readonly userId: string;
  readonly summary: string;
  readonly emailsConsidered: number;
  readonly emailsTruncated: number;
  readonly tokensUsedInput: number;
  readonly tokensUsedOutput: number;
  readonly modelUsed: string;
  readonly promptVersion: string;
}

export class Briefing {
  private constructor(private readonly props: BriefingProps) {}

  static create(input: CreateBriefingInput): Briefing {
    if (input.userId.trim().length === 0) {
      throw new InvalidBriefingError("userId es obligatorio");
    }
    if (input.modelUsed.trim().length === 0) {
      throw new InvalidBriefingError("modelUsed es obligatorio");
    }
    if (input.promptVersion.trim().length === 0) {
      throw new InvalidBriefingError("promptVersion es obligatorio");
    }
    if (input.summary.trim().length < MIN_SUMMARY_LENGTH) {
      throw new BriefingTooShortError();
    }
    if (input.emailsConsidered < 0) {
      throw new InvalidBriefingError("emailsConsidered debe ser >= 0");
    }
    if (input.emailsTruncated < 0) {
      throw new InvalidBriefingError("emailsTruncated debe ser >= 0");
    }
    if (input.tokensUsedInput < 0) {
      throw new InvalidBriefingError("tokensUsedInput debe ser >= 0");
    }
    if (input.tokensUsedOutput < 0) {
      throw new InvalidBriefingError("tokensUsedOutput debe ser >= 0");
    }

    return new Briefing({
      id: crypto.randomUUID(),
      userId: input.userId,
      summary: input.summary,
      emailsConsidered: input.emailsConsidered,
      emailsTruncated: input.emailsTruncated,
      tokensUsedInput: input.tokensUsedInput,
      tokensUsedOutput: input.tokensUsedOutput,
      modelUsed: input.modelUsed,
      promptVersion: input.promptVersion,
      createdAt: new Date(),
    });
  }

  static restore(props: BriefingProps): Briefing {
    return new Briefing(props);
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get summary(): string {
    return this.props.summary;
  }

  get emailsConsidered(): number {
    return this.props.emailsConsidered;
  }

  get emailsTruncated(): number {
    return this.props.emailsTruncated;
  }

  get tokensUsedInput(): number {
    return this.props.tokensUsedInput;
  }

  get tokensUsedOutput(): number {
    return this.props.tokensUsedOutput;
  }

  get modelUsed(): string {
    return this.props.modelUsed;
  }

  get promptVersion(): string {
    return this.props.promptVersion;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
