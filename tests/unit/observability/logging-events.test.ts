// E2E con fakes: ejercita FetchInbox → GenerateBriefing → SendBriefingEmail
// usando un LoggerSpy. Verifica:
//   1. Los eventos esperados se emiten con los campos permitidos.
//   2. NINGÚN log contiene contenidos sensibles (bodyText, snippet, subject,
//      tokens OAuth, ni partes de email cargadas en memoria).
//
// Si un día se cuela un `subject` en un payload de log, este test falla
// inmediatamente — la red de seguridad de docs/audits/logging-policy.md.

import { describe, expect, it, vi } from "vitest";

import type { BriefingEmailRendererPort } from "@/application/ports/BriefingEmailRendererPort";
import type { BriefingGeneratorPort } from "@/application/ports/BriefingGeneratorPort";
import type { BriefingRepositoryPort } from "@/application/ports/BriefingRepositoryPort";
import type {
  EmailFetcherPort,
  FetchInboxParams,
} from "@/application/ports/EmailFetcherPort";
import type { EmailSenderPort } from "@/application/ports/EmailSenderPort";
import type { GmailIntegrationRepositoryPort } from "@/application/ports/GmailIntegrationRepositoryPort";
import type { TokenEncryptionPort } from "@/application/ports/TokenEncryptionPort";
import type { UserRepositoryPort } from "@/application/ports/UserRepositoryPort";
import { GenerateBriefing } from "@/application/use-cases/briefing/GenerateBriefing";
import { SendBriefingEmail } from "@/application/use-cases/briefing/SendBriefingEmail";
import { FetchInboxEmails } from "@/application/use-cases/email/FetchInboxEmails";
import type { RefreshGmailToken } from "@/application/use-cases/gmail/RefreshGmailToken";
import { Briefing } from "@/domain/briefing/Briefing";
import { EmailMessage } from "@/domain/email-message/EmailMessage";
import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";

import { LoggerSpy } from "./LoggerSpy";

// Términos cuya presencia en CUALQUIER log pintaría una fuga de datos.
const FORBIDDEN_TERMS = [
  "bodyText",
  "snippet",
  "subject",
  "body",
  "Email body",
  "accessToken",
  "refreshToken",
  "ya29.A0AbVbY8",
  // Valor concreto de un access token mock: si aparece en un log, leak.
  "plain-access-token",
];

const SECRETIVE_BODY = "ASUNTO PRIVADO: NDA con cliente. NO debe loguearse.";
const SECRETIVE_SUBJECT = "Re: roadmap Q3 confidencial";

function makeUser(): User {
  return User.create({
    email: Email.create("user@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake"),
    displayName: "Jane",
  });
}

function makeIntegration(userId: string): GmailIntegration {
  return GmailIntegration.create({
    userId,
    googleAccountEmail: "user@gmail.com",
    accessToken: EncryptedToken.fromBase64(
      Buffer.from("enc-access").toString("base64"),
    ),
    refreshToken: EncryptedToken.fromBase64(
      Buffer.from("enc-refresh").toString("base64"),
    ),
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

function makeFakeEmail(): EmailMessage {
  return EmailMessage.create({
    id: "msg-1",
    messageIdHeader: "<msg-1@example.com>",
    threadId: "thread-1",
    subject: SECRETIVE_SUBJECT,
    fromEmail: "alice@example.com",
    fromName: "Alice",
    toEmails: ["user@example.com"],
    snippet: SECRETIVE_BODY.slice(0, 50),
    receivedAt: new Date(),
    bodyText: SECRETIVE_BODY,
  });
}

describe("Política de logging end-to-end (con fakes)", () => {
  it("emite los eventos esperados y NO leaks de contenido de email ni tokens", async () => {
    const user = makeUser();
    const integration = makeIntegration(user.id);
    const logger = new LoggerSpy();

    const briefingsSaved: Briefing[] = [];
    const briefingRepo: BriefingRepositoryPort = {
      save: vi.fn(async (b: Briefing) => {
        briefingsSaved.push(b);
      }),
      findById: vi.fn(async (id: string) => briefingsSaved.find((b) => b.id === id) ?? null),
      findLatestByUserId: vi.fn(async () => null),
    };

    // FetchInboxEmails.
    const gmailRepo: GmailIntegrationRepositoryPort = {
      save: vi.fn(),
      findByUserId: vi.fn(async () => integration),
      deleteByUserId: vi.fn(),
    };
    const tokenEnc: TokenEncryptionPort = {
      encrypt: vi.fn(async (s: string) => Buffer.from(s).toString("base64")),
      decrypt: vi.fn(async () => "plain-access-token"),
    };
    const emailFetcher: EmailFetcherPort = {
      fetchInbox: vi.fn(async (_params: FetchInboxParams) => [makeFakeEmail()]),
    };
    const refresh = {
      execute: vi.fn(async () => ({ integration })),
    } as unknown as RefreshGmailToken;

    const fetchInboxEmails = new FetchInboxEmails({
      gmailIntegrationRepo: gmailRepo,
      tokenEncryption: tokenEnc,
      emailFetcher,
      refreshGmailToken: refresh,
      logger,
    });

    // GenerateBriefing.
    const briefingGenerator: BriefingGeneratorPort = {
      generate: vi.fn(async () => ({
        summary:
          "Tienes correos importantes hoy: 1 cliente urgente y un par de respuestas pendientes que requieren atención prioritaria.",
        tokensUsedInput: 800,
        tokensUsedOutput: 120,
        modelUsed: "gpt-4o-mini",
      })),
    };
    const generateBriefing = new GenerateBriefing({
      briefingGenerator,
      briefingRepo,
      promptVersion: "v1.0.0",
      logger,
    });

    // SendBriefingEmail.
    const userRepo: UserRepositoryPort = {
      findByEmail: vi.fn(),
      findById: vi.fn(async () => user),
      findAllWithBriefingEnabled: vi.fn(async () => []),
      save: vi.fn(),
    };
    const renderer: BriefingEmailRendererPort = {
      render: vi.fn(() => ({
        subject: "Tu briefing matutino",
        html: "<p>x</p>",
        text: "x",
      })),
    };
    const sender: EmailSenderPort = {
      send: vi.fn(async () => ({
        messageId: "<smtp-msg-abcdefghijklmnopqrstuvwxyz@local>",
      })),
    };
    const sendBriefingEmail = new SendBriefingEmail({
      briefingRepo,
      userRepo,
      renderer,
      emailSender: sender,
      fromAddress: { email: "focusflow@local.dev", name: "FocusFlow" },
      logger,
    });

    // Flow E2E con fakes.
    const fetched = await fetchInboxEmails.execute({ userId: user.id });
    const { briefingId } = await generateBriefing.execute({
      userId: user.id,
      emails: fetched.emails,
    });
    await sendBriefingEmail.execute({ briefingId });

    // 1. Eventos esperados.
    expect(logger.byEvent("gmail_inbox_fetched")).toHaveLength(1);
    expect(logger.byEvent("briefing_generated")).toHaveLength(1);
    expect(logger.byEvent("briefing_email_sent")).toHaveLength(1);

    const inboxLog = logger.byEvent("gmail_inbox_fetched")[0]!;
    expect(inboxLog.payload.userId).toBe(user.id);
    expect(inboxLog.payload.count).toBe(1);

    const briefingLog = logger.byEvent("briefing_generated")[0]!;
    expect(briefingLog.payload.userId).toBe(user.id);
    expect(briefingLog.payload.briefingId).toBe(briefingId);
    expect(briefingLog.payload.modelUsed).toBe("gpt-4o-mini");
    expect(briefingLog.payload.tokensUsedInput).toBe(800);

    const sentLog = logger.byEvent("briefing_email_sent")[0]!;
    expect(sentLog.payload.userId).toBe(user.id);
    expect(sentLog.payload.briefingId).toBe(briefingId);
    expect(sentLog.payload.recipientDomain).toBe("example.com");
    // messageIdPrefix tiene <= 16 chars.
    expect((sentLog.payload.messageIdPrefix as string).length).toBeLessThanOrEqual(16);

    // 2. Sin fugas: ningún log incluye términos prohibidos.
    const offenders = logger.scanForLeaks(FORBIDDEN_TERMS);
    expect(offenders).toEqual([]);

    // 3. Sanity extra: el contenido del email NO aparece en ningún log
    // (test de tipo "canary" — palabras clave del cuerpo).
    const dump = JSON.stringify(logger.logs);
    expect(dump).not.toContain("NDA");
    expect(dump).not.toContain("confidencial");
    expect(dump).not.toContain(SECRETIVE_BODY);
  });
});
