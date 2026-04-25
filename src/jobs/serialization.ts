import { EmailMessage } from "@/domain/email-message/EmailMessage";

export interface SerializedEmail {
  readonly id: string;
  readonly messageIdHeader: string;
  readonly threadId: string;
  readonly subject: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly toEmails: readonly string[];
  readonly snippet: string;
  readonly receivedAt: string;
  readonly bodyText: string;
}

export function serializeEmail(email: EmailMessage): SerializedEmail {
  return {
    id: email.id,
    messageIdHeader: email.messageIdHeader,
    threadId: email.threadId,
    subject: email.subject,
    fromEmail: email.fromEmail.value,
    fromName: email.fromName,
    toEmails: email.toEmails,
    snippet: email.snippet,
    receivedAt: email.receivedAt.toISOString(),
    bodyText: email.bodyText,
  };
}

export function deserializeEmail(serialized: SerializedEmail): EmailMessage {
  return EmailMessage.create({
    id: serialized.id,
    messageIdHeader: serialized.messageIdHeader,
    threadId: serialized.threadId,
    subject: serialized.subject,
    fromEmail: serialized.fromEmail,
    fromName: serialized.fromName,
    toEmails: serialized.toEmails,
    snippet: serialized.snippet,
    receivedAt: new Date(serialized.receivedAt),
    bodyText: serialized.bodyText,
  });
}
