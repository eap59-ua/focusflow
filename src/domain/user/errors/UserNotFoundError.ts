import { DomainError } from "@/domain/shared/errors/DomainError";

export class UserNotFoundError extends DomainError {
  constructor() {
    super("User not found");
  }
}
