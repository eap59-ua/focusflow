import type { EmailMessage } from "@/domain/email-message/EmailMessage";

export interface FetchInboxParams {
  readonly accessToken: string;
  readonly query: string;
  readonly maxResults: number;
}

export interface EmailFetcherPort {
  fetchInbox(params: FetchInboxParams): Promise<readonly EmailMessage[]>;
}
