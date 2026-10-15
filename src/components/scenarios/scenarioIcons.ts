/**
 * Scenario icon system: original 48 × 48 voxel icons, one per scenario.
 *
 * Every icon = one isometric equipment base, rendered with the same voxel rasterizer as the
 * room, plus one or two 2D pixel badges that carry the state (thermometer level, shield, bolt,
 * lock, arrow, X …). Badges get an automatic dark outline so the silhouette reads at 32 px and
 * the state never depends on colour alone. Icons contain no text.
 *
 * Colour interface: STATE (normal / warning / critical) and NEUTRAL tokens from lib/tokens.
 */
import { Raster, type Tex } from "@/scene/raster";
import { NEUTRAL, STATE } from "@/lib/tokens";

export const ICON_SIZE = 48;

type Px = number | null; // RGB or transparent
type Mask = (x: number, y: number) => Px;

// ------------------------------------------------------------------ voxel bases
const RS = 2; // render scale: 1 world unit = 2 px

const rackTex = (lampColor: number | null): Tex => (face, u, v, w, h, t) => {
  if (u < t || v < t || u >= w - t || v >= h - t) return 0x4a525b;
  if (face === 1) {
    if (v < 2) return lampColor !== null && u > 1 && u < 2.5 ? lampColor | 0x1000000 : 0x1b1f24;
    const row = (v - 2) % 1.5;
    if (row < 0.5) return 0x1b1f24;
    if (u > w - 1.5 && u < w - 1 && row > 0.5 && row < 1) return 0x9fc9e8 | 0x1000000;
    return 0x2e343b;
  }
  return face === 0 ? 0x3a424b : 0x343b43;
};

function rackBase(r: Raster, opts: { lamp?: number | null; topLamp?: number | null } = {}) {
  r.drawBox({ x: 0, y: 0, z: 0, w: 7, d: 6, h: 14, tex: rackTex(opts.lamp ?? null) });
  if (opts.topLamp) r.drawBox({ x: 2.5, y: 2, z: 14, w: 2, d: 2, h: 2, tex: opts.topLamp | 0x1000000 });
}

const housingTex: Tex = (face, u, v, w, h, t) => {
  if (u < t || v < t || u >= w - t || v >= h - t) return 0x305478;
  if (face === 2 && v < 2) return 0xf2d24b;
  return 0x3f6a96;
};

function buttonBase(r: Raster, pressed: boolean) {
  r.drawBox({ x: 0, y: 1, z: 0, w: 4, d: 8, h: 11, tex: 0x2a3038 });
  r.drawBox({ x: 4, y: 1.5, z: 1, w: 2, d: 7, h: 9, tex: housingTex });
  r.drawBox({ x: 6, y: 3, z: 3, w: pressed ? 0.75 : 2.5, d: 4, h: 4, tex: pressed ? 0xb9bec4 : NEUTRAL.white });
}

const packetTex = (broken: boolean): Tex => (face, u, v, w, h, t) => {
  if (u < t || v < t || u >= w - t || v >= h - t) return 0x305478;
  if (face === 0) return v % 2 < 1 && u > 1 && u < w - 1 && !(broken && u > w - 3) ? NEUTRAL.data : 0x3c5a78;
  return 0x2c4560;
};

function packetBase(r: Raster, broken: boolean) {
  if (broken) {
    r.drawBox({ x: 0, y: 2, z: 0, w: 5, d: 9, h: 3, tex: packetTex(false) });
    r.drawBox({ x: 6.5, y: 1, z: 1, w: 4, d: 9, h: 3, tex: packetTex(true) });
  } else {
    r.drawBox({ x: 0, y: 1, z: 0, w: 10, d: 9, h: 3, tex: packetTex(false) });
  }
}

/** A chip package: dark body, pale die mark, gold pins along two sides. */
function chipBase(r: Raster) {
  r.drawBox({ x: 0, y: 0, z: 0, w: 10, d: 10, h: 2, tex: (face, u, v, w, h, t) => (u < t || v < t || u >= w - t || v >= h - t ? 0x3a424b : face === 2 && u > 3 && u < 7 && v > 3 && v < 7 ? 0x5d6670 : 0x1f2328) });
  for (let i = 0; i < 4; i++) {
    r.drawBox({ x: 1.5 + i * 2.2, y: -1.5, z: 0.5, w: 1, d: 1.5, h: 0.6, tex: 0xc8a24a });
    r.drawBox({ x: 1.5 + i * 2.2, y: 10, z: 0.5, w: 1, d: 1.5, h: 0.6, tex: 0xc8a24a });
  }
}

/** A puddle on the floor in front of a rack. */
function rackPuddleBase(r: Raster) {
  rackBase(r, { lamp: STATE.critical });
  r.drawBox({ x: -1, y: 6.5, z: 0, w: 9, d: 4, h: 0.4, tex: 0x3c7fc4 | 0x1000000 });
}

function connectorBase(r: Raster) {
  r.drawBox({ x: 0, y: 3, z: 0, w: 4, d: 3, h: 3, tex: 0x5d6670 });
  r.drawBox({ x: 4, y: 3.75, z: 0.75, w: 2, d: 1.5, h: 1.5, tex: 0xc8a24a }); // pins
  r.drawBox({ x: 8.5, y: 3, z: 0, w: 4, d: 3, h: 3, tex: 0x4a525b });
  r.drawBox({ x: -3, y: 4, z: 1, w: 3, d: 1, h: 1, tex: 0x1f2328 });
  r.drawBox({ x: 12.5, y: 4, z: 1, w: 3, d: 1, h: 1, tex: 0x1f2328 });
}

// ------------------------------------------------------------------ 2D pixel badges (16 × 16)
const W = NEUTRAL.white;

function thermometer(level: number, color: number): Mask {
  return (x, y) => {
    const bulbD = (x - 7.5) ** 2 + (y - 11.5) ** 2;
    const tubeTop = y === 0 ? x >= 6 && x <= 9 : y >= 1 && y <= 10 && x >= 5 && x <= 10;
    if (!tubeTop && bulbD > 14) return null;
    if (bulbD <= 5.5) return color; // filled bulb
    const channel = x >= 7 && x <= 8 && y >= 2 && y <= 10;
    if (channel) return y >= 10 - Math.round(level * 8) ? color : NEUTRAL.steelDark;
    return W;
  };
}

const shieldCheck: Mask = (x, y) => {
  const half = y < 9 ? 6.5 : 6.5 - (y - 9) * 1.1;
  if (y < 1 || y > 15 || Math.abs(x - 7.5) > half) return null;
  const check = (y === 9 && x === 4) || (y === 10 && (x === 5 || x === 4)) || (y === 11 && (x === 6 || x === 5)) || (y === 10 && x === 7) || (y === 9 && x === 8) || (y === 8 && x === 9) || (y === 7 && x === 10) || (y === 6 && x === 11) || (y === 11 && x === 6) || (y === 9 && x === 7) || (y === 8 && x === 8) || (y === 7 && x === 9) || (y === 6 && x === 10) || (y === 5 && x === 11);
  return check ? W : STATE.normal;
};

/** Warning triangle with a dark glyph: 'bolt' or 'bang'. */
function triangle(color: number, glyph: "bolt" | "bang"): Mask {
  return (x, y) => {
    if (y < 1 || y > 14) return null;
    const half = (y - 1) * 0.55 + 0.5;
    if (Math.abs(x - 7.5) > half) return null;
    const dark = NEUTRAL.outline;
    if (glyph === "bang") {
      if (x >= 7 && x <= 8 && ((y >= 5 && y <= 10) || y === 12 || y === 13)) return dark;
    } else {
      const bolt = (y === 5 && (x === 8 || x === 9)) || (y === 6 && (x === 7 || x === 8)) || (y === 7 && x >= 6 && x <= 9) || (y === 8 && (x === 8 || x === 9)) || (y === 9 && (x === 7 || x === 8)) || (y === 10 && (x === 6 || x === 7)) || (y === 11 && x === 6);
      if (bolt) return dark;
    }
    return color;
  };
}

const lock: Mask = (x, y) => {
  const shackle = y >= 1 && y <= 6 && x >= 4 && x <= 11 && !(x >= 6 && x <= 9 && y >= 3) && !(y === 1 && (x === 4 || x === 11));
  if (shackle) return NEUTRAL.steel;
  if (y >= 7 && y <= 14 && x >= 2 && x <= 13) return (x === 7 || x === 8) && y >= 9 && y <= 12 ? NEUTRAL.outline : STATE.warning;
  return null;
};

const crossBox: Mask = (x, y) => {
  if (x < 1 || x > 14 || y < 1 || y > 14) return null;
  const d1 = Math.abs(x - y) <= 1, d2 = Math.abs(x - (15 - y)) <= 1;
  return (d1 || d2) && x > 2 && x < 13 && y > 2 && y < 13 ? W : STATE.critical;
};

/** No telemetry: amber prohibition ring over signal arcs. */
const noSignal: Mask = (x, y) => {
  const r = Math.hypot(x - 7.5, y - 7.5);
  if (r > 7.6) return null;
  if (r >= 5.9) return STATE.warning;
  if (Math.abs(x - y) <= 1) return STATE.warning; // slash
  const ar = Math.hypot(x - 7.5, y - 10);
  const arc = y <= 10 && ((ar >= 1.5 && ar < 2.6) || (ar >= 3.6 && ar < 4.7));
  return arc ? W : NEUTRAL.graphite;
};

/** Water drop: blue, with a white highlight. */
const drop: Mask = (x, y) => {
  const cy = 10, r = 4.6;
  const inBody = (x - 7.5) ** 2 + (y - cy) ** 2 <= r * r;
  const inTip = y >= 1 && y < cy && Math.abs(x - 7.5) <= ((y - 1) / (cy - 1)) * r;
  if (!inBody && !inTip) return null;
  if ((x === 5 || x === 6) && y >= 8 && y <= 11) return W;
  return NEUTRAL.data;
};

/** Steep rise: red arrow pointing up and right. */
const arrowUpRight: Mask = (x, y) => {
  const shaft = Math.abs(x + y - 15) <= 1 && x >= 2 && x <= 11;
  const head = (y >= 1 && y <= 3 && x >= 7 && x <= 14) || (x >= 12 && x <= 14 && y >= 1 && y <= 8);
  return shaft || head ? STATE.critical : null;
};

/** Gauge: steel dial with a needle near full scale. */
const gauge: Mask = (x, y) => {
  const r = Math.hypot(x - 7.5, y - 9);
  if (y > 12 || r > 7.2) return null;
  if (r > 5.8) return NEUTRAL.steel;
  const needle = Math.abs((y - 9) * 0.9 + (x - 7.5) * 0.45) <= 0.7 && x >= 7 && y <= 9;
  if (needle) return W;
  return r < 1.2 ? W : NEUTRAL.graphite;
};

// ------------------------------------------------------------------ composition
interface IconSpec {
  base: (r: Raster) => void;
  /** origin of the voxel base inside the 48 px icon (logical units of the raster) */
  origin: [number, number];
  badges: { mask: Mask; at: [number, number] }[];
}

const RACK_O: [number, number] = [8.5, 16.5];
const B_MAIN: [number, number] = [28, 28];
const B_TOP: [number, number] = [29, 4];

export const ICON_SPECS: Record<string, IconSpec> = {
  normal: { base: (r) => rackBase(r, { lamp: STATE.normal }), origin: RACK_O, badges: [{ mask: shieldCheck, at: B_MAIN }] },
  "heat-up": { base: (r) => rackBase(r, { lamp: STATE.warning }), origin: RACK_O, badges: [{ mask: thermometer(0.6, STATE.warning), at: B_MAIN }] },
  critical: { base: (r) => rackBase(r, { lamp: STATE.critical, topLamp: STATE.critical }), origin: RACK_O, badges: [{ mask: thermometer(1, STATE.critical), at: B_MAIN }] },
  runaway: {
    base: (r) => rackBase(r, { topLamp: STATE.critical }),
    origin: RACK_O,
    badges: [
      { mask: thermometer(0.35, STATE.normal), at: B_MAIN },
      { mask: arrowUpRight, at: B_TOP },
    ],
  },
  leak: { base: rackPuddleBase, origin: RACK_O, badges: [{ mask: drop, at: B_MAIN }] },
  overload: { base: (r) => rackBase(r, { lamp: STATE.warning }), origin: RACK_O, badges: [{ mask: triangle(STATE.warning, "bolt"), at: B_MAIN }] },
  energy: { base: (r) => rackBase(r, { lamp: STATE.normal }), origin: RACK_O, badges: [{ mask: gauge, at: B_MAIN }] },
  "ecc-one": { base: chipBase, origin: [12, 12], badges: [{ mask: shieldCheck, at: B_MAIN }] },
  "ecc-two": { base: chipBase, origin: [12, 12], badges: [{ mask: crossBox, at: B_MAIN }] },
  "held-button": { base: (r) => buttonBase(r, true), origin: [10, 12.5], badges: [{ mask: lock, at: B_MAIN }] },
  invalid: { base: (r) => packetBase(r, false), origin: [11, 10], badges: [{ mask: triangle(STATE.warning, "bang"), at: B_MAIN }] },
  corrupt: { base: (r) => packetBase(r, true), origin: [11, 10], badges: [{ mask: crossBox, at: B_MAIN }] },
  "silent-leak": {
    base: connectorBase,
    origin: [9, 10],
    badges: [
      { mask: noSignal, at: B_TOP },
      { mask: drop, at: B_MAIN },
    ],
  },
};

function abgr(rgb: number) {
  return (0xff000000 | ((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 255)) >>> 0;
}

/** Render one icon into RGBA pixels (transparent background). */
export function renderIconPixels(id: string): Uint32Array | null {
  const spec = ICON_SPECS[id];
  if (!spec) return null;
  const N = ICON_SIZE;
  const r = new Raster(RS, spec.origin[0], spec.origin[1], N, N);
  r.clear(0);
  spec.base(r);
  const out = new Uint32Array(N * N);
  for (let i = 0; i < N * N; i++) out[i] = r.depth[i] > -1e8 ? r.color[i] : 0;
  // badges, each with an automatic one-pixel dark outline
  for (const { mask, at } of spec.badges) {
    const [bx, by] = at;
    const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && mask(x, y) !== null;
    for (let y = -1; y <= 16; y++)
      for (let x = -1; x <= 16; x++) {
        const px = bx + x, py = by + y;
        if (px < 0 || py < 0 || px >= N || py >= N) continue;
        const c = filled(x, y) ? mask(x, y) : null;
        if (c !== null) out[py * N + px] = abgr(c);
        else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) out[py * N + px] = abgr(NEUTRAL.outline);
      }
  }
  return out;
}

const cache = new Map<string, string>();

/** Data URL for a scenario icon, generated once per session. */
export function scenarioIconUrl(id: string): string | null {
  if (typeof document === "undefined") return null;
  const hit = cache.get(id);
  if (hit) return hit;
  const px = renderIconPixels(id);
  if (!px) return null;
  const c = document.createElement("canvas");
  c.width = c.height = ICON_SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(ICON_SIZE, ICON_SIZE);
  new Uint32Array(img.data.buffer).set(px);
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL("image/png");
  cache.set(id, url);
  return url;
}
