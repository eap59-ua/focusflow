export interface EmailAddress {
  readonly email: string;
  readonly name?: string;
}

export interface SendEmailParams {
  readonly to: EmailAddress;
  readonly from: EmailAddress;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface SendEmailResult {
  readonly messageId: string;
}

export interface EmailSenderPort {
  send(params: SendEmailParams): Promise<SendEmailResult>;
}
