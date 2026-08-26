"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  ImagePlus,
  Loader2,
  Star,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  IMAGE_FORMAT_SUMMARY,
  MAX_ALT_LENGTH,
  MAX_FILES_PER_UPLOAD,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_PROPERTY,
  formatBytes,
  isImageMimeType,
} from "@/lib/media/constants";
import { cn } from "@/lib/utils/cn";
import type { SafeMedia } from "@/types";

/**
 * The seller's photo manager.
 *
 * ── The server owns the gallery; this component owns the gestures ───────────
 *
 * Every mutation goes to the API and the response — always the full gallery, in
 * canonical order — replaces local state wholesale. The component never patches
 * its own array from a partial response and never computes a new `sortOrder`:
 * positions and the "exactly one cover" invariant are `lib/media/order.ts`'s job,
 * settled inside a transaction. So a stale tab, two open windows, or a failed
 * request all converge on whatever the database actually says rather than on what
 * this component hoped.
 *
 * Reordering is the one exception, and only visually: a drag that waits for a
 * round trip before the tile moves feels broken, so the new order is painted
 * immediately and the snapshot is restored if the PATCH fails.
 *
 * ── Why plain `<img>` and not `next/image` ──────────────────────────────────
 *
 * The image optimizer fetches the source URL server-side, from its own request,
 * with no cookies attached. `/api/media/[id]` answers an anonymous request for an
 * unpublished listing's photo with a 404 — correctly — so an optimized `<img>`
 * here would render broken for exactly the case this page exists to serve: a
 * draft. The public browse gallery has the opposite situation and does use
 * `next/image`. The eslint rule is suppressed per element with that reason.
 *
 * ── Client validation is a courtesy ─────────────────────────────────────────
 *
 * The type and size checks below exist so a 30 MB HEIC fails in a tenth of a
 * second instead of after a two-minute upload. They are not the control: the
 * server re-derives the MIME type from the file's magic bytes and re-measures its
 * length, because `File.type` is a browser's guess from the extension and a
 * scripted client can claim anything at all.
 */

/** A file being uploaded right now — a local preview with no row behind it yet. */
type Pending = {
  readonly key: string;
  readonly name: string;
  readonly previewUrl: string;
};

/**
 * Cleans a filename for display in an error message.
 *
 * Mirrors `displayName` in the upload route, for the client-side rejections that
 * never reach the server. Nothing here is used to build a path — the file's name
 * is not sent anywhere except as part of the multipart body, and is not stored.
 */
function displayName(name: string, index: number): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
    .replace(/[\\/]/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : `File ${index + 1}`;
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function ImageUploader({
  propertyId,
  initialMedia,
}: {
  propertyId: string;
  initialMedia: readonly SafeMedia[];
}) {
  const [media, setMedia] = useState<readonly SafeMedia[]>(initialMedia);
  const [pending, setPending] = useState<readonly Pending[]>([]);

  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Per-file rejections, from either side of the boundary. */
  const [problems, setProblems] = useState<readonly string[]>([]);

  const [uploading, setUploading] = useState(false);
  /** The photo currently mid-request, so only its own controls spin. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const [dropActive, setDropActive] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  /** Object URLs still owned by this component, revoked on unmount. */
  const previewUrls = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current = [];
    },
    []
  );

  const remaining = Math.max(0, MAX_IMAGES_PER_PROPERTY - media.length);
  const full = remaining === 0;
  const anyBusy = uploading || arranging || busyId !== null;

  // ───────────────────────────────────────────────────────────
  // Upload
  // ───────────────────────────────────────────────────────────

  const upload = useCallback(
    async (selected: readonly File[]) => {
      setFormError(null);
      setNotice(null);
      setProblems([]);

      if (selected.length === 0) return;

      // How many of this batch can possibly be stored. Checked here so the seller
      // is told before the bytes go out, and again server-side because this number
      // can be stale by the time the request lands.
      const room = Math.min(remaining, MAX_FILES_PER_UPLOAD);
      if (room === 0) {
        setFormError(
          full
            ? `This listing already has the maximum of ${MAX_IMAGES_PER_PROPERTY} photos. Delete one to add another.`
            : `Upload at most ${MAX_FILES_PER_UPLOAD} photos at a time.`
        );
        return;
      }

      const accepted: File[] = [];
      const rejected: string[] = [];

      selected.forEach((file, index) => {
        const name = displayName(file.name, index);

        if (!isImageMimeType(file.type)) {
          rejected.push(`${name}: that file type isn't supported. Use ${IMAGE_FORMAT_SUMMARY}.`);
          return;
        }
        if (file.size === 0) {
          rejected.push(`${name}: that file is empty.`);
          return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          rejected.push(
            `${name}: ${formatBytes(file.size)} is too large. The limit is ${formatBytes(
              MAX_IMAGE_BYTES
            )} per photo.`
          );
          return;
        }
        if (accepted.length >= room) {
          rejected.push(
            `${name}: not uploaded — only ${room} more photo${room === 1 ? "" : "s"} will fit right now.`
          );
          return;
        }
        accepted.push(file);
      });

      setProblems(rejected);
      if (accepted.length === 0) return;

      // Previews come from the selected files themselves, so a tile appears the
      // instant the drop lands rather than after the round trip.
      const tiles: Pending[] = accepted.map((file, index) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.push(previewUrl);
        return { key: `${index}-${file.size}-${file.lastModified}`, name: file.name, previewUrl };
      });

      setPending(tiles);
      setUploading(true);

      const body = new FormData();
      body.append("kind", "IMAGE");
      for (const file of accepted) body.append("files", file);

      try {
        const response = await fetch(`/api/properties/${propertyId}/media`, {
          method: "POST",
          body,
        });
        const data = await response.json();

        if (!response.ok) {
          setFormError(data.error ?? "Something went wrong. Please try again.");
          // The route reports per-file reasons under `fieldErrors.files` when the
          // whole batch failed; keep them, they are the actionable part.
          if (typeof data.fieldErrors?.files === "string") {
            setProblems((current) => [...current, data.fieldErrors.files]);
          }
          return;
        }

        setMedia(data.media ?? []);

        const uploaded: number = data.uploaded ?? 0;
        const duplicates: string[] = Array.isArray(data.duplicates) ? data.duplicates : [];
        const serverRejections: { name?: string; reason?: string }[] = Array.isArray(data.rejected)
          ? data.rejected
          : [];

        if (serverRejections.length > 0) {
          setProblems((current) => [
            ...current,
            ...serverRejections.map(
              (item) => `${item.name ?? "A file"}: ${item.reason ?? "could not be used."}`
            ),
          ]);
        }
        if (duplicates.length > 0) {
          setProblems((current) => [
            ...current,
            `Already on this listing, so skipped: ${duplicates.join(", ")}.`,
          ]);
        }

        if (uploaded > 0) {
          setNotice(`${uploaded} photo${uploaded === 1 ? "" : "s"} uploaded.`);
        } else if (duplicates.length > 0) {
          setNotice("Those photos are already on this listing.");
        }
      } catch {
        setFormError("Network error. Please check your connection and try again.");
      } finally {
        setUploading(false);
        setPending([]);
        for (const tile of tiles) URL.revokeObjectURL(tile.previewUrl);
        previewUrls.current = previewUrls.current.filter(
          (url) => !tiles.some((tile) => tile.previewUrl === url)
        );
        // Cleared so choosing the same file again still fires `change`.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [full, propertyId, remaining]
  );

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    void upload(Array.from(event.target.files ?? []));
  };

  // Only file drags are interesting here. Without this test, dragging a tile over
  // the drop zone during a reorder would light it up as if it were a file.
  const isFileDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const onDrop = (event: React.DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    setDropActive(false);
    void upload(Array.from(event.dataTransfer.files ?? []));
  };

  // ───────────────────────────────────────────────────────────
  // Arrange — order and cover, one request
  // ───────────────────────────────────────────────────────────

  const arrange = useCallback(
    async (body: { order?: string[]; primaryId?: string }, snapshot: readonly SafeMedia[]) => {
      setFormError(null);
      setNotice(null);
      setArranging(true);

      try {
        const response = await fetch(`/api/properties/${propertyId}/media`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json();

        if (!response.ok) {
          // The optimistic order was a guess; the snapshot is what the server last
          // confirmed, so that is what the seller should be looking at.
          setMedia(snapshot);
          setFormError(data.error ?? "That change could not be saved. Please try again.");
          return;
        }

        setMedia(data.media ?? []);
      } catch {
        setMedia(snapshot);
        setFormError("Network error. Please check your connection and try again.");
      } finally {
        setArranging(false);
      }
    },
    [propertyId]
  );

  const reorderTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= media.length) return;

    const snapshot = media;
    const next = moveItem(media, from, to);
    setMedia(next);
    void arrange({ order: next.map((item) => item.id) }, snapshot);
  };

  const setCover = (mediaId: string) => {
    void arrange({ primaryId: mediaId }, media);
  };

  // ───────────────────────────────────────────────────────────
  // Per-photo: alt text, delete
  // ───────────────────────────────────────────────────────────

  const saveAlt = async (mediaId: string, alt: string) => {
    setFormError(null);
    setNotice(null);
    setBusyId(mediaId);

    try {
      const response = await fetch(`/api/properties/${propertyId}/media/${mediaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alt }),
      });
      const data = await response.json();

      if (!response.ok) {
        setFormError(
          data.fieldErrors?.alt ?? data.error ?? "That description could not be saved."
        );
        return;
      }

      setMedia(data.media ?? []);
      setNotice("Description saved.");
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (mediaId: string) => {
    setFormError(null);
    setNotice(null);
    setConfirmId(null);
    setBusyId(mediaId);

    try {
      const response = await fetch(`/api/properties/${propertyId}/media/${mediaId}`, {
        method: "DELETE",
      });
      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error ?? "That photo could not be deleted. Please try again.");
        return;
      }

      setMedia(data.media ?? []);
      setNotice("Photo deleted.");
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

  // ───────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────

  return (
    <div>
      {formError && <Alert tone="error">{formError}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {problems.length > 0 && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        >
          <p className="font-medium">
            {problems.length === 1 ? "One file was not used:" : "Some files were not used:"}
          </p>
          <ul className="mt-1.5 space-y-1 text-amber-100/85">
            {problems.map((problem) => (
              <li key={problem} className="leading-relaxed">
                {problem}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Drop zone ─────────────────────────────────────── */}
      <div
        onDragEnter={(event) => {
          if (isFileDrag(event)) {
            event.preventDefault();
            setDropActive(true);
          }
        }}
        onDragOver={(event) => {
          if (isFileDrag(event)) {
            // Required: without it the browser navigates to the dropped file.
            event.preventDefault();
            setDropActive(true);
          }
        }}
        onDragLeave={(event) => {
          // Only when the pointer actually left the zone, not on every child it
          // crossed on the way in.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropActive(false);
          }
        }}
        onDrop={onDrop}
        className={cn(
          "rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-200",
          dropActive
            ? "border-cyan/60 bg-cyan/[0.06]"
            : "border-white/12 bg-white/[0.02] hover:border-white/20",
          full && "opacity-60"
        )}
      >
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.06] text-slate-300">
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <UploadCloud className="h-5 w-5" aria-hidden="true" />
          )}
        </span>

        <p className="text-sm font-medium text-slate-200">
          {full ? "This listing is full" : "Drag photos here, or choose files"}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {IMAGE_FORMAT_SUMMARY} · up to {formatBytes(MAX_IMAGE_BYTES)} each ·{" "}
          {MAX_FILES_PER_UPLOAD} at a time
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          onChange={onPick}
          className="hidden"
          // A disabled input cannot be opened programmatically either, which is the
          // behaviour wanted while a batch is in flight.
          disabled={uploading || full}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || full}
          className="btn-primary mt-4 inline-flex items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          aria-busy={uploading}
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Uploading…
            </>
          ) : (
            <>
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              Choose photos
            </>
          )}
        </button>

        <p className="mt-3 text-xs text-slate-500 tabular">
          {media.length} of {MAX_IMAGES_PER_PROPERTY} used
          {remaining > 0 && ` · ${remaining} remaining`}
        </p>
      </div>

      {/* ── The gallery ───────────────────────────────────── */}
      {media.length === 0 && pending.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">
          No photos yet. The first one you upload becomes the cover image, and you can change
          it at any time.
        </p>
      ) : (
        <>
          <div className="mt-6 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-200">
              Photos <span className="text-slate-500">({media.length})</span>
            </h3>
            {arranging && (
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Saving order…
              </span>
            )}
          </div>

          <p className="mt-1 text-xs text-slate-500">
            The first photo is the cover. Drag a tile to reorder, or use the arrows.
          </p>

          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {media.map((item, index) => {
              const itemBusy = busyId === item.id;

              return (
                <li
                  key={item.id}
                  draggable={!anyBusy}
                  onDragStart={(event) => {
                    setDragIndex(index);
                    // Some browsers refuse to start a drag without payload.
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragOver={(event) => {
                    if (dragIndex !== null) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (dragIndex === null) return;
                    event.preventDefault();
                    reorderTo(dragIndex, index);
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border bg-white/[0.02] transition-all duration-200",
                    dragIndex === index
                      ? "border-cyan/60 opacity-50"
                      : "border-white/10 hover:border-white/20",
                    item.isPrimary && "ring-1 ring-cyan/40"
                  )}
                >
                  <div className="relative aspect-[4/3] bg-navy-950/60">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the
                        optimizer sends no cookies, so it cannot read a draft's photos. */}
                    <img
                      src={item.url}
                      alt={item.alt ?? `Photo ${index + 1}`}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />

                    {item.isPrimary && (
                      <span className="badge-soft absolute left-2 top-2 gap-1 text-[10px]">
                        <Star className="h-3 w-3" aria-hidden="true" />
                        Cover
                      </span>
                    )}

                    <span className="pointer-events-none absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-navy-950/70 text-[11px] font-semibold text-slate-200 backdrop-blur-sm tabular">
                      {index + 1}
                    </span>

                    <span
                      className="pointer-events-none absolute bottom-2 left-2 text-slate-300/70 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden="true"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>

                    {itemBusy && (
                      <span className="absolute inset-0 flex items-center justify-center bg-navy-950/60">
                        <Loader2 className="h-5 w-5 animate-spin text-slate-200" aria-hidden="true" />
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 p-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => reorderTo(index, index - 1)}
                        disabled={anyBusy || index === 0}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label={`Move photo ${index + 1} earlier`}
                      >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => reorderTo(index, index + 1)}
                        disabled={anyBusy || index === media.length - 1}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label={`Move photo ${index + 1} later`}
                      >
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setCover(item.id)}
                        disabled={anyBusy || item.isPrimary}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed",
                          item.isPrimary
                            ? "border-cyan/40 text-cyan disabled:opacity-100"
                            : "border-white/10 text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-35"
                        )}
                        aria-label={
                          item.isPrimary
                            ? `Photo ${index + 1} is the cover image`
                            : `Make photo ${index + 1} the cover image`
                        }
                      >
                        <Star
                          className={cn("h-4 w-4", item.isPrimary && "fill-current")}
                          aria-hidden="true"
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfirmId(item.id)}
                        disabled={anyBusy}
                        className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label={`Delete photo ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>

                    {/* Alt text. Saved on blur rather than on every keystroke: one
                        request per edit, not one per character. */}
                    <input
                      type="text"
                      defaultValue={item.alt ?? ""}
                      maxLength={MAX_ALT_LENGTH}
                      placeholder="Describe this photo"
                      disabled={anyBusy}
                      onBlur={(event) => {
                        const value = event.target.value.trim();
                        if (value === (item.alt ?? "")) return;
                        void saveAlt(item.id, value);
                      }}
                      className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-royal-400/50 focus:outline-none disabled:opacity-50"
                      aria-label={`Description for photo ${index + 1}`}
                    />
                  </div>

                  {/* Inline confirmation rather than `window.confirm`: deleting a
                      photo cannot be undone, and a native dialog is both easy to
                      dismiss by reflex and unstyleable. */}
                  {confirmId === item.id && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy-950/90 p-3 text-center backdrop-blur-sm">
                      <p className="text-xs font-medium text-slate-200">
                        Delete this photo? This cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void remove(item.id)}
                          className="rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/25"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/5"
                        >
                          Keep
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}

            {/* Files mid-flight. Rendered from the local object URLs so the grid
                grows the moment the drop lands, and replaced by real rows when the
                response arrives. */}
            {pending.map((tile) => (
              <li
                key={tile.key}
                className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
              >
                <div className="relative aspect-[4/3] bg-navy-950/60">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL
                      cannot be optimized; there is no server-side source to fetch. */}
                  <img
                    src={tile.previewUrl}
                    alt=""
                    className="h-full w-full object-cover opacity-40"
                  />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-200" aria-hidden="true" />
                  </span>
                </div>
                <p className="truncate p-2.5 text-[11px] text-slate-400" title={tile.name}>
                  {tile.name}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
