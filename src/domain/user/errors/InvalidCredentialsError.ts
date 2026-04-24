import { DomainError } from "@/domain/shared/errors/DomainError";

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super("Invalid email or password");
  }
}
