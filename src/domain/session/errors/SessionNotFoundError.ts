import { DomainError } from "@/domain/shared/errors/DomainError";

export class SessionNotFoundError extends DomainError {
  constructor() {
    super("Session not found");
  }
}
