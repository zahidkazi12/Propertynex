import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { PropertyForm } from "@/components/dashboard/PropertyForm";
import { PropertyStatusPanel } from "@/components/dashboard/PropertyStatusPanel";
import { findAccessibleProperty } from "@/lib/properties/access";
import { toSafeProperty } from "@/lib/properties/serialize";
import { formatShortLocation } from "@/lib/properties/format";

/**
 * `/dashboard/properties/[id]/edit` — edit one listing, and move it through its
 * lifecycle.
 *
 * ── Authorization ───────────────────────────────────────────────────────────
 *
 * `findAccessibleProperty` is the same page-level guard the photos screen uses: a
 * malformed id, a deleted listing and someone else's listing all render the same
 * not-found page, so this URL cannot be used to probe for which listing ids
 * exist. Passing the check here grants nothing — every mutation the form and the
 * status panel issue goes back through a route that re-runs the guard, and the
 * update's `where` clause is `{ id, ownerId }` regardless.
 *
 * ── Why the row is serialised before it crosses over ────────────────────────
 *
 * `toSafeProperty` turns the Prisma row into exactly the object
 * `GET /api/properties/[id]` returns. The form therefore has one input shape
 * whether it was rendered on the server with props or (later) hydrated from the
 * API, and there is no second serialisation path to keep in step.
 *
 * ── Why the status panel is here and not on the index ───────────────────────
 *
 * Editing never changes status — `lib/properties/status.ts` is explicit that a
 * published listing stays published when its price changes. So "save" and
 * "publish" are genuinely different actions, and putting them on one screen but
 * in separate cards is what makes that visible: one card is the listing's
 * content, the other is who can see it.
 */

type PageProps = { params: Promise<{ id: string }> };

export const metadata = {
  title: "Edit listing · PROPERTYNEX",
};

export default async function EditPropertyPage({ params }: PageProps) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=/dashboard/properties/${id}/edit`);

  const property = await findAccessibleProperty(id, user);
  if (!property) notFound();

  const safe = toSafeProperty(property);
  const location = formatShortLocation(property);

  return (
    <div className="mx-auto max-w-4xl animate-fade-in" style={{ animationFillMode: "both" }}>
      <Link
        href="/dashboard/properties"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        All properties
      </Link>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan">Edit listing</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          {property.title}
        </h1>
        {location && <p className="mt-1.5 text-sm text-slate-400">{location}</p>}
      </div>

      <div className="mt-7">
        <PropertyStatusPanel property={safe} role={user.role} />
      </div>

      <div className="mt-5">
        <PropertyForm property={safe} />
      </div>
    </div>
  );
}
