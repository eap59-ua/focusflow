import { DomainError } from "@/domain/shared/errors/DomainError";

export class EmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super("Email is already registered");
  }
}
