import type {
  BriefingSchedulerPort,
  TriggerBriefingResult,
} from "@/application/ports/BriefingSchedulerPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { UserNotFoundError } from "@/domain/user/errors/UserNotFoundError";

export interface TriggerBriefingForUserDependencies {
  readonly userRepo: UserRepositoryPort;
  readonly scheduler: BriefingSchedulerPort;
}

export interface TriggerBriefingForUserInput {
  readonly userId: string;
}

export class TriggerBriefingForUser {
  constructor(private readonly deps: TriggerBriefingForUserDependencies) {}

  async execute(
    input: TriggerBriefingForUserInput,
  ): Promise<TriggerBriefingResult> {
    const user = await this.deps.userRepo.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError();
    }
    return this.deps.scheduler.triggerNow(user.id);
  }
}
