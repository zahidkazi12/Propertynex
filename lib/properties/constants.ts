/**
 * The property vocabulary: every enumerated value a listing can hold, plus the
 * amenity allowlist.
 *
 * ── Why this file is client-safe ────────────────────────────────────────────
 *
 * The add/edit form is a Client Component and needs these lists to render its
 * selects. So this module must never pull the Prisma runtime into the browser
 * bundle. The enum *types* come from `@prisma/client` through a **type-only**
 * import, which TypeScript erases at compile time — no runtime dependency, no
 * `server-only` marker, and still a single source of truth for the union types.
 *
 * ── Why labels are `Record<Enum, string>` and not arrays of options ─────────
 *
 * A `Record` keyed by the enum union is exhaustive by construction: adding a
 * member to `enum PropertyType` in `prisma/schema.prisma` without giving it a
 * label here is a *type error*, not a select box with a blank row in it. The
 * ordered/grouped arrays below exist for presentation only, and
 * `tests/unit/property-constants.test.ts` asserts they cover every key of the
 * corresponding record exactly once — the one property the compiler can't see.
 */
import type {
  AreaUnit,
  ContactPreference,
  Furnishing,
  ListingType,
  ParkingType,
  PropertyStatus,
  PropertyType,
  Role,
} from "@prisma/client";

export type Option<T extends string> = { readonly value: T; readonly label: string };

// ─────────────────────────────────────────────────────────────
// Listing intent
// ─────────────────────────────────────────────────────────────

export const LISTING_TYPE_LABELS: Record<ListingType, string> = {
  BUY: "For sale",
  RENT: "For rent",
};

export const LISTING_TYPE_ORDER: readonly ListingType[] = ["BUY", "RENT"];

// ─────────────────────────────────────────────────────────────
// Property type
// ─────────────────────────────────────────────────────────────

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  APARTMENT: "Apartment / Flat",
  INDEPENDENT_HOUSE: "Independent house",
  VILLA: "Villa",
  BUILDER_FLOOR: "Builder floor",
  PENTHOUSE: "Penthouse",
  STUDIO: "Studio apartment",
  PLOT: "Residential plot",
  FARMHOUSE: "Farmhouse",
  PG_HOSTEL: "PG / Hostel",
  OFFICE: "Office space",
  SHOP: "Shop",
  SHOWROOM: "Showroom",
  WAREHOUSE: "Warehouse / Godown",
  COMMERCIAL_LAND: "Commercial land",
};

/** Presentation grouping for the `<select>`; see the test that pins coverage. */
export const PROPERTY_TYPE_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly types: readonly PropertyType[];
}> = [
  {
    label: "Residential",
    types: [
      "APARTMENT",
      "INDEPENDENT_HOUSE",
      "VILLA",
      "BUILDER_FLOOR",
      "PENTHOUSE",
      "STUDIO",
      "FARMHOUSE",
      "PG_HOSTEL",
    ],
  },
  { label: "Commercial", types: ["OFFICE", "SHOP", "SHOWROOM", "WAREHOUSE"] },
  { label: "Land", types: ["PLOT", "COMMERCIAL_LAND"] },
];

/**
 * Types for which a bedroom and bathroom count is meaningful — and therefore
 * required. `lib/validation/property.ts` enforces that, and also *clears* those
 * fields for every other type so a plot can never carry a stale "3 bedrooms"
 * from a type change mid-form.
 *
 * PG_HOSTEL is included: a paying-guest listing is advertised by room count.
 * OFFICE/SHOP/SHOWROOM/WAREHOUSE are not — they are advertised by area, and a
 * washroom count is not the same thing as a bathroom count.
 */
export const ROOM_BEARING_TYPES: readonly PropertyType[] = [
  "APARTMENT",
  "INDEPENDENT_HOUSE",
  "VILLA",
  "BUILDER_FLOOR",
  "PENTHOUSE",
  "STUDIO",
  "FARMHOUSE",
  "PG_HOSTEL",
];

/**
 * Types with no building on them. Floor, furnishing, parking, property age and
 * room counts are all meaningless here and are normalised away server-side.
 */
export const LAND_TYPES: readonly PropertyType[] = ["PLOT", "COMMERCIAL_LAND"];

export function isRoomBearing(type: PropertyType): boolean {
  return ROOM_BEARING_TYPES.includes(type);
}

export function isLand(type: PropertyType): boolean {
  return LAND_TYPES.includes(type);
}

// ─────────────────────────────────────────────────────────────
// Area, furnishing, parking, contact
// ─────────────────────────────────────────────────────────────

export const AREA_UNIT_LABELS: Record<AreaUnit, string> = {
  SQFT: "sq ft",
  SQM: "sq m",
  SQYD: "sq yd",
  ACRE: "acre",
  HECTARE: "hectare",
};

export const AREA_UNIT_ORDER: readonly AreaUnit[] = [
  "SQFT",
  "SQM",
  "SQYD",
  "ACRE",
  "HECTARE",
];

export const FURNISHING_LABELS: Record<Furnishing, string> = {
  UNFURNISHED: "Unfurnished",
  SEMI_FURNISHED: "Semi-furnished",
  FULLY_FURNISHED: "Fully furnished",
};

export const FURNISHING_ORDER: readonly Furnishing[] = [
  "UNFURNISHED",
  "SEMI_FURNISHED",
  "FULLY_FURNISHED",
];

export const PARKING_LABELS: Record<ParkingType, string> = {
  NONE: "No parking",
  OPEN: "Open parking",
  COVERED: "Covered parking",
  BOTH: "Open + covered",
};

export const PARKING_ORDER: readonly ParkingType[] = ["NONE", "OPEN", "COVERED", "BOTH"];

export const CONTACT_PREFERENCE_LABELS: Record<ContactPreference, string> = {
  PHONE: "Call me",
  EMAIL: "Email me",
  BOTH: "Call or email me",
  IN_APP: "Contact me through PROPERTYNEX only",
};

export const CONTACT_PREFERENCE_ORDER: readonly ContactPreference[] = [
  "BOTH",
  "PHONE",
  "EMAIL",
  "IN_APP",
];

// ─────────────────────────────────────────────────────────────
// Who is selling
// ─────────────────────────────────────────────────────────────

/**
 * What a buyer is choosing between when they filter by "posted by".
 *
 * This is deliberately *not* `Role`. `Role` has five members and answers an
 * authorization question — what may this account do. A buyer filtering the
 * marketplace is asking a different, coarser question: am I dealing with the
 * person who lives there, an intermediary, or a developer. Two of the five roles
 * are the same answer to that question (a USER who happens to have listed their
 * flat and an account that has upgraded to OWNER are both "owner"), and one of
 * them — ADMIN — is not an answer at all and must never be surfaced as a seller
 * category.
 *
 * Keeping the two vocabularies separate is what lets `Role` grow (a MODERATOR,
 * a PARTNER) without either leaking into a public filter or forcing a URL
 * parameter to change.
 */
export const SELLER_KINDS = ["owner", "agent", "builder"] as const;

export type SellerKind = (typeof SELLER_KINDS)[number];

export const SELLER_KIND_LABELS: Record<SellerKind, string> = {
  owner: "Owner",
  agent: "Agent",
  builder: "Builder",
};

/** Plural form, for the filter dropdown ("Owners" reads better than "Owner"). */
export const SELLER_KIND_PLURAL_LABELS: Record<SellerKind, string> = {
  owner: "Owners only",
  agent: "Agents only",
  builder: "Builders only",
};

/**
 * Which account roles each buyer-facing category covers.
 *
 * ADMIN appears in no bucket. An admin can technically own a listing, and if one
 * ever does it is reachable by every other filter — it simply has no honest
 * answer to "who is selling this", so it is not claimed by one.
 */
export const SELLER_KIND_ROLES: Record<SellerKind, readonly Role[]> = {
  owner: ["USER", "OWNER"],
  agent: ["AGENT"],
  builder: ["BUILDER"],
};

/**
 * The inverse mapping, for labelling a card.
 *
 * Returns `null` for a role no category claims, and the card then shows no
 * seller-kind chip rather than inventing one.
 */
export function sellerKindForRole(role: Role): SellerKind | null {
  for (const kind of SELLER_KINDS) {
    if (SELLER_KIND_ROLES[kind].includes(role)) return kind;
  }
  return null;
}

export function isSellerKind(value: string): value is SellerKind {
  return (SELLER_KINDS as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────
// Configuration steps (browse filters)
// ─────────────────────────────────────────────────────────────

/**
 * The rungs the bedroom and bathroom filters offer, read as "N or more".
 *
 * Both stop at 5 rather than at the 20 the parser will accept: a "6+ BHK"
 * option would be an empty result set on almost any inventory, and a buyer who
 * genuinely wants one can still ask for it by editing the URL. The parser's
 * wider bound is a validation limit, not a menu.
 */
export const BEDROOM_STEPS = [1, 2, 3, 4, 5] as const;
export const BATHROOM_STEPS = [1, 2, 3, 4] as const;

/** Upper bound accepted by the parser for either count. */
export const MAX_ROOM_COUNT = 20;

// ─────────────────────────────────────────────────────────────
// Status presentation
// ─────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<PropertyStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  UNPUBLISHED: "Unpublished",
  PENDING_VERIFICATION: "Pending verification",
  VERIFIED: "Verified",
};

export const STATUS_DESCRIPTIONS: Record<PropertyStatus, string> = {
  DRAFT: "Saved but not visible to anyone else.",
  PUBLISHED: "Live on the marketplace and visible to buyers.",
  UNPUBLISHED: "Taken offline by you. Nothing is lost; you can republish it.",
  PENDING_VERIFICATION: "Submitted for review. Offline until a reviewer decides.",
  VERIFIED: "Reviewed and approved by PROPERTYNEX, and live.",
};

/** Tailwind classes per status. Kept beside the labels so a new status can't
 *  render with an undefined class string. */
export const STATUS_TONES: Record<PropertyStatus, string> = {
  DRAFT: "border-white/15 bg-white/5 text-slate-300",
  PUBLISHED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  UNPUBLISHED: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  PENDING_VERIFICATION: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  VERIFIED: "border-cyan/40 bg-cyan/10 text-cyan",
};

/** Tab order for the My Properties filter bar. */
export const STATUS_FILTER_ORDER: readonly PropertyStatus[] = [
  "DRAFT",
  "PUBLISHED",
  "UNPUBLISHED",
  "PENDING_VERIFICATION",
  "VERIFIED",
];

// ─────────────────────────────────────────────────────────────
// Amenities
// ─────────────────────────────────────────────────────────────

/**
 * The amenity allowlist.
 *
 * Free text is rejected at the validation boundary (see
 * `lib/validation/property.ts`), which is what keeps this a searchable facet
 * later instead of an unbounded set of near-duplicate strings
 * ("24x7 security", "24/7 Security", "security 24 hours", …).
 *
 * Slugs are the stored value and are part of the data contract — rename a
 * *label* freely, but changing a slug orphans it on every row that already has
 * it, so treat that as a migration.
 */
export const AMENITY_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly amenities: ReadonlyArray<Option<string>>;
}> = [
  {
    label: "Building & safety",
    amenities: [
      { value: "power-backup", label: "Power backup" },
      { value: "lift", label: "Lift" },
      { value: "security-24x7", label: "24x7 security" },
      { value: "cctv", label: "CCTV surveillance" },
      { value: "gated-community", label: "Gated community" },
      { value: "water-supply-24x7", label: "24x7 water supply" },
      { value: "fire-safety", label: "Fire safety" },
      { value: "intercom", label: "Intercom" },
      { value: "visitor-parking", label: "Visitor parking" },
      { value: "wheelchair-access", label: "Wheelchair access" },
    ],
  },
  {
    label: "Community & leisure",
    amenities: [
      { value: "gym", label: "Gym" },
      { value: "swimming-pool", label: "Swimming pool" },
      { value: "clubhouse", label: "Clubhouse" },
      { value: "play-area", label: "Children's play area" },
      { value: "park", label: "Park / garden" },
      { value: "jogging-track", label: "Jogging track" },
      { value: "indoor-games", label: "Indoor games" },
      { value: "pet-friendly", label: "Pet friendly" },
    ],
  },
  {
    label: "Inside the home",
    amenities: [
      { value: "modular-kitchen", label: "Modular kitchen" },
      { value: "wardrobes", label: "Fitted wardrobes" },
      { value: "air-conditioning", label: "Air conditioning" },
      { value: "geyser", label: "Geyser" },
      { value: "piped-gas", label: "Piped gas" },
      { value: "balcony", label: "Balcony" },
      { value: "servant-room", label: "Servant room" },
      { value: "study-room", label: "Study room" },
      { value: "pooja-room", label: "Pooja room" },
      { value: "store-room", label: "Store room" },
      { value: "vastu-compliant", label: "Vastu compliant" },
    ],
  },
  {
    label: "Sustainability",
    amenities: [
      { value: "rain-water-harvesting", label: "Rainwater harvesting" },
      { value: "solar-panels", label: "Solar panels" },
      { value: "waste-disposal", label: "Waste disposal" },
      { value: "ev-charging", label: "EV charging" },
    ],
  },
];

/** Flat allowlist, derived so the groups stay the single source of truth. */
export const AMENITY_SLUGS: readonly string[] = AMENITY_GROUPS.flatMap((group) =>
  group.amenities.map((amenity) => amenity.value)
);

const AMENITY_LABEL_BY_SLUG = new Map(
  AMENITY_GROUPS.flatMap((group) => group.amenities.map((a) => [a.value, a.label] as const))
);

export function isKnownAmenity(slug: string): boolean {
  return AMENITY_LABEL_BY_SLUG.has(slug);
}

/** Falls back to the slug so a row written before a slug was retired still
 *  renders something readable rather than an empty chip. */
export function amenityLabel(slug: string): string {
  return AMENITY_LABEL_BY_SLUG.get(slug) ?? slug;
}

/** Upper bound on how many amenities one listing may carry. Above the size of
 *  the allowlist would be pointless; this is a guard against a padded payload. */
export const MAX_AMENITIES = AMENITY_SLUGS.length;

// ─────────────────────────────────────────────────────────────
// Google Maps links
// ─────────────────────────────────────────────────────────────

/**
 * Hosts accepted for `Property.mapsUrl`.
 *
 * The field is rendered as a link the owner and (later) prospective buyers
 * click, so an open URL field is a stored-redirect / phishing vector: "here is
 * the map for the flat" pointing anywhere. Restricting it to Google's own map
 * hosts is what makes the stored value safe to linkify.
 *
 * `maps.app.goo.gl` and `goo.gl` are the share-sheet shorteners the Google Maps
 * app produces, which is what most owners will actually paste.
 */
const MAPS_HOST_ALLOWLIST: readonly string[] = [
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "www.google.com",
  "google.com",
];

/** `google.<cctld>` and `google.co.<cctld>`, with or without a `www`/`maps`
 *  prefix — the same map on a regional domain. */
const GOOGLE_REGIONAL_HOST = /^(?:www\.|maps\.)?google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/;

/**
 * True only for an https Google Maps URL. Rejects every other host, every
 * other scheme (including `javascript:` and `data:`), and anything `new URL`
 * cannot parse.
 */
export function isAllowedMapsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  return MAPS_HOST_ALLOWLIST.includes(host) || GOOGLE_REGIONAL_HOST.test(host);
}
