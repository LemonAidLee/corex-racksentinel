/**
 * The operator: movement logic (independent of rendering) plus a voxel model built from boxes.
 * Small animation set: sit (relaxed / alert), stand, walk, inspect, press, release a held button.
 */
import { CHAIN, NODES, OBJ, type NodeName } from "./layout";
import { PAL } from "./palette";
import { shade, type Box, type Raster, type Tex } from "./raster";

export type Facing = "px" | "nx" | "py" | "ny";
type Pose = "sit" | "stand" | "walk" | "inspect" | "reach" | "release";


const WALK_SPEED = 52; // world units per second

export interface OperatorHooks {
  /** Called at the moment the finger reaches P0. */
  onPressDown(): void;
  onPressUp(): void;
  /** Called when the operator unsticks a held P0. */
  onRelease(): void;
  isHeld(): boolean;
}

type Action = { kind: "press"; t: number; phase: "release" | "down" | "up" | "done" } | null;

export class Operator {
  x: number = NODES.seat.x;
  y: number = NODES.seat.y;
  facing: Facing = "py";
  pose: Pose = "sit";
  /** Seated and paying attention to the monitor. */
  alert = false;
  /** Index into CHAIN of the last node reached (or being left). */
  at = 0;
  private path: number[] = [];
  private arrival: (() => void) | null = null;
  private walkT = 0;
  private action: Action = null;
  private glanceT = 0;
  /** Seconds left of the brief "noticed a warning" reaction. */
  reactT = 0;
  /** Walk speed multiplier (reduced motion shortens transitions). */
  speedScale = 1;
  target: NodeName = "seat";

  constructor(private hooks: OperatorHooks) {}

  get busy(): boolean {
    return this.path.length > 0 || this.action !== null;
  }

  get location(): NodeName {
    return CHAIN[this.at];
  }

  /** Walk along the chain to a node, then run `then`. Replaces any current trip. */
  goTo(node: NodeName, then?: () => void): void {
    const target = CHAIN.indexOf(node);
    this.target = node;
    if (this.action?.kind === "press" && this.action.phase === "up") this.hooks.onPressUp();
    this.action = null;
    // Mid-segment, keep heading to the next node first so movement stays on the graph.
    const cur = this.path.length ? this.path[0] : this.at;
    const seq: number[] = this.path.length ? [cur] : [];
    for (let i = cur; i !== target; ) {
      i += target > i ? 1 : -1;
      seq.push(i);
    }
    this.path = seq;
    this.arrival = then ?? null;
    if (!this.path.length) this.arrive();
    else if (this.pose === "sit") this.pose = "stand";
  }

  goToDesk(): void {
    this.goTo("seat");
  }

  goInspect(): void {
    this.goTo("rack");
  }

  pressButton(): void {
    this.goTo("button", () => {
      this.facing = "nx";
      this.action = { kind: "press", t: 0, phase: this.hooks.isHeld() ? "release" : "down" };
    });
  }

  /**
   * Abandon the current trip and action. A finger on P0 lets go; mid-walk, the operator only
   * finishes the current segment so they stay on the walk graph.
   */
  cancel(): void {
    if (this.action?.kind === "press" && this.action.phase === "up") this.hooks.onPressUp();
    this.action = null;
    this.arrival = null;
    if (this.path.length) {
      this.path = [this.path[0]];
      this.target = CHAIN[this.path[0]];
    } else if (this.pose === "reach" || this.pose === "release") {
      this.pose = "stand";
    }
  }

  /** Jump without walking (observer mode, instant demo replays). */
  teleport(node: NodeName): void {
    this.path = [];
    this.action = null;
    this.at = CHAIN.indexOf(node);
    this.x = NODES[node].x;
    this.y = NODES[node].y;
    this.target = node;
    this.arrive();
  }

  /** React to a new warning or trip: look at the monitor, or at the rack when standing. */
  notice(): void {
    this.reactT = 0.6;
    if (this.pose === "sit") {
      this.alert = true;
      this.facing = "nx";
    } else if (!this.busy && this.location !== "button") {
      this.facing = this.location === "rack" ? "ny" : "px";
      this.glanceT = 1.4;
    }
  }

  setCalm(calm: boolean): void {
    if (calm && this.pose === "sit") {
      this.alert = false;
      this.facing = "py";
    }
  }

  private arrive(): void {
    const node = CHAIN[this.at];
    if (node === "seat") {
      this.pose = "sit";
      this.facing = this.alert ? "nx" : "py";
    } else if (node === "rack") {
      this.pose = "inspect";
      this.facing = "ny";
    } else {
      this.pose = "stand";
      if (node === "button") this.facing = "nx";
    }
    const cb = this.arrival;
    this.arrival = null;
    cb?.();
  }

  update(dt: number): void {
    this.reactT = Math.max(0, this.reactT - dt);
    if (this.glanceT > 0) {
      this.glanceT -= dt;
      if (this.glanceT <= 0 && this.location === "rack" && !this.busy) this.facing = "ny";
    }
    if (this.path.length) {
      this.pose = "walk";
      this.walkT += dt;
      let budget = WALK_SPEED * this.speedScale * dt;
      while (budget > 0 && this.path.length) {
        const n = NODES[CHAIN[this.path[0]]];
        const dx = n.x - this.x, dy = n.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.001) this.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "px" : "nx") : dy > 0 ? "py" : "ny";
        if (dist <= budget) {
          this.x = n.x;
          this.y = n.y;
          budget -= dist;
          this.at = this.path.shift()!;
        } else {
          this.x += (dx / dist) * budget;
          this.y += (dy / dist) * budget;
          budget = 0;
        }
      }
      if (!this.path.length) this.arrive();
      return;
    }
    const a = this.action;
    if (a?.kind === "press") {
      a.t += dt;
      if (a.phase === "release") {
        this.pose = "release";
        if (a.t > 0.55) {
          this.hooks.onRelease();
          a.phase = "down";
          a.t = 0;
        }
      } else if (a.phase === "down") {
        this.pose = "reach";
        if (a.t > 0.22) {
          this.hooks.onPressDown();
          a.phase = "up";
          a.t = 0;
        }
      } else if (a.phase === "up") {
        if (a.t > 0.28) {
          this.hooks.onPressUp();
          a.phase = "done";
          a.t = 0;
        }
      } else if (a.t > 0.25) {
        this.pose = "stand";
        this.action = null;
      }
    }
  }

  /** True while the finger is on the cap (for the button's visual depress). */
  get pressing(): boolean {
    return this.action?.kind === "press" && this.action.phase === "up";
  }

  // ---------------------------------------------------------------- model
  /**
   * Draw the voxel operator. Local axes: a = forward, s = side, z = up. About 39 world units
   * tall, roughly half the rack. Positions snap to the raster's texel grid so the figure never
   * shimmers between pixels.
   */
  draw(r: Raster, time: number, reducedMotion = false): void {
    const t = r.t;
    const snap = (v: number) => Math.round(v / t) * t;
    const px = snap(this.x), py = snap(this.y);
    const f = this.facing;
    const parts: Box[] = [];
    const put = (a0: number, s0: number, z0: number, la: number, ls: number, lz: number, tex: Tex | number) => {
      a0 = snap(a0); s0 = snap(s0); z0 = snap(z0);
      let x0: number, y0: number, w: number, d: number;
      switch (f) {
        case "px": x0 = px + a0; y0 = py + s0; w = la; d = ls; break;
        case "nx": x0 = px - a0 - la; y0 = py - s0 - ls; w = la; d = ls; break;
        case "py": x0 = px - s0 - ls; y0 = py + a0; w = ls; d = la; break;
        case "ny": x0 = px + s0; y0 = py - a0 - la; w = ls; d = la; break;
      }
      parts.push({ x: x0, y: y0, z: z0, w, d, h: lz, tex, id: OBJ.OPERATOR });
    };
    // which world face is the operator's front or back (for face and badge textures)
    const front = f === "px" ? 2 : f === "py" ? 1 : -1;
    const back = f === "nx" ? 2 : f === "ny" ? 1 : -1;
    const profileForward = f === "px" || f === "ny";

    const seated = this.pose === "sit";
    const walking = this.pose === "walk";
    const phase = this.walkT * 9;
    const swing = walking ? Math.sin(phase) * 2.2 : 0;
    const liftL = walking ? Math.max(0, Math.sin(phase)) * 0.8 : 0;
    const liftR = walking ? Math.max(0, -Math.sin(phase)) * 0.8 : 0;
    const bob = walking ? Math.abs(Math.sin(phase)) * 0.5 : 0;
    const breathe = !walking && !reducedMotion && Math.sin(time * 1.4) > 0.75 ? 0.5 : 0;
    const react = !reducedMotion && this.reactT > 0 ? 1 : 0;
    const lean = seated && this.alert ? 1 : 0;

    // ---- legs and boots
    const bootTex: Tex = (_face, _u, v, _w, h) => (v >= h - 0.5 ? 0x0f1113 : PAL.boots);
    const legTex: Tex = (face, u, _v, w) => (face === 0 ? PAL.trousers : u < 0.5 || u >= w - 0.5 ? shade(PAL.trousers, 0.85) : PAL.trousers);
    const hip = seated ? 13 : 16 + bob;
    if (seated) {
      put(-1 + lean, -4.5, hip - 3.5, 9, 4, 3.5, legTex);
      put(-1 + lean, 0.5, hip - 3.5, 9, 4, 3.5, legTex);
      put(6.5, -4.5, 1.5, 3.5, 4, hip - 5, legTex);
      put(6.5, 0.5, 1.5, 3.5, 4, hip - 5, legTex);
      put(6.5, -4.5, 0, 4.5, 4, 1.5, bootTex);
      put(6.5, 0.5, 0, 4.5, 4, 1.5, bootTex);
    } else {
      put(-1.75 + swing, -4.5, 2 + liftL, 3.5, 4, hip - 2 - liftL, legTex);
      put(-1.75 - swing, 0.5, 2 + liftR, 3.5, 4, hip - 2 - liftR, legTex);
      put(-1.75 + swing, -4.5, liftL, 5, 4, 2, bootTex);
      put(-1.75 - swing, 0.5, liftR, 5, 4, 2, bootTex);
    }

    // ---- torso: uniform with collar, zip, ID badge and belt
    const tz = hip;
    const torsoH = 13;
    const torsoTex: Tex = (face, u, v, w, h) => {
      if (face === 0) return v < 1 || v >= h - 1 ? PAL.uniformDark : PAL.uniform;
      if (v >= h - 1.25) return face === front && Math.abs(u - w / 2) < 0.9 ? PAL.steelLight : 0x1d2228; // belt and buckle
      if (v < 1) return shade(PAL.uniform, 1.25); // collar
      if (face === front) {
        if (Math.abs(u - w / 2) < 0.25) return PAL.uniformDark; // zip
        if (u >= w - 3.5 && u < w - 1.75 && v >= 2.5 && v < 4.5) return PAL.badge;
      }
      if (face === back && v >= 2 && v < 2.75) return PAL.uniformDark; // yoke seam
      return u < 0.5 || u >= w - 0.5 ? PAL.uniformDark : PAL.uniform;
    };
    put(-2.5 + lean, -5, tz, 5, 10, torsoH + breathe, torsoTex);
    put(-1 + lean, -1.5, tz + torsoH, 2, 3, 1, PAL.skinShade); // neck

    // ---- arms (sleeve and hand)
    const sh = tz + torsoH - 1 + breathe; // shoulder height
    const arm = (side: -1 | 1, a0: number, z0: number, len: number) => {
      const s0 = side < 0 ? -7 : 5;
      put(a0, s0, z0, 3, 2, len, PAL.uniform);
      put(a0 + 0.5, s0, z0 - 1.75, 2, 2, 1.75, PAL.skin);
    };
    if (this.pose === "reach" || this.pose === "release") {
      // right arm extended forward at shoulder height toward P0
      const ext = this.pose === "release" ? 7 + Math.round(Math.sin(time * 16)) * 0.5 : this.pressing ? 9.5 : 8;
      put(0, 5, sh - 2.5, ext, 2, 2.5, PAL.uniform);
      put(ext, 5.25, sh - 2.25, 1.5, 1.5, 2, PAL.skin);
      arm(-1, -1.5, sh - 9.5, 9.5);
    } else if (this.pose === "inspect") {
      // left hand raised toward the rack front
      put(0, -7, sh - 3, 5.5, 2, 2.5, PAL.uniform);
      put(5.5, -6.75, sh - 3.5, 1.5, 1.5, 2.5, PAL.skin);
      arm(1, -1.5, sh - 9.5, 9.5);
    } else if (seated) {
      put(lean, -7, tz + 6, 7, 2, 3, PAL.uniform);
      put(lean, 5, tz + 6, 7, 2, 3, PAL.uniform);
      put(7 + lean, -6.75, tz + 6, 2, 1.75, 2, PAL.skin);
      put(7 + lean, 5, tz + 6, 2, 1.75, 2, PAL.skin);
    } else {
      const raise = react ? 2 : 0;
      arm(-1, -1.5 - swing * 0.6, sh - 9.5 + raise, 9.5);
      arm(1, -1.5 + swing * 0.6, sh - 9.5 + raise, 9.5);
    }

    // ---- head: face toward the facing direction, hair elsewhere
    const headTex: Tex = (face, u, v, w, h) => {
      if (face === 0) return u < 0.5 || v < 0.5 ? shade(PAL.hair, 0.85) : PAL.hair;
      if (face === back) return v < h - 2 ? PAL.hair : PAL.skinShade;
      if (face === front) {
        if (v < 1.75) return PAL.hair; // fringe
        if (v >= 2.6 && v < 3.1 && ((u >= 1.25 && u < 2.75) || (u >= w - 2.75 && u < w - 1.25))) return shade(PAL.hair, 0.9); // brows
        if (v >= 3.5 && v < 4.75 && ((u >= 1.5 && u < 2.5) || (u >= w - 2.5 && u < w - 1.5))) return PAL.eye;
        if (v >= 6.25 && v < 6.75 && u >= w / 2 - 1 && u < w / 2 + 1) return PAL.skinShade; // mouth
        return v >= h - 1 ? PAL.skinShade : PAL.skin;
      }
      // profile: hair toward the back, an ear, one eye toward the front
      const towardBack = profileForward ? u < 2.5 : u >= w - 2.5;
      if (v < 1.75 || (towardBack && v < h - 2)) return PAL.hair;
      if (v >= 3.5 && v < 5.5 && u >= w / 2 - 0.5 && u < w / 2 + 0.75) return PAL.skinShade; // ear
      const eyeU = profileForward ? w - 1.75 : 0.75;
      if (v >= 3.5 && v < 4.75 && u >= eyeU && u < eyeU + 1) return PAL.eye;
      return PAL.skin;
    };
    const headA = -3.5 + lean + (this.pose === "inspect" ? 0.5 : 0);
    put(headA, -3.5, tz + torsoH + 1 + breathe + react * 0.5, 7, 7, 8.5, headTex);

    for (const b of parts) r.drawBox(b);
  }
}

const chairTex: Tex = (face, u, v, w, h, t) => (face === 0 ? (u < t || v < t || u >= w - t || v >= h - t ? PAL.chair : PAL.chairSeat) : v < 0.75 ? shade(PAL.chairSeat, 1.1) : PAL.chair);

/** Office chair; its back sits behind whoever is in it, so it turns with the operator. */
export function drawChair(r: Raster, px: number, py: number, f: Facing): void {
  const T = OBJ.TERMINAL;
  // five-star base, gas lift, seat, backrest
  r.drawBox({ x: px - 6, y: py - 1, z: 0, w: 12, d: 2, h: 1, tex: PAL.chair, id: T });
  r.drawBox({ x: px - 1, y: py - 6, z: 0, w: 2, d: 12, h: 1, tex: PAL.chair, id: T });
  r.drawBox({ x: px - 0.75, y: py - 0.75, z: 1, w: 1.5, d: 1.5, h: 9, tex: PAL.steelDark, id: T });
  r.drawBox({ x: px - 7, y: py - 7, z: 10, w: 14, d: 14, h: 3, tex: chairTex, id: T });
  const back =
    f === "nx" ? { x: px + 5, y: py - 6.5, w: 2, d: 13 }
    : f === "px" ? { x: px - 7, y: py - 6.5, w: 2, d: 13 }
    : f === "py" ? { x: px - 6.5, y: py - 7, w: 13, d: 2 }
    : { x: px - 6.5, y: py + 5, w: 13, d: 2 };
  r.drawBox({ ...back, z: 14, h: 15, tex: chairTex, id: T });
}

