import { DomainError } from "@/domain/shared/errors/DomainError";

export class InvalidBriefingError extends DomainError {
  constructor(reason: string) {
    super(`Invalid Briefing: ${reason}`);
  }
}
