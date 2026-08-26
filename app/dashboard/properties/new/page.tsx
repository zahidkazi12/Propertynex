import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { PropertyForm } from "@/components/dashboard/PropertyForm";

/**
 * `/dashboard/properties/new` — add a listing.
 *
 * A thin shell: the auth redirect, the heading, and the form. There is nothing to
 * read from the database for a listing that does not exist yet, and nothing to
 * authorize beyond "is someone signed in" — ownership is established by the POST
 * handler, which writes `ownerId` from the session and accepts it from nowhere
 * else.
 */

export const metadata = {
  title: "Add a listing · PROPERTYNEX",
};

export default async function NewPropertyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/dashboard/properties/new");

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
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan">New listing</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Add a property
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Everything is on one page, and it all saves in one go — including a draft. Photos come
          next, once the listing itself exists to attach them to.
        </p>
      </div>

      <div className="mt-7">
        <PropertyForm />
      </div>
    </div>
  );
}
