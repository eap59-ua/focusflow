import type { PasswordHasherPort } from "@/application/ports/PasswordHasherPort";
import type { SessionRepositoryPort } from "@/application/ports/SessionRepositoryPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { Session } from "@/domain/session/Session";
import { Email } from "@/domain/user/Email";
import { InvalidCredentialsError } from "@/domain/user/errors/InvalidCredentialsError";

import {
  loginUserInputSchema,
  type LoginUserInput,
} from "./LoginUser.schema";

export interface LoginUserDependencies {
  readonly userRepo: UserRepositoryPort;
  readonly hasher: PasswordHasherPort;
  readonly sessionRepo: SessionRepositoryPort;
  readonly sessionLifetimeDays: number;
}

export interface LoginUserOutput {
  readonly session: Session;
}

export class LoginUser {
  constructor(private readonly deps: LoginUserDependencies) {}

  async execute(input: LoginUserInput): Promise<LoginUserOutput> {
    const parsed = loginUserInputSchema.parse(input);

    let email: Email;
    try {
      email = Email.create(parsed.email);
    } catch {
      throw new InvalidCredentialsError();
    }

    const user = await this.deps.userRepo.findByEmail(email);
    if (!user) {
      throw new InvalidCredentialsError();
    }

    const ok = await this.deps.hasher.verify(
      parsed.password,
      user.hashedPassword,
    );
    if (!ok) {
      throw new InvalidCredentialsError();
    }

    const session = Session.create({
      userId: user.id,
      lifetimeDays: this.deps.sessionLifetimeDays,
    });
    await this.deps.sessionRepo.save(session);

    return { session };
  }
}
