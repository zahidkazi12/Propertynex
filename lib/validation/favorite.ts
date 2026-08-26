import { z } from "zod";

/**
 * `POST`/`DELETE /api/favorites` — the whole request body.
 *
 * One field, because one field is all a save is: *which* listing. Who is saving
 * it is the session cookie's answer, not the body's, and there is deliberately
 * no `userId` in this schema for a client to supply — Zod's object schemas strip
 * unknown keys, so a request that posts one has it removed before the route can
 * accidentally read it. That is the same subtraction `lib/validation/media.ts`
 * documents, applied to the smallest possible payload.
 *
 * The id is shape-checked here rather than at the database, because Prisma's
 * Mongo connector *throws* on a malformed ObjectId — a 500 where a 400 belongs.
 * `lib/properties/favorites.ts` guards again with `isValidObjectId` so the
 * module is safe to call from anywhere, not only from behind this schema.
 *
 * The message is the same opaque one a genuinely missing listing gets. A
 * signed-in visitor probing ids must not be able to tell "that is not an id"
 * from "that id is not yours to see"; see the existence-oracle note in
 * lib/properties/favorites.ts.
 */
export const favoriteSchema = z.object({
  propertyId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "That property could not be found."),
});

export type FavoriteInput = z.infer<typeof favoriteSchema>;
