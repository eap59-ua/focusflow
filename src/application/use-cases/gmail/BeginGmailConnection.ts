import type { OAuthClientPort } from "@/application/ports/OAuthClientPort";
import type { OAuthStateStorePort } from "@/application/ports/OAuthStateStorePort";

const STATE_BYTES = 32;
const STATE_TTL_SECONDS = 600;
const GMAIL_SCOPES: readonly string[] = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
];

function generateStateHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(STATE_BYTES));
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

export interface BeginGmailConnectionDependencies {
  readonly oauthStateStore: OAuthStateStorePort;
  readonly oauthClient: OAuthClientPort;
}

export interface BeginGmailConnectionInput {
  readonly userId: string;
}

export interface BeginGmailConnectionOutput {
  readonly authorizeUrl: string;
}

export class BeginGmailConnection {
  constructor(private readonly deps: BeginGmailConnectionDependencies) {}

  async execute(
    input: BeginGmailConnectionInput,
  ): Promise<BeginGmailConnectionOutput> {
    const state = generateStateHex();
    await this.deps.oauthStateStore.save(state, input.userId, STATE_TTL_SECONDS);
    const authorizeUrl = this.deps.oauthClient.generateAuthUrl(state, GMAIL_SCOPES);
    return { authorizeUrl };
  }
}
