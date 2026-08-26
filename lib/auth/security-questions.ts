import { hashSecret, verifySecret } from "./password";

/**
 * Security questions — RETAINED, BUT NO LONGER PART OF PASSWORD RECOVERY.
 *
 * Password recovery is now OTP-based (see lib/otp/ and
 * app/api/auth/forgot-password/). Nothing in the recovery flow reads this file.
 *
 * It is kept because `User.securityQuestionId` / `User.securityAnswerHash`
 * survive as optional columns — accounts created before the switch still hold
 * values there, and a later step-up-verification feature (confirming identity
 * before a high-risk action, rather than *instead of* proving control of an
 * email or phone) is the kind of thing they would be appropriate for. Deleting
 * the catalog would strand that data with no way to interpret the stored ids.
 *
 * What was removed along with the old flow:
 *
 *  - `getDecoySecurityQuestion`, which invented a plausible question for
 *    unknown emails so the old step 1 could answer uniformly. Enumeration
 *    protection is now handled properly, by creating a full decoy recovery
 *    session, so the decoy question has nothing left to do.
 *  - The failed-attempt and lockout counters on User, which existed solely to
 *    rate-limit answer guessing.
 *
 * Nothing here should be wired back into password recovery. A security answer
 * is a low-entropy secret that is often discoverable from public information,
 * and unlike a passcode it does not prove present control of the contact
 * address an account is registered to.
 */
export const SECURITY_QUESTIONS = [
  { id: 1, text: "What was the name of your first school?" },
  { id: 2, text: "What was your childhood nickname?" },
  { id: 3, text: "What was the name of your first pet?" },
  { id: 4, text: "What was the name of the city where you were born?" },
  { id: 5, text: "What was your favorite childhood game?" },
  { id: 6, text: "What was the name of your favorite teacher?" },
  { id: 7, text: "What was your favorite childhood movie?" },
  { id: 8, text: "What was the first place you traveled to?" },
  { id: 9, text: "What was your favorite food as a child?" },
  { id: 10, text: "What was the name of your childhood best friend?" },
  { id: 11, text: "Which is your favourite car brand?" },
] as const;

export type SecurityQuestionId = (typeof SECURITY_QUESTIONS)[number]["id"];

export const SECURITY_QUESTION_IDS = SECURITY_QUESTIONS.map((q) => q.id) as SecurityQuestionId[];

export function getSecurityQuestionText(id: number): string | undefined {
  return SECURITY_QUESTIONS.find((q) => q.id === id)?.text;
}

/**
 * Normalizes an answer before hashing/comparison so that trivial formatting
 * differences (casing, surrounding whitespace, repeated internal spaces) don't
 * cause a legitimate user to fail verification.
 */
export function normalizeSecurityAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function hashSecurityAnswer(answer: string): Promise<string> {
  return hashSecret(normalizeSecurityAnswer(answer));
}

export async function verifySecurityAnswer(
  answer: string,
  storedHash: string
): Promise<boolean> {
  return verifySecret(normalizeSecurityAnswer(answer), storedHash);
}
