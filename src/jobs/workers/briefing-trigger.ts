import { Worker, type ConnectionOptions } from "bullmq";

import type { TriggerBriefingForUser } from "@/application/use-cases/scheduling/TriggerBriefingForUser";

import { QUEUE_NAMES } from "../queues";

export interface BriefingTriggerJobData {
  readonly userId: string;
}

export interface BriefingTriggerJobResult {
  readonly flowId: string;
}

export interface BriefingTriggerWorkerDependencies {
  readonly triggerBriefingForUser: TriggerBriefingForUser;
  readonly connection: ConnectionOptions;
}

export function buildBriefingTriggerWorker(
  deps: BriefingTriggerWorkerDependencies,
): Worker<BriefingTriggerJobData, BriefingTriggerJobResult> {
  return new Worker<BriefingTriggerJobData, BriefingTriggerJobResult>(
    QUEUE_NAMES.BRIEFING_TRIGGER,
    async (job) => {
      const result = await deps.triggerBriefingForUser.execute({
        userId: job.data.userId,
      });
      return { flowId: result.flowId };
    },
    { connection: deps.connection },
  );
}
