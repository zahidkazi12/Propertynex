/**
 * A minimal ambient declaration for the slice of the Google Maps JavaScript API
 * this application uses.
 *
 * ── Why this exists instead of `@types/google.maps` ─────────────────────────
 *
 * The DefinitelyTyped package would work and costs nothing at runtime, but it is
 * still a dependency to install, pin and update, and it declares several thousand
 * lines describing an API surface this product does not touch. The codebase's
 * stated position on vendor SDKs (`lib/otp/providers/`, `lib/maps/loader.ts`) is
 * to describe the narrow contract actually in use, so that is what this does.
 *
 * ── How to read it ─────────────────────────────────────────────────────────
 *
 * It is deliberately *incomplete*. Every member here is one `lib/maps/loader.ts`
 * or a component under `components/maps/` calls. Adding a call means adding its
 * declaration, which is the point: the file doubles as an inventory of how much
 * of Google's API this app depends on, and that inventory is currently short
 * enough to read in one screen.
 *
 * Members are typed as loosely as is safe where Google's own shape is a union of
 * many things (`styles`, listener arguments) and tightly everywhere it matters
 * (positions, bounds, the map handle itself).
 */

declare global {
  namespace google.maps {
    interface LatLngLiteral {
      lat: number;
      lng: number;
    }

    interface Padding {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    }

    class LatLng {
      lat(): number;
      lng(): number;
      toJSON(): LatLngLiteral;
    }

    class LatLngBounds {
      constructor();
      extend(point: LatLngLiteral | LatLng): LatLngBounds;
      isEmpty(): boolean;
      getCenter(): LatLng;
    }

    class Size {
      constructor(width: number, height: number);
    }

    class Point {
      constructor(x: number, y: number);
    }

    interface Icon {
      url: string;
      scaledSize?: Size;
      anchor?: Point;
    }

    /** One entry of a JSON map style. The stylers array is genuinely open-ended
     *  in Google's schema, so it is typed as such rather than guessed at. */
    interface MapTypeStyle {
      featureType?: string;
      elementType?: string;
      stylers: Array<Record<string, string | number>>;
    }

    interface MapOptions {
      center?: LatLngLiteral;
      zoom?: number;
      minZoom?: number;
      maxZoom?: number;
      disableDefaultUI?: boolean;
      zoomControl?: boolean;
      mapTypeControl?: boolean;
      streetViewControl?: boolean;
      fullscreenControl?: boolean;
      keyboardShortcuts?: boolean;
      clickableIcons?: boolean;
      backgroundColor?: string;
      /**
       * `"cooperative"` is the setting that keeps a map inside a scrolling page
       * usable: a one-finger drag scrolls the page and two fingers pan the map, so
       * the map cannot trap the page scroll on a phone.
       */
      gestureHandling?: "cooperative" | "greedy" | "none" | "auto";
      styles?: MapTypeStyle[];
    }

    interface MarkerOptions {
      position: LatLngLiteral;
      map?: Map | null;
      title?: string;
      icon?: Icon | string;
      zIndex?: number;
      optimized?: boolean;
    }

    interface MapsEventListener {
      remove(): void;
    }

    class Map {
      constructor(element: HTMLElement, options?: MapOptions);
      setCenter(position: LatLngLiteral): void;
      setZoom(zoom: number): void;
      getZoom(): number | undefined;
      panTo(position: LatLngLiteral): void;
      fitBounds(bounds: LatLngBounds, padding?: number | Padding): void;
      addListener(eventName: string, handler: () => void): MapsEventListener;
    }

    class Marker {
      constructor(options?: MarkerOptions);
      setMap(map: Map | null): void;
      setIcon(icon: Icon | string): void;
      setZIndex(zIndex: number): void;
      addListener(eventName: string, handler: () => void): MapsEventListener;
    }
  }

  interface Window {
    google?: {
      maps: typeof google.maps;
    };
  }
}

export {};
