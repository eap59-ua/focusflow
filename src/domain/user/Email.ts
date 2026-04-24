import { InvalidEmailError } from "@/domain/user/errors/InvalidEmailError";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
  private constructor(private readonly _value: string) {}

  static create(raw: string): Email {
    if (!EMAIL_REGEX.test(raw)) {
      throw new InvalidEmailError();
    }
    return new Email(raw);
  }

  get value(): string {
    return this._value;
  }

  equals(other: Email): boolean {
    return this._value === other._value;
  }
}
