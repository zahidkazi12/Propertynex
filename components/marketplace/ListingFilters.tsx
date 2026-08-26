"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, SlidersHorizontal, X } from "lucide-react";
import { SelectField, type SelectGroup } from "@/components/ui/SelectField";
import {
  PROPERTY_TYPE_GROUPS,
  PROPERTY_TYPE_LABELS,
} from "@/lib/properties/constants";
import {
  BEDROOM_STEPS,
  BROWSE_SORTS,
  BROWSE_SORT_LABELS,
  hasActiveFilters,
  type BrowseQuery,
} from "@/lib/properties/public";

/**
 * The filter bar for `/buy` and `/rent`.
 *
 * ── Why it is a real `<form method="get">` ──────────────────────────────────
 *
 * The URL is the state. Filters live in the query string, the page reads them on
 * the server, and this form's only job is to put them there — which means the
 * native submit already does the right thing with JavaScript disabled or still
 * loading. `onSubmit` intercepts it purely to upgrade a document load into a
 * client-side transition; the resulting URL is identical either way.
 *
 * Consequences worth noting, since they are easy to lose in a refactor:
 *
 *   - The inputs are uncontrolled, with `defaultValue` from the parsed query.
 *     The page is server-rendered per URL, so the URL is the only writer; React
 *     state mirroring it would be a second source of truth that can disagree.
 *   - `FormData` → `URLSearchParams` drops blank fields, so "Any type" produces
 *     `/buy` and not `/buy?type=&min=&max=`.
 *   - Changing a filter always returns to page 1. Staying on page 4 of a result
 *     set that just shrank to one page is how a filter change looks like an
 *     empty catalogue.
 *
 * Field names here are the contract with `parseBrowseQuery`: q, type, min, max,
 * beds, sort.
 */

const TYPE_GROUPS: readonly SelectGroup[] = PROPERTY_TYPE_GROUPS.map((group) => ({
  label: group.label,
  options: group.types.map((type) => ({
    value: type,
    label: PROPERTY_TYPE_LABELS[type],
  })),
}));

const ANY_TYPE = [{ value: "", label: "Any property type" }] as const;

const BED_OPTIONS = [
  { value: "", label: "Any" },
  ...BEDROOM_STEPS.map((count) => ({ value: String(count), label: `${count}+ BHK` })),
];

const SORT_OPTIONS = BROWSE_SORTS.map((sort) => ({
  value: sort,
  label: BROWSE_SORT_LABELS[sort],
}));

export function ListingFilters({
  basePath,
  query,
}: {
  /** `/buy` or `/rent` — the form's own action, so it round-trips to itself. */
  basePath: string;
  query: BrowseQuery;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isFiltered = hasActiveFilters(query);

  const submit = (form: HTMLFormElement) => {
    const params = new URLSearchParams();

    for (const [name, value] of new FormData(form).entries()) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed) params.set(name, trimmed);
    }

    // Any change to the filters resets pagination — see the header.
    params.delete("page");

    const search = params.toString();
    startTransition(() => router.push(search ? `${basePath}?${search}` : basePath));
  };

  return (
    <form
      method="get"
      action={basePath}
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
      className="glass-card edge-glow relative overflow-hidden p-5 sm:p-6"
      aria-label="Filter listings"
    >
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <label htmlFor="q" className="field-label">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder="City, locality or keyword"
            maxLength={80}
            className="input-field"
          />
        </div>

        <div className="lg:col-span-3">
          <SelectField
            label="Property type"
            name="type"
            defaultValue={query.propertyType ?? ""}
            options={ANY_TYPE}
            groups={TYPE_GROUPS}
          />
        </div>

        <div className="lg:col-span-3">
          <fieldset>
            <legend className="field-label">
              Price range
              <span className="ml-1 font-normal text-slate-500">(₹)</span>
            </legend>
            <div className="flex items-center gap-2">
              <input
                name="min"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                defaultValue={query.minPrice ?? ""}
                placeholder="Min"
                aria-label="Minimum price in rupees"
                className="input-field"
              />
              <span className="text-slate-500" aria-hidden="true">
                –
              </span>
              <input
                name="max"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                defaultValue={query.maxPrice ?? ""}
                placeholder="Max"
                aria-label="Maximum price in rupees"
                className="input-field"
              />
            </div>
          </fieldset>
        </div>

        <div className="lg:col-span-2">
          <SelectField
            label="Bedrooms"
            name="beds"
            defaultValue={query.minBedrooms === null ? "" : String(query.minBedrooms)}
            options={BED_OPTIONS}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-white/[0.08] pt-5 sm:flex-row sm:items-end sm:justify-between">
        {/* Sort submits on change rather than waiting for "Apply": it is a view
            preference, not part of the filter set the user is composing. */}
        <div className="sm:w-56">
          <SelectField
            label="Sort by"
            name="sort"
            defaultValue={query.sort}
            options={SORT_OPTIONS}
            onChange={(event) => {
              const form = event.currentTarget.form;
              if (form) submit(form);
            }}
          />
        </div>

        <div className="flex items-center gap-2.5">
          {isFiltered && (
            // A link, not a reset button: clearing filters is a navigation to the
            // unfiltered URL, which also makes it middle-clickable and shareable.
            <Link href={basePath} className="btn-ghost px-4">
              <X className="h-4 w-4" aria-hidden="true" />
              Clear
            </Link>
          )}
          <button type="submit" className="btn-primary px-6" disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            )}
            {isPending ? "Applying…" : "Apply filters"}
          </button>
        </div>
      </div>
    </form>
  );
}
