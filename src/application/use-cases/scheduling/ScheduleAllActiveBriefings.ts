import type { BriefingSchedulerPort } from "@/application/ports/BriefingSchedulerPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";

export interface ScheduleAllActiveBriefingsDependencies {
  readonly userRepo: UserRepositoryPort;
  readonly scheduler: BriefingSchedulerPort;
}

export interface ScheduleAllActiveBriefingsOutput {
  readonly scheduledCount: number;
}

export class ScheduleAllActiveBriefings {
  constructor(private readonly deps: ScheduleAllActiveBriefingsDependencies) {}

  async execute(): Promise<ScheduleAllActiveBriefingsOutput> {
    const users = await this.deps.userRepo.findAllWithBriefingEnabled();
    for (const user of users) {
      await this.deps.scheduler.scheduleForUser(user);
    }
    return { scheduledCount: users.length };
  }
}
