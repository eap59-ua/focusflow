import { DomainError } from "@/domain/shared/errors/DomainError";

export class InvalidEmailError extends DomainError {
  constructor() {
    super("Email format is invalid");
  }
}
