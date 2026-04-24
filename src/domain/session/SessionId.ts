import { InvalidSessionIdError } from "@/domain/session/errors/InvalidSessionIdError";

const HEX_64 = /^[0-9a-f]{64}$/;
const TOKEN_BYTES = 32;

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

export class SessionId {
  private constructor(private readonly _value: string) {}

  static create(raw: string): SessionId {
    if (!HEX_64.test(raw)) {
      throw new InvalidSessionIdError();
    }
    return new SessionId(raw);
  }

  static generate(): SessionId {
    const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
    return new SessionId(toHex(bytes));
  }

  get value(): string {
    return this._value;
  }

  equals(other: SessionId): boolean {
    return this._value === other._value;
  }
}
