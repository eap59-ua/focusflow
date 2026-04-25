import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { GetCurrentUser } from "@/application/use-cases/auth/GetCurrentUser";
import { LoginUser } from "@/application/use-cases/auth/LoginUser";
import { LogoutUser } from "@/application/use-cases/auth/LogoutUser";
import { RegisterUser } from "@/application/use-cases/auth/RegisterUser";
import { FetchInboxEmails } from "@/application/use-cases/email/FetchInboxEmails";
import { BeginGmailConnection } from "@/application/use-cases/gmail/BeginGmailConnection";
import { CompleteGmailConnection } from "@/application/use-cases/gmail/CompleteGmailConnection";
import { DisconnectGmail } from "@/application/use-cases/gmail/DisconnectGmail";
import { GetGmailStatus } from "@/application/use-cases/gmail/GetGmailStatus";
import { RefreshGmailToken } from "@/application/use-cases/gmail/RefreshGmailToken";

import { GmailEmailFetcher } from "./adapters/gmail/GmailEmailFetcher";
import { GoogleOAuthClient } from "./adapters/oauth/GoogleOAuthClient";
import { RedisOAuthStateStore } from "./adapters/oauth/RedisOAuthStateStore";
import { PrismaGmailIntegrationRepository } from "./adapters/prisma/PrismaGmailIntegrationRepository";
import { PrismaSessionRepository } from "./adapters/prisma/PrismaSessionRepository";
import { PrismaUserRepository } from "./adapters/prisma/PrismaUserRepository";
import { BcryptPasswordHasher } from "./adapters/security/BcryptPasswordHasher";
import { AesGcmTokenEncryption } from "./security/AesGcmTokenEncryption";

const DEFAULT_SESSION_LIFETIME_DAYS = 30;
const DEFAULT_GMAIL_FETCH_QUERY = "in:inbox newer_than:1d";
const DEFAULT_GMAIL_FETCH_MAX_MESSAGES = 50;

export interface Container {
  readonly registerUser: RegisterUser;
  readonly loginUser: LoginUser;
  readonly logoutUser: LogoutUser;
  readonly getCurrentUser: GetCurrentUser;
  readonly beginGmailConnection: BeginGmailConnection;
  readonly completeGmailConnection: CompleteGmailConnection;
  readonly refreshGmailToken: RefreshGmailToken;
  readonly disconnectGmail: DisconnectGmail;
  readonly getGmailStatus: GetGmailStatus;
  readonly fetchInboxEmails: FetchInboxEmails;
}

function readSessionLifetimeDays(): number {
  const raw = process.env.SESSION_LIFETIME_DAYS;
  if (!raw) return DEFAULT_SESSION_LIFETIME_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `SESSION_LIFETIME_DAYS inválido: "${raw}". Debe ser un número positivo.`,
    );
  }
  return parsed;
}

function readTokenEncryptionKey(): string {
  const raw = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY no está definida. Genera una con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" y añádela al .env. Ver docs/pending-external-setup.md.",
    );
  }
  return raw;
}

function readGmailFetchMaxMessages(): number {
  const raw = process.env.GMAIL_FETCH_MAX_MESSAGES;
  if (!raw) return DEFAULT_GMAIL_FETCH_MAX_MESSAGES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `GMAIL_FETCH_MAX_MESSAGES inválido: "${raw}". Debe ser un número positivo.`,
    );
  }
  return Math.floor(parsed);
}

export interface BuildContainerOptions {
  readonly prisma: PrismaClient;
  readonly redis: Redis;
}

export function buildContainer(opts: BuildContainerOptions): Container {
  const { prisma, redis } = opts;
  const userRepo = new PrismaUserRepository(prisma);
  const sessionRepo = new PrismaSessionRepository(prisma);
  const gmailIntegrationRepo = new PrismaGmailIntegrationRepository(prisma);
  const hasher = new BcryptPasswordHasher();
  const tokenEncryption = new AesGcmTokenEncryption(readTokenEncryptionKey());
  const oauthClient = new GoogleOAuthClient({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.GOOGLE_OAUTH_REDIRECT_URI ??
      "http://localhost:3030/settings/gmail/callback",
  });
  const oauthStateStore = new RedisOAuthStateStore(redis);
  const sessionLifetimeDays = readSessionLifetimeDays();

  const registerUser = new RegisterUser({ userRepo, hasher });
  const loginUser = new LoginUser({
    userRepo,
    hasher,
    sessionRepo,
    sessionLifetimeDays,
  });
  const logoutUser = new LogoutUser({ sessionRepo });
  const getCurrentUser = new GetCurrentUser({
    sessionRepo,
    userRepo,
    clock: () => new Date(),
  });

  const beginGmailConnection = new BeginGmailConnection({
    oauthStateStore,
    oauthClient,
  });
  const completeGmailConnection = new CompleteGmailConnection({
    oauthStateStore,
    oauthClient,
    tokenEncryption,
    gmailIntegrationRepo,
  });
  const refreshGmailToken = new RefreshGmailToken({
    gmailIntegrationRepo,
    tokenEncryption,
    oauthClient,
  });
  const disconnectGmail = new DisconnectGmail({ gmailIntegrationRepo });
  const getGmailStatus = new GetGmailStatus({ gmailIntegrationRepo });

  const emailFetcher = new GmailEmailFetcher();
  const fetchInboxEmails = new FetchInboxEmails({
    gmailIntegrationRepo,
    tokenEncryption,
    emailFetcher,
    refreshGmailToken,
    defaultQuery: process.env.GMAIL_FETCH_QUERY ?? DEFAULT_GMAIL_FETCH_QUERY,
    maxResults: readGmailFetchMaxMessages(),
  });

  return {
    registerUser,
    loginUser,
    logoutUser,
    getCurrentUser,
    beginGmailConnection,
    completeGmailConnection,
    refreshGmailToken,
    disconnectGmail,
    getGmailStatus,
    fetchInboxEmails,
  };
}
