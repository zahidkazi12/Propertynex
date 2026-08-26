import type { AreaUnit, ListingType } from "@prisma/client";
import { AREA_UNIT_LABELS } from "@/lib/properties/constants";

/**
 * Display formatting for listings. Client-safe (type-only Prisma import).
 *
 * ── Why these are hand-rolled instead of `Intl` ─────────────────────────────
 *
 * Everything here is deterministic and locale-independent by construction. The
 * same string is produced on the server and in the browser, on any Node build
 * and any user's machine, so a card rendered on the server can never hydrate
 * into a slightly different string. `Intl.NumberFormat("en-IN")` and
 * `toLocaleDateString` both depend on the ICU data the runtime happens to ship
 * and on the viewer's time zone, which is exactly the kind of difference that
 * surfaces as a hydration mismatch rather than as a visible bug.
 */

/** Indian digit grouping: 12,34,567 rather than 1,234,567. */
export function groupIndian(value: number): string {
  const rounded = Math.round(Math.abs(value));
  const digits = String(rounded);
  const sign = value < 0 ? "-" : "";

  if (digits.length <= 3) return `${sign}${digits}`;

  // Last three digits, then pairs.
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}${pairs},${lastThree}`;
}

const CRORE = 10_000_000;
const LAKH = 100_000;

/** Trims a trailing ".00"/".50" → ".5" so "1.50 Cr" reads as "1.5 Cr". */
function trimDecimals(value: number): string {
  return value
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

/**
 * Compact Indian price. Crores and lakhs are how property prices are actually
 * quoted in this market; a rupee-grouped 25000000 is not readable at a glance.
 */
export function formatPrice(price: number): string {
  if (price >= CRORE) return `₹${trimDecimals(price / CRORE)} Cr`;
  if (price >= LAKH) return `₹${trimDecimals(price / LAKH)} L`;
  return `₹${groupIndian(price)}`;
}

/** Rent carries a period; a sale price does not. */
export function formatPriceWithPeriod(price: number, listingType: ListingType): string {
  return listingType === "RENT" ? `${formatPrice(price)}/month` : formatPrice(price);
}

/** Exact rupee amount, for the detail view where precision matters. */
export function formatExactPrice(price: number): string {
  return `₹${groupIndian(price)}`;
}

export function formatArea(value: number, unit: AreaUnit): string {
  const amount = Number.isInteger(value) ? groupIndian(value) : trimDecimals(value);
  return `${amount} ${AREA_UNIT_LABELS[unit]}`;
}

/**
 * "3 BHK", "3 BHK · 2 baths" — the shorthand every Indian listing leads with.
 * Returns null for a plot or a warehouse, where it means nothing.
 */
export function formatConfiguration(
  bedrooms: number | null,
  bathrooms: number | null
): string | null {
  const parts: string[] = [];
  if (bedrooms !== null) parts.push(`${bedrooms} BHK`);
  if (bathrooms !== null) parts.push(`${bathrooms} ${bathrooms === 1 ? "bath" : "baths"}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function formatFloor(floor: number | null, totalFloors: number | null): string | null {
  if (floor === null && totalFloors === null) return null;

  const floorLabel =
    floor === null ? null : floor === 0 ? "Ground floor" : `Floor ${floor}`;

  if (floorLabel && totalFloors !== null) return `${floorLabel} of ${totalFloors}`;
  if (floorLabel) return floorLabel;
  return `${totalFloors} floors`;
}

export function formatPropertyAge(years: number | null): string | null {
  if (years === null) return null;
  if (years === 0) return "New / under construction";
  return `${years} ${years === 1 ? "year" : "years"} old`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * "22 Aug 2026", read in UTC.
 *
 * UTC rather than the viewer's zone, deliberately: it is the only choice that
 * gives the same answer everywhere. Showing a listing's creation date in the
 * viewer's local zone would be marginally nicer and would require this to be a
 * Client Component to avoid a hydration mismatch — not a trade worth making for
 * a "created on" line.
 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * "Aug 2026" — the same UTC reading as `formatDate`, with the day dropped.
 *
 * For "Member since" on a seller's card. The day a stranger opened their account
 * is precision nobody asked for and a small piece of an account's history handed
 * out for free; the month and year say everything the trust signal needs to.
 */
export function formatMonthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Full address on one line, skipping the parts that were left blank. */
export function formatAddress(property: {
  addressLine1: string;
  addressLine2: string | null;
  locality: string | null;
  city: string;
  state: string;
  pincode: string;
}): string {
  return [
    property.addressLine1,
    property.addressLine2,
    property.locality,
    property.city,
    property.state,
    property.pincode,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ");
}

/** Short "City, Locality" line for cards. */
export function formatShortLocation(property: {
  locality: string | null;
  city: string;
}): string {
  return property.locality ? `${property.locality}, ${property.city}` : property.city;
}
