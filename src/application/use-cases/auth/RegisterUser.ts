import type { PasswordHasherPort } from "@/application/ports/PasswordHasherPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { EmailAlreadyRegisteredError } from "@/domain/user/errors/EmailAlreadyRegisteredError";
import { WeakPasswordError } from "@/domain/user/errors/WeakPasswordError";

import {
  registerUserInputSchema,
  type RegisterUserInput,
} from "./RegisterUser.schema";

const MIN_PASSWORD_LENGTH = 8;

export interface RegisterUserDependencies {
  readonly userRepo: UserRepositoryPort;
  readonly hasher: PasswordHasherPort;
}

export class RegisterUser {
  constructor(private readonly deps: RegisterUserDependencies) {}

  async execute(input: RegisterUserInput): Promise<User> {
    const parsed = registerUserInputSchema.parse(input);

    const email = Email.create(parsed.email);

    if (parsed.password.length < MIN_PASSWORD_LENGTH) {
      throw new WeakPasswordError();
    }

    const existing = await this.deps.userRepo.findByEmail(email);
    if (existing) {
      throw new EmailAlreadyRegisteredError();
    }

    const hashedRaw = await this.deps.hasher.hash(parsed.password);
    const hashedPassword = HashedPassword.fromHash(hashedRaw);

    const user = User.create({
      email,
      hashedPassword,
      displayName: parsed.displayName,
    });

    await this.deps.userRepo.save(user);
    return user;
  }
}
