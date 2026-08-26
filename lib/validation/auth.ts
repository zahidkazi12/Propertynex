import { z } from "zod";
import { OTP_LENGTH } from "@/lib/otp/config";

// Reasonably strict but not adversarial: at least 8 characters, one letter,
// one number. Real-world apps might also check against breached-password
// lists — out of scope for this milestone but noted in the README.
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters") // bcrypt's effective input limit
  .regex(/[a-zA-Z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s\-()]{7,18}$/, "Enter a valid phone number");

export const signupSchema = z
  .object({
    name: z.string().trim().min(2, "Full name is too short").max(80),
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: "You must accept the terms to continue" }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ─────────────────────────────────────────────────────────────
// Password recovery (OTP)
// ─────────────────────────────────────────────────────────────

/**
 * Step 1 takes one field that may be either an email address or a mobile
 * number, so the schema only enforces a length envelope here — deciding which
 * of the two it is, and rejecting values that are neither, is
 * `parseIdentifier`'s job (lib/utils/identifier.ts). Splitting it that way
 * keeps a single source of truth for the email/phone shapes, which the route
 * also needs in order to pick a delivery channel.
 */
export const forgotPasswordStartSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, "Enter your email address or mobile number")
    .max(120, "That value is too long"),
});

const otpCodeSchema = z
  .string()
  .trim()
  // Accept the digits with any separators the user may have pasted in; the
  // route normalizes before comparing.
  .regex(new RegExp(`^[0-9\\s-]{${OTP_LENGTH},${OTP_LENGTH * 3}}$`), "Enter the 6-digit code")
  .refine((value) => value.replace(/\D/g, "").length === OTP_LENGTH, {
    message: `Enter the ${OTP_LENGTH}-digit code`,
  });

export const forgotPasswordVerifySchema = z.object({
  recoveryToken: z.string().min(10),
  code: otpCodeSchema,
});

export const forgotPasswordResendSchema = z.object({
  recoveryToken: z.string().min(10),
});

export const forgotPasswordResetSchema = z
  .object({
    resetToken: z.string().min(10),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
