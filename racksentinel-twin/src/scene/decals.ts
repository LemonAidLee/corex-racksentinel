/**
 * Printed decals: lettering too fine for the voxel raster (the ChampionCHIP eXperience door mat
 * and the CoreX team plaque). Each decal is a small offscreen canvas, lettered once, then drawn
 * every frame onto its surface with the isometric projection as an affine transform. The mat and
 * plaque themselves stay in the raster; only their lettering is drawn here. Nothing passes in
 * front of either surface, so they need no depth test.
 */
import { DOOR_MAT, ORIGIN, TEAM_SIGN } from "./layout";

type Vec3 = readonly [number, number, number];

export interface Decal {
  img: HTMLCanvasElement;
  /** World position of the image's top-left pixel. */
  origin: Vec3;
  /** World step for one image pixel to the right, and one pixel down. */
  right: Vec3;
  down: Vec3;
  alpha: number;
}

/** Image pixels per world unit: fine enough to read, coarse enough to sit with the pixel art. */
const RES = 9;

/** Logo palette sampled from the competition artwork: yellow-orange top, orange, red foot. */
const FIRE = ["#ffc93f", "#ff8a22", "#f45a1a", "#cf2419"] as const;

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Deterministic pseudo-random sequence so the cracks are identical on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}

/** Fill the text already set on `ctx` with the fiery gradient, lava cracks and embers. */
function fireText(ctx: CanvasRenderingContext2D, text: string, x: number, baseline: number, size: number, seed: number) {
  const top = baseline - size * 0.74, bottom = baseline + size * 0.02;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  FIRE.forEach((c, i) => g.addColorStop(i / (FIRE.length - 1), c));
  const w = ctx.measureText(text).width;

  // letters on their own layer so cracks and embers stay inside the strokes
  const layer = canvas(ctx.canvas.width, ctx.canvas.height);
  const l = layer.getContext("2d")!;
  l.font = ctx.font;
  l.textBaseline = "alphabetic";
  l.fillStyle = g;
  l.fillText(text, x, baseline);
  l.globalCompositeOperation = "source-atop";
  const r = rng(seed);
  // dark cracked texture: short jagged polylines
  l.strokeStyle = "rgba(92, 16, 8, 0.8)";
  l.lineWidth = Math.max(1, size * 0.035);
  for (let i = 0; i < Math.round(w / (size * 0.16)); i++) {
    let px = x + r() * w, py = top + r() * (bottom - top);
    l.beginPath();
    l.moveTo(px, py);
    for (let k = 0; k < 3; k++) {
      px += (r() - 0.5) * size * 0.35;
      py += (r() - 0.5) * size * 0.3;
      l.lineTo(px, py);
    }
    l.stroke();
  }
  // hot embers
  l.fillStyle = "rgba(255, 228, 140, 0.85)";
  for (let i = 0; i < Math.round(w / (size * 0.22)); i++) {
    const s = Math.max(1, size * (0.03 + r() * 0.03));
    l.fillRect(x + r() * w, top + r() * (bottom - top) * 0.7, s, s);
  }
  // a faint warm glow under the letters, as in the artwork
  ctx.save();
  ctx.shadowColor = "rgba(255, 96, 24, 0.45)";
  ctx.shadowBlur = size * 0.18;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/**
 * Letter onto a padded scratch canvas, then crop to the visible ink and place it centred in a
 * `w` × `h` canvas, scaled down if needed to fit `fit` of each side. Centring on real ink (not
 * font metrics) keeps descenders, italics and the glow from pulling the lettering off-centre.
 */
function centred(w: number, h: number, fit: [number, number], paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
  const pad = Math.round(Math.max(w, h) * 0.25);
  const scratch = canvas(w + pad * 2, h + pad * 2);
  const sctx = scratch.getContext("2d")!;
  sctx.translate(pad, pad);
  paint(sctx, w, h);
  const { data, width, height } = sctx.getImageData(0, 0, scratch.width, scratch.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 96) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const out = canvas(w, h);
  if (x1 < 0) return out;
  const iw = x1 - x0 + 1, ih = y1 - y0 + 1;
  const k = Math.min(1, (out.width * fit[0]) / iw, (out.height * fit[1]) / ih);
  const dw = iw * k, dh = ih * k;
  // keep a small margin so the soft glow outside the ink box is not cut at the canvas edge
  const m = Math.round(Math.max(w, h) * 0.04);
  out.getContext("2d")!.drawImage(scratch, x0 - m, y0 - m, iw + m * 2, ih + m * 2, (out.width - dw) / 2 - m * k, (out.height - dh) / 2 - m * k, dw + m * 2 * k, dh + m * 2 * k);
  return out;
}

/** "ChampionCHIP / eXperience" on two lines, centred in the mat's printable area. */
function logoCanvas(family: string, wUnits: number, hUnits: number): HTMLCanvasElement {
  return centred(Math.round(wUnits * RES), Math.round(hUnits * RES), [0.94, 0.84], (ctx, w, h) => paintLogo(ctx, family, w, h));
}

function paintLogo(ctx: CanvasRenderingContext2D, family: string, cw: number, ch: number): void {
  const c = { width: cw, height: ch };
  const lines = ["ChampionCHIP", "eXperience"];
  let size = c.height * 0.4;
  ctx.font = `600 ${size}px ${family}`;
  const widest = Math.max(...lines.map((t) => ctx.measureText(t).width));
  size = Math.min(size, (size * c.width * 0.94) / widest);
  ctx.font = `600 ${size}px ${family}`;
  const lead = size * 1.02;
  const first = (c.height - lead) / 2 + size * 0.72;
  lines.forEach((t, i) => fireText(ctx, t, (c.width - ctx.measureText(t).width) / 2, first + i * lead, size, 17 + i));
}

/** "CoreX": light steel letters, a fiery X, a thin ember rule beneath; centred on the plaque. */
function teamCanvas(family: string, wUnits: number, hUnits: number): HTMLCanvasElement {
  return centred(Math.round(wUnits * RES), Math.round(hUnits * RES), [0.86, 0.78], (ctx, w, h) => paintTeam(ctx, family, w, h));
}

function paintTeam(ctx: CanvasRenderingContext2D, family: string, cw: number, ch: number): void {
  const c = { width: cw, height: ch };
  let size = c.height * 0.62;
  ctx.font = `italic 800 ${size}px ${family}`;
  const full = ctx.measureText("CoreX").width;
  size = Math.min(size, (size * c.width * 0.86) / full);
  ctx.font = `italic 800 ${size}px ${family}`;
  const core = ctx.measureText("Core").width, total = ctx.measureText("CoreX").width;
  const x = (c.width - total) / 2, base = c.height * 0.62 + size * 0.2;
  ctx.fillStyle = "#e3e9ee";
  ctx.fillText("Core", x, base);
  fireText(ctx, "X", x + core, base, size, 5);
  ctx.fillStyle = "rgba(244, 90, 26, 0.8)";
  ctx.fillRect(x + size * 0.1, base + size * 0.14, total - size * 0.1, Math.max(1, size * 0.06));
}

/** Build the room's decals. `family` is the CSS font-family list of the logo face. */
export function createRoomDecals(family: string): Decal[] {
  // door mat: printable area inside the bound edge; text reads along the mat toward the back
  // wall (up-right on screen) with its top edge toward the door
  const m = { x0: DOOR_MAT.x + 1.6, x1: DOOR_MAT.x + DOOR_MAT.w - 1.6, y0: DOOR_MAT.y + 1.6, y1: DOOR_MAT.y + DOOR_MAT.d - 1.6 };
  const mat = logoCanvas(family, m.y1 - m.y0, m.x1 - m.x0);
  // plaque: front face, inside its rim
  const p = { x0: TEAM_SIGN.x + 1, x1: TEAM_SIGN.x + TEAM_SIGN.w - 1, z0: TEAM_SIGN.z + 1, z1: TEAM_SIGN.z + TEAM_SIGN.h - 1 };
  const team = teamCanvas(family, p.x1 - p.x0, p.z1 - p.z0);
  const k = 1 / RES;
  return [
    { img: mat, origin: [m.x0, m.y1, 0.42], right: [0, -k, 0], down: [k, 0, 0], alpha: 0.94 },
    { img: team, origin: [p.x0, TEAM_SIGN.y + TEAM_SIGN.d + 0.01, p.z1], right: [k, 0, 0], down: [0, 0, -k], alpha: 1 },
  ];
}

/** World vector → logical-pixel vector (the linear part of the projection). */
const lin = (v: Vec3): [number, number] => [v[0] - v[1], (v[0] + v[1]) / 2 - v[2]];

/**
 * Draw a decal onto the presented canvas. `dx`, `dy` are the device position of logical (0, 0)
 * and `s` the device pixels per logical pixel, exactly as the room raster is drawn.
 */
export function drawDecal(ctx: CanvasRenderingContext2D, d: Decal, dx: number, dy: number, s: number): void {
  const [ox, oy] = lin(d.origin);
  const [rx, ry] = lin(d.right);
  const [vx, vy] = lin(d.down);
  ctx.save();
  ctx.globalAlpha = d.alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(s * rx, s * ry, s * vx, s * vy, dx + s * (ORIGIN.ox + ox), dy + s * (ORIGIN.oy + oy));
  ctx.drawImage(d.img, 0, 0);
  ctx.restore();
}
