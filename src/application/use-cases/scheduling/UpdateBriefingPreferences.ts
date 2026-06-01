import type { BriefingSchedulerPort } from "@/application/ports/BriefingSchedulerPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { UserNotFoundError } from "@/domain/user/errors/UserNotFoundError";

export interface UpdateBriefingPreferencesDependencies {
  readonly userRepo: UserRepositoryPort;
  readonly scheduler: BriefingSchedulerPort;
}

export interface UpdateBriefingPreferencesInput {
  readonly userId: string;
  readonly hour: number;
  readonly timezone: string;
  readonly enabled: boolean;
}

export class UpdateBriefingPreferences {
  constructor(private readonly deps: UpdateBriefingPreferencesDependencies) {}

  async execute(input: UpdateBriefingPreferencesInput): Promise<void> {
    const user = await this.deps.userRepo.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    // S3: una sola transición de dominio por rama (evita la doble allocation /
    // doble updatedAt que generaba updateBriefingPreferences(...).disableBriefing()).
    const updated = input.enabled
      ? user.enableBriefing(input.hour, input.timezone)
      : user.disableBriefingWith(input.hour, input.timezone);

    await this.deps.userRepo.save(updated);

    if (updated.briefingEnabled) {
      await this.deps.scheduler.scheduleForUser(updated);
    } else {
      await this.deps.scheduler.unscheduleForUser(updated.id);
    }
  }
}
