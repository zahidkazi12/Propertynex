"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Loader2, MapPin } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { Alert } from "@/components/ui/Alert";
import { SelectField, type SelectGroup, type SelectOption } from "@/components/ui/SelectField";
import { TextAreaField } from "@/components/ui/TextAreaField";
import {
  AMENITY_GROUPS,
  AREA_UNIT_LABELS,
  AREA_UNIT_ORDER,
  CONTACT_PREFERENCE_LABELS,
  CONTACT_PREFERENCE_ORDER,
  FURNISHING_LABELS,
  FURNISHING_ORDER,
  isLand,
  isRoomBearing,
  LISTING_TYPE_LABELS,
  LISTING_TYPE_ORDER,
  LOCATION_PRECISION_DESCRIPTIONS,
  LOCATION_PRECISION_LABELS,
  LOCATION_PRECISION_ORDER,
  PARKING_LABELS,
  PARKING_ORDER,
  PROPERTY_TYPE_GROUPS,
  PROPERTY_TYPE_LABELS,
} from "@/lib/properties/constants";
import type { ApiErrorResponse, SafeProperty } from "@/types";
import type { LocationPrecision, PropertyType } from "@prisma/client";

/**
 * The add / edit listing form, shared by `/dashboard/properties/new` and
 * `/dashboard/properties/[id]/edit`.
 *
 * ── One page, not a wizard ──────────────────────────────────────────────────
 *
 * `lib/validation/property.ts` holds create and update to a single completeness
 * bar: a DRAFT is fully validated, so "publish" needs no second validation pass
 * and no listing can go live with a missing price because it was written while
 * the row was a draft. The cost of that trade is that a listing cannot be saved
 * half-finished — which is precisely why this is one scrolling page with one
 * submit rather than a multi-step wizard whose later steps discard the earlier
 * ones on a validation failure.
 *
 * ── One state shape, all strings ────────────────────────────────────────────
 *
 * Every text/select value is held as a string and posted as one. That is not
 * laziness about types: the write schema is authored for exactly this, running
 * `blankToUndefined` ahead of every `z.coerce`, so `""` means "not provided"
 * rather than the `0` a bare `z.coerce.number()` would produce. Parsing numbers
 * here would mean re-implementing that rule in a second place, on the side of
 * the wire that cannot be trusted anyway.
 *
 * `negotiable` (and `publish`) are the exceptions, sent as real booleans:
 * `z.coerce.boolean()` treats *any* non-empty string as `true`, so posting
 * `"false"` would set them.
 *
 * ── Which fields are sent ───────────────────────────────────────────────────
 *
 * The payload is rebuilt from the *applicable* field set, so a listing retyped
 * from apartment to plot does not carry its old floor number along. The server
 * normalises those away regardless — this only stops the owner being shown an
 * error ("floor cannot be higher than total floors") about two inputs that are
 * no longer on screen.
 *
 * `country` is never sent. The PIN-code rule is India-specific, so the server
 * fixes the country to match; the field is rendered read-only to say so.
 */

type PropertyFormProps = {
  /** Present in edit mode. Absent means this is a new listing. */
  property?: SafeProperty;
};

type FormState = {
  title: string;
  description: string;
  listingType: string;
  propertyType: string;
  price: string;
  negotiable: boolean;
  areaValue: string;
  areaUnit: string;
  bedrooms: string;
  bathrooms: string;
  floor: string;
  totalFloors: string;
  furnishing: string;
  parking: string;
  propertyAgeYears: string;
  amenities: string[];
  addressLine1: string;
  addressLine2: string;
  locality: string;
  city: string;
  state: string;
  pincode: string;
  mapsUrl: string;
  latitude: string;
  longitude: string;
  locationPrecision: string;
  contactPreference: string;
};

/**
 * Visual order of the fields, used to decide which server error to scroll to.
 *
 * A separate list rather than `Object.keys(fieldErrors)`, because that order is
 * the server's (schema declaration order, then cross-field refinements last),
 * and jumping an owner to the *fourth* problem on the page is disorienting even
 * when all four are highlighted.
 */
const FIELD_ORDER: readonly string[] = [
  "listingType",
  "propertyType",
  "title",
  "description",
  "price",
  "areaValue",
  "areaUnit",
  "bedrooms",
  "bathrooms",
  "floor",
  "totalFloors",
  "furnishing",
  "parking",
  "propertyAgeYears",
  "amenities",
  "addressLine1",
  "addressLine2",
  "locality",
  "city",
  "state",
  "pincode",
  "mapsUrl",
  "latitude",
  "longitude",
  "locationPrecision",
  "contactPreference",
];

const LISTING_TYPE_OPTIONS: readonly SelectOption[] = LISTING_TYPE_ORDER.map((value) => ({
  value,
  label: LISTING_TYPE_LABELS[value],
}));

/** `PROPERTY_TYPE_GROUPS` calls its members `types`; `SelectField` wants
 *  `options`. Mapped once here rather than inline on every render. */
const PROPERTY_TYPE_SELECT_GROUPS: readonly SelectGroup[] = PROPERTY_TYPE_GROUPS.map((group) => ({
  label: group.label,
  options: group.types.map((value) => ({ value, label: PROPERTY_TYPE_LABELS[value] })),
}));

const AREA_UNIT_OPTIONS: readonly SelectOption[] = AREA_UNIT_ORDER.map((value) => ({
  value,
  label: AREA_UNIT_LABELS[value],
}));

const FURNISHING_OPTIONS: readonly SelectOption[] = FURNISHING_ORDER.map((value) => ({
  value,
  label: FURNISHING_LABELS[value],
}));

const PARKING_OPTIONS: readonly SelectOption[] = PARKING_ORDER.map((value) => ({
  value,
  label: PARKING_LABELS[value],
}));

const CONTACT_PREFERENCE_OPTIONS: readonly SelectOption[] = CONTACT_PREFERENCE_ORDER.map(
  (value) => ({ value, label: CONTACT_PREFERENCE_LABELS[value] })
);

/** `null` -> `""`, so "not provided" round-trips as the empty input the schema
 *  is written to understand. */
function fromNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

function initialState(property?: SafeProperty): FormState {
  if (!property) {
    return {
      title: "",
      description: "",
      listingType: "",
      propertyType: "",
      price: "",
      negotiable: false,
      areaValue: "",
      // Both of these are *required* enums server-side, so they start on the
      // overwhelmingly common answer rather than on an empty placeholder the
      // owner has to clear a validation error to discover.
      areaUnit: "SQFT",
      bedrooms: "",
      bathrooms: "",
      floor: "",
      totalFloors: "",
      furnishing: "",
      parking: "",
      propertyAgeYears: "",
      amenities: [],
      addressLine1: "",
      addressLine2: "",
      locality: "",
      city: "",
      state: "",
      pincode: "",
      mapsUrl: "",
      latitude: "",
      longitude: "",
      locationPrecision: "APPROXIMATE",
      contactPreference: "BOTH",
    };
  }

  return {
    title: property.title,
    description: property.description,
    listingType: property.listingType,
    propertyType: property.propertyType,
    price: String(property.price),
    negotiable: property.negotiable,
    areaValue: String(property.areaValue),
    areaUnit: property.areaUnit,
    bedrooms: fromNumber(property.bedrooms),
    bathrooms: fromNumber(property.bathrooms),
    floor: fromNumber(property.floor),
    totalFloors: fromNumber(property.totalFloors),
    furnishing: property.furnishing ?? "",
    parking: property.parking ?? "",
    propertyAgeYears: fromNumber(property.propertyAgeYears),
    amenities: property.amenities,
    addressLine1: property.addressLine1,
    addressLine2: property.addressLine2 ?? "",
    locality: property.locality ?? "",
    city: property.city,
    state: property.state,
    pincode: property.pincode,
    mapsUrl: property.mapsUrl ?? "",
    latitude: fromNumber(property.latitude),
    longitude: fromNumber(property.longitude),
    locationPrecision: property.locationPrecision,
    contactPreference: property.contactPreference,
  };
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan">{eyebrow}</p>
      <h2 className="mt-1.5 text-base font-semibold text-white">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-400">{description}</p>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

export function PropertyForm({ property }: PropertyFormProps) {
  const router = useRouter();
  const editing = property !== undefined;

  const [form, setForm] = useState<FormState>(() => initialState(property));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  /** Which button is in flight — also the "are we busy" flag. */
  const [pending, setPending] = useState<"draft" | "publish" | "save" | null>(null);

  const busy = pending !== null;

  // `""` is not a `PropertyType`, so before a type is chosen nothing is treated
  // as room-bearing and everything type-dependent stays hidden.
  const chosenType = form.propertyType ? (form.propertyType as PropertyType) : null;
  const showRooms = chosenType !== null && isRoomBearing(chosenType);
  const showBuilding = chosenType !== null && !isLand(chosenType);

  // Both boxes hold something. Deliberately not "is this a valid coordinate" —
  // the precision control should appear as soon as the owner is evidently
  // entering a pin, not only once they have typed a parseable one. The server
  // validates the numbers; this only decides whether the question is relevant.
  const hasCoordinateInput =
    form.latitude.trim().length > 0 && form.longitude.trim().length > 0;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    // Clearing this field's error as it is edited: leaving it red while the
    // owner retypes it says the new value is wrong, which nothing has checked.
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  function toggleAmenity(slug: string) {
    setForm((current) => ({
      ...current,
      amenities: current.amenities.includes(slug)
        ? current.amenities.filter((item) => item !== slug)
        : [...current.amenities, slug],
    }));
    setErrors((current) => {
      if (!("amenities" in current)) return current;
      const next = { ...current };
      delete next.amenities;
      return next;
    });
  }

  /**
   * Scroll to and focus the first field the server rejected.
   *
   * This works because `FormField`, `SelectField` and `TextAreaField` all
   * default their `id` to their `name`, so a `fieldErrors` key *is* a DOM id.
   * On a page this long, an error alert at the bottom and a red field three
   * screens up is otherwise a hunt.
   */
  function focusFirstError(fieldErrors: Record<string, string>) {
    const first = FIELD_ORDER.find((field) => fieldErrors[field]);
    if (!first) return;

    // One frame, so React has committed the error text before we measure where
    // to scroll to.
    requestAnimationFrame(() => {
      const element = document.getElementById(first);
      if (!element) return;
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.focus({ preventScroll: true });
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    // Which of the two submit buttons was used. Read off the event rather than
    // held in state, because a click handler that sets state cannot be relied on
    // to have flushed before submit runs.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = editing ? "save" : submitter?.value === "publish" ? "publish" : "draft";

    setFormError(null);
    setErrors({});
    setSuccess(false);
    setPending(intent);

    const payload = {
      title: form.title,
      description: form.description,
      listingType: form.listingType,
      propertyType: form.propertyType,
      price: form.price,
      negotiable: form.negotiable,
      areaValue: form.areaValue,
      areaUnit: form.areaUnit,
      bedrooms: showRooms ? form.bedrooms : "",
      bathrooms: showRooms ? form.bathrooms : "",
      floor: showBuilding ? form.floor : "",
      totalFloors: showBuilding ? form.totalFloors : "",
      furnishing: showBuilding ? form.furnishing : "",
      parking: showBuilding ? form.parking : "",
      propertyAgeYears: showBuilding ? form.propertyAgeYears : "",
      amenities: form.amenities,
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2,
      locality: form.locality,
      city: form.city,
      state: form.state,
      pincode: form.pincode,
      mapsUrl: form.mapsUrl,
      latitude: form.latitude,
      longitude: form.longitude,
      // Sent only alongside a coordinate pair. The server pins it back to the
      // private default when the pair is absent anyway; not sending it keeps the
      // payload honest about what the owner actually chose.
      locationPrecision: hasCoordinateInput ? form.locationPrecision : "",
      contactPreference: form.contactPreference,
      ...(editing ? {} : { publish: intent === "publish" }),
    };

    try {
      const response = await fetch(
        editing ? `/api/properties/${property.id}` : "/api/properties",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const data: ApiErrorResponse & { property?: SafeProperty } = await response.json();

      if (!response.ok) {
        setFormError(data.error ?? "Something went wrong. Please try again.");
        if (data.fieldErrors) {
          setErrors(data.fieldErrors);
          focusFirstError(data.fieldErrors);
        }
        setPending(null);
        return;
      }

      if (!editing && data.property) {
        // Straight on to photos: a listing with no pictures is the single
        // biggest thing missing from a brand-new one, and this is the moment the
        // owner is still holding them.
        router.refresh();
        router.push(`/dashboard/properties/${data.property.id}/photos`);
        // `pending` is deliberately left set — the buttons stay disabled through
        // the navigation instead of flashing back to enabled.
        return;
      }

      setSuccess(true);
      router.refresh();
      setPending(null);
    } catch {
      setFormError("Network error. Please check your connection and try again.");
      setPending(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <SectionCard
        eyebrow="Step 1"
        title="The basics"
        description="What you're listing, and how a buyer will recognise it in a list of results."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            label="Listing type"
            name="listingType"
            required
            placeholder="Select…"
            options={LISTING_TYPE_OPTIONS}
            value={form.listingType}
            onChange={(event) => set("listingType", event.target.value)}
            error={errors.listingType}
            disabled={busy}
          />
          <SelectField
            label="Property type"
            name="propertyType"
            required
            placeholder="Select…"
            groups={PROPERTY_TYPE_SELECT_GROUPS}
            value={form.propertyType}
            onChange={(event) => set("propertyType", event.target.value)}
            error={errors.propertyType}
            hint="This decides which details below apply."
            disabled={busy}
          />
        </div>

        <FormField
          label="Title"
          name="title"
          required
          maxLength={120}
          placeholder="3 BHK apartment in Indiranagar with balcony"
          value={form.title}
          onChange={(event) => set("title", event.target.value)}
          error={errors.title}
          hint="8–120 characters. Lead with the configuration and the locality."
          disabled={busy}
        />

        <TextAreaField
          label="Description"
          name="description"
          required
          rows={7}
          maxLength={5000}
          showCount
          placeholder="Describe the layout, the condition, what's nearby, and anything a buyer would otherwise have to ask about."
          value={form.description}
          onChange={(event) => set("description", event.target.value)}
          error={errors.description}
          hint="At least 30 characters."
          disabled={busy}
        />
      </SectionCard>

      <SectionCard
        eyebrow="Step 2"
        title="Price and size"
        description="Both are required, and both are what buyers filter on first."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label={form.listingType === "RENT" ? "Rent per month (₹)" : "Price (₹)"}
            name="price"
            required
            type="text"
            inputMode="decimal"
            placeholder="4500000"
            value={form.price}
            onChange={(event) => set("price", event.target.value)}
            error={errors.price}
            hint="Digits only — no commas or currency symbol."
            disabled={busy}
          />
          <div className="grid grid-cols-[1fr,auto] gap-3">
            <FormField
              label="Built-up area"
              name="areaValue"
              required
              type="text"
              inputMode="decimal"
              placeholder="1450"
              value={form.areaValue}
              onChange={(event) => set("areaValue", event.target.value)}
              error={errors.areaValue}
              disabled={busy}
            />
            <div className="w-28 xs:w-32">
              <SelectField
                label="Unit"
                name="areaUnit"
                required
                options={AREA_UNIT_OPTIONS}
                value={form.areaUnit}
                onChange={(event) => set("areaUnit", event.target.value)}
                error={errors.areaUnit}
                disabled={busy}
              />
            </div>
          </div>
        </div>

        <label
          htmlFor="negotiable"
          className="flex w-fit cursor-pointer items-center gap-2.5 text-sm text-slate-300"
        >
          <input
            id="negotiable"
            name="negotiable"
            type="checkbox"
            checked={form.negotiable}
            onChange={(event) => set("negotiable", event.target.checked)}
            disabled={busy}
            className="h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-white/5 accent-cyan"
          />
          Price is negotiable
        </label>
      </SectionCard>

      {/* Hidden in full for a plot: floor, furnishing, parking and age all
          describe a building, and the server nulls every one of them for land
          types anyway. Rendering inputs whose values are discarded on save is
          worse than rendering none. */}
      {showBuilding && (
        <SectionCard
          eyebrow="Step 3"
          title="Configuration"
          description={
            showRooms
              ? "Room counts are required for this property type. The rest is optional."
              : "All optional — fill in what applies to this property."
          }
        >
          {showRooms && (
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label="Bedrooms"
                name="bedrooms"
                required
                type="text"
                inputMode="numeric"
                placeholder="3"
                value={form.bedrooms}
                onChange={(event) => set("bedrooms", event.target.value)}
                error={errors.bedrooms}
                disabled={busy}
              />
              <FormField
                label="Bathrooms"
                name="bathrooms"
                required
                type="text"
                inputMode="numeric"
                placeholder="2"
                value={form.bathrooms}
                onChange={(event) => set("bathrooms", event.target.value)}
                error={errors.bathrooms}
                disabled={busy}
              />
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              label="Floor"
              name="floor"
              type="text"
              inputMode="numeric"
              placeholder="4"
              value={form.floor}
              onChange={(event) => set("floor", event.target.value)}
              error={errors.floor}
              hint="Ground floor is 0. Basements can be negative."
              disabled={busy}
            />
            <FormField
              label="Total floors in the building"
              name="totalFloors"
              type="text"
              inputMode="numeric"
              placeholder="12"
              value={form.totalFloors}
              onChange={(event) => set("totalFloors", event.target.value)}
              error={errors.totalFloors}
              disabled={busy}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              label="Furnishing"
              name="furnishing"
              placeholder="Not specified"
              options={FURNISHING_OPTIONS}
              value={form.furnishing}
              onChange={(event) => set("furnishing", event.target.value)}
              error={errors.furnishing}
              disabled={busy}
            />
            <SelectField
              label="Parking"
              name="parking"
              placeholder="Not specified"
              options={PARKING_OPTIONS}
              value={form.parking}
              onChange={(event) => set("parking", event.target.value)}
              error={errors.parking}
              disabled={busy}
            />
          </div>

          <div className="sm:max-w-xs">
            <FormField
              label="Age of the property (years)"
              name="propertyAgeYears"
              type="text"
              inputMode="numeric"
              placeholder="5"
              value={form.propertyAgeYears}
              onChange={(event) => set("propertyAgeYears", event.target.value)}
              error={errors.propertyAgeYears}
              hint="0 for a new build."
              disabled={busy}
            />
          </div>
        </SectionCard>
      )}

      <section className="glass-card p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan">
          {showBuilding ? "Step 4" : "Step 3"}
        </p>
        <h2 className="mt-1.5 text-base font-semibold text-white">Amenities</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">
          Optional, and pick only what the property genuinely has —{" "}
          {form.amenities.length === 0
            ? "none selected."
            : `${form.amenities.length} selected.`}
        </p>

        {/* Focusable so the "jump to the first error" pass can land on the group
            when the server rejects the selection itself. */}
        <fieldset
          id="amenities"
          tabIndex={-1}
          className="mt-5 space-y-6 focus:outline-none"
          aria-describedby={errors.amenities ? "amenities-error" : undefined}
          disabled={busy}
        >
          <legend className="sr-only">Amenities</legend>

          {AMENITY_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {group.label}
              </p>
              <div className="mt-3 grid gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {group.amenities.map((amenity) => {
                  const checked = form.amenities.includes(amenity.value);
                  return (
                    <label
                      key={amenity.value}
                      htmlFor={`amenity-${amenity.value}`}
                      className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300 transition-colors hover:text-white"
                    >
                      <input
                        id={`amenity-${amenity.value}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAmenity(amenity.value)}
                        className="h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-white/5 accent-cyan"
                      />
                      {amenity.label}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </fieldset>

        {errors.amenities && (
          <p id="amenities-error" className="field-error" role="alert">
            {errors.amenities}
          </p>
        )}
      </section>

      <SectionCard
        eyebrow={showBuilding ? "Step 5" : "Step 4"}
        title="Where it is"
        description="The full address is for your records and for genuine buyers. Public listings show only the locality and city."
      >
        <FormField
          label="Address line 1"
          name="addressLine1"
          required
          maxLength={160}
          autoComplete="address-line1"
          placeholder="Flat 402, Sunrise Residency"
          value={form.addressLine1}
          onChange={(event) => set("addressLine1", event.target.value)}
          error={errors.addressLine1}
          disabled={busy}
        />
        <FormField
          label="Address line 2"
          name="addressLine2"
          maxLength={160}
          autoComplete="address-line2"
          placeholder="12th Main Road"
          value={form.addressLine2}
          onChange={(event) => set("addressLine2", event.target.value)}
          error={errors.addressLine2}
          disabled={busy}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Locality"
            name="locality"
            maxLength={120}
            placeholder="Indiranagar"
            value={form.locality}
            onChange={(event) => set("locality", event.target.value)}
            error={errors.locality}
            hint="Shown on public listings."
            disabled={busy}
          />
          <FormField
            label="City"
            name="city"
            required
            maxLength={80}
            autoComplete="address-level2"
            placeholder="Bengaluru"
            value={form.city}
            onChange={(event) => set("city", event.target.value)}
            error={errors.city}
            disabled={busy}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <FormField
            label="State"
            name="state"
            required
            maxLength={80}
            autoComplete="address-level1"
            placeholder="Karnataka"
            value={form.state}
            onChange={(event) => set("state", event.target.value)}
            error={errors.state}
            disabled={busy}
          />
          <FormField
            label="PIN code"
            name="pincode"
            required
            type="text"
            inputMode="numeric"
            maxLength={6}
            autoComplete="postal-code"
            placeholder="560038"
            value={form.pincode}
            onChange={(event) => set("pincode", event.target.value)}
            error={errors.pincode}
            disabled={busy}
          />
          {/* Read-only rather than absent, so the stored value is visible and
              obviously not a choice. The server sets it regardless of what is
              posted — the PIN-code rule above it is India-specific. */}
          <FormField
            label="Country"
            name="country"
            value="India"
            readOnly
            disabled
            hint="India-only for now."
          />
        </div>

        <FormField
          label="Google Maps link"
          name="mapsUrl"
          type="url"
          maxLength={2048}
          placeholder="https://maps.app.goo.gl/…"
          value={form.mapsUrl}
          onChange={(event) => set("mapsUrl", event.target.value)}
          error={errors.mapsUrl}
          hint="Optional. Use Share in Google Maps and paste the link — other hosts are rejected."
          disabled={busy}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Latitude"
            name="latitude"
            type="text"
            inputMode="decimal"
            placeholder="12.9784"
            value={form.latitude}
            onChange={(event) => set("latitude", event.target.value)}
            error={errors.latitude}
            disabled={busy}
          />
          <FormField
            label="Longitude"
            name="longitude"
            type="text"
            inputMode="decimal"
            placeholder="77.6408"
            value={form.longitude}
            onChange={(event) => set("longitude", event.target.value)}
            error={errors.longitude}
            hint="Optional — but enter both or neither."
            disabled={busy}
          />
        </div>

        <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Coordinates place your listing on the Explore map and on its own page. Leaving them
          empty costs you nothing — your listing simply carries no pin.
        </p>

        {/* Only meaningful once a pin exists, so it is disclosed progressively:
            asking an owner to choose a precision for coordinates they have not
            entered is a decision about nothing. `normalise()` also pins the stored
            value back to APPROXIMATE when the pair is absent, so hiding the
            control cannot leave a stale EXACT behind. */}
        {hasCoordinateInput && (
          <div className="animate-fade-in" style={{ animationFillMode: "both" }}>
            <SelectField
              label="Map precision"
              name="locationPrecision"
              options={LOCATION_PRECISION_ORDER.map((value) => ({
                value,
                label: LOCATION_PRECISION_LABELS[value],
              }))}
              value={form.locationPrecision}
              onChange={(event) => set("locationPrecision", event.target.value)}
              error={errors.locationPrecision}
              hint={LOCATION_PRECISION_DESCRIPTIONS[form.locationPrecision as LocationPrecision]}
              disabled={busy}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard
        eyebrow={showBuilding ? "Step 6" : "Step 5"}
        title="How buyers reach you"
        description="This controls which of your contact details a published listing is allowed to show."
      >
        <div className="sm:max-w-md">
          <SelectField
            label="Contact preference"
            name="contactPreference"
            required
            options={CONTACT_PREFERENCE_OPTIONS}
            value={form.contactPreference}
            onChange={(event) => set("contactPreference", event.target.value)}
            error={errors.contactPreference}
            hint="Your phone and email come from your profile — they are never typed in here."
            disabled={busy}
          />
        </div>
      </SectionCard>

      {/* Alerts live with the buttons rather than at the top of the page: this
          form is several screens long, and a message above the fold is a message
          nobody sees after pressing submit at the bottom. */}
      <div className="glass-card edge-glow p-5 sm:p-6">
        {formError && <Alert>{formError}</Alert>}
        {success && <Alert tone="success">Saved. Your changes are live on this listing.</Alert>}

        {editing ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {busy ? "Saving…" : "Save changes"}
            </button>
            <Link
              href={`/dashboard/properties/${property.id}/photos`}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Manage photos
            </Link>
            <p className="w-full text-xs leading-relaxed text-slate-500 sm:w-auto sm:flex-1">
              Editing a listing never changes whether it is published.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              {/* Draft first in the DOM, so pressing Enter in a text field picks
                  the reversible option. */}
              <button
                type="submit"
                name="intent"
                value="draft"
                className="btn-secondary"
                disabled={busy}
                aria-busy={pending === "draft"}
              >
                {pending === "draft" && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {pending === "draft" ? "Saving…" : "Save as draft"}
              </button>
              <button
                type="submit"
                name="intent"
                value="publish"
                className="btn-primary"
                disabled={busy}
                aria-busy={pending === "publish"}
              >
                {pending === "publish" && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {pending === "publish" ? "Publishing…" : "Save & publish"}
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Either way you go to the photo step next. A draft is private to you and can be
              published from the listing&apos;s edit page whenever you&apos;re ready — and it is
              checked just as thoroughly as a published one, so nothing here can be left blank.
            </p>
          </>
        )}
      </div>
    </form>
  );
}
