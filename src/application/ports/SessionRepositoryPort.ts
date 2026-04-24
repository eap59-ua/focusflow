import type { Session } from "@/domain/session/Session";
import type { SessionId } from "@/domain/session/SessionId";

export interface SessionRepositoryPort {
  save(session: Session): Promise<void>;
  findById(id: SessionId): Promise<Session | null>;
  deleteById(id: SessionId): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}
