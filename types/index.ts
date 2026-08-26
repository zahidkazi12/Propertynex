import type {
  AreaUnit,
  ContactPreference,
  Furnishing,
  InquiryStatus,
  ListingType,
  MediaKind,
  ParkingType,
  PropertyStatus,
  PropertyType,
} from "@prisma/client";

import type { SellerKind } from "@/lib/properties/constants";

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  image: string | null;
  createdAt: string;
};

export interface ApiErrorResponse {
  error: string;
  fieldErrors?: Record<string, string>;
}

/**
 * A `Property` row as it crosses into a Client Component or an API response.
 *
 * Dates become ISO strings, matching how `SafeUser` already handles
 * `createdAt`. The point is not that `Date` cannot cross the boundary — the RSC
 * payload does carry it — but that one shape is used everywhere: the object the
 * edit form receives as props is the same object the JSON API returns, so there
 * is no second serialisation path to keep in step.
 *
 * `ownerId` is included because the owner's own dashboard is the only place
 * these are rendered. The public marketplace needs a narrower projection (no
 * owner id, no draft rows, contact details filtered by `contactPreference`) —
 * that is `PublicListing` below, a separate type rather than this one widened.
 */
export type SafeProperty = {
  id: string;
  ownerId: string;

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

  contactPreference: ContactPreference;

  status: PropertyStatus;
  publishedAt: string | null;
  verificationRequestedAt: string | null;
  verifiedAt: string | null;

  createdAt: string;
  updatedAt: string;
};

/**
 * A live listing as shown to an anonymous visitor on `/explore`, `/buy` and
 * `/rent`.
 *
 * The narrow counterpart to `SafeProperty`, and narrow by subtraction: it is
 * what remains after removing everything a stranger has no reason to receive.
 * Absent here, and present there:
 *
 *   - `ownerId` — a browse card must not be joinable back to an account. The
 *     seller is described by `seller` below, which carries a display name and a
 *     category and no identifier, so a card cannot be used to enumerate users.
 *   - `addressLine1/2`, `pincode`, `mapsUrl`, `latitude`, `longitude` — a public
 *     listing advertises its locality and city, not its exact door. This holds on
 *     the detail page too: `PublicListingDetail` widens the *seller*, not the
 *     address.
 *   - every contact field, and `contactPreference` itself — with no contact
 *     details in the type, `IN_APP` ("do not surface my phone or email") holds
 *     by construction rather than by a rule someone has to remember. The detail
 *     page needs them, so it uses a different type; see `PublicSellerContact`.
 *   - `status` — collapsed to `verified`, because which of the two live statuses
 *     a row holds is owner/admin information, while the badge is not.
 *
 * Only rows in `LIVE_STATUSES` are ever mapped into this shape; drafts and
 * pending rows have no representation here at all. Built field by field in
 * `lib/properties/public.ts`, so a new column on `Property` cannot leak into a
 * public response by being spread in.
 */
export type PublicListing = {
  id: string;

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

  locality: string | null;
  city: string;
  state: string;

  /** Carries the PROPERTYNEX verified badge. */
  verified: boolean;

  /** Who is offering it. Never an account identifier — see `PublicSeller`. */
  seller: PublicSeller;

  /**
   * The listing's photos, in the order the seller arranged them, cover first.
   *
   * Empty for a listing with no photos — which is a real state, not an error: the
   * marketplace predates this feature, so existing rows have none. Every renderer
   * therefore has to handle an empty array rather than assuming an image exists.
   */
  images: PublicMedia[];

  /** When the listing first went live, ISO 8601. */
  listedAt: string;
};

/**
 * The seller as a browse card describes them.
 *
 * Two fields, and the absences are the design. There is no `id`, so a card
 * carries no handle back to a user document and a scraper cannot walk the
 * marketplace to build an account list. There is no email or phone, so the
 * cheap, high-volume surface — a page of twelve cards — cannot be harvested for
 * contact details whatever the seller's `contactPreference` says.
 *
 * `kind` is `null` when the account's role belongs to no buyer-facing category
 * (see `sellerKindForRole`), and the renderer then shows no chip. It does not
 * fall back to "Owner": mislabelling who you are dealing with is worse than not
 * saying.
 */
export type PublicSeller = {
  /** Display name from the account. */
  name: string;
  kind: SellerKind | null;
};

/**
 * The seller as the *detail* page describes them — the one place contact
 * details can appear.
 *
 * `phone` and `email` are `null` unless the listing's own `contactPreference`
 * asks for that channel to be shown, and the projection that builds this
 * (`toPublicSellerContact`) is the only code in the app that can put either in
 * front of a visitor. `IN_APP` yields null for both; the in-app inquiry form is
 * offered regardless, so choosing it hides a seller's number without hiding the
 * seller.
 */
export type PublicSellerContact = PublicSeller & {
  /** When the account was created, ISO 8601. A trust signal, not an identifier. */
  memberSince: string;
  phone: string | null;
  email: string | null;
};

/**
 * A live listing on its own page at `/property/[id]`.
 *
 * Identical to `PublicListing` except that the seller is widened to
 * `PublicSellerContact`. The address is deliberately *not* widened: a detail
 * page shows the same locality/city/state a card does, for the reason given
 * above. Publishing an exact door is a separate product decision with its own
 * consent question, not a side effect of building a detail page.
 */
export type PublicListingDetail = Omit<PublicListing, "seller"> & {
  seller: PublicSellerContact;
};

/**
 * One piece of media as its owner sees it, in the dashboard photo manager and in
 * the media API's responses.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 *
 * `storageDriver` and `storageKey`. They are the only fields on `PropertyMedia`
 * that describe where bytes physically live, and neither has any use in a
 * browser — publishing them would hand out the storage layout that
 * `prisma/schema.prisma` explains at length this design keeps private. `url` is
 * built by `mediaUrl()` from the row's own id instead, so the only address a
 * client ever learns is one that goes back through an access check.
 *
 * The original upload filename is absent because it is never stored at all — see
 * `lib/media/keys.ts`.
 */
export type SafeMedia = {
  id: string;
  propertyId: string;
  kind: MediaKind;

  /** Always `/api/media/<id>`. Never a storage path. */
  url: string;

  /** As determined from the file's own bytes, not as the upload claimed. */
  mimeType: string;
  byteSize: number;

  /** Non-null for every image this app stored; nullable because a future
   *  VIDEO/TOUR_360 row legitimately has no intrinsic pixel size. */
  width: number | null;
  height: number | null;

  alt: string | null;

  sortOrder: number;
  isPrimary: boolean;

  createdAt: string;
};

/**
 * One image as an anonymous visitor receives it.
 *
 * The same narrow-by-subtraction relationship to `SafeMedia` that
 * `PublicListing` has to `SafeProperty`. A browse card needs to render a picture
 * and describe it; it does not need the file's size in bytes, its MIME type, its
 * position number, or which listing row it hangs off. `isPrimary` is gone too,
 * because the array itself is ordered with the cover first — a flag the client
 * would have to search for is a flag that can disagree with the order.
 */
export type PublicMedia = {
  id: string;
  /** Always `/api/media/<id>`. */
  url: string;
  width: number | null;
  height: number | null;
  alt: string | null;
};

/** An inquiry as shown to the listing's owner. */
export type SafeInquiry = {
  id: string;
  propertyId: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  status: InquiryStatus;
  createdAt: string;
};

/** Per-status row counts for the My Properties filter bar. */
export type PropertyStatusCounts = Record<PropertyStatus, number>;
