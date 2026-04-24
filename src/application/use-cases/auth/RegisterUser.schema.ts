import { z } from "zod";

export const registerUserInputSchema = z.object({
  email: z.string(),
  password: z.string(),
  displayName: z.string(),
});

export type RegisterUserInput = z.infer<typeof registerUserInputSchema>;
