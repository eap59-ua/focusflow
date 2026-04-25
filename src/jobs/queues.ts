import { Queue, type ConnectionOptions } from "bullmq";

export const QUEUE_NAMES = {
  GMAIL_INBOX_SYNC: "gmail-inbox-sync",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export function buildGmailInboxSyncQueue(connection: ConnectionOptions): Queue {
  return new Queue(QUEUE_NAMES.GMAIL_INBOX_SYNC, { connection });
}
