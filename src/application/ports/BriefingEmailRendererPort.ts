import type { Briefing } from "@/domain/briefing/Briefing";
import type { User } from "@/domain/user/User";

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface BriefingEmailRendererPort {
  render(briefing: Briefing, user: User): RenderedEmail;
}
