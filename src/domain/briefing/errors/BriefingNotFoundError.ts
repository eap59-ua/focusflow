import { DomainError } from "@/domain/shared/errors/DomainError";

export class BriefingNotFoundError extends DomainError {
  constructor() {
    super("Briefing not found");
  }
}
