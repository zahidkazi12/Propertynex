import { z } from "zod";

import { RECORD_ID_PATTERN } from "@/lib/utils/record-id";

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
 * The id is shape-checked here rather than at the database, so a value the store
 * could never have issued costs a 400 instead of a round trip;
 * `lib/utils/record-id.ts` owns the pattern. `lib/properties/favorites.ts` guards
 * again with `isValidRecordId` so the module is safe to call from anywhere, not
 * only from behind this schema.
 *
 * The message is the same opaque one a genuinely missing listing gets. A
 * signed-in visitor probing ids must not be able to tell "that is not an id"
 * from "that id is not yours to see"; see the existence-oracle note in
 * lib/properties/favorites.ts.
 */
export const favoriteSchema = z.object({
  propertyId: z.string().regex(RECORD_ID_PATTERN, "That property could not be found."),
});

export type FavoriteInput = z.infer<typeof favoriteSchema>;
