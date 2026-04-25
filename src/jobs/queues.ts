import { Queue, type ConnectionOptions } from "bullmq";

export const QUEUE_NAMES = {
  GMAIL_INBOX_SYNC: "gmail-inbox-sync",
  GENERATE_BRIEFING: "generate-briefing",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 3600, count: 100 },
  removeOnFail: { age: 7 * 24 * 3600 },
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
