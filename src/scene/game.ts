/**
 * Game loop: owns the canvas, the voxel layers, the operator and the camera.
 * It reads the simulation runtime every frame but never pushes per-frame data into React:
 * DOM overlays are positioned by writing transforms directly.
 *
 * Coordinates: camera, anchors and picking work in logical space (the 576 × 324 frame);
 * the raster renders that frame at a quality-dependent scale S.
 */
import type { SimulationRuntime } from "@/sim/runtime";
import { CFG, TEMP_CLASS, settingsView } from "@/sim/controller";
import { INPUT } from "@/sim/protocol";
import { Camera, type FocusName } from "./camera";
import { ANCHORS, AMBER_LAMP, BEACON, NAME_BY_OBJ, NODES, OBJ, OBJ_BY_NAME, ORIGIN, UART_PATH, type AnchorName, type Interactive } from "./layout";
import { createRoomDecals, drawDecal, type Decal } from "./decals";
import { drawChair, Operator, type Facing } from "./operator";
import { PAL } from "./palette";
import { LOGICAL_H, LOGICAL_W, QUALITY_SCALE, Raster, hash2, toABGR, type Quality } from "./raster";
import { buildStatic, drawBackgroundLeds, drawMonitor, drawRackDynamic, type RackLook } from "./world";

/** Scene sounds that come from animation rather than from the controller. */
export type SceneCue = "step" | "chair";

export interface GameCallbacks {
  onHover(target: Interactive | null): void;
  onActivate(target: Interactive): void;
  /** The renderer stepped quality down because frames were too slow. */
  onQualityFallback?(to: Quality): void;
  onCue?(cue: SceneCue): void;
}

/**
 * Room mood, eased toward the controller state every frame so lighting changes are felt rather
 * than read: alarms rise quickly, recovery fades out in slow stages.
 */
interface Mood {
  warm: number;
  crit: number;
  /** P6 power overload. */
  current: number;
  /** Water on the leak sensor (P1). */
  leak: number;
  epo: number;
  /** UART link indicator. */
  link: number;
}

/** The director uses centred framings; the plain ones leave room for an inspection panel. */
const INCIDENT_FRAMING: Partial<Record<FocusName, FocusName>> = { rack: "incidentRack", desk: "incidentDesk", button: "incidentButton" };

/** Seconds a followed incident framing is held before the next one may replace it. */
const FOLLOW_HOLD_S = 2.2;

interface AnchorReg {
  el: HTMLElement;
  at: AnchorName;
  /** Where the element sits relative to the anchor point. */
  place: "right" | "left" | "above" | "below" | "point";
  gap: number;
}

interface Pulse { t: number; dir: 1 | -1; color: number; reply?: number }
/** A rejected packet bursting at the controller end of the cable tray. */
interface Burst { t: number }

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
  private bursts: Burst[] = [];
  private mood: Mood = { warm: 0, crit: 0, current: 0, leak: 0, epo: 0, link: 0 };
  private beaconAngle = 0;
  private glitchT = 0;
  /** Incident-following camera: on by default, never under reduced motion. */
  follow = true;
  /** A panel the user opened owns the camera; the director stays out of the way. */
  private userLock = false;
  private followUntil = 0;
  private followNext: FocusName | null = null;
  private autoReturnAt = -1;
  private wasStreaming = true;
  private frameHooks = new Set<() => void>();
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
        if (this.camera.focus === "button" || this.camera.focus === "incidentButton") this.returnToRoomAt = this.time + 1.8;
      },
      onRelease: () => this.rt.buttonUp(),
      isHeld: () => this.rt.p0Down,
      onStep: () => this.cb.onCue?.("step"),
      onChair: () => this.cb.onCue?.("chair"),
    });

    // The scene's operator is the runtime's agent: manual clicks and scenario acknowledgements
    // both walk the same graph and press P0 through the same down/up calls.
    const op = this.operator;
    rt.agent = {
      pressReset: () => {
        if (this.observer) op.teleport("button");
        this.direct("button", true);
        op.pressButton();
      },
      cancel: () => op.cancel(),
      returnToDesk: () => {
        if (this.observer) op.teleport("seat");
        else op.goToDesk(true);
        if (this.camera.focus === "button" || this.camera.focus === "incidentButton") this.setFocus("room");
      },
      get busy() {
        return op.busy;
      },
    };

    // Incident choreography: every reaction below follows a real controller event.
    const bus = rt.bus;
    this.unsubs.push(
      bus.on("telemetry", ({ result }) => {
        if (!this.reducedMotion) this.pulses.push({ t: 0, dir: 1, color: PAL.pulse, reply: result.reply[0] });
        if (result.outcome === "bad-crc" || result.outcome === "invalid") {
          this.glitchT = 0.8;
          // look at the terminal that sent it, then back to whatever is still wrong
          this.direct("desk", true);
          this.followNext = this.rt.controller.state.epo ? "rack" : "room";
        }
      }),
      bus.on("trip", () => {
        this.flashT = 1.2;
        if (!this.reducedMotion) this.camera.emphasize();
        this.operator.notice();
        if (!this.observer) this.operator.respond();
        this.direct("rack", true);
      }),
      bus.on("warning", () => {
        this.operator.notice();
        this.direct("rack");
      }),
      bus.on("scenario", ({ phase }) => {
        if (phase === "start") {
          if (!this.reducedMotion) this.camera.emphasize();
          this.direct("room", true);
        } else {
          // finished: hold the last framing a moment, then show the whole room again
          this.followUntil = this.time + 1.5;
          this.followNext = "room";
        }
      }),
      bus.on("reset", ({ outcome }) => {
        // free play: nobody coordinates the recovery, so the operator checks the rack and goes back
        if (outcome === "accepted" && this.rt.recovery.phase === "idle") this.autoReturnAt = this.time + 2.2;
      }),
      bus.on("state", (s) => {
        const calm = !s.epo && s.tempClass === TEMP_CLASS.NORMAL && !s.overload && !(s.inputs & INPUT.LEAK);
        this.operator.setCalm(calm);
      }),
      bus.on("restart", () => {
        this.pulses = [];
        this.bursts = [];
        this.flashT = 0;
        this.glitchT = 0;
        this.autoReturnAt = -1;
        this.followNext = null;
        this.followUntil = 0;
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

  /** "Follow incident": the camera frames whatever the current event is about. */
  setFollow(on: boolean): void {
    this.follow = on;
    if (!on) this.followNext = null;
  }

  /** A user-opened panel owns the camera while it is open. */
  setInteractionLock(on: boolean): void {
    this.userLock = on;
    if (on) this.followNext = null;
  }

  /** Run `fn` every frame after the camera moves (DOM overlays such as leader lines). */
  onFrame(fn: () => void): () => void {
    this.frameHooks.add(fn);
    return () => this.frameHooks.delete(fn);
  }

  /**
   * Incident camera direction: frame `name`, holding each framing long enough to read. A
   * request during the hold waits its turn unless `urgent`. Short eased moves (about half a
   * second); nothing at all under reduced motion, in observer mode or while a panel is open.
   */
  private direct(name: FocusName, urgent = false): void {
    if (!this.follow || this.reducedMotion || this.observer || this.userLock) return;
    if (!urgent && this.time < this.followUntil) {
      this.followNext = name;
      return;
    }
    this.followNext = null;
    this.followUntil = this.time + FOLLOW_HOLD_S;
    this.returnToRoomAt = -1;
    this.camera.setFocus(INCIDENT_FRAMING[name] ?? name);
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
    const dt = this.last ? Math.max(0, Math.min(0.1, (now - this.last) / 1000)) : 0;
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
        if (this.camera.focus === "button" || this.camera.focus === "incidentButton") this.setFocus("room");
      }
      if (this.autoReturnAt > 0 && this.time >= this.autoReturnAt && !this.operator.busy) {
        this.autoReturnAt = -1;
        if (this.rt.recovery.phase === "idle" && !this.rt.controller.state.epo && this.operator.location !== "seat") {
          this.operator.goToDesk(true);
          this.direct("room", true);
        }
      }
      // the link going silent is an event too: show the terminal that stopped sending
      if (this.wasStreaming && !this.rt.streaming) {
        this.direct("desk", true);
        this.followNext = this.rt.controller.state.epo ? "rack" : null;
      }
      this.wasStreaming = this.rt.streaming;
      if (this.followNext && this.time >= this.followUntil) this.direct(this.followNext);
    }
    const t0 = performance.now();
    this.render(paused ? 0 : dt);
    const cam = this.camera.update(dt, this.reducedMotion);
    this.present(cam.cx, cam.cy, cam.zoom);
    this.watchPerformance(performance.now() - t0, dt);
    for (const a of this.anchors.values()) this.placeAnchor(a);
    for (const fn of this.frameHooks) fn();
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
    const fanLevel = s.tempClass >= TEMP_CLASS.HOT ? 2 : s.tempClass === TEMP_CLASS.WARM ? 1 : 0;
    const leak = !!(s.inputs & INPUT.LEAK);
    const anyCrit = s.epo || s.tempClass === TEMP_CLASS.CRITICAL || leak;
    const anyWarn = s.tempClass >= TEMP_CLASS.WARM || s.overload;
    return {
      time: this.time,
      tempClass: s.tempClass,
      pins: s.pins,
      overload: s.overload,
      epo: s.epo,
      leak,
      fanAngle: this.fanAngle,
      fanLevel,
      ledRate: this.reducedMotion ? 1 : 5,
      flash: !this.reducedMotion && this.flashT > 0 && Math.floor(this.flashT * 6) % 2 === 0,
      capPressed: this.rt.p0Down,
      capHeld: this.rt.p0Down && !this.operator.pressing,
      monitorState: anyCrit ? "crit" : anyWarn ? "warn" : "ok",
      monitorEpo: s.epo,
      readings: { v: settingsView(s)[CFG.VOLTAGE].value, i: s.latestCurrent, t: s.latestTemp, got: s.gotTemp },
      linkSilent: !this.rt.streaming,
      heartbeat: this.reducedMotion || this.time % 2.4 < 0.16 || (this.time % 2.4 > 0.34 && this.time % 2.4 < 0.48),
      link: this.mood.link,
      glitch: !this.reducedMotion && this.glitchT > 0 && Math.floor(this.glitchT * 12) % 2 === 0,
    };
  }

  /** Ease the room mood toward the controller state: quick to alarm, slow and staged to recover. */
  private updateMood(dt: number): void {
    const s = this.rt.controller.state;
    const target: Mood = {
      warm: s.tempClass === TEMP_CLASS.WARM ? 0.6 : s.tempClass === TEMP_CLASS.HOT ? 1 : 0,
      crit: s.tempClass === TEMP_CLASS.CRITICAL ? 1 : 0,
      current: s.overload ? 1 : 0,
      leak: s.inputs & INPUT.LEAK ? 1 : 0,
      epo: s.epo ? 1 : 0,
      link: this.rt.streaming ? (this.pulses.length ? 1 : 0.5) : 0,
    };
    const m = this.mood;
    for (const k of Object.keys(m) as (keyof Mood)[]) {
      if (this.reducedMotion) m[k] = target[k];
      else {
        const rate = target[k] > m[k] ? 7 : k === "link" ? 3 : 0.9;
        m[k] += (target[k] - m[k]) * (1 - Math.exp(-dt * rate));
        if (Math.abs(target[k] - m[k]) < 0.004) m[k] = target[k];
      }
    }
  }

  private render(dt: number): void {
    this.updateMood(dt);
    const L = this.look();
    const speed = [0.6, 1.7, 3.6][L.fanLevel] * (this.reducedMotion ? 0.35 : 1);
    this.fanAngle = (this.fanAngle + dt * speed * Math.PI * 2) % (Math.PI * 2);
    this.flashT = Math.max(0, this.flashT - dt);
    this.glitchT = Math.max(0, this.glitchT - dt);
    this.beaconAngle = (this.beaconAngle + dt * 2.8) % (Math.PI * 2);

    const r = this.work;
    const S = r.S;
    r.copyFrom(this.base);

    // contact shadows for the chair and the operator (floor pixels only)
    const op = this.operator;
    const shadowAt = (x: number, y: number, radius: number, k: number) => {
      const [sx, sy] = r.project(x, y, 0);
      r.darken(sx, sy, radius * 1.41 * S, radius * 0.71 * S, k, OBJ.NONE);
    };
    const chairX = NODES.seat.x + op.chairRoll * 3.5; // rolled back while the operator is up
    shadowAt(chairX, NODES.seat.y, 7.5, 0.78);
    if (op.pose !== "sit") shadowAt(op.x, op.y, 6, 0.72);

    // chair, Rack A moving parts, background idle LEDs, monitor, operator
    if (op.pose === "sit") this.chairFacing = op.facing;
    drawChair(r, chairX, NODES.seat.y, this.chairFacing);
    drawRackDynamic(r, L);
    drawBackgroundLeds(r, this.time, this.reducedMotion);
    drawMonitor(r, L);
    op.draw(r, this.time, this.reducedMotion);
    if (!this.reducedMotion) this.drawAirflow(r, L.fanLevel);

    this.drawLights(r, L);

    // UART pulses along the cable tray (outbound packet, then the reply), and rejections
    if (this.pulses.length) this.drawPulses(r, dt);
    if (this.bursts.length) this.drawBursts(r, dt);

    // exhaust shimmer above the rack from the real (external) temperature: faint when Warm
    const tempRaw = this.rt.conditions.tempRaw;
    if (!this.reducedMotion && tempRaw >= 54) this.shimmer(r, tempRaw > 64 ? 1.2 : 0.55);

    // hover / keyboard focus outline
    const hl = this.focusRing || this.hover;
    if (hl) r.outline(hl, PAL.highlight, this.outlineMarks);
  }

  /**
   * State-reactive lighting, all hard-banded pools: cool overhead light in normal operation,
   * amber near Rack 01 when Warm, a sweeping red beacon and red floor reflections while the EPO
   * is latched, amber at the overload lamp, cold blue light off the water when the leak sensor is wet.
   * Pools scale with the eased mood, so recovery fades in stages instead of switching off.
   */
  private drawLights(r: Raster, L: RackLook): void {
    const S = r.S, m = this.mood;
    const pool = (x: number, y: number, z: number, rx: number, ry: number, rgb: number, k: number, bands = 3, onlyId = -1) => {
      if (k < 0.004) return;
      const [px, py] = r.project(x, y, z);
      r.lightPool(px, py, rx * S, ry * S, rgb, k, bands, onlyId);
    };
    // overhead fixtures: cool pools, dimmed under an alarm, with a barely visible fluorescent waver
    const alarm = Math.max(m.epo, m.crit);
    const waver = this.reducedMotion ? 1 : 1 + (hash2(Math.floor(this.time * 7), 3, 77) - 0.5) * 0.08;
    const cool = 0.055 * (1 - 0.6 * alarm) * waver;
    pool(34, 16, 0, 34, 16, PAL.coolLight, cool, 2);
    pool(134, 16, 0, 28, 14, PAL.coolLight, cool * 0.9, 2);

    // Warm: amber near the rack
    pool(100, 30, 30, 38, 48, PAL.warn, 0.08 * m.warm, 2);
    // Critical: red reflected on the cooling tiles in front of the rack
    pool(102, 38, 0, 30, 14, PAL.crit, 0.07 * m.crit, 2);
    // EPO latched: beacon glow plus a sweep across the floor (static under reduced motion)
    if (m.epo > 0.004) {
      const [bx, by] = r.project(BEACON.x + 3, BEACON.y + 3, 86);
      r.lightPool(bx, by + 12 * S, 58 * S, 34 * S, PAL.crit, (L.flash ? 0.26 : 0.14) * m.epo, 3);
      if (this.reducedMotion) pool(103, 40, 0, 26, 13, PAL.crit, 0.06 * m.epo, 2);
      else pool(103 + Math.cos(this.beaconAngle) * 30, 42 + Math.sin(this.beaconAngle) * 16, 0, 22, 11, PAL.crit, 0.11 * m.epo, 2);
    }
    // P6 power overload: the amber lamp lights its surroundings
    pool(AMBER_LAMP.x + 3, AMBER_LAMP.y + 3, 78, 40, 22, PAL.warn, 0.13 * m.current, 3);
    // water on the floor in front of the rack reflects a cold blue
    pool(100, 34, 0, 26, 12, PAL.water, 0.16 * m.leak, 3);

    // DCIM monitor spill (brighter while a rejected packet tears the display)
    const monColor = L.monitorState === "crit" ? PAL.crit : L.monitorState === "warn" ? PAL.warn : 0x6fa8c8;
    const [mx, my] = r.project(12, 76, 38);
    r.lightPool(mx + 6 * S, my + 6 * S, 30 * S, 18 * S, L.glitch ? PAL.warn : monColor, L.glitch ? 0.11 : 0.07, 2);

    // a small reflection slides down Rack 01's front edge every few seconds
    const g = (this.time % 9) / 1.8;
    if (!this.reducedMotion && g < 1) pool(114, 25, 82 - g * 80, 2.5, 6, 0xffffff, 0.14, 2, OBJ.RACK);
  }

  /** Cool air drawn up from the perforated tiles into Rack 01's intake; faster with fan boost. */
  private drawAirflow(r: Raster, fanLevel: number): void {
    const speed = [0.22, 0.4, 0.62][fanLevel];
    const size = Math.max(1, Math.round(r.S * 0.6));
    for (let i = 0; i < 16; i++) {
      const life = (this.time * speed + hash2(i, 3, 5)) % 1;
      const x = 87 + hash2(i, 1, 5) * 26;
      const y = 30 + hash2(i, 2, 5) * 18 - life * 7;
      const z = life * 20;
      const [sx, sy] = r.project(x, y, z);
      const depth = x + y + z;
      const k = 0.32 * (1 - life);
      for (let oy = 0; oy < size; oy++)
        for (let ox = 0; ox < size; ox++) {
          const px = Math.floor(sx) + ox, py = Math.floor(sy) + oy;
          if (px < 0 || py < 0 || px >= r.w || py >= r.h) continue;
          const j = py * r.w + px;
          if (r.depth[j] > depth + 1) continue;
          const c = r.color[j];
          // ImageData is ABGR: blend each channel toward the cool tint
          const tint = PAL.coolLight;
          const cr = (c & 255) + (((tint >> 16) & 255) - (c & 255)) * k;
          const cg = ((c >> 8) & 255) + (((tint >> 8) & 255) - ((c >> 8) & 255)) * k;
          const cb = ((c >> 16) & 255) + ((tint & 255) - ((c >> 16) & 255)) * k;
          r.color[j] = (0xff000000 | (Math.round(cb) << 16) | (Math.round(cg) << 8) | Math.round(cr)) >>> 0;
        }
    }
  }

  /** A rejected packet bursts at the controller end of the tray before its reply returns. */
  private drawBursts(r: Raster, dt: number): void {
    const S = r.S;
    const [x, y, z] = pathPoint(1);
    const [cx, cy] = r.project(x, y, z);
    const col = toABGR(PAL.warn);
    let n = 0;
    for (const b of this.bursts) {
      b.t += dt / 0.5;
      if (b.t < 1) this.bursts[n++] = b;
    }
    this.bursts.length = n;
    for (const b of this.bursts) {
      const rad = (1.5 + b.t * 5) * S;
      for (let a = 0; a < 20; a++) {
        if ((a + Math.floor(b.t * 6)) % 2) continue; // broken ring
        const px = Math.round(cx + Math.cos((a / 20) * Math.PI * 2) * rad);
        const py = Math.round(cy + Math.sin((a / 20) * Math.PI * 2) * rad * 0.6);
        if (px >= 0 && py >= 0 && px < r.w && py < r.h) r.color[py * r.w + px] = col;
      }
    }
  }

  private drawPulses(r: Raster, dt: number): void {
    const S = r.S;
    let n = 0;
    for (const p of this.pulses) {
      p.t += dt / 0.45;
      if (p.t >= 1) {
        if (p.dir === 1 && p.reply !== undefined) {
          const ok = p.reply === 0xa5;
          if (!ok) this.bursts.push({ t: 0 });
          this.pulses[n++] = { t: 0, dir: -1, color: ok ? PAL.pulse : PAL.warn };
        }
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

  private shimmer(r: Raster, amp: number): void {
    const S = r.S, W = r.w;
    const [x0] = r.project(86, 26, 80);
    const [x1] = r.project(114, 0, 80);
    const [, top] = r.project(100, 12, 90);
    const row = this.shimmerRow;
    for (let y = Math.max(0, Math.floor(top - 34 * S)); y < Math.floor(top - 4 * S); y++) {
      const shift = Math.round(Math.sin(this.time * 7 + (y / S) * 0.9) * amp * S);
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
      // clears the brand block (wordmark row + page switcher) and the status panel
      const topSafe = 110, bottomSafe = 64;
      left = Math.max(m, Math.min(this.viewW - w - m, left));
      top = Math.max(topSafe, Math.min(this.cssH - h - bottomSafe, top));
    }
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }
}
