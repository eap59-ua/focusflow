import { Worker, type ConnectionOptions } from "bullmq";

import type { GenerateBriefing } from "@/application/use-cases/briefing/GenerateBriefing";

import { QUEUE_NAMES } from "../queues";
import { deserializeEmail, type SerializedEmail } from "../serialization";

export interface GenerateBriefingJobData {
  readonly userId: string;
  readonly emails: readonly SerializedEmail[];
}

export interface GenerateBriefingJobResult {
  readonly briefingId: string;
}

export interface GenerateBriefingWorkerDependencies {
  readonly generateBriefing: GenerateBriefing;
  readonly connection: ConnectionOptions;
}

export function buildGenerateBriefingWorker(
  deps: GenerateBriefingWorkerDependencies,
): Worker<GenerateBriefingJobData, GenerateBriefingJobResult> {
  return new Worker<GenerateBriefingJobData, GenerateBriefingJobResult>(
    QUEUE_NAMES.GENERATE_BRIEFING,
    async (job) => {
      const emails = job.data.emails.map(deserializeEmail);
      const { briefingId } = await deps.generateBriefing.execute({
        userId: job.data.userId,
        emails,
      });
      return { briefingId };
    },
    { connection: deps.connection },
  );
}
