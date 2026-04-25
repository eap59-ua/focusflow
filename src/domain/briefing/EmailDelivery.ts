import { InvalidBriefingError } from "@/domain/briefing/errors/InvalidBriefingError";

export interface EmailDeliveryProps {
  readonly briefingId: string;
  readonly recipientEmail: string;
  readonly sentAt: Date;
  readonly messageId: string;
}

export class EmailDelivery {
  private constructor(private readonly props: EmailDeliveryProps) {}

  static create(props: EmailDeliveryProps): EmailDelivery {
    if (props.briefingId.trim().length === 0) {
      throw new InvalidBriefingError("EmailDelivery.briefingId es obligatorio");
    }
    if (props.recipientEmail.trim().length === 0) {
      throw new InvalidBriefingError(
        "EmailDelivery.recipientEmail es obligatorio",
      );
    }
    if (props.messageId.trim().length === 0) {
      throw new InvalidBriefingError("EmailDelivery.messageId es obligatorio");
    }
    return new EmailDelivery(props);
  }

  get briefingId(): string {
    return this.props.briefingId;
  }

  get recipientEmail(): string {
    return this.props.recipientEmail;
  }

  get sentAt(): Date {
    return this.props.sentAt;
  }

  get messageId(): string {
    return this.props.messageId;
  }
}
