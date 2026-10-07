/**
 * Isometric voxel rasterizer with a configurable render scale.
 *
 * World axes: x runs down-right, y runs down-left, z is up. World units never change with
 * quality; the raster maps them to pixels through a render scale S:
 *     sx = S · (ox + x − y)        sy = S · (oy + (x + y) / 2 − z)
 * Logical space is the S = 1 frame (576 × 324). Camera, anchors and picking work in logical
 * space; only the raster knows about S. The camera looks along (−1, −1, −1), so only the +z
 * (top), +y (left-front) and +x (right-front) faces are visible and depth is x + y + z.
 *
 * Each pixel centre is intersected with the visible faces of a box, which gives exact,
 * gap-free, hard-edged faces, a z-buffer and an object-id buffer at any scale.
 * Textures receive continuous world coordinates and the size of one texel (1 / S), so
 * procedural detail resolves more finely at higher quality instead of merely shrinking.
 */

/** Logical frame, sized to hold the three-rack room at the default framing. */
export const LOGICAL_W = 576;
export const LOGICAL_H = 324;

export type Quality = "performance" | "balanced" | "sharp";
/** Raster widths per quality: 480 × 270, 720 × 405 and 960 × 540 pixels. */
const RASTER_W: Record<Quality, number> = { performance: 480, balanced: 720, sharp: 960 };
export const QUALITY_SCALE: Record<Quality, number> = {
  performance: RASTER_W.performance / LOGICAL_W,
  balanced: RASTER_W.balanced / LOGICAL_W,
  sharp: RASTER_W.sharp / LOGICAL_W,
};
export const QUALITY_LABEL: Record<Quality, string> = { performance: "Performance", balanced: "Balanced", sharp: "Sharp" };
export const rasterSize = (q: Quality) => [Math.round(LOGICAL_W * QUALITY_SCALE[q]), Math.round(LOGICAL_H * QUALITY_SCALE[q])] as const;
export const QUALITY_SIZE = (q: Quality) => rasterSize(q).join("×");

/** 0 = top (+z), 1 = left-front (+y), 2 = right-front (+x). */
export type Face = 0 | 1 | 2;

/** Bit flag on a texel colour: draw at full brightness, ignore face shading. */
export const EMISSIVE = 0x1000000;
/** Return from a texture to leave the pixel untouched (cut-outs). */
export const CLEAR = -1;

/**
 * Texture callback, all in world units. `u` runs left→right on screen and `v` top→bottom
 * (for the top face, v runs from the back edge toward the viewer). `w`, `h` are the face size
 * and `t` the size of one texel, useful for exactly-one-pixel lines at any quality.
 */
export type Tex = (face: Face, u: number, v: number, w: number, h: number, t: number) => number;

export interface Box {
  x: number;
  y: number;
  z: number;
  w: number; // extent along x
  d: number; // extent along y
  h: number; // extent along z
  tex: Tex | number;
  id?: number;
}

const FACE_SHADE: [number, number, number] = [1, 0.8, 0.62];
const MAX_IDS = 8;

export function shade(rgb: number, k: number): number {
  const r = Math.min(255, Math.round(((rgb >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((rgb >> 8) & 255) * k));
  const b = Math.min(255, Math.round((rgb & 255) * k));
  return (r << 16) | (g << 8) | b;
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** RGB → little-endian ABGR for ImageData's Uint32 view. */
export const toABGR = (rgb: number) => (0xff000000 | ((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 255)) >>> 0;

export class Raster {
  readonly w: number;
  readonly h: number;
  readonly color: Uint32Array;
  readonly depth: Float32Array;
  readonly id: Uint8Array;
  /** Per-id screen bounding boxes [x0, y0, x1, y1], kept for fast outlines. */
  readonly bounds = new Int32Array(MAX_IDS * 4);

  /**
   * @param S render scale (pixels per logical pixel)
   * @param colorBuffer optional backing store, e.g. an ImageData buffer, to avoid a copy per frame
   */
  constructor(readonly S: number, readonly ox: number, readonly oy: number, w = Math.round(LOGICAL_W * S), h = Math.round(LOGICAL_H * S), colorBuffer?: ArrayBuffer) {
    this.w = w;
    this.h = h;
    this.color = colorBuffer ? new Uint32Array(colorBuffer) : new Uint32Array(w * h);
    this.depth = new Float32Array(w * h);
    this.id = new Uint8Array(w * h);
    this.resetBounds();
  }

  private resetBounds(): void {
    for (let i = 0; i < MAX_IDS; i++) this.bounds.set([1e9, 1e9, -1, -1], i * 4);
  }

  /** World size of one pixel. */
  get t(): number {
    return 1 / this.S;
  }

  clear(bg: number): void {
    this.color.fill(toABGR(bg));
    this.depth.fill(-1e9);
    this.id.fill(0);
    this.resetBounds();
  }

  copyFrom(src: Raster): void {
    this.color.set(src.color);
    this.depth.set(src.depth);
    this.id.set(src.id);
    this.bounds.set(src.bounds);
  }

  /** World → raster pixels. */
  project(x: number, y: number, z: number): [number, number] {
    return [this.S * (this.ox + (x - y)), this.S * (this.oy + (x + y) / 2 - z)];
  }

  /** World → logical pixels (scale independent: camera, anchors). */
  projectLogical(x: number, y: number, z: number): [number, number] {
    return [this.ox + (x - y), this.oy + (x + y) / 2 - z];
  }

  drawBox(b: Box): void {
    const { ox, oy, S, w: W, h: H } = this;
    const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.d, z0 = b.z, z1 = b.z + b.h;
    const tex = b.tex;
    const id = b.id ?? 0;
    const t = 1 / S;

    const pxMin = Math.max(0, Math.floor(S * (ox + x0 - y1)));
    const pxMax = Math.min(W - 1, Math.ceil(S * (ox + x1 - y0)));
    const pyMin = Math.max(0, Math.floor(S * (oy + (x0 + y0) / 2 - z1)));
    const pyMax = Math.min(H - 1, Math.ceil(S * (oy + (x1 + y1) / 2 - z0)));
    const E = 1e-6;
    let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;

    for (let py = pyMin; py <= pyMax; py++) {
      const Y = (py + 0.5) / S - oy;
      for (let px = pxMin; px <= pxMax; px++) {
        const X = (px + 0.5) / S - ox;
        let best = -1e9;
        let face: Face = 0;
        let fu = 0, fv = 0;

        // top: z = z1
        {
          const s = 2 * (Y + z1);
          const x = (X + s) / 2, y = (s - X) / 2;
          if (x >= x0 - E && x < x1 - E && y >= y0 - E && y < y1 - E) {
            best = x + y + z1; face = 0; fu = x - x0; fv = y - y0;
          }
        }
        // left-front: y = y1
        {
          const x = X + y1;
          const z = (x + y1) / 2 - Y;
          if (x >= x0 - E && x < x1 - E && z > z0 + E && z <= z1 + E) {
            const dd = x + y1 + z;
            if (dd > best) { best = dd; face = 1; fu = x - x0; fv = z1 - z; }
          }
        }
        // right-front: x = x1
        {
          const y = x1 - X;
          const z = (x1 + y) / 2 - Y;
          if (y > y0 + E && y <= y1 + E && z > z0 + E && z <= z1 + E) {
            const dd = x1 + y + z;
            if (dd > best) { best = dd; face = 2; fu = y1 - y; fv = z1 - z; }
          }
        }
        if (best === -1e9) continue;
        const i = py * W + px;
        if (best <= this.depth[i]) continue;

        let c: number;
        if (typeof tex === "number") {
          c = tex;
        } else {
          const fw = face === 2 ? b.d : b.w;
          const fh = face === 0 ? b.d : b.h;
          c = tex(face, Math.min(fw - E, Math.max(0, fu)), Math.min(fh - E, Math.max(0, fv)), fw, fh, t);
          if (c === CLEAR) continue;
        }
        const rgb = c & EMISSIVE ? c & 0xffffff : shade(c, FACE_SHADE[face]);
        this.color[i] = toABGR(rgb);
        this.depth[i] = best;
        this.id[i] = id;
        if (id) {
          if (px < bx0) bx0 = px;
          if (px > bx1) bx1 = px;
          if (py < by0) by0 = py;
          if (py > by1) by1 = py;
        }
      }
    }
    if (id && bx1 >= 0) {
      const k = id * 4, B = this.bounds;
      B[k] = Math.min(B[k], bx0); B[k + 1] = Math.min(B[k + 1], by0);
      B[k + 2] = Math.max(B[k + 2], bx1); B[k + 3] = Math.max(B[k + 3], by1);
    }
  }

  /** Additive, hard-banded light pool centred on a raster point (no smooth gradients). */
  lightPool(cx: number, cy: number, rx: number, ry: number, rgb: number, strength: number, bands = 3): void {
    if (strength <= 0) return;
    const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
    const xMin = Math.max(0, Math.floor(cx - rx)), xMax = Math.min(this.w - 1, Math.ceil(cx + rx));
    const yMin = Math.max(0, Math.floor(cy - ry)), yMax = Math.min(this.h - 1, Math.ceil(cy + ry));
    for (let y = yMin; y <= yMax; y++) {
      const dy = (y + 0.5 - cy) / ry;
      for (let x = xMin; x <= xMax; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dist = dx * dx + dy * dy;
        if (dist >= 1) continue;
        const k = (Math.ceil((1 - Math.sqrt(dist)) * bands) / bands) * strength;
        const i = y * this.w + x;
        const c = this.color[i];
        const cr = Math.min(255, (c & 255) + r * k);
        const cg = Math.min(255, ((c >> 8) & 255) + g * k);
        const cb = Math.min(255, ((c >> 16) & 255) + b * k);
        this.color[i] = (0xff000000 | (cb << 16) | (cg << 8) | cr) >>> 0;
      }
    }
  }

  /** Multiply pixels inside an ellipse by `k` (banded), optionally only where id matches. */
  darken(cx: number, cy: number, rx: number, ry: number, k: number, onlyId = -1): void {
    const xMin = Math.max(0, Math.floor(cx - rx)), xMax = Math.min(this.w - 1, Math.ceil(cx + rx));
    const yMin = Math.max(0, Math.floor(cy - ry)), yMax = Math.min(this.h - 1, Math.ceil(cy + ry));
    for (let y = yMin; y <= yMax; y++) {
      const dy = (y + 0.5 - cy) / ry;
      for (let x = xMin; x <= xMax; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const d = dx * dx + dy * dy;
        if (d >= 1) continue;
        const i = y * this.w + x;
        if (onlyId >= 0 && this.id[i] !== onlyId) continue;
        const m = d < 0.45 ? k : (1 + k) / 2;
        const c = this.color[i];
        this.color[i] = (0xff000000 | (Math.round(((c >> 16) & 255) * m) << 16) | (Math.round(((c >> 8) & 255) * m) << 8) | Math.round((c & 255) * m)) >>> 0;
      }
    }
  }

  /** Inner outline around every pixel carrying `targetId`; thickness grows with scale. */
  outline(targetId: number, rgb: number, marks: Int32Array): void {
    const k = targetId * 4, B = this.bounds;
    if (B[k + 2] < 0) return;
    const ids = this.id, W = this.w;
    const T = Math.max(1, Math.round(this.S * 0.75));
    const col = toABGR(rgb);
    let n = 0;
    for (let y = Math.max(T, B[k + 1]); y <= Math.min(this.h - 1 - T, B[k + 3]); y++) {
      for (let x = Math.max(T, B[k]); x <= Math.min(W - 1 - T, B[k + 2]); x++) {
        const i = y * W + x;
        if (ids[i] !== targetId) continue;
        let edge = false;
        for (let d = 1; d <= T && !edge; d++) {
          edge = ids[i - d] !== targetId || ids[i + d] !== targetId || ids[i - d * W] !== targetId || ids[i + d * W] !== targetId;
        }
        if (edge && n < marks.length) marks[n++] = i;
      }
    }
    for (let j = 0; j < n; j++) this.color[marks[j]] = col;
  }
}

/** Deterministic per-cell hash in [0, 1). */
export function hash2(u: number, v: number, seed = 0): number {
  let h = (u * 374761393 + v * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
