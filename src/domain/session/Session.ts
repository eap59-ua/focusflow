import { SessionId } from "@/domain/session/SessionId";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SessionProps {
  readonly id: SessionId;
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface CreateSessionInput {
  readonly userId: string;
  readonly lifetimeDays: number;
}

export class Session {
  private constructor(private readonly props: SessionProps) {}

  static create(input: CreateSessionInput): Session {
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + input.lifetimeDays * MS_PER_DAY,
    );
    return new Session({
      id: SessionId.generate(),
      userId: input.userId,
      createdAt,
      expiresAt,
    });
  }

  static restore(props: SessionProps): Session {
    return new Session(props);
  }

  isExpired(now: Date): boolean {
    return now.getTime() >= this.props.expiresAt.getTime();
  }

  get id(): SessionId {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }
}
