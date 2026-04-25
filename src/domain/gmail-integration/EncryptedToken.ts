import { InvalidEncryptedTokenError } from "@/domain/gmail-integration/errors/InvalidEncryptedTokenError";

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export class EncryptedToken {
  private constructor(private readonly _base64: string) {}

  static fromBase64(value: string): EncryptedToken {
    if (value.length === 0 || value.length % 4 !== 0) {
      throw new InvalidEncryptedTokenError();
    }
    if (!BASE64_PATTERN.test(value)) {
      throw new InvalidEncryptedTokenError();
    }
    return new EncryptedToken(value);
  }

  toBase64(): string {
    return this._base64;
  }

  equals(other: EncryptedToken): boolean {
    return this._base64 === other._base64;
  }
}
