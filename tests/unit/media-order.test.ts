import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPrimary,
  applyReorder,
  diffOrder,
  nextSortOrder,
  normalizeOrder,
  primaryOf,
  sortMedia,
  type MediaOrderRow,
} from "../../lib/media/order";

/**
 * `lib/media/order.ts` — the gallery's two invariants.
 *
 * Positions stay dense (0..n-1), and exactly one photo is the cover. Both are
 * things MongoDB cannot express as a constraint, so they are upheld in code on
 * every mutation, which makes them exactly the things worth testing directly.
 *
 * The reorder tests are written from the client's side of the boundary: the id
 * list arrives from a browser, so it may be stale, partial, duplicated, or name
 * photos belonging to another listing entirely. None of those may corrupt the
 * gallery and none may lose a photo — a seller whose second tab uploaded a
 * picture must find that picture still there after a drag in the first tab.
 */

/** Ids that read as positions, so a failure message is legible. */
function rows(spec: readonly (readonly [string, number, boolean])[]): MediaOrderRow[] {
  return spec.map(([id, sortOrder, isPrimary]) => ({ id, sortOrder, isPrimary }));
}

/** `[id, sortOrder, isPrimary]` triples, for comparing a whole result at once. */
function shape(
  result: readonly { id: string; sortOrder: number; isPrimary: boolean }[]
): (readonly [string, number, boolean])[] {
  return result.map((row) => [row.id, row.sortOrder, row.isPrimary] as const);
}

function ids(result: readonly { id: string }[]): string[] {
  return result.map((row) => row.id);
}

/** Both invariants, checked together. Every mutation's result must satisfy them. */
function assertWellFormed(result: readonly { id: string; sortOrder: number; isPrimary: boolean }[]) {
  result.forEach((row, index) => {
    assert.equal(row.sortOrder, index, `position ${index} is numbered ${row.sortOrder}`);
  });
  if (result.length > 0) {
    assert.equal(
      result.filter((row) => row.isPrimary).length,
      1,
      "a non-empty gallery must have exactly one cover"
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────

test("sortMedia orders by position", () => {
  const sorted = sortMedia(rows([["c", 2, false], ["a", 0, true], ["b", 1, false]]));
  assert.deepEqual(ids(sorted), ["a", "b", "c"]);
});

test("sortMedia breaks ties on id, so the gallery cannot reshuffle itself", () => {
  // Duplicate positions are possible on rows written before a normalisation. With
  // no tiebreak the order would be whatever Mongo happened to return, and two
  // identical requests would render two different galleries.
  const tied = rows([["z", 0, false], ["m", 0, false], ["a", 0, true]]);
  assert.deepEqual(ids(sortMedia(tied)), ["a", "m", "z"]);
  assert.deepEqual(ids(sortMedia([...tied].reverse())), ["a", "m", "z"]);
});

test("sortMedia does not mutate its input", () => {
  const original = rows([["c", 2, false], ["a", 0, true]]);
  const snapshot = shape(original);
  sortMedia(original);
  assert.deepEqual(shape(original), snapshot);
});

test("primaryOf returns the flagged photo", () => {
  const found = primaryOf(rows([["a", 0, false], ["b", 1, true], ["c", 2, false]]));
  assert.equal(found?.id, "b");
});

test("primaryOf falls back to the first photo when nothing is flagged", () => {
  // Tolerance on the read path is deliberate: a lost race should cost a seller a
  // surprising cover, never a listing that renders no photograph at all.
  const found = primaryOf(rows([["b", 1, false], ["a", 0, false]]));
  assert.equal(found?.id, "a");
});

test("primaryOf takes the first when several rows are flagged", () => {
  const found = primaryOf(rows([["c", 2, true], ["a", 0, true], ["b", 1, false]]));
  assert.equal(found?.id, "a");
});

test("primaryOf returns null only for an empty gallery", () => {
  assert.equal(primaryOf([]), null);
});

// ─────────────────────────────────────────────────────────────
// Normalising
// ─────────────────────────────────────────────────────────────

test("normalizeOrder closes gaps left by deletions", () => {
  // What twenty photos look like after the middle ones have been deleted a few
  // times. "Position 14" has to stop meaning anything to anyone reading the row.
  const result = normalizeOrder(rows([["a", 0, true], ["b", 7, false], ["c", 41, false]]));
  assert.deepEqual(shape(result), [["a", 0, true], ["b", 1, false], ["c", 2, false]]);
  assertWellFormed(result);
});

test("normalizeOrder keeps the existing cover wherever it sits", () => {
  const result = normalizeOrder(rows([["a", 0, false], ["b", 5, true], ["c", 9, false]]));
  assert.deepEqual(shape(result), [["a", 0, false], ["b", 1, true], ["c", 2, false]]);
});

test("normalizeOrder appoints a cover when there is none", () => {
  // This is what makes "upload the first photo" and "delete the cover" both end
  // with a listing that still has a cover, without either path thinking about it.
  const result = normalizeOrder(rows([["b", 3, false], ["a", 1, false]]));
  assert.deepEqual(shape(result), [["a", 0, true], ["b", 1, false]]);
  assertWellFormed(result);
});

test("normalizeOrder settles a gallery that somehow has several covers", () => {
  const result = normalizeOrder(rows([["a", 0, true], ["b", 1, true], ["c", 2, true]]));
  assert.deepEqual(shape(result), [["a", 0, true], ["b", 1, false], ["c", 2, false]]);
  assertWellFormed(result);
});

test("normalizeOrder on an empty gallery is empty, not an error", () => {
  assert.deepEqual(normalizeOrder([]), []);
});

// ─────────────────────────────────────────────────────────────
// Reordering
// ─────────────────────────────────────────────────────────────

const GALLERY = rows([["a", 0, true], ["b", 1, false], ["c", 2, false], ["d", 3, false]]);

test("applyReorder applies the order the seller arranged", () => {
  const result = applyReorder(GALLERY, ["d", "c", "b", "a"]);
  assert.deepEqual(ids(result), ["d", "c", "b", "a"]);
  assertWellFormed(result);
});

test("reordering does not change which photo is the cover", () => {
  // Position and cover are separate fields for exactly this reason: dragging the
  // strip around is not a statement about which image leads.
  const result = applyReorder(GALLERY, ["d", "c", "b", "a"]);
  assert.equal(result.find((row) => row.isPrimary)?.id, "a");
  assert.equal(result.findIndex((row) => row.isPrimary), 3);
});

test("applyReorder ignores ids that are not in the gallery", () => {
  // A caller cannot pull another listing's photo into this gallery by naming it,
  // and cannot make the request fail by naming one that was just deleted.
  const result = applyReorder(GALLERY, ["c", "deadbeefdeadbeefdeadbeef", "a"]);
  assert.deepEqual(ids(result), ["c", "a", "b", "d"]);
  assertWellFormed(result);
});

test("a repeated id counts once, at its first mention", () => {
  const result = applyReorder(GALLERY, ["b", "b", "b", "a"]);
  assert.deepEqual(ids(result), ["b", "a", "c", "d"]);
  assertWellFormed(result);
});

test("photos the caller omitted are moved, never lost", () => {
  // The stale-second-tab case. `c` and `d` were not in the payload; they end up
  // after the named ones, in their existing relative order, and both still exist.
  const result = applyReorder(GALLERY, ["b", "a"]);
  assert.deepEqual(ids(result), ["b", "a", "c", "d"]);
  assert.equal(result.length, GALLERY.length);
  assertWellFormed(result);
});

test("an empty order list leaves the gallery in its current order", () => {
  const result = applyReorder(GALLERY, []);
  assert.deepEqual(ids(result), ["a", "b", "c", "d"]);
  assertWellFormed(result);
});

test("an order list of nothing but foreign ids is a no-op, not a wipe", () => {
  const result = applyReorder(GALLERY, ["ffffffffffffffffffffffff", "eeeeeeeeeeeeeeeeeeeeeeee"]);
  assert.deepEqual(ids(result), ["a", "b", "c", "d"]);
  assertWellFormed(result);
});

test("applyReorder normalises a gallery whose stored positions were a mess", () => {
  const messy = rows([["a", 9, false], ["b", 9, false], ["c", -4, true]]);
  const result = applyReorder(messy, ["b", "c"]);
  assert.deepEqual(shape(result), [["b", 0, false], ["c", 1, true], ["a", 2, false]]);
  assertWellFormed(result);
});

test("applyReorder is total: no permutation of any subset can break an invariant", () => {
  // Exhaustive over every subset of a four-photo gallery in every order, plus the
  // hostile extras. 65 payloads; each result must still be dense with one cover
  // and must still contain all four photos.
  const names = ["a", "b", "c", "d"];
  const payloads: string[][] = [];

  const walk = (chosen: string[]) => {
    payloads.push([...chosen]);
    for (const name of names) {
      if (!chosen.includes(name)) walk([...chosen, name]);
    }
  };
  walk([]);

  for (const payload of payloads) {
    for (const extra of [[], ["zzzzzzzzzzzzzzzzzzzzzzzz"], [payload[0] ?? "a"]]) {
      const result = applyReorder(GALLERY, [...payload, ...extra]);
      assertWellFormed(result);
      assert.deepEqual(
        ids(result).slice().sort(),
        names,
        `lost or invented a photo for ${JSON.stringify(payload)}`
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────
// Choosing the cover
// ─────────────────────────────────────────────────────────────

test("applyPrimary moves the cover flag and leaves positions alone", () => {
  const result = applyPrimary(GALLERY, "c");
  assert.deepEqual(shape(result ?? []), [
    ["a", 0, false],
    ["b", 1, false],
    ["c", 2, true],
    ["d", 3, false],
  ]);
  assertWellFormed(result ?? []);
});

test("applyPrimary returns null for an id the gallery does not have", () => {
  // Which the route turns into a 404 — the same answer a request naming another
  // owner's media id gets, since such a row is never in the set to begin with.
  assert.equal(applyPrimary(GALLERY, "deadbeefdeadbeefdeadbeef"), null);
  assert.equal(applyPrimary([], "deadbeefdeadbeefdeadbeef"), null);
});

test("applyPrimary on the photo that is already the cover is idempotent", () => {
  const once = applyPrimary(GALLERY, "a");
  const twice = applyPrimary(once ?? [], "a");
  assert.deepEqual(shape(once ?? []), shape(twice ?? []));
});

test("applyPrimary also repairs a gallery that arrived with several covers", () => {
  const broken = rows([["a", 0, true], ["b", 1, true]]);
  const result = applyPrimary(broken, "b");
  assert.deepEqual(shape(result ?? []), [["a", 0, false], ["b", 1, true]]);
  assertWellFormed(result ?? []);
});

// ─────────────────────────────────────────────────────────────
// Writing as little as possible
// ─────────────────────────────────────────────────────────────

test("diffOrder reports only the rows that actually changed", () => {
  // A twenty-photo gallery reordered by one drag changes a handful of rows.
  // Writing all twenty would make the transaction twenty updates wide for nothing.
  const after = applyReorder(GALLERY, ["a", "c", "b", "d"]);
  assert.deepEqual(ids(diffOrder(GALLERY, after)).sort(), ["b", "c"]);
});

test("diffOrder reports a cover change even when no position moved", () => {
  const after = applyPrimary(GALLERY, "c") ?? [];
  assert.deepEqual(ids(diffOrder(GALLERY, after)).sort(), ["a", "c"]);
});

test("diffOrder reports nothing when nothing changed", () => {
  assert.deepEqual(diffOrder(GALLERY, normalizeOrder(GALLERY)), []);
});

test("diffOrder always reports a row it has never seen", () => {
  // A freshly inserted row has no `before`, so it must always be written.
  const withNew = normalizeOrder([...GALLERY, ...rows([["e", 4, false]])]);
  assert.deepEqual(ids(diffOrder(GALLERY, withNew)), ["e"]);
});

test("nextSortOrder puts the first photo at position zero", () => {
  assert.equal(nextSortOrder([]), 0);
});

test("nextSortOrder appends after everything already there", () => {
  assert.equal(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 1 }, { sortOrder: 2 }]), 3);
  // Gaps and duplicates included: it is the maximum that matters, not the count,
  // or a second upload would collide with an existing position.
  assert.equal(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 19 }, { sortOrder: 19 }]), 20);
  assert.equal(nextSortOrder([{ sortOrder: -3 }]), 0);
});
