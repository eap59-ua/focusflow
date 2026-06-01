import nodemailer, { type Transporter } from "nodemailer";

import type {
  EmailSenderPort,
  SendEmailParams,
  SendEmailResult,
} from "@/application/ports/EmailSenderPort";

export interface NodemailerSmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string;
  readonly pass?: string;
}

function formatAddress(addr: { email: string; name?: string }): string {
  return addr.name && addr.name.trim().length > 0
    ? `"${addr.name.replace(/"/g, '\\"')}" <${addr.email}>`
    : addr.email;
}

export class NodemailerEmailSender implements EmailSenderPort {
  private readonly transporter: Transporter;

  constructor(config: NodemailerSmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth:
        config.user && config.pass
          ? { user: config.user, pass: config.pass }
          : undefined,
    });
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const info = await this.transporter.sendMail({
      from: formatAddress(params.from),
      to: formatAddress(params.to),
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    return { messageId: info.messageId };
  }
}
