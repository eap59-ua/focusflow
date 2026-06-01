import { Worker, type ConnectionOptions } from "bullmq";

import type { SendBriefingEmail } from "@/application/use-cases/briefing/SendBriefingEmail";

import { QUEUE_NAMES } from "../queues";

export interface SendBriefingEmailJobData {
  readonly briefingId: string;
}

export interface SendBriefingEmailJobResult {
  readonly messageId: string;
}

export interface SendBriefingEmailWorkerDependencies {
  readonly sendBriefingEmail: SendBriefingEmail;
  readonly connection: ConnectionOptions;
}

export function buildSendBriefingEmailWorker(
  deps: SendBriefingEmailWorkerDependencies,
): Worker<SendBriefingEmailJobData, SendBriefingEmailJobResult> {
  return new Worker<SendBriefingEmailJobData, SendBriefingEmailJobResult>(
    QUEUE_NAMES.SEND_BRIEFING_EMAIL,
    async (job) => {
      const delivery = await deps.sendBriefingEmail.execute({
        briefingId: job.data.briefingId,
      });
      return { messageId: delivery.messageId };
    },
    { connection: deps.connection },
  );
}
