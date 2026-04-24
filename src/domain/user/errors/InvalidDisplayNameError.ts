import { DomainError } from "@/domain/shared/errors/DomainError";

export class InvalidDisplayNameError extends DomainError {
  constructor() {
    super("Display name must be a non-empty string up to 100 characters");
  }
}
