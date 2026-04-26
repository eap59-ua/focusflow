import { EmailMessage } from "@/domain/email-message/EmailMessage";

// Capa de serialización para cruzar la frontera JSON de BullMQ. Email content
// viaja por Redis aquí — las queues que lo usan tienen removeOnComplete
// acotado. Marcado `// OK: zero-retention` para que el grep estático de
// scripts/verify-zero-retention.ts ignore las líneas con campos sensibles.
export interface SerializedEmail {
  readonly id: string;
  readonly messageIdHeader: string;
  readonly threadId: string;
  readonly subject: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly toEmails: readonly string[];
  readonly snippet: string; // OK: zero-retention
  readonly receivedAt: string;
  readonly bodyText: string; // OK: zero-retention
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
    snippet: email.snippet, // OK: zero-retention
    receivedAt: email.receivedAt.toISOString(),
    bodyText: email.bodyText, // OK: zero-retention
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
    snippet: serialized.snippet, // OK: zero-retention
    receivedAt: new Date(serialized.receivedAt),
    bodyText: serialized.bodyText, // OK: zero-retention
  });
}
