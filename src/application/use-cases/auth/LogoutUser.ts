import type { SessionRepositoryPort } from "@/application/ports/SessionRepositoryPort";
import { SessionId } from "@/domain/session/SessionId";

export interface LogoutUserDependencies {
  readonly sessionRepo: SessionRepositoryPort;
}

export interface LogoutUserInput {
  readonly sessionId: string;
}

export class LogoutUser {
  constructor(private readonly deps: LogoutUserDependencies) {}

  async execute(input: LogoutUserInput): Promise<void> {
    let id: SessionId;
    try {
      id = SessionId.create(input.sessionId);
    } catch {
      return;
    }
    await this.deps.sessionRepo.deleteById(id);
  }
}
