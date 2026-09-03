import { z } from "zod";
import type {
  AreaUnit,
  ContactPreference,
  Furnishing,
  ListingType,
  LocationPrecision,
  ParkingType,
  PropertyStatus,
  PropertyType,
} from "@prisma/client";
import {
  AREA_UNIT_LABELS,
  CONTACT_PREFERENCE_LABELS,
  FURNISHING_LABELS,
  isAllowedMapsUrl,
  isKnownAmenity,
  isLand,
  isRoomBearing,
  LISTING_TYPE_LABELS,
  LOCATION_PRECISION_LABELS,
  MAX_AMENITIES,
  PARKING_LABELS,
  PROPERTY_TYPE_LABELS,
  STATUS_LABELS,
} from "@/lib/properties/constants";

/**
 * Server-side validation for property writes. This is the trust boundary: the
 * routes call `parse` on the raw body and touch nothing else from the request.
 *
 * ── What is *not* in this schema, and why that is the point ─────────────────
 *
 * `ownerId`, `status`, `publishedAt`, `verifiedAt`, `verifiedById` and
 * `verificationRequestedAt` are absent. Zod's object schemas **strip** unknown
 * keys, so a client that posts
 *
 *     { title: "…", ownerId: "<someone else>", status: "VERIFIED" }
 *
 * has those two keys silently dropped before the data reaches Prisma. They are
 * not rejected with an error, because a hostile client learns nothing useful
 * from the difference — they simply cannot be written through this path at all.
 * `ownerId` comes from the session; `status` moves only through
 * `lib/properties/status.ts`.
 *
 * ── Enum values are derived, not restated ───────────────────────────────────
 *
 * Every `z.enum` below is built from a `Record<PrismaEnum, string>` in
 * `lib/properties/constants.ts`. Those records are exhaustive by construction —
 * a new member in `prisma/schema.prisma` without a label is a type error — so
 * the accepted value set here can never drift from the database's.
 */

/** Builds a zod enum from an exhaustive label record, so the two stay in step. */
function enumOf<T extends string>(labels: Record<T, string>, message: string) {
  const values = Object.keys(labels) as [T, ...T[]];
  return z.enum(values, { errorMap: () => ({ message }) });
}

/**
 * HTML form controls submit `""` for "nothing entered", and `z.coerce.number()`
 * turns `""` into `0` — which would quietly store a floor of 0 or an age of 0
 * instead of "not provided". Empty strings and nulls are normalised to
 * `undefined` before any coercion runs.
 */
const blankToUndefined = (value: unknown) =>
  value === null || (typeof value === "string" && value.trim() === "") ? undefined : value;

/** Strips C0/C1 control characters (keeping tab and newline) and trims. Guards
 *  against invisible payloads in text that is later rendered and searched. */
function cleanMultiline(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")
    .trim();
}

/** Single-line text: as above, but newlines collapse to spaces. */
function cleanSingleLine(value: string): string {
  return cleanMultiline(value).replace(/\s+/g, " ");
}

const singleLine = (min: number, max: number, tooShort: string, tooLong: string) =>
  z
    .string({ required_error: tooShort, invalid_type_error: tooShort })
    .transform(cleanSingleLine)
    .pipe(z.string().min(min, tooShort).max(max, tooLong));

const optionalSingleLine = (max: number, tooLong: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ invalid_type_error: "Enter valid text" })
      .transform(cleanSingleLine)
      .pipe(z.string().min(1).max(max, tooLong))
      .optional()
  );

/** A required, finite, positive amount (price, area). */
const positiveAmount = (label: string, max: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({
        required_error: `Enter ${label}`,
        invalid_type_error: `Enter a valid ${label}`,
      })
      .finite(`Enter a valid ${label}`)
      .positive(`${label[0].toUpperCase()}${label.slice(1)} must be greater than 0`)
      .max(max, `That ${label} looks too large — please check it`)
  );

/** An optional whole number within an inclusive range. */
const optionalCount = (label: string, min: number, max: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ invalid_type_error: `Enter a valid ${label}` })
      .int(`${label[0].toUpperCase()}${label.slice(1)} must be a whole number`)
      .min(min, `${label[0].toUpperCase()}${label.slice(1)} cannot be less than ${min}`)
      .max(max, `${label[0].toUpperCase()}${label.slice(1)} cannot be more than ${max}`)
      .optional()
  );

const optionalEnum = <T extends string>(labels: Record<T, string>, message: string) =>
  z.preprocess(blankToUndefined, enumOf(labels, message).optional());

const optionalCoordinate = (label: string, bound: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ invalid_type_error: `Enter a valid ${label}` })
      .finite(`Enter a valid ${label}`)
      .min(-bound, `${label[0].toUpperCase()}${label.slice(1)} must be between -${bound} and ${bound}`)
      .max(bound, `${label[0].toUpperCase()}${label.slice(1)} must be between -${bound} and ${bound}`)
      .optional()
  );

/**
 * Amenities are an allowlist, checked member by member. Unknown values are
 * refused rather than dropped: an owner who ticks something the server does not
 * recognise should be told, not silently have it disappear from their listing.
 *
 * The message never echoes the offending value back — there is no reason to
 * reflect arbitrary client input into a response body.
 */
const amenitiesField = z.preprocess(
  (value) => (value === null || value === undefined ? [] : value),
  z
    .array(z.string({ invalid_type_error: "Invalid amenity selection" }).trim(), {
      invalid_type_error: "Invalid amenity selection",
    })
    .max(MAX_AMENITIES, `Select at most ${MAX_AMENITIES} amenities`)
    .superRefine((list, ctx) => {
      if (list.some((slug) => !isKnownAmenity(slug))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "One of the selected amenities is not on the list.",
        });
      }
    })
    // Deduplicated so a padded payload cannot inflate the array past the cap by
    // repeating one slug, and so the stored list is canonical.
    .transform((list) => [...new Set(list)])
);

const mapsUrlField = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .max(2048, "That link is too long")
    .refine(isAllowedMapsUrl, "Paste an https Google Maps link (google.com or maps.app.goo.gl)")
    .optional()
);

// ─────────────────────────────────────────────────────────────
// The write schema
// ─────────────────────────────────────────────────────────────

const propertyBaseSchema = z.object({
  title: singleLine(
    8,
    120,
    "Give the listing a title of at least 8 characters",
    "Title must be at most 120 characters"
  ),
  description: z
    .string({ required_error: "Describe the property" })
    .transform(cleanMultiline)
    .pipe(
      z
        .string()
        .min(30, "Description must be at least 30 characters")
        .max(5000, "Description must be at most 5000 characters")
    ),

  propertyType: enumOf(PROPERTY_TYPE_LABELS, "Select a property type"),
  listingType: enumOf(LISTING_TYPE_LABELS, "Choose whether this is for sale or for rent"),

  price: positiveAmount("a price", 1e12),
  negotiable: z.coerce.boolean().default(false),

  areaValue: positiveAmount("an area", 1e7),
  areaUnit: enumOf(AREA_UNIT_LABELS, "Select an area unit"),

  bedrooms: optionalCount("bedrooms", 0, 50),
  bathrooms: optionalCount("bathrooms", 0, 50),
  floor: optionalCount("floor", -5, 200),
  totalFloors: optionalCount("total floors", 0, 200),

  furnishing: optionalEnum(FURNISHING_LABELS, "Select a furnishing status"),
  parking: optionalEnum(PARKING_LABELS, "Select a parking option"),
  propertyAgeYears: optionalCount("property age", 0, 200),

  amenities: amenitiesField,

  addressLine1: singleLine(
    4,
    160,
    "Enter the address",
    "Address line 1 must be at most 160 characters"
  ),
  addressLine2: optionalSingleLine(160, "Address line 2 must be at most 160 characters"),
  locality: optionalSingleLine(120, "Locality must be at most 120 characters"),
  city: singleLine(2, 80, "Enter the city", "City must be at most 80 characters"),
  state: singleLine(2, 80, "Enter the state", "State must be at most 80 characters"),
  pincode: z
    .string({ required_error: "Enter the PIN code" })
    .trim()
    .regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit PIN code"),

  mapsUrl: mapsUrlField,
  latitude: optionalCoordinate("latitude", 90),
  longitude: optionalCoordinate("longitude", 180),

  /**
   * How precisely those coordinates may be published.
   *
   * Defaulted rather than required, so a client that predates this field — or an
   * owner who never opens the location section — lands on the private option
   * instead of failing validation or being opted into publication. The default
   * matches the column default in `prisma/schema.prisma` deliberately: two places
   * decide "what if unspecified", and they must give the same answer.
   */
  locationPrecision: z
    .preprocess(
      blankToUndefined,
      enumOf(LOCATION_PRECISION_LABELS, "Choose how precisely to show this location").optional()
    )
    .transform((value) => value ?? "APPROXIMATE"),

  contactPreference: enumOf(
    CONTACT_PREFERENCE_LABELS,
    "Choose how buyers should contact you"
  ),
});

/**
 * Cross-field rules. Each attaches its message to the field the owner has to
 * fix, so the form can highlight it rather than showing a form-level error.
 */
function checkCrossFieldRules(
  data: z.infer<typeof propertyBaseSchema>,
  ctx: z.RefinementCtx
): void {
  const type = data.propertyType as PropertyType;

  // Room counts are required exactly where they are meaningful.
  if (isRoomBearing(type)) {
    if (data.bedrooms === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bedrooms"],
        message: "Enter the number of bedrooms",
      });
    }
    if (data.bathrooms === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bathrooms"],
        message: "Enter the number of bathrooms",
      });
    }
  }

  if (
    data.floor !== undefined &&
    data.totalFloors !== undefined &&
    data.floor > data.totalFloors
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["floor"],
      message: "Floor cannot be higher than the building's total floors",
    });
  }

  // A lone coordinate cannot place a pin, and storing half of one invites a
  // future map view to read `latitude` and default the other axis to 0 — a
  // point in the Gulf of Guinea.
  if ((data.latitude === undefined) !== (data.longitude === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [data.latitude === undefined ? "latitude" : "longitude"],
      message: "Enter both latitude and longitude, or neither",
    });
  }
}

/** What the routes hand to Prisma. `null` (not `undefined`) for cleared fields:
 *  an update must be able to *remove* a value, and `undefined` in a Prisma
 *  update means "leave unchanged", which would make clearing impossible. */
export type PropertyWriteData = {
  title: string;
  description: string;
  propertyType: PropertyType;
  listingType: ListingType;
  price: number;
  negotiable: boolean;
  areaValue: number;
  areaUnit: AreaUnit;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  furnishing: Furnishing | null;
  parking: ParkingType | null;
  propertyAgeYears: number | null;
  amenities: string[];
  addressLine1: string;
  addressLine2: string | null;
  locality: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  mapsUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision: LocationPrecision;
  contactPreference: ContactPreference;
};

/**
 * Normalisation, applied after validation.
 *
 * Fields that are meaningless for the chosen type are forced to `null` rather
 * than trusted from the payload. This is what stops a listing that started life
 * as a 3-bedroom apartment and was changed to a plot from keeping "3 bedrooms,
 * semi-furnished, floor 4" in the database — the form hides those inputs on the
 * type change, but a hand-rolled request would still carry them.
 */
function normalise(data: z.infer<typeof propertyBaseSchema>): PropertyWriteData {
  const type = data.propertyType as PropertyType;
  const land = isLand(type);
  const rooms = isRoomBearing(type);

  return {
    title: data.title,
    description: data.description,
    propertyType: type,
    listingType: data.listingType as ListingType,
    price: data.price,
    negotiable: data.negotiable,
    areaValue: data.areaValue,
    areaUnit: data.areaUnit as AreaUnit,

    bedrooms: rooms ? (data.bedrooms ?? null) : null,
    bathrooms: rooms ? (data.bathrooms ?? null) : null,
    floor: land ? null : (data.floor ?? null),
    totalFloors: land ? null : (data.totalFloors ?? null),
    furnishing: land ? null : ((data.furnishing as Furnishing | undefined) ?? null),
    parking: land ? null : ((data.parking as ParkingType | undefined) ?? null),
    propertyAgeYears: land ? null : (data.propertyAgeYears ?? null),

    amenities: data.amenities,

    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2 ?? null,
    locality: data.locality ?? null,
    city: data.city,
    state: data.state,
    pincode: data.pincode,
    // Not accepted from the client. The PIN-code rule above is India-specific,
    // so claiming to store an arbitrary country would be validating an address
    // against the wrong country's format. International addresses are a schema
    // change, not a free-text field.
    country: "India",

    mapsUrl: data.mapsUrl ?? null,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,

    // Meaningless without a coordinate to apply it to, so it is pinned back to
    // the private default when the pair is absent. Storing EXACT against no
    // coordinates would leave a listing that starts publishing its precise
    // position the moment someone later fills the pair in — a consent decision
    // made by an unrelated edit.
    locationPrecision:
      data.latitude === undefined || data.longitude === undefined
        ? "APPROXIMATE"
        : (data.locationPrecision as LocationPrecision),

    contactPreference: data.contactPreference as ContactPreference,
  };
}

/**
 * Create and update share one schema and one completeness bar.
 *
 * A DRAFT is therefore fully validated, not half-filled. That is a deliberate
 * trade: it means "publish" needs no second validation pass and no listing can
 * reach the public marketplace with a missing price because it was written while
 * the row was still a draft. The cost is that an owner cannot save a title and
 * come back later — which the form mitigates by keeping everything on one page
 * rather than a multi-step wizard that loses work.
 */
export const propertyWriteSchema = propertyBaseSchema
  .superRefine(checkCrossFieldRules)
  .transform(normalise);

/**
 * Create additionally accepts `publish`, so "Save & publish" is one request
 * rather than a create followed by a status change that could fail on its own
 * and leave a surprise draft behind. It is still a real DRAFT → PUBLISHED
 * transition, checked against the same table.
 */
export const propertyCreateSchema = propertyBaseSchema
  .extend({ publish: z.coerce.boolean().default(false) })
  .superRefine(checkCrossFieldRules)
  .transform((data) => ({ ...normalise(data), publish: data.publish }));

export const statusChangeSchema = z.object({
  status: enumOf(STATUS_LABELS, "That is not a valid status"),
});

/**
 * Query parameters for the owner's list endpoint. `perPage` is capped so a
 * caller cannot ask for the whole collection in one response.
 */
export const propertyListQuerySchema = z.object({
  status: z.preprocess(blankToUndefined, enumOf(STATUS_LABELS, "Unknown status filter").optional()),
  page: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(10_000).default(1)
  ),
  perPage: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(50).default(12)
  ),
});

export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;
export type StatusChangeInput = z.infer<typeof statusChangeSchema>;
export type PropertyListQuery = z.infer<typeof propertyListQuerySchema>;

/** Narrow a raw string to a `PropertyStatus`, for reading URL filters. */
export function toPropertyStatus(value: string | undefined): PropertyStatus | undefined {
  if (!value) return undefined;
  return value in STATUS_LABELS ? (value as PropertyStatus) : undefined;
}
