import { DomainError } from "@/domain/shared/errors/DomainError";

export class InvalidBriefingHourError extends DomainError {
  constructor() {
    super("Invalid briefing hour: must be integer 0-23");
  }
}
