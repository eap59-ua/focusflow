export interface OAuthExchangeResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly scope: string;
  readonly googleAccountEmail: string;
}

export interface OAuthRefreshResult {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
}

export interface OAuthClientPort {
  generateAuthUrl(state: string, scopes: readonly string[]): string;
  exchangeCode(code: string): Promise<OAuthExchangeResult>;
  refreshAccessToken(refreshToken: string): Promise<OAuthRefreshResult>;
}
