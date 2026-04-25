import type { Briefing } from "@/domain/briefing/Briefing";

export interface BriefingRepositoryPort {
  save(briefing: Briefing): Promise<void>;
  findById(id: string): Promise<Briefing | null>;
  findLatestByUserId(userId: string): Promise<Briefing | null>;
}
