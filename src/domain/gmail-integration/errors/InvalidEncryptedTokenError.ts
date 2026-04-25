import { DomainError } from "@/domain/shared/errors/DomainError";

export class InvalidEncryptedTokenError extends DomainError {
  constructor() {
    super("Invalid encrypted token format");
  }
}
