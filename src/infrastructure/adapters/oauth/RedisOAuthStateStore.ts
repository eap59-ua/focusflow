import type { Redis } from "ioredis";

import type {
  OAuthStateConsumeResult,
  OAuthStateStorePort,
} from "@/application/ports/OAuthStateStorePort";

const KEY_PREFIX = "oauth:gmail:state:";

const CONSUME_LUA = `
local v = redis.call('GET', KEYS[1])
if v then
  redis.call('DEL', KEYS[1])
end
return v
`;

export class RedisOAuthStateStore implements OAuthStateStorePort {
  constructor(private readonly redis: Redis) {}

  async save(state: string, userId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(KEY_PREFIX + state, userId, "EX", ttlSeconds);
  }

  async consume(state: string): Promise<OAuthStateConsumeResult | null> {
    const result = (await this.redis.eval(
      CONSUME_LUA,
      1,
      KEY_PREFIX + state,
    )) as string | null;
    return result ? { userId: result } : null;
  }
}
