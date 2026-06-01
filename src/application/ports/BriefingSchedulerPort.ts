import type { User } from "@/domain/user/User";

export interface TriggerBriefingResult {
  readonly flowId: string;
}

export interface BriefingSchedulerPort {
  scheduleForUser(user: User): Promise<void>;
  unscheduleForUser(userId: string): Promise<void>;
  triggerNow(userId: string): Promise<TriggerBriefingResult>;
}
