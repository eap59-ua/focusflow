import type { SessionRepositoryPort } from "@/application/ports/SessionRepositoryPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { SessionId } from "@/domain/session/SessionId";
import { SessionExpiredError } from "@/domain/session/errors/SessionExpiredError";
import { SessionNotFoundError } from "@/domain/session/errors/SessionNotFoundError";
import type { User } from "@/domain/user/User";

export interface GetCurrentUserDependencies {
  readonly sessionRepo: SessionRepositoryPort;
  readonly userRepo: UserRepositoryPort;
  readonly clock: () => Date;
}

export interface GetCurrentUserInput {
  readonly sessionId: string;
}

export interface GetCurrentUserOutput {
  readonly user: User;
}

export class GetCurrentUser {
  constructor(private readonly deps: GetCurrentUserDependencies) {}

  async execute(input: GetCurrentUserInput): Promise<GetCurrentUserOutput> {
    let id: SessionId;
    try {
      id = SessionId.create(input.sessionId);
    } catch {
      throw new SessionNotFoundError();
    }

    const session = await this.deps.sessionRepo.findById(id);
    if (!session) {
      throw new SessionNotFoundError();
    }

    if (session.isExpired(this.deps.clock())) {
      await this.deps.sessionRepo.deleteById(id);
      throw new SessionExpiredError();
    }

    const user = await this.deps.userRepo.findById(session.userId);
    if (!user) {
      await this.deps.sessionRepo.deleteById(id);
      throw new SessionNotFoundError();
    }

    return { user };
  }
}
