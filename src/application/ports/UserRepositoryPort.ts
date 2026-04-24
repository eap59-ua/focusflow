import type { Email } from "@/domain/user/Email";
import type { User } from "@/domain/user/User";

export interface UserRepositoryPort {
  findByEmail(email: Email): Promise<User | null>;
  save(user: User): Promise<void>;
}
