/**
 * Area unit conversion.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A listing stores area as a `{ areaValue, areaUnit }` pair, and sellers really
 * do use all five units — a flat is quoted in sq ft, a farmhouse in acres, a
 * plot in sq yd. The browse filter, meanwhile, has to offer *one* scale, because
 * "between 800 and 1,500" is meaningless if half the results are measured in
 * hectares. Square feet is that scale: it is what the overwhelming majority of
 * Indian residential listings are quoted in.
 *
 * So a comparison across units has to happen somewhere, and there are only two
 * places it can: in the database or in this module.
 *
 * ── Why not a denormalised `areaSqft` column ────────────────────────────────
 *
 * That would be faster — one indexed range scan instead of five — and it is the
 * right answer at a scale this application is nowhere near. It was rejected here
 * because it buys that speed with a second source of truth for a number the
 * seller already gave us: every write path would have to recompute it, every
 * existing row would need a backfill, and a row that skipped either would be
 * invisible to the filter while looking perfectly fine in the dashboard. A
 * filter that silently omits listings is a worse failure than a filter that
 * costs an extra index.
 *
 * The alternative, taken below, is to convert the *threshold* instead of the
 * data: "at least 1,000 sq ft" becomes "(SQFT and ≥ 1000) or (SQM and ≥ 92.9)
 * or (ACRE and ≥ 0.023) or …". Five branches, each an equality on `areaUnit`
 * plus a range on `areaValue`, which is exactly what the existing rows can
 * answer without being rewritten. `buildWhere()` in lib/properties/public.ts is
 * the only caller.
 *
 * ── Precision ───────────────────────────────────────────────────────────────
 *
 * The factors are exact where the definition is exact (1 sq yd is 9 sq ft; 1
 * acre is 43,560 sq ft, both by definition) and carry twelve significant figures
 * where it is not (the metric ones derive from 1 ft = 0.3048 m exactly, so
 * 1 m² = 1/0.3048² ft², an irrational decimal). At the magnitudes a filter
 * boundary uses this is far below the resolution anyone types.
 *
 * Client-safe: no Prisma runtime import, no `server-only`. The filter form
 * imports the labels; the query builder imports the factors.
 */

import type { AreaUnit } from "@prisma/client";

/**
 * How many square feet one of each unit is.
 *
 * Keyed by the enum so adding a member to `AreaUnit` in the schema is a type
 * error here rather than a silently missing filter branch.
 */
export const AREA_SQFT_FACTORS: Record<AreaUnit, number> = {
  SQFT: 1,
  // 1 m = 1 / 0.3048 ft, squared.
  SQM: 10.7639104167,
  // 1 yd = 3 ft, squared. Exact.
  SQYD: 9,
  // Exact by definition.
  ACRE: 43_560,
  // 1 hectare = 10,000 m².
  HECTARE: 107_639.104167,
};

/** Convert a stored `{ value, unit }` area into square feet. */
export function toSqft(value: number, unit: AreaUnit): number {
  return value * AREA_SQFT_FACTORS[unit];
}

/**
 * Convert a square-foot threshold into the equivalent number in `unit`.
 *
 * Used to push a filter boundary down to rows stored in another unit, which is
 * why it is `fromSqft` and not `toUnit`: the input is always the user's typed
 * square-foot figure.
 */
export function fromSqft(sqft: number, unit: AreaUnit): number {
  return sqft / AREA_SQFT_FACTORS[unit];
}

/**
 * The rungs offered by the area filter's dropdowns, in square feet.
 *
 * Discrete steps rather than free number entry: an area range is a coarse
 * intent ("a two-bedroom, not a studio"), the useful boundaries are well known,
 * and a select cannot be typed into wrongly. Price stays a free number input
 * because a budget genuinely is specific.
 */
export const AREA_STEPS_SQFT: readonly number[] = [
  300, 500, 750, 1_000, 1_250, 1_500, 2_000, 2_500, 3_000, 5_000, 10_000,
];

/** The largest area boundary the parser will accept, in square feet. */
export const MAX_AREA_SQFT = 10_000_000;
