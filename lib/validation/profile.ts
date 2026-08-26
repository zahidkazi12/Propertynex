import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, "Full name is too short").max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\s\-()]{7,18}$/, "Enter a valid phone number"),
  image: z.string().trim().url("Must be a valid URL").optional().or(z.literal("")),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
