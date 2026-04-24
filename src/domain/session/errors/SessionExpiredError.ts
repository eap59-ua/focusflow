import { DomainError } from "@/domain/shared/errors/DomainError";

export class SessionExpiredError extends DomainError {
  constructor() {
    super("Session has expired");
  }
}
