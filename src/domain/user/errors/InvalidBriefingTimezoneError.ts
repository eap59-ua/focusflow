import { DomainError } from "@/domain/shared/errors/DomainError";

export class InvalidBriefingTimezoneError extends DomainError {
  constructor() {
    super("Invalid briefing timezone: not recognized by Intl");
  }
}
