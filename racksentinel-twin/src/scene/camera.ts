/** Fixed-angle camera: only pans and zooms gently between a few framing presets. */
import { LOGICAL_H as BUF_H, LOGICAL_W as BUF_W } from "./raster";
import { projectLogical as P } from "./layout";

export type FocusName = "room" | "rack" | "desk" | "button" | "observer" | "incidentRack" | "incidentDesk" | "incidentButton";

export interface CamPose { cx: number; cy: number; zoom: number }

/** Frame a world point, offset in logical pixels (offsets leave room for contextual panels). */
function frame(x: number, y: number, z: number, dx: number, dy: number, zoom: number): CamPose {
  const [cx, cy] = P(x, y, z);
  return { cx: cx + dx, cy: cy + dy, zoom };
}

/**
 * Logical-space framings. Room shows all three racks and the desk; rack keeps Rack A prominent
 * with its neighbours as context; button stays close enough to watch the operator press P0.
 */
export const FOCUS: Record<FocusName, CamPose> = {
  room: { cx: BUF_W / 2 + 2, cy: BUF_H / 2 + 2, zoom: 1 },
  rack: frame(100, 12, 40, 58, 0, 1.38),
  button: frame(121, 13, 32, 36, -14, 1.5),
  desk: frame(9, 76, 52, 29, 40, 1.2),
  observer: frame(100, 12, 40, -4, -8, 3.4),
  // incident following: no panel is open, so the subject stays centred and slightly wider,
  // leaving the HUD corners clear
  incidentRack: frame(104, 14, 44, -6, 6, 1.22),
  incidentDesk: frame(14, 76, 44, -12, 18, 1.18),
  incidentButton: frame(118, 18, 34, -10, 6, 1.3),
};

/**
 * Framings used while a side panel is docked on the right. The scene area is already narrowed
 * by the dock, so the inspector offsets above would leave a wide empty gap beside it: the
 * subject sits slightly right of centre instead, toward the docked panel.
 */
const FOCUS_DOCKED: Partial<Record<FocusName, CamPose>> = {
  rack: frame(100, 12, 40, -24, 0, 1.38),
  button: frame(121, 13, 32, -18, -14, 1.5),
  desk: frame(9, 76, 52, -10, 40, 1.2),
};

/** Logical x of Rack A, used for the brief push-in on a new trip. */
const RACK_CX = P(100, 12, 40)[0];

export class Camera {
  pose: CamPose = { ...FOCUS.room };
  private target: CamPose = { ...FOCUS.room };
  private punch = 0;
  private docked = false;
  focus: FocusName = "room";

  private framing(name: FocusName): CamPose {
    return { ...((this.docked && FOCUS_DOCKED[name]) || FOCUS[name]) };
  }

  setFocus(name: FocusName, instant = false): void {
    this.focus = name;
    this.target = this.framing(name);
    if (instant) this.pose = { ...this.target };
  }

  /** A panel docked on the right (or undocked): re-frame the current subject accordingly. */
  setDocked(docked: boolean, instant = false): void {
    if (this.docked === docked) return;
    this.docked = docked;
    this.setFocus(this.focus, instant);
  }

  /** Brief push-in used once when a new trip latches. */
  emphasize(): void {
    this.punch = 1;
  }

  update(dt: number, reducedMotion: boolean): CamPose {
    if (reducedMotion) {
      this.pose = { ...this.target };
      this.punch = 0;
      return this.pose;
    }
    const k = 1 - Math.exp(-dt * 4.5);
    this.pose.cx += (this.target.cx - this.pose.cx) * k;
    this.pose.cy += (this.target.cy - this.pose.cy) * k;
    this.pose.zoom += (this.target.zoom - this.pose.zoom) * k;
    this.punch = Math.max(0, this.punch - dt * 1.6);
    const p = Math.sin(this.punch * Math.PI) * 0.05;
    return { cx: this.pose.cx + (RACK_CX - this.pose.cx) * p, cy: this.pose.cy, zoom: this.pose.zoom * (1 + p) };
  }
}
