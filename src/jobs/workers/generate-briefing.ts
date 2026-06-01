import { Worker, type ConnectionOptions, type Job } from "bullmq";

import type { GenerateBriefing } from "@/application/use-cases/briefing/GenerateBriefing";

import { QUEUE_NAMES } from "../queues";
import { deserializeEmail, type SerializedEmail } from "../serialization";

export interface GenerateBriefingJobData {
  readonly userId: string;
  readonly emails?: readonly SerializedEmail[];
  // Marcador de zero-retention: el error handler reescribe job.data dejando fuera
  // `emails` (que contiene el cuerpo del email) cuando el job falla.
  readonly _wiped?: boolean;
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

type GenerateBriefingJob = Pick<
  Job<GenerateBriefingJobData, GenerateBriefingJobResult>,
  "data" | "updateData" | "getChildrenValues"
>;

/**
 * Procesa un job de generación de briefing. Extraído del Worker para testear el
 * wipe de zero-retention (drop de `emails`) en el error handler sin Redis.
 */
export async function runGenerateBriefingJob(
  job: GenerateBriefingJob,
  generateBriefing: Pick<GenerateBriefing, "execute">,
): Promise<GenerateBriefingJobResult> {
  try {
    let serializedEmails = job.data.emails;
    if (!serializedEmails || serializedEmails.length === 0) {
      const childrenValues = await job.getChildrenValues<ChildSyncResult>();
      const firstChild = Object.values(childrenValues)[0];
      if (firstChild?.emails) {
        serializedEmails = firstChild.emails;
      }
    }
    const emails = (serializedEmails ?? []).map(deserializeEmail);
    const { briefingId } = await generateBriefing.execute({
      userId: job.data.userId,
      emails,
    });
    return { briefingId };
  } catch (err) {
    // El payload incluye `emails` con el contenido del correo. Lo wipeamos antes
    // de re-lanzar para que NO sobreviva en el estado fallido (removeOnFail.age).
    await job.updateData({ userId: job.data.userId, _wiped: true });
    throw err;
  }
}

export function buildGenerateBriefingWorker(
  deps: GenerateBriefingWorkerDependencies,
): Worker<GenerateBriefingJobData, GenerateBriefingJobResult> {
  return new Worker<GenerateBriefingJobData, GenerateBriefingJobResult>(
    QUEUE_NAMES.GENERATE_BRIEFING,
    (job) => runGenerateBriefingJob(job, deps.generateBriefing),
    { connection: deps.connection },
  );
}
