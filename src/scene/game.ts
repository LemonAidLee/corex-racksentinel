/**
 * Game loop: owns the canvas, the voxel layers, the operator and the camera.
 * It reads the simulation runtime every frame but never pushes per-frame data into React:
 * DOM overlays are positioned by writing transforms directly.
 *
 * Coordinates: camera, anchors and picking work in logical space (the 576 × 324 frame);
 * the raster renders that frame at a quality-dependent scale S.
 */
import type { SimulationRuntime } from "@/sim/runtime";
import { TEMP_CLASS } from "@/sim/controller";
import { Camera, type FocusName } from "./camera";
import { ANCHORS, AMBER_LAMP, BEACON, NAME_BY_OBJ, NODES, OBJ, OBJ_BY_NAME, ORIGIN, UART_PATH, type AnchorName, type Interactive } from "./layout";
import { createRoomDecals, drawDecal, type Decal } from "./decals";
import { drawChair, Operator, type Facing } from "./operator";
import { PAL } from "./palette";
import { LOGICAL_H, LOGICAL_W, QUALITY_SCALE, Raster, toABGR, type Quality } from "./raster";
import { buildStatic, drawBackgroundLeds, drawMonitor, drawRackDynamic, type RackLook } from "./world";

export interface GameCallbacks {
  onHover(target: Interactive | null): void;
  onActivate(target: Interactive): void;
  /** The renderer stepped quality down because frames were too slow. */
  onQualityFallback?(to: Quality): void;
}

interface AnchorReg {
  el: HTMLElement;
  at: AnchorName;
  /** Where the element sits relative to the anchor point. */
  place: "right" | "left" | "above" | "below" | "point";
  gap: number;
}

interface Pulse { t: number; dir: 1 | -1; color: number; reply?: number }

const PATH_LEN = (() => {
  const segs: number[] = [];
  for (let i = 1; i < UART_PATH.length; i++) {
    const [a, b] = [UART_PATH[i - 1], UART_PATH[i]];
    segs.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return { segs, total: segs.reduce((s, x) => s + x, 0) };
})();

function pathPoint(t: number): [number, number, number] {
  let d = Math.max(0, Math.min(1, t)) * PATH_LEN.total;
  for (let i = 0; i < PATH_LEN.segs.length; i++) {
    const L = PATH_LEN.segs[i];
    if (d <= L || i === PATH_LEN.segs.length - 1) {
      const k = L ? Math.min(1, d / L) : 0;
      const a = UART_PATH[i], b = UART_PATH[i + 1];
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
    d -= L;
  }
  return UART_PATH[UART_PATH.length - 1] as [number, number, number];
}

/** Rendering budget (ms of CPU per frame) before Sharp steps down to Balanced. */
const SLOW_FRAME_MS = 13;

export class Game {
  readonly operator: Operator;
  readonly camera = new Camera();
  reducedMotion = false;
  observer = false;
  quality: Quality;

  private ctx: CanvasRenderingContext2D;
  private off!: HTMLCanvasElement;
  private offCtx!: CanvasRenderingContext2D;
  private image!: ImageData;
  private base!: Raster;
  private work!: Raster;
  private outlineMarks!: Int32Array;
  private shimmerRow!: Uint32Array;
  private raf = 0;
  private last = 0;
  private time = 0;
  private fanAngle = 0;
  private flashT = 0;
  private pulses: Pulse[] = [];
  private hover: number = OBJ.NONE;
  private focusRing: number = OBJ.NONE;
  private anchors = new Map<HTMLElement, AnchorReg>();
  private cssW = 1;
  /** CSS px on the right covered by a docked HUD panel; the scene centres in the rest. */
  private inset = 0;
  private insetTarget = 0;
  private cssH = 1;
  private dpr = 1;
  private view = { cx: 0, cy: 0, scale: 1 };
  private chairFacing: Facing = "py";
  private returnToRoomAt = -1;
  private unsubs: (() => void)[] = [];
  private resizeObs: ResizeObserver;
  private hidden = false;
  private perf = { ema: 0, frames: 0, slowFor: 0 };
  private decals: Decal[] = [];

  constructor(private canvas: HTMLCanvasElement, private rt: SimulationRuntime, private cb: GameCallbacks, quality: Quality = "sharp") {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.quality = quality;
    this.allocate();

    this.operator = new Operator({
      onPressDown: () => this.rt.buttonDown(true),
      onPressUp: () => {
        this.rt.buttonUp();
        if (this.camera.focus === "button") this.returnToRoomAt = this.time + 1.8;
      },
      onRelease: () => this.rt.buttonUp(),
      isHeld: () => this.rt.p0Down,
    });

    // The scene's operator is the runtime's agent: manual clicks and scenario acknowledgements
    // both walk the same graph and press P0 through the same down/up calls.
    const op = this.operator;
    rt.agent = {
      pressReset: () => {
        if (this.observer) op.teleport("button");
        if (!this.observer) this.setFocus("button");
        op.pressButton();
      },
      cancel: () => op.cancel(),
      returnToDesk: () => {
        if (this.observer) op.teleport("seat");
        else op.goToDesk();
        if (this.camera.focus === "button") this.setFocus("room");
      },
      get busy() {
        return op.busy;
      },
    };

    const bus = rt.bus;
    this.unsubs.push(
      bus.on("telemetry", ({ result }) => {
        if (!this.reducedMotion) this.pulses.push({ t: 0, dir: 1, color: PAL.pulse, reply: result.reply[0] });
      }),
      bus.on("trip", () => {
        this.flashT = 1.2;
        if (!this.reducedMotion) this.camera.emphasize();
        this.operator.notice();
      }),
      bus.on("warning", () => this.operator.notice()),
      bus.on("scenario", ({ phase }) => {
        if (phase === "start" && !this.reducedMotion) this.camera.emphasize();
      }),
      bus.on("state", (s) => {
        const calm = !s.epo && s.tempClass === TEMP_CLASS.NORMAL && !s.overload;
        this.operator.setCalm(calm);
      }),
      bus.on("restart", () => {
        this.pulses = [];
        this.flashT = 0;
      }),
    );

    this.loadDecals();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();

    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("click", this.onClick);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** (Re)create every scale-dependent buffer and bake the static room. */
  private allocate(): void {
    const S = QUALITY_SCALE[this.quality];
    const w = Math.round(LOGICAL_W * S), h = Math.round(LOGICAL_H * S);
    this.off = document.createElement("canvas");
    this.off.width = w;
    this.off.height = h;
    this.offCtx = this.off.getContext("2d")!;
    this.image = this.offCtx.createImageData(w, h);
    this.base = new Raster(S, ORIGIN.ox, ORIGIN.oy, w, h);
    // the work raster writes straight into the ImageData: no per-frame copy
    this.work = new Raster(S, ORIGIN.ox, ORIGIN.oy, w, h, this.image.data.buffer);
    this.outlineMarks = new Int32Array(w * 8);
    this.shimmerRow = new Uint32Array(w);
    buildStatic(this.base);
    this.perf = { ema: 0, frames: 0, slowFor: 0 };
  }

  /** Letter the mat and plaque decals now, and again once the logo face has loaded. */
  private loadDecals(): void {
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-logo").trim() || "sans-serif";
    const build = () => {
      this.decals = createRoomDecals(family);
    };
    build();
    document.fonts?.load(`600 48px ${family}`).then(build, () => {});
    document.fonts?.load(`italic 800 48px ${family}`).then(build, () => {});
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.unsubs.forEach((u) => u());
    this.resizeObs.disconnect();
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("click", this.onClick);
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.rt.agent) this.rt.agent = null;
  }

  // ---------------------------------------------------------------- public API
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.allocate();
  }

  /** Reserve `px` CSS pixels on the right for a docked panel; the scene re-centres in the rest. */
  setViewInset(px: number): void {
    this.insetTarget = Math.max(0, Math.min(px, this.cssW * 0.5));
    if (this.reducedMotion || this.rt.paused) this.inset = this.insetTarget;
    this.camera.setDocked(this.insetTarget > 200, this.reducedMotion); // the rail alone does not re-frame
  }

  setFocus(name: FocusName, instant = false): void {
    this.returnToRoomAt = -1;
    if (this.observer) name = "observer";
    this.camera.setFocus(name, instant || this.reducedMotion);
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.operator.speedScale = on ? 2 : 1;
    if (on) this.pulses = [];
  }

  setObserver(on: boolean): void {
    this.observer = on;
    this.camera.setFocus(on ? "observer" : "room", true);
  }

  /** Keyboard focus ring drawn in the scene (mirrors the DOM hotspot that has focus). */
  setFocusRing(target: Interactive | null): void {
    this.focusRing = target ? OBJ_BY_NAME[target] : OBJ.NONE;
  }

  /** Reset the operator to the desk (simulation restart). */
  resetOperator(): void {
    this.operator.teleport("seat");
    this.operator.alert = false;
    this.operator.facing = "py";
    this.chairFacing = "py";
  }

  addAnchor(el: HTMLElement, at: AnchorName, place: AnchorReg["place"] = "point", gap = 16): () => void {
    this.anchors.set(el, { el, at, place, gap });
    this.placeAnchor(this.anchors.get(el)!);
    return () => this.anchors.delete(el);
  }

  /** CSS-pixel position of a world anchor. */
  anchorToCss(at: AnchorName): [number, number] {
    const [x, y, z] = ANCHORS[at];
    const [lx, ly] = this.work.projectLogical(x, y, z);
    const { cx, cy, scale } = this.view;
    return [this.viewW / 2 + (lx - cx) * scale, this.cssH / 2 + (ly - cy) * scale];
  }

  // ---------------------------------------------------------------- input
  private pick(e: PointerEvent | MouseEvent): number {
    const rect = this.canvas.getBoundingClientRect();
    const { cx, cy, scale } = this.view;
    const S = this.work.S, W = this.work.w, H = this.work.h;
    const bx = Math.floor((cx + (e.clientX - rect.left - this.viewW / 2) / scale) * S);
    const by = Math.floor((cy + (e.clientY - rect.top - this.cssH / 2) / scale) * S);
    if (bx < 0 || by < 0 || bx >= W || by >= H) return OBJ.NONE;
    const id = this.work.id[by * W + bx];
    if (id !== OBJ.NONE && id !== OBJ.OPERATOR) return id;
    // generous target for the small P0 button (touch and projector use)
    const R = Math.round(5 * S);
    for (let y = Math.max(0, by - R); y <= Math.min(H - 1, by + R); y++)
      for (let x = Math.max(0, bx - R); x <= Math.min(W - 1, bx + R); x++)
        if (this.work.id[y * W + x] === OBJ.BUTTON) return OBJ.BUTTON;
    return OBJ.NONE;
  }

  private onPointerMove = (e: PointerEvent) => {
    const id = this.pick(e);
    if (id !== this.hover) {
      this.hover = id;
      this.canvas.style.cursor = NAME_BY_OBJ[id] ? "pointer" : "default";
      this.cb.onHover(NAME_BY_OBJ[id] ?? null);
    }
  };

  private onPointerLeave = () => {
    if (this.hover !== OBJ.NONE) {
      this.hover = OBJ.NONE;
      this.cb.onHover(null);
    }
  };

  private onClick = (e: MouseEvent) => {
    const name = NAME_BY_OBJ[this.pick(e)];
    if (name) this.cb.onActivate(name);
  };

  private onVisibility = () => {
    this.hidden = document.hidden;
    if (!this.hidden) {
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
  }

  // ---------------------------------------------------------------- frame
  private frame = (now: number) => {
    if (this.hidden) return; // stop entirely while the tab is hidden
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const paused = this.rt.paused;

    if (!paused) {
      this.rt.advance(dt * 1000);
      this.time += dt;
      // ease the scene toward its new centre when a side panel docks or undocks
      if (this.inset !== this.insetTarget) {
        this.inset += (this.insetTarget - this.inset) * (this.reducedMotion ? 1 : 1 - Math.exp(-dt * 10));
        if (Math.abs(this.insetTarget - this.inset) < 0.5) this.inset = this.insetTarget;
      }
      this.operator.update(dt);
      if (this.returnToRoomAt > 0 && this.time >= this.returnToRoomAt && !this.operator.busy) {
        this.returnToRoomAt = -1;
        if (this.camera.focus === "button") this.setFocus("room");
      }
    }
    const t0 = performance.now();
    this.render(paused ? 0 : dt);
    const cam = this.camera.update(dt, this.reducedMotion);
    this.present(cam.cx, cam.cy, cam.zoom);
    this.watchPerformance(performance.now() - t0, dt);
    for (const a of this.anchors.values()) this.placeAnchor(a);
  };

  /** Step Sharp down to Balanced if rendering keeps exceeding the frame budget. */
  private watchPerformance(cost: number, dt: number): void {
    const p = this.perf;
    p.frames++;
    p.ema = p.frames === 1 ? cost : p.ema * 0.95 + cost * 0.05;
    if (this.quality !== "sharp" || p.frames < 90) return;
    p.slowFor = p.ema > SLOW_FRAME_MS ? p.slowFor + dt : 0;
    if (p.slowFor > 2.5) {
      this.setQuality("balanced");
      this.cb.onQualityFallback?.("balanced");
    }
  }

  private look(): RackLook {
    const s = this.rt.controller.state;
    const fanLevel = s.tempClass === TEMP_CLASS.CRITICAL ? 2 : s.tempClass === TEMP_CLASS.WARM ? 1 : 0;
    const anyCrit = s.epo || s.tempClass === TEMP_CLASS.CRITICAL;
    const anyWarn = s.tempClass === TEMP_CLASS.WARM || s.overload;
    return {
      time: this.time,
      tempClass: s.tempClass,
      overload: s.overload,
      epo: s.epo,
      fanAngle: this.fanAngle,
      fanLevel,
      ledRate: this.reducedMotion ? 1 : 5,
      flash: !this.reducedMotion && this.flashT > 0 && Math.floor(this.flashT * 6) % 2 === 0,
      capPressed: this.rt.p0Down,
      capHeld: this.rt.p0Down && !this.operator.pressing,
      monitorState: anyCrit ? "crit" : anyWarn ? "warn" : "ok",
      monitorEpo: s.epo,
      readings: { v: s.voltage, i: s.latestCurrent, t: s.latestTemp, got: s.gotTemp },
      linkSilent: !this.rt.streaming,
    };
  }

  private render(dt: number): void {
    const s = this.rt.controller.state;
    const L = this.look();
    const speed = [0.6, 1.7, 3.6][L.fanLevel] * (this.reducedMotion ? 0.35 : 1);
    this.fanAngle = (this.fanAngle + dt * speed * Math.PI * 2) % (Math.PI * 2);
    this.flashT = Math.max(0, this.flashT - dt);

    const r = this.work;
    const S = r.S;
    r.copyFrom(this.base);

    // contact shadows for the chair and the operator (floor pixels only)
    const op = this.operator;
    const shadowAt = (x: number, y: number, radius: number, k: number) => {
      const [sx, sy] = r.project(x, y, 0);
      r.darken(sx, sy, radius * 1.41 * S, radius * 0.71 * S, k, OBJ.NONE);
    };
    shadowAt(NODES.seat.x, NODES.seat.y, 7.5, 0.78);
    if (op.pose !== "sit") shadowAt(op.x, op.y, 6, 0.72);

    // chair, Rack A moving parts, background idle LEDs, monitor, operator
    if (op.pose === "sit") this.chairFacing = op.facing;
    drawChair(r, NODES.seat.x, NODES.seat.y, this.chairFacing);
    drawRackDynamic(r, L);
    drawBackgroundLeds(r, this.time, this.reducedMotion);
    drawMonitor(r, L);
    op.draw(r, this.time, this.reducedMotion);

    // lights: hard-banded pools, no gradients
    const [bx, by] = r.project(BEACON.x + 3, BEACON.y + 3, 86);
    if (s.epo) r.lightPool(bx, by + 12 * S, 58 * S, 34 * S, PAL.crit, L.flash ? 0.26 : 0.14, 3);
    const [ax, ay] = r.project(AMBER_LAMP.x + 3, AMBER_LAMP.y + 3, 84);
    if (s.overload) r.lightPool(ax, ay + 6 * S, 40 * S, 22 * S, PAL.warn, 0.13, 3);
    if (s.tempClass === TEMP_CLASS.WARM) {
      const [fx, fy] = r.project(100, 30, 30);
      r.lightPool(fx, fy, 38 * S, 48 * S, PAL.warn, 0.07, 2);
    }
    const [mx, my] = r.project(12, 76, 38);
    const monColor = L.monitorState === "crit" ? PAL.crit : L.monitorState === "warn" ? PAL.warn : 0x6fa8c8;
    r.lightPool(mx + 6 * S, my + 6 * S, 30 * S, 18 * S, monColor, 0.07, 2);

    // UART pulses along the cable tray (outbound packet, then the reply)
    if (this.pulses.length) this.drawPulses(r, dt);

    // heat shimmer above the rack while the real (external) temperature is above 32.0 °C
    if (!this.reducedMotion && this.rt.conditions.tempRaw > 64) this.shimmer(r);

    // hover / keyboard focus outline
    const hl = this.focusRing || this.hover;
    if (hl) r.outline(hl, PAL.highlight, this.outlineMarks);
  }

  private drawPulses(r: Raster, dt: number): void {
    const S = r.S;
    let n = 0;
    for (const p of this.pulses) {
      p.t += dt / 0.45;
      if (p.t >= 1) {
        if (p.dir === 1 && p.reply !== undefined) this.pulses[n++] = { t: 0, dir: -1, color: p.reply === 0xa5 ? PAL.pulse : PAL.warn };
      } else this.pulses[n++] = p;
    }
    this.pulses.length = n;
    for (const p of this.pulses) {
      const [x, y, z] = pathPoint(p.dir === 1 ? p.t : 1 - p.t);
      const [sx, sy] = r.project(x, y, z);
      const depth = x + y + z;
      const size = Math.max(1, Math.round((p.dir === 1 ? 2 : 1.25) * S));
      const col = toABGR(p.color);
      for (let oy = 0; oy < size; oy++)
        for (let ox = 0; ox < size; ox++) {
          const px = Math.floor(sx - size / 2) + ox, py = Math.floor(sy - size / 2) + oy;
          if (px < 0 || py < 0 || px >= r.w || py >= r.h) continue;
          const i = py * r.w + px;
          if (r.depth[i] > depth + 2) continue;
          r.color[i] = col;
        }
    }
  }

  private shimmer(r: Raster): void {
    const S = r.S, W = r.w;
    const [x0] = r.project(86, 26, 80);
    const [x1] = r.project(114, 0, 80);
    const [, top] = r.project(100, 12, 90);
    const row = this.shimmerRow;
    for (let y = Math.max(0, Math.floor(top - 34 * S)); y < Math.floor(top - 4 * S); y++) {
      const shift = Math.round(Math.sin(this.time * 7 + (y / S) * 0.9) * 1.2 * S);
      if (!shift) continue;
      const off = y * W;
      row.set(r.color.subarray(off, off + W));
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
        const sx = x - shift;
        if (sx >= 0 && sx < W) r.color[off + x] = row[sx];
      }
    }
  }

  /** Width of the visible scene area (the canvas minus a docked panel on the right). */
  private get viewW(): number {
    return Math.max(1, this.cssW - this.inset);
  }

  private present(cx: number, cy: number, zoom: number): void {
    this.offCtx.putImageData(this.image, 0, 0);
    const fit = Math.min(this.viewW / LOGICAL_W, this.cssH / LOGICAL_H);
    // portrait screens (tablets) would leave the room tiny: frame it tighter
    const portrait = !this.observer && this.cssH > this.viewW ? 1.32 : 1;
    const scale = fit * zoom * portrait; // CSS px per logical px
    this.view = { cx, cy, scale };

    const ctx = this.ctx;
    const d = this.dpr;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0e1115";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const s = scale * d;
    // snap the destination origin to device pixels to avoid shimmering seams
    const dx = Math.round((this.viewW * d) / 2 - cx * s);
    const dy = Math.round(this.canvas.height / 2 - cy * s);
    ctx.drawImage(this.off, dx, dy, Math.round(LOGICAL_W * s), Math.round(LOGICAL_H * s));
    // printed lettering on the door mat and team plaque, at screen resolution
    for (const decal of this.decals) drawDecal(ctx, decal, dx, dy, s);
  }

  private placeAnchor(a: AnchorReg): void {
    const [x, y] = this.anchorToCss(a.at);
    const el = a.el;
    let left = x, top = y;
    if (a.place !== "point") {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (a.place === "right") { left = x + a.gap; top = y - h / 2; }
      else if (a.place === "left") { left = x - a.gap - w; top = y - h / 2; }
      else if (a.place === "above") { left = x - w / 2; top = y - a.gap - h; }
      else { left = x - w / 2; top = y + a.gap; }
      const m = 12;
      const topSafe = 92, bottomSafe = 64;
      left = Math.max(m, Math.min(this.viewW - w - m, left));
      top = Math.max(topSafe, Math.min(this.cssH - h - bottomSafe, top));
    }
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }
}
