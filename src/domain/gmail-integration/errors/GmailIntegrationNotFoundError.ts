import { DomainError } from "@/domain/shared/errors/DomainError";

export class GmailIntegrationNotFoundError extends DomainError {
  constructor() {
    super("Gmail integration not found");
  }
}
