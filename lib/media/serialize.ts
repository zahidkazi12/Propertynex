/**
 * `PropertyMedia` row → the shapes that cross a boundary.
 *
 * Same rule as `lib/properties/serialize.ts`, and the same reason: written out
 * field by field, never a spread with overrides. Here it is doing more than
 * keeping the shape tidy — `storageDriver` and `storageKey` sit right next to the
 * fields that *are* published, so a spread would put the storage layout in a JSON
 * response the moment someone widened the row. There is no line to delete for
 * that to happen; the fields simply never appear.
 *
 * `url` is derived from the row's id through `mediaUrl()`, the one place a media
 * address is constructed in the whole app. It takes an id and nothing else, so
 * there is no call site that could pass it a key.
 */
import type { PropertyMedia } from "@prisma/client";
import { mediaUrl } from "@/lib/media/constants";
import { primaryOf, sortMedia } from "@/lib/media/order";
import type { PublicMedia, SafeMedia } from "@/types";

/** Owner-facing. Includes the technical detail the photo manager shows (format,
 *  size, dimensions) and the two fields it edits (`alt`, `isPrimary`). */
export function toSafeMedia(media: PropertyMedia): SafeMedia {
  return {
    id: media.id,
    propertyId: media.propertyId,
    kind: media.kind,

    url: mediaUrl(media.id),

    mimeType: media.mimeType,
    byteSize: media.byteSize,
    width: media.width,
    height: media.height,

    alt: media.alt,

    sortOrder: media.sortOrder,
    isPrimary: media.isPrimary,

    createdAt: media.createdAt.toISOString(),
  };
}

/** Visitor-facing. Enough to render the picture and describe it; nothing else. */
export function toPublicMedia(media: PropertyMedia): PublicMedia {
  return {
    id: media.id,
    url: mediaUrl(media.id),
    width: media.width,
    height: media.height,
    alt: media.alt,
  };
}

/** The owner's gallery, in position order. */
export function toSafeGallery(rows: readonly PropertyMedia[]): SafeMedia[] {
  return sortMedia(rows).map(toSafeMedia);
}

/**
 * The public gallery: images only, cover first, then the seller's order.
 *
 * Two things happen here rather than in the renderers.
 *
 * The kind filter, because `PublicMedia` has no `kind` field — once a floor plan
 * or a video row can exist, an unfiltered projection would put it in the photo
 * carousel with nothing to distinguish it. Filtering at the projection means the
 * array's type and its contents cannot disagree.
 *
 * The cover promotion, because `PublicMedia` carries no `isPrimary` flag: the
 * *order* is the statement about which image leads. `primaryOf` tolerates a row
 * set with no primary or several (see `lib/media/order.ts`), so a listing whose
 * flags were left inconsistent by a lost race still renders, just with a cover the
 * seller may not have chosen.
 */
export function toPublicGallery(rows: readonly PropertyMedia[]): PublicMedia[] {
  const images = sortMedia(rows.filter((row) => row.kind === "IMAGE"));
  const cover = primaryOf(images);
  if (!cover) return [];

  return [cover, ...images.filter((row) => row.id !== cover.id)].map(toPublicMedia);
}
