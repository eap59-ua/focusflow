import { OAuth2Client } from "google-auth-library";

import type {
  OAuthClientPort,
  OAuthExchangeResult,
  OAuthRefreshResult,
} from "@/application/ports/OAuthClientPort";

export interface GoogleOAuthClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

const NOT_CONFIGURED_MSG =
  "Google OAuth no está configurado: faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en .env. Ver docs/pending-external-setup.md.";

function decodeIdTokenEmail(idToken: string): string {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("id_token con formato inválido");
  }
  const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
  const payload: unknown = JSON.parse(payloadJson);
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { email?: unknown }).email !== "string"
  ) {
    throw new Error("id_token no contiene email");
  }
  return (payload as { email: string }).email;
}

export class GoogleOAuthClient implements OAuthClientPort {
  constructor(private readonly config: GoogleOAuthClientConfig) {}

  private buildClient(): OAuth2Client {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error(NOT_CONFIGURED_MSG);
    }
    return new OAuth2Client({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri,
    });
  }

  generateAuthUrl(state: string, scopes: readonly string[]): string {
    const client = this.buildClient();
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: [...scopes],
      state,
    });
  }

  async exchangeCode(code: string): Promise<OAuthExchangeResult> {
    const client = this.buildClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.access_token) {
      throw new Error("Google OAuth: respuesta sin access_token");
    }
    if (!tokens.refresh_token) {
      throw new Error(
        "Google OAuth: respuesta sin refresh_token. Asegura prompt='consent' en el consent screen.",
      );
    }
    if (!tokens.id_token) {
      throw new Error(
        "Google OAuth: respuesta sin id_token. Verifica scopes openid + email.",
      );
    }

    const expiresInSeconds = tokens.expiry_date
      ? Math.max(0, Math.floor((tokens.expiry_date - Date.now()) / 1000))
      : 3600;
    const scope = tokens.scope ?? "";
    const googleAccountEmail = decodeIdTokenEmail(tokens.id_token);

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds,
      scope,
      googleAccountEmail,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthRefreshResult> {
    const client = this.buildClient();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error("Google OAuth: refresh sin access_token");
    }
    const expiresInSeconds = credentials.expiry_date
      ? Math.max(0, Math.floor((credentials.expiry_date - Date.now()) / 1000))
      : 3600;

    return {
      accessToken: credentials.access_token,
      expiresInSeconds,
    };
  }
}
