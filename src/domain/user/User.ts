import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { InvalidBriefingHourError } from "@/domain/user/errors/InvalidBriefingHourError";
import { InvalidBriefingTimezoneError } from "@/domain/user/errors/InvalidBriefingTimezoneError";
import { InvalidDisplayNameError } from "@/domain/user/errors/InvalidDisplayNameError";

const MAX_DISPLAY_NAME_LENGTH = 100;
const DEFAULT_BRIEFING_HOUR = 8;
const DEFAULT_BRIEFING_TIMEZONE = "Europe/Madrid";

function isValidBriefingHour(hour: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

function isValidTimezone(tz: string): boolean {
  if (tz.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface UserProps {
  readonly id: string;
  readonly email: Email;
  readonly hashedPassword: HashedPassword;
  readonly displayName: string;
  readonly briefingHour: number;
  readonly briefingTimezone: string;
  readonly briefingEnabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateUserInput {
  readonly email: Email;
  readonly hashedPassword: HashedPassword;
  readonly displayName: string;
  readonly briefingHour?: number;
  readonly briefingTimezone?: string;
  readonly briefingEnabled?: boolean;
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

    const briefingHour = input.briefingHour ?? DEFAULT_BRIEFING_HOUR;
    const briefingTimezone = input.briefingTimezone ?? DEFAULT_BRIEFING_TIMEZONE;
    if (!isValidBriefingHour(briefingHour)) {
      throw new InvalidBriefingHourError();
    }
    if (!isValidTimezone(briefingTimezone)) {
      throw new InvalidBriefingTimezoneError();
    }

    const now = new Date();
    return new User({
      id: crypto.randomUUID(),
      email: input.email,
      hashedPassword: input.hashedPassword,
      displayName: input.displayName,
      briefingHour,
      briefingTimezone,
      briefingEnabled: input.briefingEnabled ?? false,
      createdAt: now,
      updatedAt: now,
    });
  }

  enableBriefing(hour: number, timezone: string): User {
    if (!isValidBriefingHour(hour)) {
      throw new InvalidBriefingHourError();
    }
    if (!isValidTimezone(timezone)) {
      throw new InvalidBriefingTimezoneError();
    }
    return new User({
      ...this.props,
      briefingHour: hour,
      briefingTimezone: timezone,
      briefingEnabled: true,
      updatedAt: new Date(),
    });
  }

  disableBriefing(): User {
    return new User({
      ...this.props,
      briefingEnabled: false,
      updatedAt: new Date(),
    });
  }

  updateBriefingPreferences(hour: number, timezone: string): User {
    if (!isValidBriefingHour(hour)) {
      throw new InvalidBriefingHourError();
    }
    if (!isValidTimezone(timezone)) {
      throw new InvalidBriefingTimezoneError();
    }
    return new User({
      ...this.props,
      briefingHour: hour,
      briefingTimezone: timezone,
      updatedAt: new Date(),
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

  get briefingHour(): number {
    return this.props.briefingHour;
  }

  get briefingTimezone(): string {
    return this.props.briefingTimezone;
  }

  get briefingEnabled(): boolean {
    return this.props.briefingEnabled;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
