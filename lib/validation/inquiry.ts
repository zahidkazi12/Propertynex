import { z } from "zod";

/**
 * `POST /api/inquiries` — a visitor contacting a seller about one listing.
 *
 * ── What the body cannot carry ──────────────────────────────────────────────
 *
 * The same subtraction as the rest of `lib/validation/`. `PropertyInquiry` has
 * eight writable columns; this schema has five, and the three missing ones are
 * missing on purpose:
 *
 *   - `ownerId` — copied from the property row the route just loaded. It is a
 *     denormalised `property.ownerId`, so accepting it from a client would let
 *     anyone file an inquiry into a stranger's inbox against somebody else's
 *     listing.
 *   - `fromUserId` — read from the session cookie, or left null for a signed-out
 *     visitor. A client-supplied value would let a caller attribute their own
 *     inquiry to another account.
 *   - `status` — always `NEW` at creation; it is the *owner's* workflow field,
 *     advanced from the dashboard, and a sender has no business setting it.
 *
 * Zod object schemas strip unknown keys, so a request that posts any of the
 * three has them removed before the route sees the parsed value. The route never
 * spreads the body into `prisma.propertyInquiry.create`; it names each field.
 *
 * ── Why name and email are asked for even from signed-in users ─────────────
 *
 * The person typing is not always the person on the account — a family member
 * uses a shared laptop, a broker enquires on a client's behalf, and the number
 * the seller should ring back is whichever one was typed. The form prefills from
 * the session, which is convenient, but the submitted value is what is stored.
 * `fromUserId` still records *which account* it came through, so the two
 * questions ("who should the seller call" and "which account sent this") each
 * have their own answer instead of one standing in for both.
 */

/**
 * Control characters stripped, whitespace collapsed, then capped.
 *
 * The generous pre-cap on the raw string exists so the transform is not handed
 * an unbounded input to walk; the real limit is applied after normalising, so
 * padding a message with a megabyte of newlines does not smuggle it past the
 * length check or trip it on characters that were about to be removed.
 */
function cleanString(max: number, tooLong: string) {
  return z
    .string()
    .max(max * 8, tooLong)
    .transform((value) =>
      value
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    )
    .pipe(z.string().max(max, tooLong));
}

export const MAX_INQUIRY_MESSAGE_LENGTH = 1_000;

export const inquirySchema = z.object({
  /** Shape-checked before Prisma's Mongo connector can throw on it. */
  propertyId: z.string().regex(/^[0-9a-fA-F]{24}$/, "That property could not be found."),

  name: cleanString(80, "Keep your name under 80 characters.").pipe(
    z.string().min(2, "Please enter your name.")
  ),

  /**
   * Lower-cased so the owner's inbox does not show the same enquirer twice, and
   * because an address is not case-sensitive in the half that matters.
   */
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),

  /**
   * Optional, and `""` means "not given" rather than a phone number that is the
   * empty string — the column is nullable and should say so. The pattern matches
   * `lib/validation/auth.ts`, so a number that was acceptable at signup is
   * acceptable here.
   */
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\s\-()]{7,18}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),

  message: cleanString(
    MAX_INQUIRY_MESSAGE_LENGTH,
    `Keep your message under ${MAX_INQUIRY_MESSAGE_LENGTH} characters.`
  ).pipe(z.string().min(10, "Please write at least a sentence or two.")),
});

export type InquiryInput = z.infer<typeof inquirySchema>;
