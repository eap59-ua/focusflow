import { Worker, type ConnectionOptions, type Job } from "bullmq";

import type { TriggerBriefingForUser } from "@/application/use-cases/scheduling/TriggerBriefingForUser";

import { QUEUE_NAMES } from "../queues";

export interface BriefingTriggerJobData {
  readonly userId: string;
  // Marcador de zero-retention: por consistencia con los otros workers, el error
  // handler reescribe job.data a la forma mínima cuando el job falla.
  readonly _wiped?: boolean;
}

export interface BriefingTriggerJobResult {
  readonly flowId: string;
}

export interface BriefingTriggerWorkerDependencies {
  readonly triggerBriefingForUser: TriggerBriefingForUser;
  readonly connection: ConnectionOptions;
}

type BriefingTriggerJob = Pick<
  Job<BriefingTriggerJobData, BriefingTriggerJobResult>,
  "data" | "updateData"
>;

/**
 * Procesa un job de trigger. No carga contenido sensible, pero aplica el mismo
 * patrón de wipe en error que el resto de workers por consistencia.
 */
export async function runBriefingTriggerJob(
  job: BriefingTriggerJob,
  triggerBriefingForUser: Pick<TriggerBriefingForUser, "execute">,
): Promise<BriefingTriggerJobResult> {
  try {
    const result = await triggerBriefingForUser.execute({
      userId: job.data.userId,
    });
    return { flowId: result.flowId };
  } catch (err) {
    await job.updateData({ userId: job.data.userId, _wiped: true });
    throw err;
  }
}

export function buildBriefingTriggerWorker(
  deps: BriefingTriggerWorkerDependencies,
): Worker<BriefingTriggerJobData, BriefingTriggerJobResult> {
  return new Worker<BriefingTriggerJobData, BriefingTriggerJobResult>(
    QUEUE_NAMES.BRIEFING_TRIGGER,
    (job) => runBriefingTriggerJob(job, deps.triggerBriefingForUser),
    { connection: deps.connection },
  );
}
