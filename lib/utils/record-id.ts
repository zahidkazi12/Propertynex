/**
 * The shape of a record id, in one place.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 *
 * Every model in `prisma/schema.prisma` declares `@id @default(cuid())`, so an
 * id is a CUID and nothing else. That fact was previously spelled out as an
 * inline regular expression in four separate files — two Zod schemas, the media
 * key builder and the ownership module — which is exactly how the four of them
 * came to disagree: the schema was migrated from MongoDB to PostgreSQL, and the
 * copies were left describing 24-character ObjectIds that the database no longer
 * issues. Every id-guarded path then rejected every real id.
 *
 * One definition, imported by all of them, cannot drift like that. It lives
 * under `lib/utils/` rather than in `lib/properties/ownership.ts` because the
 * media layer needs the same answer, and reaching into an *authorization* module
 * for a string shape is what made copy-pasting look like the tidier option.
 *
 * ── What the check is for, now that the database is PostgreSQL ───────────────
 *
 * Under the MongoDB connector a malformed id was a *crash*: Prisma threw rather
 * than returning null, so `/api/properties/nope` became a 500 unless the shape
 * was validated first. The PostgreSQL connector does not throw — `id` is a plain
 * text column, and a value that could never have been issued simply matches no
 * row.
 *
 * So this is no longer a guard against an exception. It is a cheap pre-filter
 * that keeps a malformed id and an unknown id indistinguishable from outside —
 * both 404, as `lib/properties/ownership.ts` explains at length — and saves a
 * round trip to the database to learn something the string itself already says.
 * Worth keeping for both reasons; worth not defending with the old one.
 */

/**
 * Prisma's `cuid()` default generates a CUID v1: the literal `c`, then 24
 * lowercase base36 characters, for 25 in total.
 *
 * Anchored at both ends, and deliberately narrow. A permissive
 * `^[a-z0-9]{20,32}$` would accept ids this application cannot have issued,
 * which costs the pre-filter its only job. Note that `cuid(2)` — CUID v2, a
 * different length and alphabet — is *not* in use anywhere in the schema; if a
 * model ever adopts it, this pattern is the one place that has to learn about it.
 */
export const RECORD_ID_PATTERN = /^c[a-z0-9]{24}$/;

/**
 * True for a string the database could have issued as an id.
 *
 * Callers treat `false` as "no such record" rather than as a validation error —
 * see the module header, and the existence-oracle note in
 * `lib/properties/ownership.ts`.
 */
export function isValidRecordId(value: string): boolean {
  return RECORD_ID_PATTERN.test(value);
}
