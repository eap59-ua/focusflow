import { DomainError } from "@/domain/shared/errors/DomainError";

export class OAuthStateMismatchError extends DomainError {
  constructor() {
    super("OAuth state mismatch");
  }
}
