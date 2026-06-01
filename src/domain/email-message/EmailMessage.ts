import { Email } from "@/domain/user/Email";
import { InvalidEmailMessageError } from "@/domain/email-message/errors/InvalidEmailMessageError";

const MAX_FUTURE_SKEW_MS = 60 * 1000;

export interface EmailMessageProps {
  readonly id: string;
  readonly messageIdHeader: string;
  readonly threadId: string;
  readonly subject: string;
  readonly fromEmail: Email;
  readonly fromName: string | null;
  readonly toEmails: readonly string[];
  readonly snippet: string;
  readonly receivedAt: Date;
  readonly bodyText: string;
}

export interface CreateEmailMessageInput {
  readonly id: string;
  readonly messageIdHeader: string;
  readonly threadId: string;
  readonly subject: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly toEmails: readonly string[];
  readonly snippet: string;
  readonly receivedAt: Date;
  readonly bodyText: string;
}

export class EmailMessage {
  private constructor(private readonly props: EmailMessageProps) {}

  static create(input: CreateEmailMessageInput): EmailMessage {
    if (input.id.trim().length === 0) {
      throw new InvalidEmailMessageError("id es obligatorio");
    }
    if (input.messageIdHeader.trim().length === 0) {
      throw new InvalidEmailMessageError("messageIdHeader es obligatorio");
    }
    if (input.threadId.trim().length === 0) {
      throw new InvalidEmailMessageError("threadId es obligatorio");
    }

    let fromEmail: Email;
    try {
      fromEmail = Email.create(input.fromEmail);
    } catch {
      throw new InvalidEmailMessageError(
        `fromEmail con formato inválido: "${input.fromEmail}"`,
      );
    }

    const now = Date.now();
    if (input.receivedAt.getTime() > now + MAX_FUTURE_SKEW_MS) {
      throw new InvalidEmailMessageError(
        "receivedAt no puede estar en el futuro (más allá de 60s de skew)",
      );
    }

    return new EmailMessage({
      id: input.id,
      messageIdHeader: input.messageIdHeader,
      threadId: input.threadId,
      subject: input.subject,
      fromEmail,
      fromName: input.fromName,
      toEmails: input.toEmails,
      snippet: input.snippet,
      receivedAt: input.receivedAt,
      bodyText: input.bodyText,
    });
  }

  get id(): string {
    return this.props.id;
  }

  get messageIdHeader(): string {
    return this.props.messageIdHeader;
  }

  get threadId(): string {
    return this.props.threadId;
  }

  get subject(): string {
    return this.props.subject;
  }

  get fromEmail(): Email {
    return this.props.fromEmail;
  }

  get fromName(): string | null {
    return this.props.fromName;
  }

  get toEmails(): readonly string[] {
    return this.props.toEmails;
  }

  get snippet(): string {
    return this.props.snippet;
  }

  get receivedAt(): Date {
    return this.props.receivedAt;
  }

  get bodyText(): string {
    return this.props.bodyText;
  }
}
