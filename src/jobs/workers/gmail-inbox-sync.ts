import { Worker, type ConnectionOptions } from "bullmq";

import type { FetchInboxEmails } from "@/application/use-cases/email/FetchInboxEmails";

import { QUEUE_NAMES } from "../queues";

export interface GmailInboxSyncJobData {
  readonly userId: string;
  readonly sinceISO: string | null;
}

export interface GmailInboxSyncJobResult {
  readonly count: number;
  readonly integrationId: string;
}

export interface GmailInboxSyncWorkerDependencies {
  readonly fetchInboxEmails: FetchInboxEmails;
  readonly connection: ConnectionOptions;
}

export function buildGmailInboxSyncWorker(
  deps: GmailInboxSyncWorkerDependencies,
): Worker<GmailInboxSyncJobData, GmailInboxSyncJobResult> {
  return new Worker<GmailInboxSyncJobData, GmailInboxSyncJobResult>(
    QUEUE_NAMES.GMAIL_INBOX_SYNC,
    async (job) => {
      const { userId, sinceISO } = job.data;
      const since = sinceISO ? new Date(sinceISO) : undefined;
      const { emails, integrationId } = await deps.fetchInboxEmails.execute({
        userId,
        since,
      });
      return { count: emails.length, integrationId };
    },
    { connection: deps.connection },
  );
}
