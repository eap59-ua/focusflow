import {
  auth as gmailAuth,
  gmail as gmailApi,
  gmail_v1,
} from "@googleapis/gmail";

import type {
  EmailFetcherPort,
  FetchInboxParams,
} from "@/application/ports/EmailFetcherPort";
import { EmailMessage } from "@/domain/email-message/EmailMessage";

const FETCH_CONCURRENCY = 5;

export interface GmailMessagesClient {
  list(params: {
    userId: string;
    q?: string;
    maxResults?: number;
  }): Promise<{ data: gmail_v1.Schema$ListMessagesResponse }>;
  get(params: {
    userId: string;
    id: string;
    format: "full";
  }): Promise<{ data: gmail_v1.Schema$Message }>;
}

export type GmailMessagesClientFactory = (
  accessToken: string,
) => GmailMessagesClient;

function defaultClientFactory(accessToken: string): GmailMessagesClient {
  const oauth = new gmailAuth.OAuth2();
  oauth.setCredentials({ access_token: accessToken });
  const gmail = gmailApi({
    version: "v1",
    auth: oauth,
    retry: true,
    retryConfig: {
      retry: 3,
      retryDelay: 1000,
      statusCodesToRetry: [
        [429, 429],
        [500, 599],
      ],
    },
  });
  return gmail.users.messages as unknown as GmailMessagesClient;
}

interface ParsedFrom {
  readonly email: string;
  readonly name: string | null;
}

function parseFromHeader(raw: string): ParsedFrom {
  const match = /^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (match) {
    return { name: match[1]!.trim() || null, email: match[2]!.trim() };
  }
  return { name: null, email: raw.trim() };
}

function parseAddressList(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((part) => parseFromHeader(part).email)
    .filter((s) => s.length > 0);
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function findPartByMime(
  payload: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): gmail_v1.Schema$MessagePart | undefined {
  if (!payload) return undefined;
  if (payload.mimeType === mimeType && payload.body?.data) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPartByMime(part, mimeType);
    if (found) return found;
  }
  return undefined;
}

function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const plain = findPartByMime(payload, "text/plain");
  if (plain?.body?.data) {
    return decodeBase64Url(plain.body.data);
  }
  const html = findPartByMime(payload, "text/html");
  if (html?.body?.data) {
    return stripHtml(decodeBase64Url(html.body.data));
  }
  if (payload.body?.data) {
    const raw = decodeBase64Url(payload.body.data);
    return payload.mimeType === "text/html" ? stripHtml(raw) : raw;
  }
  return "";
}

function readHeader(
  headers: ReadonlyArray<gmail_v1.Schema$MessagePartHeader> | undefined,
  name: string,
): string {
  if (!headers) return "";
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name?.toLowerCase() === lower);
  return found?.value ?? "";
}

export function parseGmailMessage(msg: gmail_v1.Schema$Message): EmailMessage {
  const id = msg.id ?? "";
  const threadId = msg.threadId ?? "";
  const snippet = msg.snippet ?? "";
  const internalDateMs = msg.internalDate
    ? Number.parseInt(msg.internalDate, 10)
    : Date.now();
  const receivedAt = new Date(internalDateMs);

  const headers = msg.payload?.headers ?? [];
  const subject = readHeader(headers, "Subject");
  const fromRaw = readHeader(headers, "From");
  const toRaw = readHeader(headers, "To");
  const messageIdRaw = readHeader(headers, "Message-ID");
  const messageIdHeader =
    messageIdRaw.length > 0 ? messageIdRaw : `<missing-${id}@unknown>`;

  const from = parseFromHeader(fromRaw);
  const toEmails = parseAddressList(toRaw);
  const bodyText = extractBodyText(msg.payload);

  return EmailMessage.create({
    id,
    messageIdHeader,
    threadId,
    subject,
    fromEmail: from.email,
    fromName: from.name,
    toEmails,
    snippet,
    receivedAt,
    bodyText,
  });
}

async function pMapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]!);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

export class GmailEmailFetcher implements EmailFetcherPort {
  private readonly clientFactory: GmailMessagesClientFactory;

  constructor(clientFactory?: GmailMessagesClientFactory) {
    this.clientFactory = clientFactory ?? defaultClientFactory;
  }

  async fetchInbox(params: FetchInboxParams): Promise<readonly EmailMessage[]> {
    const client = this.clientFactory(params.accessToken);

    const list = await client.list({
      userId: "me",
      q: params.query,
      maxResults: params.maxResults,
    });

    const ids = (list.data.messages ?? [])
      .map((m) => m.id)
      .filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );

    if (ids.length === 0) return [];

    const messages = await pMapWithConcurrency(ids, FETCH_CONCURRENCY, (id) =>
      client.get({ userId: "me", id, format: "full" }),
    );

    return messages.map((res) => parseGmailMessage(res.data));
  }
}
