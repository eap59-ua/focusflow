import { DomainError } from "@/domain/shared/errors/DomainError";

export class InvalidSessionIdError extends DomainError {
  constructor() {
    super("Session id must be exactly 64 lowercase hex characters");
  }
}
