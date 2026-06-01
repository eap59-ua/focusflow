export interface OAuthStateConsumeResult {
  readonly userId: string;
}

export interface OAuthStateStorePort {
  save(state: string, userId: string, ttlSeconds: number): Promise<void>;
  consume(state: string): Promise<OAuthStateConsumeResult | null>;
}
