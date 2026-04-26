import {
  FlowProducer,
  type ConnectionOptions,
  type Queue,
} from "bullmq";

import type {
  BriefingSchedulerPort,
  TriggerBriefingResult,
} from "@/application/ports/BriefingSchedulerPort";
import type { User } from "@/domain/user/User";

import { QUEUE_NAMES } from "../../jobs/queues";

const TRIGGER_QUEUE_NAME = "briefing-trigger";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function userIdToMinute(userId: string): number {
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) + hash + userId.charCodeAt(i);
  }
  return Math.abs(hash) % 60;
}

function oneDayAgoISO(): string {
  return new Date(Date.now() - ONE_DAY_MS).toISOString();
}

function jobSchedulerId(userId: string): string {
  return `briefing:${userId}`;
}

export interface BullMQBriefingSchedulerDependencies {
  readonly briefingTriggerQueue: Queue;
  readonly connection: ConnectionOptions;
}

export class BullMQBriefingScheduler implements BriefingSchedulerPort {
  private readonly flowProducer: FlowProducer;

  constructor(private readonly deps: BullMQBriefingSchedulerDependencies) {
    this.flowProducer = new FlowProducer({ connection: deps.connection });
  }

  async scheduleForUser(user: User): Promise<void> {
    const minute = userIdToMinute(user.id);
    const cronPattern = `${minute} ${user.briefingHour} * * *`;
    await this.deps.briefingTriggerQueue.upsertJobScheduler(
      jobSchedulerId(user.id),
      { pattern: cronPattern, tz: user.briefingTimezone },
      {
        name: TRIGGER_QUEUE_NAME,
        data: { userId: user.id },
      },
    );
  }

  async unscheduleForUser(userId: string): Promise<void> {
    await this.deps.briefingTriggerQueue.removeJobScheduler(
      jobSchedulerId(userId),
    );
  }

  async triggerNow(userId: string): Promise<TriggerBriefingResult> {
    const flow = await this.flowProducer.add({
      name: "send-briefing-email",
      queueName: QUEUE_NAMES.SEND_BRIEFING_EMAIL,
      data: { userId },
      children: [
        {
          name: "generate-briefing",
          queueName: QUEUE_NAMES.GENERATE_BRIEFING,
          data: { userId },
          children: [
            {
              name: "gmail-inbox-sync",
              queueName: QUEUE_NAMES.GMAIL_INBOX_SYNC,
              data: { userId, sinceISO: oneDayAgoISO() },
            },
          ],
        },
      ],
    });
    return { flowId: flow.job.id ?? `flow-${Date.now()}` };
  }

  async close(): Promise<void> {
    await this.flowProducer.close();
  }
}
