import { z } from "zod";

export const loginUserInputSchema = z.object({
  email: z.string(),
  password: z.string(),
});

export type LoginUserInput = z.infer<typeof loginUserInputSchema>;
