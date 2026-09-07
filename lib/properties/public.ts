import "server-only";

/**
 * The public read path — `/explore`, `/buy`, `/rent` and `/property/[id]`.
 *
 * ── What this module is, and what it deliberately is not ────────────────────
 *
 * It is a **read-only projection**. There is no create, update, status change or
 * ownership check here, and nothing in it is reachable from a request body: the
 * only inputs are query-string filters, each parsed against a closed set of
 * allowed values (./browse-query) before being turned into a `where`
 * (./browse-where). The owner-side write path (`app/api/properties/*`,
 * `lib/properties/access.ts`, `lib/properties/status.ts`) is untouched and
 * remains the only way a listing is created or moves status.
 *
 * ── Why it exists rather than reusing `/api/properties` ─────────────────────
 *
 * That endpoint is owner-scoped by design — every query it issues is pinned to
 * `ownerId` from the session, and its own header says widening the scope is not
 * an operation it offers. A public browse needs the opposite shape: no session,
 * every owner's listings, and only the ones that are live. So it is a separate
 * query, constrained on `status` first, which is exactly what the
 * `@@index([status, …])` family in `prisma/schema.prisma` was added for.
 *
 * ── Why `PublicListing` is a narrower type than `SafeProperty` ──────────────
 *
 * `types/index.ts` calls this out already: the public marketplace needs "no
 * owner id, no draft rows, contact details filtered by `contactPreference`" —
 * "a separate type, not this one widened". `toPublicListing` is that type's
 * serialiser, and it satisfies the requirement structurally rather than by
 * policy:
 *
 *   - `ownerId` is dropped, so a browse card cannot be joined back to an account.
 *     The seller is described by name and category only.
 *   - `addressLine1/2`, `pincode` and `mapsUrl` are dropped — on the detail page
 *     too. A live listing advertises its locality and city, not the exact door.
 *   - `latitude`/`longitude` are not projected as stored. A map pin is published
 *     as `location`, built by `./location.ts`, which applies the listing's
 *     `locationPrecision` first and rounds an `APPROXIMATE` pin to a coarser
 *     grid. Reduced precision, not a fabricated point — and labelled as
 *     approximate wherever it is drawn.
 *   - No contact field is projected. On the detail page, and only there,
 *     `toPublicSellerContact` may add a phone or an email — and it consults
 *     `contactPreference` to decide, so `IN_APP` ("do not surface my phone or
 *     email") is honoured in the one place it could be violated.
 *   - `status` is reduced to a single `verified` boolean. Which of the two live
 *     statuses a row holds is owner/admin information; whether it carries the
 *     PROPERTYNEX badge is the part a visitor needs.
 *
 * Adding a field to `Property` therefore does not silently publish it — the same
 * property `toSafeProperty` has, and the same reason: this is written out field
 * by field, never spread.
 */

import type { Property, PropertyMedia, User } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { toPublicGallery } from "@/lib/media/serialize";
import { isValidRecordId } from "@/lib/utils/record-id";
import type { PublicListing, PublicListingDetail, PublicSeller, PublicSellerContact } from "@/types";

import { BROWSE_PER_PAGE, type BrowseQuery } from "./browse-query";
import { browseOrderBy, buildBrowseWhere, type BrowseExtra } from "./browse-where";
import { favoriteIdsFor, savedPropertyIds } from "./favorites";
import { toPublicMapLocation } from "./location";
import { sellerKindForRole } from "./constants";
import { LIVE_STATUSES } from "./status";

// Re-exported so route handlers and components have one import for the browse
// vocabulary and do not have to know it is split across two files for bundling
// reasons.
export {
  BROWSE_FIELDS,
  BROWSE_PER_PAGE,
  BROWSE_SORTS,
  BROWSE_SORT_LABELS,
  DEFAULT_SORT,
  activeFilterChips,
  activeFilterCount,
  browseQueryString,
  filterHref,
  hasActiveFilters,
  parseBrowseQuery,
  type BrowseQuery,
  type BrowseSort,
  type FilterChip,
  type RawSearchParams,
} from "./browse-query";

// ─────────────────────────────────────────────────────────────
// Projection
// ─────────────────────────────────────────────────────────────

/** The columns of `User` a public projection is allowed to read. */
type SellerRow = Pick<User, "name" | "role">;
type SellerContactRow = SellerRow & Pick<User, "email" | "phone" | "createdAt">;

/**
 * The Prisma `select` for a seller.
 *
 * An explicit select rather than `include: { owner: true }`, so the password
 * hash, the phone digits and the legacy security-answer hash are never loaded
 * into the process at all on a public read — not loaded-then-dropped. The
 * narrowest thing that can leak is the narrowest thing that was fetched.
 */
const SELLER_SELECT = { name: true, role: true } as const;
const SELLER_CONTACT_SELECT = {
  name: true,
  role: true,
  email: true,
  phone: true,
  createdAt: true,
} as const;

function toPublicSeller(owner: SellerRow): PublicSeller {
  return { name: owner.name, kind: sellerKindForRole(owner.role) };
}

/**
 * The seller as the detail page shows them, with contact details gated on the
 * listing's `contactPreference`.
 *
 * This is the only function in the application that can put a seller's phone
 * number or email address in front of a visitor, which is why the gate is a
 * `switch` over the enum rather than a pair of booleans: adding a member to
 * `ContactPreference` without deciding what it discloses is a compile error, not
 * a default-open leak. `IN_APP` yields null for both — the in-app inquiry form
 * is offered regardless, so the seller is still reachable.
 */
function toPublicSellerContact(
  owner: SellerContactRow,
  preference: Property["contactPreference"]
): PublicSellerContact {
  let phone: string | null = null;
  let email: string | null = null;

  switch (preference) {
    case "PHONE":
      phone = owner.phone;
      break;
    case "EMAIL":
      email = owner.email;
      break;
    case "BOTH":
      phone = owner.phone;
      email = owner.email;
      break;
    case "IN_APP":
      break;
  }

  return {
    ...toPublicSeller(owner),
    memberSince: owner.createdAt.toISOString(),
    phone,
    email,
  };
}

/**
 * Prisma row → the shape a browse card renders.
 *
 * Field by field, never a spread — see the module header for what is dropped and
 * why.
 *
 * `media` and `owner` are passed in rather than read off the row so this stays a
 * pure function of its arguments: the caller decides which relations it loaded,
 * and one that loaded neither gets an empty gallery and an anonymous seller
 * instead of a type error. `media` defaults to `[]` because a listing with no
 * photos is a real state — the marketplace predates that feature, so existing
 * rows have none.
 */
export function toPublicListing(
  property: Property,
  media: readonly PropertyMedia[] = [],
  seller: PublicSeller = { name: "PROPERTYNEX seller", kind: null }
): PublicListing {
  return {
    id: property.id,

    title: property.title,
    description: property.description,
    propertyType: property.propertyType,
    listingType: property.listingType,

    price: property.price,
    negotiable: property.negotiable,

    areaValue: property.areaValue,
    areaUnit: property.areaUnit,

    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    floor: property.floor,
    totalFloors: property.totalFloors,

    furnishing: property.furnishing,
    parking: property.parking,
    propertyAgeYears: property.propertyAgeYears,

    amenities: property.amenities,

    // Locality + city + state only. No street line, no pincode, no coordinates.
    locality: property.locality,
    city: property.city,
    state: property.state,

    // The pin, through the precision gate — never `property.latitude/longitude`
    // directly. Null for a listing with no usable coordinates, which renders as
    // no marker rather than as a placeholder one.
    location: toPublicMapLocation(property),

    // The badge, not the status. `VERIFIED` is admin-granted — see status.ts.
    verified: property.status === "VERIFIED",

    seller,

    // Images only, cover first, then the seller's order. Both the kind filter and
    // the ordering live in `toPublicGallery` rather than in the query below — see
    // the note at the `include` for why.
    images: toPublicGallery(media),

    // `publishedAt` is stamped the first time a listing goes live and preserved
    // across republishes, so it is the listing's real age. It is non-null for
    // every live row, but the fallback keeps the type honest rather than
    // asserting a database invariant in the browser.
    listedAt: (property.publishedAt ?? property.createdAt).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
// Browse
// ─────────────────────────────────────────────────────────────

export type BrowseResult = {
  /**
   * False when the listings store could not be reached.
   *
   * Distinguished from "no matches" on purpose: an empty grid should say
   * "nothing matches your filters", and an unreachable database should say
   * "listings are temporarily unavailable". Rendering the first message for the
   * second case is how a browse page quietly lies about an outage.
   */
  readonly available: boolean;
  readonly listings: readonly PublicListing[];

  /**
   * Which of `listings` this viewer has already saved.
   *
   * Resolved here rather than in the page or the card because it is one indexed
   * query over the ids this query just returned — twelve cards is one round trip,
   * not twelve — and because a heart that renders from the same result object as
   * the card cannot disagree with it. Always empty for a signed-out visitor, so
   * callers never branch on null.
   */
  readonly savedIds: ReadonlySet<string>;

  readonly total: number;
  readonly page: number;
  readonly perPage: number;
  readonly pageCount: number;
};

export type BrowseOptions = {
  /**
   * The signed-in visitor, if any.
   *
   * Used for two things and nothing else: resolving `saved=1` against their own
   * favorites, and deciding which hearts render filled. It cannot widen what the
   * query returns — a signed-in user sees exactly the listings a stranger sees.
   */
  readonly viewerId?: string | null;
  /**
   * Predicates with no URL representation — currently only "has parking of some
   * kind", which the AI assistant can ask for and the filter vocabulary cannot
   * express. See `BrowseExtra`; it can only narrow, never widen.
   */
  readonly extra?: BrowseExtra;
};

/**
 * One page of live listings.
 *
 * Never throws. A browse page is the front door of the marketplace, and a
 * database hiccup there should degrade to a legible "temporarily unavailable"
 * panel rather than a 500 — the caller reads `available` and renders
 * accordingly.
 */
export async function browsePublicListings(
  query: BrowseQuery,
  options: BrowseOptions = {}
): Promise<BrowseResult> {
  const viewerId = options.viewerId ?? null;

  const empty = (available: boolean): BrowseResult => ({
    available,
    listings: [],
    savedIds: new Set<string>(),
    total: 0,
    page: query.page,
    perPage: BROWSE_PER_PAGE,
    pageCount: 1,
  });

  try {
    // Resolved from the session, never from the URL: `?saved=1` from a signed-out
    // visitor yields `null` here, which `buildBrowseWhere` turns into an empty
    // `id: { in: [] }` rather than an unfiltered marketplace.
    //
    // Named for its job — it is the *filter input*, the whole set of ids this
    // viewer has saved. Distinct from `savedOnPage` below, which is the subset of
    // this page's results that are saved and is what the hearts render from.
    const savedFilterIds =
      query.savedOnly && viewerId !== null ? await savedPropertyIds(viewerId) : null;

    // Nothing saved is an answer, not a query worth issuing.
    if (query.savedOnly && (savedFilterIds === null || savedFilterIds.length === 0)) {
      return empty(true);
    }

    const where = buildBrowseWhere(query, savedFilterIds, options.extra ?? {});

    const [rows, total] = await Promise.all([
      prisma.property.findMany({
        where,
        orderBy: browseOrderBy(query.sort),
        skip: (query.page - 1) * BROWSE_PER_PAGE,
        take: BROWSE_PER_PAGE,
        include: {
          // The whole media relation, unfiltered and unordered, because
          // `toPublicGallery` filters by kind and sorts by position anyway. Doing it
          // there instead of in a nested `where`/`orderBy` means one implementation
          // of "which images, in what order" — the one that has unit tests — rather
          // than two that have to agree. Twelve cards' worth of media rows is a few
          // kilobytes; the pictures themselves are fetched lazily, one request per
          // `/api/media/<id>`.
          media: true,
          // Two columns of the owner, by explicit select. See SELLER_SELECT.
          owner: { select: SELLER_SELECT },
        },
      }),
      prisma.property.count({ where }),
    ]);

    // After the rows, because it is scoped to the ids this page actually holds.
    // `favoriteIdsFor` swallows its own failures and returns an empty set — the
    // cards are the content and the hearts are decoration on top of them, so a
    // favorites hiccup must not turn a working browse page into an outage.
    const savedOnPage = await favoriteIdsFor(
      viewerId,
      rows.map((row) => row.id)
    );

    return {
      available: true,
      listings: rows.map((row) => toPublicListing(row, row.media, toPublicSeller(row.owner))),
      savedIds: savedOnPage,
      total,
      page: query.page,
      perPage: BROWSE_PER_PAGE,
      pageCount: Math.max(1, Math.ceil(total / BROWSE_PER_PAGE)),
    };
  } catch (error) {
    // Logged server-side only. The visitor is told the section is unavailable,
    // never why — the same posture the API routes take.
    console.error("[browse] listing query failed:", error);
    return empty(false);
  }
}

// ─────────────────────────────────────────────────────────────
// One listing
// ─────────────────────────────────────────────────────────────

/**
 * A single live listing by id, or `null`.
 *
 * ── Why `null` and not `notFound()` ────────────────────────────────────────
 *
 * `notFound()` works by throwing a control-flow signal that Next catches, so it
 * has to be called in the render path and must not be wrapped in a `try/catch` —
 * this function has one, for the database. Returning `null` and letting the page
 * component decide keeps those two concerns from colliding.
 *
 * ── Why a missing listing and a private one are the same answer ────────────
 *
 * `status: { in: LIVE_STATUSES }` is part of the lookup, not a check performed
 * afterwards, so a DRAFT id and a nonexistent id are indistinguishable from
 * outside: both are `null`, both become the same 404. The alternative — finding
 * the row and then refusing it — leaks the existence of every unpublished
 * listing to anyone willing to try ids, which is the same reasoning
 * `lib/properties/ownership.ts` gives for answering 404 rather than 403 on the
 * owner side.
 *
 * A malformed id is rejected before Prisma sees it — see `lib/utils/record-id.ts`
 * for why that is a pre-filter rather than a crash guard now that the store is
 * PostgreSQL.
 */
export async function findPublicListing(rawId: string): Promise<PublicListingDetail | null> {
  if (!isValidRecordId(rawId)) return null;

  try {
    const property = await prisma.property.findFirst({
      where: { id: rawId, status: { in: [...LIVE_STATUSES] } },
      include: {
        media: true,
        owner: { select: SELLER_CONTACT_SELECT },
      },
    });
    if (!property) return null;

    return {
      ...toPublicListing(property, property.media),
      seller: toPublicSellerContact(property.owner, property.contactPreference),
    };
  } catch (error) {
    console.error("[browse] listing lookup failed:", error);
    return null;
  }
}

/**
 * Up to `limit` other live listings in the same city and intent.
 *
 * Best-effort: a failure returns an empty array rather than taking the detail
 * page down with it, because "similar properties" is a convenience and the
 * listing is the content.
 */
export async function findSimilarListings(
  listing: PublicListing,
  limit = 3
): Promise<PublicListing[]> {
  try {
    const rows = await prisma.property.findMany({
      where: {
        status: { in: [...LIVE_STATUSES] },
        listingType: listing.listingType,
        city: listing.city,
        id: { not: listing.id },
      },
      orderBy: browseOrderBy("relevance"),
      take: limit,
      include: { media: true, owner: { select: SELLER_SELECT } },
    });
    return rows.map((row) => toPublicListing(row, row.media, toPublicSeller(row.owner)));
  } catch (error) {
    console.error("[browse] similar lookup failed:", error);
    return [];
  }
}
