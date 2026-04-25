import { Queue, type ConnectionOptions } from "bullmq";

export const QUEUE_NAMES = {
  GMAIL_INBOX_SYNC: "gmail-inbox-sync",
  GENERATE_BRIEFING: "generate-briefing",
  SEND_BRIEFING_EMAIL: "send-briefing-email",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 3600, count: 100 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

const SEND_EMAIL_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 60_000 },
} as const;

export function buildGmailInboxSyncQueue(connection: ConnectionOptions): Queue {
  return new Queue(QUEUE_NAMES.GMAIL_INBOX_SYNC, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

export function buildGenerateBriefingQueue(
  connection: ConnectionOptions,
): Queue {
  return new Queue(QUEUE_NAMES.GENERATE_BRIEFING, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
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
