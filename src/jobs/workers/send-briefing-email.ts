import { Worker, type ConnectionOptions } from "bullmq";

import type { SendBriefingEmail } from "@/application/use-cases/briefing/SendBriefingEmail";

import { QUEUE_NAMES } from "../queues";

export interface SendBriefingEmailJobData {
  readonly briefingId?: string;
  readonly userId?: string;
}

export interface SendBriefingEmailJobResult {
  readonly messageId: string;
}

export interface SendBriefingEmailWorkerDependencies {
  readonly sendBriefingEmail: SendBriefingEmail;
  readonly connection: ConnectionOptions;
}

interface ChildGenerateResult {
  readonly briefingId?: string;
}

export function buildSendBriefingEmailWorker(
  deps: SendBriefingEmailWorkerDependencies,
): Worker<SendBriefingEmailJobData, SendBriefingEmailJobResult> {
  return new Worker<SendBriefingEmailJobData, SendBriefingEmailJobResult>(
    QUEUE_NAMES.SEND_BRIEFING_EMAIL,
    async (job) => {
      let briefingId = job.data.briefingId;
      if (!briefingId) {
        const childrenValues =
          await job.getChildrenValues<ChildGenerateResult>();
        const firstChild = Object.values(childrenValues)[0];
        if (firstChild?.briefingId) {
          briefingId = firstChild.briefingId;
        }
      }
      if (!briefingId) {
        throw new Error(
          "send-briefing-email: briefingId no disponible (ni en data ni en children)",
        );
      }
      const delivery = await deps.sendBriefingEmail.execute({ briefingId });
      return { messageId: delivery.messageId };
    },
    { connection: deps.connection },
  );
}
