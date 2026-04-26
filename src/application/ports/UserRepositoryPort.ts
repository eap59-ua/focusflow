import type { Email } from "@/domain/user/Email";
import type { User } from "@/domain/user/User";

export interface UserRepositoryPort {
  findByEmail(email: Email): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findAllWithBriefingEnabled(): Promise<readonly User[]>;
  save(user: User): Promise<void>;
}
