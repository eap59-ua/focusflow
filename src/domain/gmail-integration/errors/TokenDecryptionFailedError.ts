import { DomainError } from "@/domain/shared/errors/DomainError";

export class TokenDecryptionFailedError extends DomainError {
  constructor() {
    super("Token decryption failed");
  }
}
