import type { BriefingSchedulerPort } from "@/application/ports/BriefingSchedulerPort";
import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";

export interface DisconnectGmailDependencies {
  readonly gmailIntegrationRepo: GmailIntegrationRepositoryPort;
  readonly userRepo: UserRepositoryPort;
  readonly scheduler: BriefingSchedulerPort;
}

export interface DisconnectGmailInput {
  readonly userId: string;
}

export class DisconnectGmail {
  constructor(private readonly deps: DisconnectGmailDependencies) {}

  async execute(input: DisconnectGmailInput): Promise<void> {
    await this.deps.gmailIntegrationRepo.deleteByUserId(input.userId);
    await this.deps.scheduler.unscheduleForUser(input.userId);

    const user = await this.deps.userRepo.findById(input.userId);
    if (user && user.briefingEnabled) {
      const disabled = user.disableBriefing();
      await this.deps.userRepo.save(disabled);
    }
  }
}
