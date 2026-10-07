/**
 * Render-quality preference. Sharp is the default; only an explicit choice in the toolbar is
 * remembered. An automatic fallback (slow frames) lasts for the session and is never saved.
 *
 * The key is versioned: earlier builds saved whatever mode was active, including the old
 * Balanced default, so their value is not treated as a user choice.
 */
import type { Quality } from "@/scene/raster";

export const QUALITY_KEY = "racksentinel.quality.v2";
export const DEFAULT_QUALITY: Quality = "sharp";

type Store = Pick<Storage, "getItem" | "setItem">;

const isQuality = (q: unknown): q is Quality => q === "performance" || q === "balanced" || q === "sharp";

function store(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // storage blocked
  }
}

export function readQuality(s: Store | null = store()): Quality {
  try {
    const q = s?.getItem(QUALITY_KEY);
    if (isQuality(q)) return q;
  } catch {
    /* storage unavailable: use the default */
  }
  return DEFAULT_QUALITY;
}

/** Remember a mode the user picked. */
export function saveQuality(q: Quality, s: Store | null = store()): void {
  try {
    s?.setItem(QUALITY_KEY, q);
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
}
