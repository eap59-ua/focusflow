import { DomainError } from "@/domain/shared/errors/DomainError";

export class WeakPasswordError extends DomainError {
  constructor() {
    super("Password must be at least 8 characters long");
  }
}
