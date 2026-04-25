import type { BriefingEmailRendererPort } from "@/application/ports/BriefingEmailRendererPort";
import type { BriefingRepositoryPort } from "@/application/ports/BriefingRepositoryPort";
import type {
  EmailAddress,
  EmailSenderPort,
} from "@/application/ports/EmailSenderPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { EmailDelivery } from "@/domain/briefing/EmailDelivery";
import { BriefingNotFoundError } from "@/domain/briefing/errors/BriefingNotFoundError";
import { UserNotFoundError } from "@/domain/user/errors/UserNotFoundError";

export interface SendBriefingEmailDependencies {
  readonly briefingRepo: BriefingRepositoryPort;
  readonly userRepo: UserRepositoryPort;
  readonly renderer: BriefingEmailRendererPort;
  readonly emailSender: EmailSenderPort;
  readonly fromAddress: EmailAddress;
}

export interface SendBriefingEmailInput {
  readonly briefingId: string;
}

export class SendBriefingEmail {
  constructor(private readonly deps: SendBriefingEmailDependencies) {}

  async execute(input: SendBriefingEmailInput): Promise<EmailDelivery> {
    const briefing = await this.deps.briefingRepo.findById(input.briefingId);
    if (!briefing) {
      throw new BriefingNotFoundError();
    }

    const user = await this.deps.userRepo.findById(briefing.userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    const rendered = this.deps.renderer.render(briefing, user);

    const result = await this.deps.emailSender.send({
      to: { email: user.email.value, name: user.displayName },
      from: this.deps.fromAddress,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    return EmailDelivery.create({
      briefingId: briefing.id,
      recipientEmail: user.email.value,
      sentAt: new Date(),
      messageId: result.messageId,
    });
  }
}
