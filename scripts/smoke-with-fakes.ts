// scripts/smoke-with-fakes.ts
//
// Verificación end-to-end del flow de briefing usando fakes para todos los
// servicios externos (Gmail, OpenAI). Escribe en la BD de DEV (no test) y
// envía vía Mailpit local. Útil para validar el chain completo en ~30s sin
// necesitar credenciales de Google Cloud Console ni OpenAI.
//
// Pre-requisitos:
//   - docker compose up -d  (postgres, redis, mailpit)
//   - pnpm db:migrate (al menos una vez para que exista el schema)
//   - .env con TOKEN_ENCRYPTION_KEY válido (cualquier 64 hex chars)
//
// Uso: pnpm smoke:fakes
// Sale 0 si todo OK; 1 con mensaje claro si algo falla.
//
// NO usa credenciales reales. NO contacta servicios externos (excepto Mailpit
// local). Es seguro re-ejecutarlo: el user dev se reusa entre runs.

import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";

import type {
  BriefingGenerationResult,
  BriefingGeneratorPort,
} from "@/application/ports/BriefingGeneratorPort";
import type {
  EmailFetcherPort,
  FetchInboxParams,
} from "@/application/ports/EmailFetcherPort";
import { GenerateBriefing } from "@/application/use-cases/briefing/GenerateBriefing";
import { SendBriefingEmail } from "@/application/use-cases/briefing/SendBriefingEmail";
import { FetchInboxEmails } from "@/application/use-cases/email/FetchInboxEmails";
import { RefreshGmailToken } from "@/application/use-cases/gmail/RefreshGmailToken";
import { ScheduleAllActiveBriefings } from "@/application/use-cases/scheduling/ScheduleAllActiveBriefings";
import { TriggerBriefingForUser } from "@/application/use-cases/scheduling/TriggerBriefingForUser";
import { UpdateBriefingPreferences } from "@/application/use-cases/scheduling/UpdateBriefingPreferences";
import { EmailMessage } from "@/domain/email-message/EmailMessage";
import { EncryptedToken } from "@/domain/gmail-integration/EncryptedToken";
import { GmailIntegration } from "@/domain/gmail-integration/GmailIntegration";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { NodemailerEmailSender } from "@/infrastructure/adapters/email/NodemailerEmailSender";
import { GoogleOAuthClient } from "@/infrastructure/adapters/oauth/GoogleOAuthClient";
import { PrismaBriefingRepository } from "@/infrastructure/adapters/prisma/PrismaBriefingRepository";
import { PrismaGmailIntegrationRepository } from "@/infrastructure/adapters/prisma/PrismaGmailIntegrationRepository";
import { PrismaUserRepository } from "@/infrastructure/adapters/prisma/PrismaUserRepository";
import { BcryptPasswordHasher } from "@/infrastructure/adapters/security/BcryptPasswordHasher";
import { HtmlBriefingEmailRenderer } from "@/infrastructure/email/HtmlBriefingEmailRenderer";
import { ConsoleLogger } from "@/infrastructure/logging/ConsoleLogger";
import { MORNING_BRIEFING_PROMPT_VERSION } from "@/infrastructure/openai/prompts/morning-briefing";
import { BullMQBriefingScheduler } from "@/infrastructure/scheduling/BullMQBriefingScheduler";
import { AesGcmTokenEncryption } from "@/infrastructure/security/AesGcmTokenEncryption";
import {
  buildBriefingTriggerQueue,
  buildGenerateBriefingQueue,
  buildGmailInboxSyncQueue,
  buildSendBriefingEmailQueue,
} from "@/jobs/queues";
import { buildBriefingTriggerWorker } from "@/jobs/workers/briefing-trigger";
import { buildGenerateBriefingWorker } from "@/jobs/workers/generate-briefing";
import { buildGmailInboxSyncWorker } from "@/jobs/workers/gmail-inbox-sync";
import { buildSendBriefingEmailWorker } from "@/jobs/workers/send-briefing-email";

const DEV_USER_EMAIL = "dev@focusflow.local";
const DEV_USER_PASSWORD_HASH =
  "$2a$10$dummy.dummy.dummy.dummy.dummy.dummy.dummy.dummy.dummy.dummy.dummy";
const MAILPIT_API = "http://localhost:8025/api/v1/messages";
const FROM_ADDRESS = { email: "focusflow@local.dev", name: "FocusFlow (smoke)" };
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

function loadEnv(): void {
  process.loadEnvFile(resolve(__dirname, "..", ".env"));
}

function fakeEmails(): readonly EmailMessage[] {
  const now = Date.now();
  const mins = (n: number): Date => new Date(now - n * 60 * 1000);
  return [
    EmailMessage.create({
      id: "fake-1",
      messageIdHeader: "<fake-1@smoke.local>",
      threadId: "t-1",
      subject: "Recordatorio: revisión de PR pendiente",
      fromEmail: "alice@example.com",
      fromName: "Alice",
      toEmails: [DEV_USER_EMAIL],
      snippet: "Hola, ¿podrías revisar el PR #42 antes...",
      receivedAt: mins(120),
      bodyText: "Hola, ¿podrías revisar el PR #42 antes del viernes? Es bloqueante para release.",
    }),
    EmailMessage.create({
      id: "fake-2",
      messageIdHeader: "<fake-2@smoke.local>",
      threadId: "t-2",
      subject: "Newsletter semanal — IA y productividad",
      fromEmail: "news@aiweekly.example",
      fromName: "AI Weekly",
      toEmails: [DEV_USER_EMAIL],
      snippet: "Esta semana: 5 herramientas que están cambiando...",
      receivedAt: mins(180),
      bodyText: "Esta semana destacamos 5 herramientas en el espacio agentic. (...)",
    }),
    EmailMessage.create({
      id: "fake-3",
      messageIdHeader: "<fake-3@smoke.local>",
      threadId: "t-3",
      subject: "Aprobación de viaje (acción requerida)",
      fromEmail: "travel@empresa.com",
      fromName: "Travel Desk",
      toEmails: [DEV_USER_EMAIL],
      snippet: "Tu solicitud de viaje a Madrid requiere validación...",
      receivedAt: mins(60),
      bodyText: "Tu solicitud de viaje a Madrid requiere validación del manager antes de las 17:00 de hoy.",
    }),
  ];
}

class FakeEmailFetcher implements EmailFetcherPort {
  async fetchInbox(_params: FetchInboxParams): Promise<readonly EmailMessage[]> {
    return fakeEmails();
  }
}

class FakeBriefingGenerator implements BriefingGeneratorPort {
  async generate(
    emails: readonly EmailMessage[],
  ): Promise<BriefingGenerationResult> {
    const summary = `**Lo más urgente**:

- **Travel Desk** — aprobación de viaje a Madrid antes de las 17:00 de hoy.
- **Alice** — revisión del PR #42 (bloqueante para release).

**Para tu información**:

- AI Weekly: 5 herramientas agentic destacadas esta semana.

**Resumen del resto**: Procesados ${emails.length} emails. Sin urgencias adicionales.`;
    return {
      summary,
      tokensUsedInput: 600,
      tokensUsedOutput: 180,
      modelUsed: "smoke-fake",
    };
  }
}

interface MailpitListResponse {
  readonly messages: ReadonlyArray<{ readonly To?: ReadonlyArray<{ readonly Address?: string }> }>;
  readonly total: number;
}

async function ensureDevUser(
  prisma: PrismaClient,
  userRepo: PrismaUserRepository,
): Promise<User> {
  const email = Email.create(DEV_USER_EMAIL);
  const existing = await userRepo.findByEmail(email);
  if (existing) return existing;

  const user = User.create({
    email,
    hashedPassword: HashedPassword.fromHash(DEV_USER_PASSWORD_HASH),
    displayName: "Smoke Dev",
  });
  await userRepo.save(user);
  return user;
}

async function ensureFakeIntegration(
  user: User,
  gmailRepo: PrismaGmailIntegrationRepository,
  encryption: AesGcmTokenEncryption,
): Promise<void> {
  const existing = await gmailRepo.findByUserId(user.id);
  if (existing) return;

  const accessTokenEnc = await encryption.encrypt("fake-smoke-access-token");
  const refreshTokenEnc = await encryption.encrypt("fake-smoke-refresh-token");

  const integration = GmailIntegration.create({
    userId: user.id,
    googleAccountEmail: "smoke-dev@gmail.example",
    accessToken: EncryptedToken.fromBase64(accessTokenEnc),
    refreshToken: EncryptedToken.fromBase64(refreshTokenEnc),
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  await gmailRepo.save(integration);
}

async function pollForBriefing(
  briefingRepo: PrismaBriefingRepository,
  userId: string,
  startedAt: number,
): Promise<{ id: string; summary: string; modelUsed: string } | null> {
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const latest = await briefingRepo.findLatestByUserId(userId);
    if (latest && latest.createdAt.getTime() >= startedAt - 1000) {
      return { id: latest.id, summary: latest.summary, modelUsed: latest.modelUsed };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

async function pollForMailpitDelivery(
  recipient: string,
  startedAt: number,
): Promise<{ id: string; subject: string } | null> {
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    try {
      const res = await fetch(MAILPIT_API);
      if (res.ok) {
        const json = (await res.json()) as MailpitListResponse;
        const match = json.messages.find((m) =>
          (m.To ?? []).some((t) => t.Address === recipient),
        );
        if (match) {
          // Mailpit list endpoint returns shape with ID and Subject in v1 API.
          const lookup = match as unknown as { ID?: string; Subject?: string };
          return { id: lookup.ID ?? "?", subject: lookup.Subject ?? "?" };
        }
      }
    } catch {
      // Mailpit no levantado todavía — seguimos polleando.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

async function main(): Promise<void> {
  loadEnv();

  const dbUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!dbUrl) throw new Error("DATABASE_URL no definida (revisa .env).");
  if (!redisUrl) throw new Error("REDIS_URL no definida (revisa .env).");
  if (!tokenKey) throw new Error("TOKEN_ENCRYPTION_KEY no definida (revisa .env).");

  console.log("=== smoke-with-fakes ===\n");

  const adapter = new PrismaPg({ connectionString: dbUrl });
  const prisma = new PrismaClient({ adapter });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  const encryption = new AesGcmTokenEncryption(tokenKey);
  const logger = new ConsoleLogger();

  // Pre-flight: confirma que Redis y Postgres responden antes de
  // construir Workers (que tirarían unhandled errors si la conexión falla).
  try {
    await redis.connect();
    await redis.ping();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[smoke] Redis no disponible en ${redisUrl}: ${msg}. ¿docker compose up -d?`);
    redis.disconnect();
    process.exit(1);
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[smoke] Postgres no disponible en ${dbUrl}: ${msg}. ¿docker compose up -d? ¿pnpm db:migrate?`);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  }

  // Repos.
  const userRepo = new PrismaUserRepository(prisma);
  const gmailRepo = new PrismaGmailIntegrationRepository(prisma);
  const briefingRepo = new PrismaBriefingRepository(prisma);

  // Adapters reales (Mailpit) y fakes (Gmail/OpenAI).
  const emailFetcher = new FakeEmailFetcher();
  const briefingGenerator = new FakeBriefingGenerator();
  const renderer = new HtmlBriefingEmailRenderer();
  const sender = new NodemailerEmailSender({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number.parseInt(process.env.SMTP_PORT ?? "1025", 10),
    secure: false,
  });

  // OAuth client (dummy — no se va a invocar porque skip refresh).
  const oauthClient = new GoogleOAuthClient({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "http://localhost:3030/cb",
  });
  const refreshGmailToken = new RefreshGmailToken({
    gmailIntegrationRepo: gmailRepo,
    tokenEncryption: encryption,
    oauthClient,
  });

  // Use cases.
  const fetchInboxEmails = new FetchInboxEmails({
    gmailIntegrationRepo: gmailRepo,
    tokenEncryption: encryption,
    emailFetcher,
    refreshGmailToken,
    logger,
  });
  const generateBriefing = new GenerateBriefing({
    briefingGenerator,
    briefingRepo,
    promptVersion: MORNING_BRIEFING_PROMPT_VERSION,
    logger,
  });
  const sendBriefingEmail = new SendBriefingEmail({
    briefingRepo,
    userRepo,
    renderer,
    emailSender: sender,
    fromAddress: FROM_ADDRESS,
    logger,
  });

  // Queues + scheduler + workers.
  const triggerQueue = buildBriefingTriggerQueue(redis);
  const syncQueue = buildGmailInboxSyncQueue(redis);
  const genQueue = buildGenerateBriefingQueue(redis);
  const sendQueue = buildSendBriefingEmailQueue(redis);
  const scheduler = new BullMQBriefingScheduler({
    briefingTriggerQueue: triggerQueue,
    connection: redis,
  });
  const triggerBriefingForUser = new TriggerBriefingForUser({
    userRepo,
    scheduler,
    logger,
  });
  const updateBriefingPreferences = new UpdateBriefingPreferences({
    userRepo,
    scheduler,
  });
  // ScheduleAllActiveBriefings está disponible si se quisiera (aunque
  // este smoke no lo usa); referenciado para evitar lint de import unused.
  void new ScheduleAllActiveBriefings({ userRepo, scheduler });

  const workers = [
    buildGmailInboxSyncWorker({ fetchInboxEmails, connection: redis }),
    buildGenerateBriefingWorker({ generateBriefing, connection: redis }),
    buildSendBriefingEmailWorker({ sendBriefingEmail, connection: redis }),
    buildBriefingTriggerWorker({ triggerBriefingForUser, connection: redis }),
  ];
  await Promise.all(workers.map((w) => w.waitUntilReady()));

  let exitCode = 0;
  try {
    // Setup user + integration.
    const user = await ensureDevUser(prisma, userRepo);
    console.log(`[smoke] user dev: ${user.id} (${user.email.value})`);

    await ensureFakeIntegration(user, gmailRepo, encryption);
    console.log("[smoke] fake gmail integration: lista");

    // Activar briefing si aún no lo está.
    if (!user.briefingEnabled) {
      await updateBriefingPreferences.execute({
        userId: user.id,
        hour: user.briefingHour,
        timezone: user.briefingTimezone,
        enabled: true,
      });
      console.log("[smoke] briefing activado para el user");
    }

    const startedAt = Date.now();

    // Disparar el flow.
    const { flowId } = await triggerBriefingForUser.execute({ userId: user.id });
    console.log(`[smoke] flow disparado: ${flowId}. Esperando briefing en DB...`);

    const briefing = await pollForBriefing(briefingRepo, user.id, startedAt);
    if (!briefing) {
      throw new Error(`Timeout esperando briefing en DB tras ${POLL_TIMEOUT_MS}ms.`);
    }
    console.log(
      `[smoke] briefing creado: ${briefing.id} (model=${briefing.modelUsed}, ${briefing.summary.length} chars)`,
    );

    console.log("[smoke] esperando email en Mailpit...");
    const mail = await pollForMailpitDelivery(DEV_USER_EMAIL, startedAt);
    if (!mail) {
      throw new Error(
        `Timeout esperando email en Mailpit (${MAILPIT_API}) para ${DEV_USER_EMAIL}.`,
      );
    }
    console.log(`[smoke] email visible en Mailpit: ${mail.subject} (id=${mail.id})`);

    console.log("\nSmoke con fakes OK. Email visible en http://localhost:8025");
  } catch (err) {
    console.error("\n[smoke] FAIL:", err instanceof Error ? err.message : err);
    exitCode = 1;
  } finally {
    await Promise.all(workers.map((w) => w.close())).catch(() => undefined);
    await scheduler.close().catch(() => undefined);
    await Promise.all([
      triggerQueue.close(),
      syncQueue.close(),
      genQueue.close(),
      sendQueue.close(),
    ]).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    redis.disconnect();
  }

  process.exit(exitCode);
}

main().catch((err: unknown) => {
  console.error("[smoke-with-fakes] error inesperado:", err);
  process.exit(1);
});
