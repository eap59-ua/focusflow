import { Worker, type ConnectionOptions } from "bullmq";

import type { GenerateBriefing } from "@/application/use-cases/briefing/GenerateBriefing";

import { QUEUE_NAMES } from "../queues";
import { deserializeEmail, type SerializedEmail } from "../serialization";

export interface GenerateBriefingJobData {
  readonly userId: string;
  readonly emails?: readonly SerializedEmail[];
}

export interface GenerateBriefingJobResult {
  readonly briefingId: string;
}

export interface GenerateBriefingWorkerDependencies {
  readonly generateBriefing: GenerateBriefing;
  readonly connection: ConnectionOptions;
}

interface ChildSyncResult {
  readonly emails?: readonly SerializedEmail[];
}

export function buildGenerateBriefingWorker(
  deps: GenerateBriefingWorkerDependencies,
): Worker<GenerateBriefingJobData, GenerateBriefingJobResult> {
  return new Worker<GenerateBriefingJobData, GenerateBriefingJobResult>(
    QUEUE_NAMES.GENERATE_BRIEFING,
    async (job) => {
      let serializedEmails = job.data.emails;
      if (!serializedEmails || serializedEmails.length === 0) {
        const childrenValues = await job.getChildrenValues<ChildSyncResult>();
        const firstChild = Object.values(childrenValues)[0];
        if (firstChild?.emails) {
          serializedEmails = firstChild.emails;
        }
      }
      const emails = (serializedEmails ?? []).map(deserializeEmail);
      const { briefingId } = await deps.generateBriefing.execute({
        userId: job.data.userId,
        emails,
      });
      return { briefingId };
    },
    { connection: deps.connection },
  );
}
