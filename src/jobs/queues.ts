import { Queue, type ConnectionOptions } from "bullmq";

export const QUEUE_NAMES = {
  GMAIL_INBOX_SYNC: "gmail-inbox-sync",
  GENERATE_BRIEFING: "generate-briefing",
  SEND_BRIEFING_EMAIL: "send-briefing-email",
  BRIEFING_TRIGGER: "briefing-trigger",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// Zero-retention estricto (S1, Paso 8).
//
// El payload de varios jobs cruza la frontera JSON de BullMQ y queda en Redis.
// `gmail-inbox-sync` (result) y `generate-briefing` (data) cargan email content
// (bodyText/snippet). CLAUDE.md exige "borrado inmediato tras procesamiento":
//
//   - removeOnComplete.age = 300s (5 min): mínimo técnico para el handover del
//     FlowProducer entre workers; pasado ese plazo el payload se borra.
//   - removeOnFail.age = 3600s (1 h): mínimo para debug post-mortem. El contenido
//     sensible se wipea ADEMÁS explícitamente en el error handler del worker antes
//     de que BullMQ persista el estado fallido (ver src/jobs/workers/*).
//
// Ver docs/audits/zero-retention-policy.md § "Compromiso explícito (Paso 8)".
const STRICT_ZERO_RETENTION = {
  removeOnComplete: { age: 300, count: 50 },
  removeOnFail: { age: 3600, count: 100 },
} as const;

const SEND_EMAIL_JOB_OPTIONS = {
  ...STRICT_ZERO_RETENTION,
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 60_000 },
} as const;

export function buildGmailInboxSyncQueue(connection: ConnectionOptions): Queue {
  return new Queue(QUEUE_NAMES.GMAIL_INBOX_SYNC, {
    connection,
    defaultJobOptions: STRICT_ZERO_RETENTION,
  });
}

export function buildGenerateBriefingQueue(
  connection: ConnectionOptions,
): Queue {
  return new Queue(QUEUE_NAMES.GENERATE_BRIEFING, {
    connection,
    defaultJobOptions: STRICT_ZERO_RETENTION,
  });
}

export function buildSendBriefingEmailQueue(
  connection: ConnectionOptions,
): Queue {
  return new Queue(QUEUE_NAMES.SEND_BRIEFING_EMAIL, {
    connection,
    defaultJobOptions: SEND_EMAIL_JOB_OPTIONS,
  });
}

export function buildBriefingTriggerQueue(
  connection: ConnectionOptions,
): Queue {
  return new Queue(QUEUE_NAMES.BRIEFING_TRIGGER, {
    connection,
    defaultJobOptions: STRICT_ZERO_RETENTION,
  });
}
