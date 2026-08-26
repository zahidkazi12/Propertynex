import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { ImageUploader } from "@/components/media/ImageUploader";
import { MAX_IMAGES_PER_PROPERTY } from "@/lib/media/constants";
import { listPropertyImages } from "@/lib/media/read";
import { toSafeGallery } from "@/lib/media/serialize";
import { findAccessibleProperty } from "@/lib/properties/access";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/properties/constants";
import { formatShortLocation } from "@/lib/properties/format";
import { isLive } from "@/lib/properties/status";
import { cn } from "@/lib/utils/cn";

/**
 * `/dashboard/properties/[id]/photos` — the photo manager for one listing.
 *
 * ── Authorization ───────────────────────────────────────────────────────────
 *
 * `findAccessibleProperty` is the page-level twin of the guard every media route
 * uses: same rule, same "not yours is invisible" outcome, expressed as
 * `notFound()` instead of a 404 JSON body. A malformed id, a deleted listing and
 * someone else's listing all render the same not-found page.
 *
 * The page then hands the uploader nothing but the listing id and its current
 * gallery. Every mutation goes back through `/api/properties/[id]/media`, which
 * re-runs the guard server-side — the client is never trusted with the fact that
 * it once passed a check.
 */

type PageProps = { params: Promise<{ id: string }> };

export const metadata = {
  title: "Listing photos · PROPERTYNEX",
};

export default async function ListingPhotosPage({ params }: PageProps) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=/dashboard/properties/${id}/photos`);

  const property = await findAccessibleProperty(id, user);
  if (!property) notFound();

  const media = toSafeGallery(await listPropertyImages(property.id));
  const live = isLive(property.status);

  return (
    <div className="mx-auto max-w-5xl animate-fade-in" style={{ animationFillMode: "both" }}>
      <Link
        href="/dashboard/properties"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        All properties
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan">Photos</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {property.title}
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">{formatShortLocation(property)}</p>
        </div>

        <span
          className={cn(
            "mt-1 shrink-0 rounded-full border px-3 py-1 text-xs font-semibold",
            STATUS_TONES[property.status]
          )}
        >
          {STATUS_LABELS[property.status]}
        </span>
      </div>

      {/* Who can see these files right now. Worth stating plainly: a seller
          uploading pictures of their home before publishing deserves to know
          whether they have just put them on a public URL. They have not. */}
      <p className="mt-5 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-400">
        {live ? (
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
        ) : (
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        )}
        <span>
          {live ? (
            <>
              This listing is live, so these photos are visible to anyone browsing the
              marketplace. The first one is the cover buyers see on the listing card.
            </>
          ) : (
            <>
              This listing is not live, so these photos are visible only to you. They go public
              when the listing is published, and go offline again if it is unpublished.
            </>
          )}
        </span>
      </p>

      <div className="glass-card edge-glow mt-6 p-5 sm:p-6">
        <h2 className="text-base font-semibold text-white">
          Gallery{" "}
          <span className="text-sm font-normal text-slate-500">
            (up to {MAX_IMAGES_PER_PROPERTY} photos)
          </span>
        </h2>
        <p className="mt-1 mb-5 text-sm leading-relaxed text-slate-400">
          Buyers see these in the order you arrange them. Lead with the exterior or the best
          room — the cover image does most of the work on a busy results page.
        </p>

        <ImageUploader propertyId={property.id} initialMedia={media} />
      </div>
    </div>
  );
}
