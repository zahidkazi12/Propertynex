import type { Property, PropertyInquiry, PropertyStatus } from "@prisma/client";
import { STATUS_LABELS } from "@/lib/properties/constants";
import type { PropertyStatusCounts, SafeInquiry, SafeProperty } from "@/types";

/**
 * Prisma row → wire/props shape.
 *
 * Written out field by field rather than spread-and-override. A spread would
 * silently start shipping any column added to `Property` later — including one
 * added for internal bookkeeping — to the browser. Listing the fields means
 * exposing a new one is a decision someone makes in this file.
 */
export function toSafeProperty(property: Property): SafeProperty {
  return {
    id: property.id,
    ownerId: property.ownerId,

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

    addressLine1: property.addressLine1,
    addressLine2: property.addressLine2,
    locality: property.locality,
    city: property.city,
    state: property.state,
    pincode: property.pincode,
    country: property.country,

    mapsUrl: property.mapsUrl,
    latitude: property.latitude,
    longitude: property.longitude,

    contactPreference: property.contactPreference,

    status: property.status,
    publishedAt: property.publishedAt?.toISOString() ?? null,
    verificationRequestedAt: property.verificationRequestedAt?.toISOString() ?? null,
    verifiedAt: property.verifiedAt?.toISOString() ?? null,

    createdAt: property.createdAt.toISOString(),
    updatedAt: property.updatedAt.toISOString(),
  };
}

/**
 * Inquiry row → owner-facing shape.
 *
 * `ownerId` and `fromUserId` are deliberately dropped: the owner already knows
 * it is theirs, and `fromUserId` would link an enquirer's platform account to
 * the contact details they chose to share on this one inquiry.
 */
export function toSafeInquiry(inquiry: PropertyInquiry): SafeInquiry {
  return {
    id: inquiry.id,
    propertyId: inquiry.propertyId,
    name: inquiry.name,
    email: inquiry.email,
    phone: inquiry.phone,
    message: inquiry.message,
    status: inquiry.status,
    createdAt: inquiry.createdAt.toISOString(),
  };
}

/**
 * Turns Prisma's `groupBy` result into a complete count map.
 *
 * `groupBy` only returns statuses that have at least one row, so the filter bar
 * would render "Draft" and skip "Unpublished" entirely rather than showing it as
 * 0. Seeding every key from `STATUS_LABELS` (which is exhaustive over the enum)
 * guarantees a number for every tab.
 */
export function toStatusCounts(
  groups: ReadonlyArray<{ status: PropertyStatus; _count: { _all: number } }>
): PropertyStatusCounts {
  const counts = Object.fromEntries(
    Object.keys(STATUS_LABELS).map((status) => [status, 0])
  ) as PropertyStatusCounts;

  for (const group of groups) {
    counts[group.status] = group._count._all;
  }
  return counts;
}
