import { DomainError } from "@/domain/shared/errors/DomainError";

export class BriefingTooShortError extends DomainError {
  constructor() {
    super("Briefing summary is too short (min 50 chars)");
  }
}
