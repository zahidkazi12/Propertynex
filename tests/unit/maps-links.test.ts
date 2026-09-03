import "../stubs/patch-path-alias";

import test from "node:test";
import assert from "node:assert/strict";

import {
  directionsUrl,
  embedMapUrl,
  hasCoordinates,
  hasMapTarget,
  placeUrl,
} from "../../lib/maps/links";

/**
 * `lib/maps/links.ts` — the map integration that works with no key and no SDK.
 *
 * ── What these tests are really protecting ──────────────────────────────────
 *
 * Two properties, and both are product promises rather than implementation
 * details:
 *
 *   1. **Nothing is invented.** A target with no coordinates and no address yields
 *      `null`, not a URL pointing at 0,0 or at a guessed city centre. A caller that
 *      gets `null` renders no directions button, so the only way a "Get directions"
 *      action can exist is if there was something real to point it at.
 *   2. **Directions survive an unconfigured deployment.** `directionsUrl` and
 *      `placeUrl` never consult an API key; only `embedMapUrl` does. That split is
 *      what makes "no maps key" a degraded experience instead of a broken one, and
 *      the tests below pin it so a future refactor cannot quietly make the whole
 *      module key-dependent.
 */

const BENGALURU = { latitude: 12.9784, longitude: 77.6408 };
const ADDRESS = "Indiranagar, Bengaluru, Karnataka";

// ─────────────────────────────────────────────────────────────
// Coordinates are preferred, and are real
// ─────────────────────────────────────────────────────────────

test("directions point at the coordinates when there are coordinates", () => {
  const url = directionsUrl(BENGALURU);
  assert.ok(url, "a coordinate pair must produce a URL");

  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://www.google.com");
  assert.equal(parsed.pathname, "/maps/dir/");
  assert.equal(parsed.searchParams.get("api"), "1");
  assert.equal(parsed.searchParams.get("destination"), "12.9784,77.6408");
});

test("coordinates win over an address when both are present", () => {
  // Google geocodes a text address and can land on the middle of a locality; a
  // lat/lng lands on the point. When we hold both, the precise one is the answer.
  const url = directionsUrl({ ...BENGALURU, address: ADDRESS });
  assert.match(url ?? "", /destination=12\.9784%2C77\.6408/);
});

test("an address is used when there are no coordinates", () => {
  const url = directionsUrl({ address: ADDRESS });
  assert.ok(url);
  assert.equal(new URL(url).searchParams.get("destination"), ADDRESS);
});

test("no origin is ever sent", () => {
  // The device knows where the user is, and asking the browser for a location
  // permission this product has no other use for would be a worse trade than
  // letting Google fill it in.
  const url = directionsUrl(BENGALURU);
  assert.equal(new URL(url ?? "").searchParams.has("origin"), false);
});

test("a float artefact does not reach the URL", () => {
  // 0.1 + 0.2 style drift in a stored value would otherwise produce
  // "77.59460000000001" in a user-visible link.
  const url = directionsUrl({ latitude: 12.3, longitude: 77.5946 + 0.0000000000001 });
  assert.match(url ?? "", /destination=12\.3%2C77\.5946$/);
});

// ─────────────────────────────────────────────────────────────
// Nothing is invented
// ─────────────────────────────────────────────────────────────

test("a target with neither coordinates nor an address yields no URL at all", () => {
  for (const target of [
    {},
    { latitude: null, longitude: null },
    { address: "" },
    { address: "   " },
    { latitude: null, longitude: null, address: null },
  ]) {
    assert.equal(directionsUrl(target), null, `directions invented for ${JSON.stringify(target)}`);
    assert.equal(placeUrl(target), null, `place invented for ${JSON.stringify(target)}`);
    assert.equal(hasMapTarget(target), false);
  }
});

test("half a coordinate is not a coordinate", () => {
  // Storing one axis and defaulting the other to 0 puts the listing in the Gulf of
  // Guinea. Neither builder may fall back to a single axis.
  assert.equal(hasCoordinates({ latitude: 12.9784, longitude: null }), false);
  assert.equal(hasCoordinates({ latitude: null, longitude: 77.6408 }), false);
  assert.equal(directionsUrl({ latitude: 12.9784 }), null);

  // ...but the address still works, because that is a different fact.
  assert.ok(directionsUrl({ latitude: 12.9784, address: ADDRESS }));
});

test("out-of-range and non-finite coordinates are refused, not clamped", () => {
  const bad = [
    { latitude: 91, longitude: 0 },
    { latitude: -91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: 0, longitude: -181 },
    { latitude: Number.NaN, longitude: 0 },
    { latitude: 0, longitude: Number.POSITIVE_INFINITY },
  ];

  for (const target of bad) {
    assert.equal(hasCoordinates(target), false, `accepted ${JSON.stringify(target)}`);
    // Clamping 91 to 90 would answer a question nobody asked, in a link someone
    // is about to drive to.
    assert.equal(directionsUrl(target), null, `built a URL for ${JSON.stringify(target)}`);
  }
});

test("an out-of-range coordinate falls through to the address rather than failing", () => {
  const url = directionsUrl({ latitude: 999, longitude: 999, address: ADDRESS });
  assert.equal(new URL(url ?? "").searchParams.get("destination"), ADDRESS);
});

// ─────────────────────────────────────────────────────────────
// Only the embed needs a key
// ─────────────────────────────────────────────────────────────

test("the embed URL requires a key and returns null without one", () => {
  assert.equal(embedMapUrl(BENGALURU, ""), null);

  const url = embedMapUrl(BENGALURU, "test-key", 15);
  assert.ok(url);

  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/maps/embed/v1/place");
  assert.equal(parsed.searchParams.get("key"), "test-key");
  assert.equal(parsed.searchParams.get("q"), "12.9784,77.6408");
  assert.equal(parsed.searchParams.get("zoom"), "15");
});

test("directions and place links never depend on a key", () => {
  // The property that makes an unconfigured deployment usable. If this ever fails,
  // the fallback state has silently lost its only working action.
  assert.ok(directionsUrl(BENGALURU));
  assert.ok(placeUrl(BENGALURU));
  assert.ok(directionsUrl({ address: ADDRESS }));
  assert.ok(placeUrl({ address: ADDRESS }));
});

test("every produced URL is https and on google.com", () => {
  const urls = [
    directionsUrl(BENGALURU),
    placeUrl(BENGALURU),
    directionsUrl({ address: ADDRESS }),
    embedMapUrl(BENGALURU, "k"),
  ];

  for (const url of urls) {
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.hostname, "www.google.com");
  }
});

test("an address with URL-significant characters is encoded, not interpolated", () => {
  // A locality name is user-entered text that ends up in a query string. If it were
  // concatenated rather than encoded, "&" would start a new parameter.
  const url = placeUrl({ address: "A&B Road, Mysuru #3" });
  assert.ok(url);
  const parsed = new URL(url);
  // `/maps/search/` names its parameter `query`. `q` is the *Embed* API's spelling
  // (asserted above against `embedMapUrl`) — reading it here found nothing, which
  // passed `assert.ok(url)` and then compared null to the address.
  assert.equal(parsed.searchParams.get("query"), "A&B Road, Mysuru #3");
  assert.equal(parsed.searchParams.get("api"), "1");
  // Pin the encoding itself, not just that it round-trips: a bare "&" in the raw
  // URL is exactly the interpolation bug this test is named for, and it would still
  // leave `query` readable as "A".
  assert.ok(url.includes("%26"), `unencoded "&" in ${url}`);
});
