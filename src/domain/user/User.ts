import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { InvalidDisplayNameError } from "@/domain/user/errors/InvalidDisplayNameError";

const MAX_DISPLAY_NAME_LENGTH = 100;

export interface UserProps {
  readonly id: string;
  readonly email: Email;
  readonly hashedPassword: HashedPassword;
  readonly displayName: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateUserInput {
  readonly email: Email;
  readonly hashedPassword: HashedPassword;
  readonly displayName: string;
}

export class User {
  private constructor(private readonly props: UserProps) {}

  static restore(props: UserProps): User {
    return new User(props);
  }

  static create(input: CreateUserInput): User {
    if (input.displayName.trim().length === 0) {
      throw new InvalidDisplayNameError();
    }
    if (input.displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new InvalidDisplayNameError();
    }

    const now = new Date();
    return new User({
      id: crypto.randomUUID(),
      email: input.email,
      hashedPassword: input.hashedPassword,
      displayName: input.displayName,
      createdAt: now,
      updatedAt: now,
    });
  }

  get id(): string {
    return this.props.id;
  }

  get email(): Email {
    return this.props.email;
  }

  get hashedPassword(): HashedPassword {
    return this.props.hashedPassword;
  }

  get displayName(): string {
    return this.props.displayName;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
