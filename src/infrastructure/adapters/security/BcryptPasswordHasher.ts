import { compare, hash } from "bcryptjs";

import type { PasswordHasherPort } from "@/application/ports/PasswordHasherPort";

const DEFAULT_SALT_ROUNDS = 10;

export class BcryptPasswordHasher implements PasswordHasherPort {
  constructor(private readonly saltRounds: number = DEFAULT_SALT_ROUNDS) {}

  async hash(plain: string): Promise<string> {
    return hash(plain, this.saltRounds);
  }

  async verify(plain: string, hashed: string): Promise<boolean> {
    return compare(plain, hashed);
  }
}
