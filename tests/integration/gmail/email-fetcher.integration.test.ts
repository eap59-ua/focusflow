// @vitest-environment node
import type { gmail_v1 } from "@googleapis/gmail";
import { describe, expect, it, vi } from "vitest";

import {
  GmailEmailFetcher,
  type GmailMessagesClient,
} from "@/infrastructure/adapters/gmail/GmailEmailFetcher";

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function makePlainTextMessage(opts: {
  id: string;
  messageId: string;
  subject: string;
  from: string;
  to?: string;
  body: string;
  internalDate?: string;
  threadId?: string;
}): gmail_v1.Schema$Message {
  return {
    id: opts.id,
    threadId: opts.threadId ?? `thread-${opts.id}`,
    snippet: opts.body.slice(0, 60),
    internalDate: opts.internalDate ?? "1745568000000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Subject", value: opts.subject },
        { name: "From", value: opts.from },
        { name: "To", value: opts.to ?? "me@gmail.com" },
        { name: "Message-ID", value: opts.messageId },
      ],
      body: { data: b64url(opts.body), size: opts.body.length },
    },
  };
}

function makeMultipartMessage(opts: {
  id: string;
  messageId: string;
  subject: string;
  from: string;
  htmlBody: string;
}): gmail_v1.Schema$Message {
  return {
    id: opts.id,
    threadId: `thread-${opts.id}`,
    snippet: "html-only",
    internalDate: "1745568000000",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "Subject", value: opts.subject },
        { name: "From", value: opts.from },
        { name: "To", value: "me@gmail.com" },
        { name: "Message-ID", value: opts.messageId },
      ],
      parts: [
        {
          mimeType: "text/html",
          body: { data: b64url(opts.htmlBody), size: opts.htmlBody.length },
        },
      ],
    },
  };
}

function makeFakeClient(
  messages: gmail_v1.Schema$Message[],
): GmailMessagesClient {
  return {
    list: vi.fn(async () => ({
      data: {
        messages: messages.map((m) => ({ id: m.id! })),
      } satisfies gmail_v1.Schema$ListMessagesResponse,
    })),
    get: vi.fn(async (params) => {
      const found = messages.find((m) => m.id === params.id);
      if (!found) throw new Error(`No fixture for id ${params.id}`);
      return { data: found };
    }),
  };
}

describe("GmailEmailFetcher (integration con fakes inyectados)", () => {
  it("fetchInbox: lista + get por id, parsea texto plano y headers", async () => {
    const fixtures = [
      makePlainTextMessage({
        id: "msg-1",
        messageId: "<one@example.com>",
        subject: "Reunión jueves",
        from: '"Alice" <alice@example.com>',
        body: "Recordatorio de la reunión del jueves.",
      }),
    ];
    const client = makeFakeClient(fixtures);
    const fetcher = new GmailEmailFetcher(() => client);

    const emails = await fetcher.fetchInbox({
      accessToken: "ya29.fake",
      query: "in:inbox",
      maxResults: 10,
    });

    expect(emails).toHaveLength(1);
    const e = emails[0]!;
    expect(e.id).toBe("msg-1");
    expect(e.subject).toBe("Reunión jueves");
    expect(e.fromEmail.value).toBe("alice@example.com");
    expect(e.fromName).toBe("Alice");
    expect(e.bodyText).toContain("Recordatorio");
    expect(e.toEmails).toEqual(["me@gmail.com"]);
  });

  it("fallback HTML stripping cuando no hay text/plain", async () => {
    const html =
      "<html><body><p>Hola</p><script>alert('x')</script><b>mundo</b>&amp;<style>.a{}</style>!</body></html>";
    const fixtures = [
      makeMultipartMessage({
        id: "html-1",
        messageId: "<html@example.com>",
        subject: "HTML only",
        from: "bob@example.com",
        htmlBody: html,
      }),
    ];
    const fetcher = new GmailEmailFetcher(() => makeFakeClient(fixtures));

    const emails = await fetcher.fetchInbox({
      accessToken: "tok",
      query: "in:inbox",
      maxResults: 10,
    });

    expect(emails).toHaveLength(1);
    const body = emails[0]!.bodyText;
    expect(body).not.toContain("<");
    expect(body).not.toContain("alert(");
    expect(body).not.toContain(".a{}");
    expect(body).toContain("Hola");
    expect(body).toContain("mundo");
    expect(body).toContain("&");
  });

  it("From sin nombre (solo email) — fromName=null", async () => {
    const fixtures = [
      makePlainTextMessage({
        id: "msg-2",
        messageId: "<two@x.com>",
        subject: "x",
        from: "raw@example.com",
        body: "hola",
      }),
    ];
    const fetcher = new GmailEmailFetcher(() => makeFakeClient(fixtures));
    const emails = await fetcher.fetchInbox({
      accessToken: "tok",
      query: "q",
      maxResults: 10,
    });
    expect(emails[0]!.fromName).toBe(null);
    expect(emails[0]!.fromEmail.value).toBe("raw@example.com");
  });

  it("To con varios destinatarios separados por coma", async () => {
    const fixtures = [
      makePlainTextMessage({
        id: "msg-3",
        messageId: "<three@x.com>",
        subject: "multi",
        from: "alice@example.com",
        to: "a@x.com, b@x.com, c@x.com",
        body: "hola",
      }),
    ];
    const fetcher = new GmailEmailFetcher(() => makeFakeClient(fixtures));
    const emails = await fetcher.fetchInbox({
      accessToken: "tok",
      query: "q",
      maxResults: 10,
    });
    expect(emails[0]!.toEmails).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("Sin Message-ID en headers usa fallback sintético", async () => {
    const fixture: gmail_v1.Schema$Message = {
      id: "msg-no-mid",
      threadId: "thread-x",
      snippet: "ok",
      internalDate: "1745568000000",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "S" },
          { name: "From", value: "alice@example.com" },
          { name: "To", value: "me@gmail.com" },
        ],
        body: { data: b64url("body"), size: 4 },
      },
    };
    const fetcher = new GmailEmailFetcher(() => makeFakeClient([fixture]));
    const emails = await fetcher.fetchInbox({
      accessToken: "tok",
      query: "q",
      maxResults: 10,
    });
    expect(emails[0]!.messageIdHeader).toMatch(/^<missing-msg-no-mid@unknown>$/);
  });

  it("Lista vacía → devuelve [] sin llamar a get", async () => {
    const client: GmailMessagesClient = {
      list: vi.fn(async () => ({ data: { messages: [] } })),
      get: vi.fn(async () => {
        throw new Error("should not be called");
      }),
    };
    const fetcher = new GmailEmailFetcher(() => client);
    const emails = await fetcher.fetchInbox({
      accessToken: "tok",
      query: "q",
      maxResults: 10,
    });
    expect(emails).toEqual([]);
    expect(client.get).not.toHaveBeenCalled();
  });

  it("Llama a list con query y maxResults exactos", async () => {
    const client = makeFakeClient([]);
    const fetcher = new GmailEmailFetcher(() => client);
    await fetcher.fetchInbox({
      accessToken: "tok",
      query: "in:inbox after:1234567",
      maxResults: 25,
    });
    expect(client.list).toHaveBeenCalledWith({
      userId: "me",
      q: "in:inbox after:1234567",
      maxResults: 25,
    });
  });
});
