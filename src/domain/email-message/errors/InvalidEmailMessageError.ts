import { DomainError } from "@/domain/shared/errors/DomainError";

export class InvalidEmailMessageError extends DomainError {
  constructor(reason: string) {
    super(`Invalid EmailMessage: ${reason}`);
  }
}
