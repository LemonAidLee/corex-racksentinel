import { describe, expect, it } from "vitest";
import { DEFAULT_QUALITY, QUALITY_KEY, readQuality, saveQuality } from "./quality";

function memoryStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
}

describe("render quality preference", () => {
  it("defaults to Sharp when nothing was chosen", () => {
    expect(DEFAULT_QUALITY).toBe("sharp");
    expect(readQuality(memoryStore())).toBe("sharp");
    expect(readQuality(null)).toBe("sharp");
  });

  it("ignores the old key, which stored the previous default rather than a choice", () => {
    expect(readQuality(memoryStore({ "racksentinel.quality": "balanced" }))).toBe("sharp");
  });

  it("respects an explicit saved choice", () => {
    const s = memoryStore();
    saveQuality("performance", s);
    expect(s.map.get(QUALITY_KEY)).toBe("performance");
    expect(readQuality(s)).toBe("performance");
  });

  it("falls back to Sharp on bad values or blocked storage", () => {
    expect(readQuality(memoryStore({ [QUALITY_KEY]: "ultra" }))).toBe("sharp");
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readQuality(blocked)).toBe("sharp");
    expect(() => saveQuality("balanced", blocked)).not.toThrow();
  });
});
