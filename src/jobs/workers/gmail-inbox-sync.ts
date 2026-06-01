import { Worker, type ConnectionOptions, type Job } from "bullmq";

import type { FetchInboxEmails } from "@/application/use-cases/email/FetchInboxEmails";

import { QUEUE_NAMES } from "../queues";
import { serializeEmail, type SerializedEmail } from "../serialization";

export interface GmailInboxSyncJobData {
  readonly userId: string;
  readonly sinceISO: string | null;
  // Marcador de zero-retention: el error handler reescribe job.data a la forma
  // mínima cuando el job falla (ver runGmailInboxSyncJob).
  readonly _wiped?: boolean;
}

export interface GmailInboxSyncJobResult {
  readonly count: number;
  readonly integrationId: string;
  readonly emails: readonly SerializedEmail[];
}

export interface GmailInboxSyncWorkerDependencies {
  readonly fetchInboxEmails: FetchInboxEmails;
  readonly connection: ConnectionOptions;
}

type GmailInboxSyncJob = Pick<
  Job<GmailInboxSyncJobData, GmailInboxSyncJobResult>,
  "data" | "updateData"
>;

/**
 * Procesa un job de sync de inbox. Extraído del Worker para poder testear el
 * comportamiento de zero-retention en el error handler sin levantar Redis.
 */
export async function runGmailInboxSyncJob(
  job: GmailInboxSyncJob,
  fetchInboxEmails: Pick<FetchInboxEmails, "execute">,
): Promise<GmailInboxSyncJobResult> {
  try {
    const { userId, sinceISO } = job.data;
    const since = sinceISO ? new Date(sinceISO) : undefined;
    const { emails, integrationId } = await fetchInboxEmails.execute({
      userId,
      since,
    });
    return {
      count: emails.length,
      integrationId,
      emails: emails.map(serializeEmail),
    };
  } catch (err) {
    // Este job sólo lleva userId+sinceISO en data (sin contenido sensible), pero
    // wipeamos por consistencia con generate-briefing antes de que BullMQ persista
    // el estado fallido (removeOnFail.age).
    await job.updateData({
      userId: job.data.userId,
      sinceISO: job.data.sinceISO,
      _wiped: true,
    });
    throw err;
  }
}

export function buildGmailInboxSyncWorker(
  deps: GmailInboxSyncWorkerDependencies,
): Worker<GmailInboxSyncJobData, GmailInboxSyncJobResult> {
  return new Worker<GmailInboxSyncJobData, GmailInboxSyncJobResult>(
    QUEUE_NAMES.GMAIL_INBOX_SYNC,
    (job) => runGmailInboxSyncJob(job, deps.fetchInboxEmails),
    { connection: deps.connection },
  );
}
