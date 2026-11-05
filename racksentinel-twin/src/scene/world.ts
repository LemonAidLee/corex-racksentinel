/**
 * Room geometry and textures. All art is procedural: boxes plus texel rules written in world
 * units, so the same rules resolve into finer detail at higher render scales (1 px lines use
 * the texel size `t`). Original, tiny, and crisp under nearest-neighbour scaling.
 */
import { textPixel } from "./font";
import { ACCESS_DOOR, BACKGROUND_RACKS, CABLE_REEL, CLIPBOARD, CONDUIT, CONTROLLER_MODULE, DOOR_MAT, EXTINGUISHER, JUNCTION_BOX, LINK_LED, SCHEMATIC, SERVICE_ZONE, TEAM_SIGN, BEACON, AMBER_LAMP, CABINET, DESK, DOOR, MONITOR, OBJ, RACK, RESET, ROOM, SERVICE_AISLE, TROLLEY, type BackgroundRack } from "./layout";
import { PAL } from "./palette";
import { CLEAR, EMISSIVE, hash2, mix, shade, type Face, type Raster, type Tex } from "./raster";

// ------------------------------------------------------------------ helpers
const frac = (x: number) => x - Math.floor(x);
/** Subtle per-cell variation; `cell` is the world size of one material grain. */
const grain = (rgb: number, u: number, v: number, amt: number, seed = 0, cell = 2) =>
  shade(rgb, 1 + (hash2(Math.floor(u / cell), Math.floor(v / cell), seed) - 0.5) * amt);
/** Within one texel of the face border. */
const rim = (u: number, v: number, w: number, h: number, t: number) => u < t || v < t || u >= w - t || v >= h - t;
/** Within distance `d` of the face border. */
const band = (u: number, v: number, w: number, h: number, d: number) => u < d || v < d || u >= w - d || v >= h - d;
const inRect = (u: number, v: number, u0: number, v0: number, u1: number, v1: number) => u >= u0 && u < u1 && v >= v0 && v < v1;
const disc = (u: number, v: number, cu: number, cv: number, r: number) => (u - cu) ** 2 + (v - cv) ** 2 <= r * r;

/** Distance from (x, y) to an axis-aligned rectangle (0 inside). */
function rectDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
  return Math.hypot(dx, dy);
}

// ------------------------------------------------------------------ static textures
/** Footprints that cast banded contact shadows on the floor. */
const SHADOW_CASTERS: [number, number, number, number][] = [
  [RACK.x, RACK.y, RACK.x + RACK.w + 1, RACK.y + RACK.d + 3],
  ...BACKGROUND_RACKS.map((b) => [b.x, b.y, b.x + b.w + 1, b.y + b.d + 3] as [number, number, number, number]),
  [CABINET.x, CABINET.y, CABINET.x + CABINET.w + 1, CABINET.y + CABINET.d + 1],
  [TROLLEY.x, TROLLEY.y, TROLLEY.x + TROLLEY.w, TROLLEY.y + TROLLEY.d],
  [CABLE_REEL.x, CABLE_REEL.y, CABLE_REEL.x + CABLE_REEL.w, CABLE_REEL.y + CABLE_REEL.d],
  [2, 57, 24, 59],
  [2, 88, 24, 99],
];

/** Hazard tape outlining the service aisle at Rack A's P0 station. */
const TAPE = { x0: SERVICE_AISLE.x0, x1: SERVICE_AISLE.x1 - 2, y0: 1, y1: 28, w: 1.25 } as const;

const floorTex: Tex = (face, u, v, _w, _h, t) => {
  if (face !== 0) {
    if (v < 1) return PAL.floorSeam;
    // narrow floor-edge light strip: gives the room a clean silhouette against the dark
    if (v >= 1.4 && v < 1.4 + Math.max(t, 0.5)) return PAL.edgeLight | EMISSIVE;
    return grain(PAL.floorEdge, u, v, 0.06, 3);
  }
  const x = u, y = v;
  const T = 12;
  const tu = x % T, tv = y % T;
  if (tu < t || tv < t) return PAL.floorSeam;
  // perforated cooling tiles: a full field in front of Rack A, a quieter row in front of B and C
  const perf = x >= 84 && x < 120 && y >= 26 && y < 50;
  const perfBg = x >= 150 && x < 206 && y >= 26 && y < 38;
  let c: number;
  if (perf || perfBg) {
    const cu = frac(x / 3) * 3, cv = frac(y / 3) * 3;
    c = disc(cu, cv, 1.5, 1.5, 0.65) ? PAL.perfHole : PAL.perfTile;
    if (perfBg) c = mix(c, PAL.floorA, 0.45);
  } else if (x >= TAPE.x0 && x < TAPE.x1 && y >= TAPE.y0 && y < TAPE.y1 && band(x - TAPE.x0, y - TAPE.y0, TAPE.x1 - TAPE.x0, TAPE.y1 - TAPE.y0, TAPE.w)) {
    c = frac((x + y) / 2.5) < 0.5 ? PAL.hazard : PAL.hazardDark;
  } else {
    c = (Math.floor(x / T) + Math.floor(y / T)) % 2 ? PAL.floorA : PAL.floorB;
    c = grain(c, x, y, 0.05, 1);
  }
  // painted service-zone boundary around Rack 01 and its cooling tiles (dashed, steel blue)
  const Z = SERVICE_ZONE;
  if (x >= Z.x0 && x < Z.x1 && y < Z.y1) {
    const onX = x < Z.x0 + Z.w || x >= Z.x1 - Z.w;
    const onY = y >= Z.y1 - Z.w;
    if ((onX && frac(y / 4) < 0.62) || (onY && frac(x / 4) < 0.62)) c = mix(c, PAL.zonePaint, 0.7);
  }
  // bevelled tile edges: lit back edges, shaded front edges
  if (tu < 1 || tv < 1) c = shade(c, 1.07);
  else if (tu > T - 1 || tv > T - 1) c = shade(c, 0.92);
  // Rack A's work light: a slightly brighter, hard-banded pool in front of the rack and P0
  const lit = Math.hypot((x - 110) / 1.25, y - 30);
  if (lit < 14) c = shade(c, 1.09);
  else if (lit < 24) c = shade(c, 1.045);
  // ambient occlusion against the walls
  const wallD = Math.min(x, y);
  if (wallD < 2) c = shade(c, 0.74);
  else if (wallD < 4.5) c = shade(c, 0.87);
  // contact shadows
  let d = 99;
  for (const r of SHADOW_CASTERS) d = Math.min(d, rectDist(x, y, r[0], r[1], r[2], r[3]));
  if (x < DESK.w && y >= DESK.y && y < DESK.y + DESK.d) d = Math.min(d, 0.5); // under the desk top
  if (d < 1.5) c = shade(c, 0.7);
  else if (d < 3.5) c = shade(c, 0.85);
  return c;
};

interface WallFeatures {
  /** Access door between these u positions. */
  door?: [number, number];
  /** Ventilation grille [u0, u1, z0, z1]. */
  vent?: [number, number, number, number];
  cornerAtStart: boolean;
}

function wallTex({ door: [doorFrom, doorTo] = [-1, -1], vent, cornerAtStart }: WallFeatures): Tex {
  return (face, u, v, w, _h, t) => {
    if (face === 0) return v < t ? PAL.wallTrim : shade(PAL.wallTrim, 1.15);
    const z = ROOM.H - v; // world height (wall top is at z = H)
    if (z <= 0) return PAL.floorEdge;
    if (z < 4) return z > 4 - t ? PAL.wallTrim : grain(PAL.baseboard, u, v, 0.05, 8);
    if (z > ROOM.H - 2) return z > ROOM.H - t ? shade(PAL.wallTrim, 1.2) : PAL.wallTrim;
    // louvred ventilation grille: frame, then slats lit on top and shadowed below
    if (vent && u >= vent[0] && u < vent[1] && z >= vent[2] && z < vent[3]) {
      const gu = u - vent[0], gz = vent[3] - z, gw = vent[1] - vent[0], gh = vent[3] - vent[2];
      if (gu < 1 || gz < 1 || gu >= gw - 1 || gz >= gh - 1) return rim(gu, gz, gw, gh, t) ? PAL.wallSeam : PAL.wallTrim;
      const s = (gz - 1) % 2;
      return s < t ? shade(PAL.wall, 1.12) : s < 1.1 ? PAL.wallTrim : shade(PAL.wallTrim, 0.8);
    }
    // access door
    if (u >= doorFrom && u < doorTo && z <= 48) {
      const du = u - doorFrom, dw = doorTo - doorFrom;
      if (du < 1 || du >= dw - 1 || z > 47) return PAL.doorDark;
      if (inRect(du, z, dw - 4, 21.5, dw - 2.5, 25)) return PAL.doorHandle;
      const inUpper = z > 28 && z < 44, inLower = z > 8 && z < 24;
      if ((inUpper || inLower) && du > 3 && du < dw - 6) {
        const edgeZ = inUpper ? z < 28 + t * 2 || z > 44 - t * 2 : z < 8 + t * 2 || z > 24 - t * 2;
        if (du < 3 + t * 2 || du > dw - 6 - t * 2 || edgeZ) return PAL.doorDark;
        return shade(PAL.door, 0.95);
      }
      return grain(PAL.door, u, v, 0.04, 9);
    }
    const pu = u % 24;
    if (pu < t) return PAL.wallSeam;
    if (pu < 0.5 + t) return shade(PAL.wall, 1.06);
    if (z >= 44 && z < 45) return z < 44 + t ? shade(PAL.wall, 1.08) : PAL.wallSeam;
    let c = grain(z > 44 ? PAL.wall : PAL.wallDark, u, v, 0.04, face);
    // corner and floor occlusion
    const cornerD = cornerAtStart ? u : w - u;
    if (cornerD < 2) c = shade(c, 0.8);
    else if (cornerD < 5) c = shade(c, 0.9);
    if (z < 7) c = shade(c, 0.92);
    return c;
  };
}

const deskTopTex: Tex = (face, u, v, w, h, t) => {
  if (face === 0) {
    if (rim(u, v, w, h, t)) return PAL.deskTopDark;
    const line = hash2(Math.floor(u / 4), Math.floor(v * 2), 21) > 0.86;
    return grain(line ? shade(PAL.deskTop, 0.92) : PAL.deskTop, u, v, 0.03, 4, 1);
  }
  return v < t ? shade(PAL.deskTop, 1.05) : v < 1.5 ? PAL.deskTop : PAL.deskTopDark;
};

const deskBodyTex: Tex = (face, u, v, w, h, t) => {
  if (rim(u, v, w, h, t)) return shade(PAL.deskBody, 0.78);
  if (face === 2) {
    const dv = v % 7;
    if (dv < t) return shade(PAL.deskBody, 0.72);
    if (dv < t * 2) return shade(PAL.deskBody, 1.12);
    if (dv > 3 && dv < 4 && u > w / 2 - 2.5 && u < w / 2 + 2.5) return PAL.steelLight;
  }
  return PAL.deskBody;
};

const keyboardTex: Tex = (face, u, v, w) => {
  if (face !== 0) return PAL.keyboard;
  const ku = u % 1.6, kv = v % 1.6;
  if (u > 0.4 && u < w - 0.4 && v > 0.4 && v < 15.4 && ku > 0.3 && kv > 0.3) return kv < 0.6 ? shade(PAL.keyCap, 1.15) : PAL.keyCap;
  return PAL.keyboard;
};

const mugTex: Tex = (face, u, v) => (face === 0 ? (disc(u, v, 1.5, 1.5, 0.9) ? 0x3b2a20 : PAL.mug) : v < 1 ? shade(PAL.mug, 0.86) : PAL.mug);

const trayTex: Tex = (face, u, v, w, h, t) => {
  if (face !== 0) return v < t ? PAL.trayLip : PAL.tray;
  const across = w > h ? v : u;
  const span = w > h ? h : w;
  if (across < 0.75 || across >= span - 0.75) return PAL.trayLip;
  return Math.floor(across / 0.9) % 2 ? PAL.cable : shade(PAL.cable, 1.45);
};

const rackBodyTex: Tex = (face, u, v, w, h, t) => {
  if (rim(u, v, w, h, t)) return PAL.rackEdge;
  const bolt = (bu: number, bv: number) => disc(u, v, bu, bv, 0.55);
  if (face === 0) {
    if (band(u, v, w, h, 1.2)) return bolt(1.6, 1.6) || bolt(w - 1.6, 1.6) || bolt(1.6, h - 1.6) || bolt(w - 1.6, h - 1.6) ? PAL.bolt : PAL.rackFrame;
    const gu = frac(u / 1.5), gv = frac(v / 1.5);
    return gu > 0.35 && gu < 0.75 && gv > 0.35 && gv < 0.75 ? PAL.serverLine : PAL.rackFrame;
  }
  if (face === 2) {
    if (bolt(2.2, 2.2) || bolt(w - 2.2, 2.2) || bolt(2.2, h - 2.2) || bolt(w - 2.2, h - 2.2)) return PAL.bolt;
    if (band(u, v, w, h, 1)) return shade(PAL.rackFrame, 1.12);
    const col = u % 4;
    const inSlotRow = v > 7 && v < h - 9 && v % 9 < 6.5 && u > 3 && u < w - 3;
    if (inSlotRow && col > 1.6 && col < 2.4) return PAL.vent;
    if (inSlotRow && col >= 2.4 && col < 2.4 + t) return shade(PAL.rackFrame, 1.25);
  }
  return PAL.rackFrame;
};

/** Rack A's body: the shared cabinet plus a small RackSentinel equipment plate on its side. */
const PLATE = { u0: 4.5, u1: 19.5, v0: 25, v1: 34, px: 0.42 } as const;
/** Electrical hazard marking above the controller module. */
const TRIANGLE = { u0: 9, v0: 7.5, s: 6 } as const;
const rackATex: Tex = (face, u, v, w, h, t) => {
  if (face === 2 && inRect(u, v, PLATE.u0, PLATE.v0, PLATE.u1, PLATE.v1)) {
    const pu = u - PLATE.u0, pv = v - PLATE.v0, pw = PLATE.u1 - PLATE.u0, ph = PLATE.v1 - PLATE.v0;
    if (rim(pu, pv, pw, ph, t)) return shade(PAL.plate, 0.7);
    const cw = (s: string) => (s.length * 4 - 1) * PLATE.px;
    const line = (s: string, v0: number) => textPixel(s, (pw - cw(s)) / 2, v0, pu, pv, PLATE.px);
    if (pv < 2.75) return line("RISC-V", 0.6) ? PAL.plate : PAL.serverLine; // inverted header band
    return line("RACK", 3.4) || line("SENTINEL", 5.9) ? PAL.serverLine : PAL.plate;
  }
  if (face === 2) {
    // yellow electrical-hazard triangle with an exclamation mark
    const tu = u - TRIANGLE.u0, tv = v - TRIANGLE.v0, S2 = TRIANGLE.s, H2 = S2 * 0.88;
    const half = (vv: number) => (vv / H2) * (S2 / 2);
    if (tv >= 0 && tv < H2 && Math.abs(tu - S2 / 2) <= half(tv)) {
      const inner = tv > 0.9 && tv < H2 - 0.5 && Math.abs(tu - S2 / 2) <= half(tv - 0.9) - 0.15;
      if (!inner) return PAL.serverLine;
      if (Math.abs(tu - S2 / 2) < 0.35 && ((tv > 2 && tv < 3.7) || (tv > 4.0 && tv < 4.5))) return PAL.serverLine;
      return PAL.safetyYellow;
    }
  }
  return rackBodyTex(face, u, v, w, h, t);
};

/** Pull a texture toward the room haze: background objects stay quieter than Rack A. */
function hazed(tex: Tex, k: number): Tex {
  return (face, u, v, w, h, t) => {
    const c = tex(face, u, v, w, h, t);
    return c === CLEAR || c & EMISSIVE ? c : mix(c, PAL.bgHaze, k);
  };
}

/**
 * Idle-LED spots on the background racks (world positions, on the door front). The static
 * door shows them dark; a few light up dimly each frame. Nothing here reads controller state.
 */
export const BG_LEDS: { x: number; y: number; z: number; rate: number }[] = [];

/** Door front of a background rack: its own fit-out per variant, never any indicators. */
function bgDoorTex(variant: 0 | 1): Tex {
  return (face, u, v, w, h, t) => {
    if (face !== 1) return rim(u, v, w, h, t) ? PAL.rackEdge : PAL.rackFrame;
    if (v < 1 || v >= h - 1 || u < 0.75 || u >= w - 0.75) return v < t || u < t ? shade(PAL.rackEdge, 1.2) : PAL.rackEdge;
    const ear = u < 2.25 || u >= w - 2.25;
    if (variant === 0) {
      // blanking panel, five 2U servers, a mesh section, kick plate
      if (v < 5) return v < 1.5 || v >= 4.5 ? PAL.serverLine : (u % 3) < 1.5 && v > 2.5 && v < 3.5 ? PAL.vent : shade(PAL.serverFace, 0.95);
      if (v < 45) {
        const rv = (v - 5) % 8;
        if (rv < 0.5) return PAL.serverLine;
        if (ear) return shade(PAL.serverFace, 0.85);
        if (rv >= 2 && rv < 6.5 && u >= 3 && u < 17) {
          const bu = (u - 3) % 3.5; // drive bays
          return bu < t || rv < 2 + t || rv >= 6.5 - t ? PAL.serverLine : bu < 0.6 ? shade(PAL.serverFace, 1.1) : PAL.serverFace;
        }
        if (rv >= 3.5 && rv < 4.5 && u >= 20.5 && u < 21.5) return PAL.ledOff;
        return PAL.serverFace;
      }
      if (v < 70) {
        if (v < 46) return PAL.serverLine;
        const hu = frac(u / 1.5), hv = frac(v / 1.5);
        return hu > 0.3 && hu < 0.7 && hv > 0.3 && hv < 0.7 ? PAL.vent : shade(PAL.serverFace, 0.95);
      }
      return (u % 2) < 1 && v > 71 ? PAL.vent : shade(PAL.serverFace, 0.9);
    }
    // variant 1: patch panel, two storage shelves, six 1U servers, kick plate
    if (v < 4) return v < 1.5 ? PAL.serverLine : (u % 1.5) < 0.75 && v > 2 && v < 3.25 && !ear ? PAL.fanBg : shade(PAL.serverFace, 0.9);
    if (v < 38) {
      const rv = (v - 4) % 17;
      if (rv < 0.5) return PAL.serverLine;
      if (ear) return shade(PAL.serverFace, 0.85);
      const du = (u - 2.5) % 3.5, dv = (rv - 1) % 5;
      if (u >= 2.5 && u < 23.5 && rv >= 1 && rv < 16) {
        if (du < t || dv < t) return PAL.serverLine;
        if (dv >= 3.5 && dv < 4.25 && du >= 2.25 && du < 3) return PAL.ledOff;
        return dv < 1 ? shade(PAL.serverFace, 1.08) : PAL.serverFace;
      }
      return PAL.serverFace;
    }
    if (v < 62) {
      const rv = (v - 38) % 4;
      if (rv < 0.5) return PAL.serverLine;
      if (ear) return shade(PAL.serverFace, 0.85);
      if (rv >= 1.5 && rv < 2.5 && u >= 21 && u < 22) return PAL.ledOff;
      if (u >= 3 && u < 16 && rv >= 1.25 && rv < 3.25) return frac((u - 3) / 1.4) < 0.45 ? PAL.vent : PAL.serverFace;
      return PAL.serverFace;
    }
    return (u % 2) < 1 && v > 63 ? PAL.vent : shade(PAL.serverFace, 0.9);
  };
}

// LED spots must match the texture rules above (door starts at rack x + 1, y = 26).
for (const b of BACKGROUND_RACKS) {
  const top = b.h - 1; // door top z (door spans z 1 .. h - 1)
  const fx = b.x + 1;
  if (b.variant === 0) {
    for (let k = 0; k < 5; k++) BG_LEDS.push({ x: fx + 20.5, y: b.y + b.d + 2, z: top - (5 + k * 8 + 3.5) - 1, rate: 0.7 + (k % 3) * 0.35 });
  } else {
    for (let k = 0; k < 6; k++) BG_LEDS.push({ x: fx + 21, y: b.y + b.d + 2, z: top - (38 + k * 4 + 1.5) - 1, rate: 0.5 + (k % 2) * 0.45 });
    for (let k = 0; k < 2; k++) BG_LEDS.push({ x: fx + 2.5 + 2.25 + k * 7, y: b.y + b.d + 2, z: top - (4 + 1 + 3.5) - 0.75, rate: 1.6 });
  }
}

function drawBackgroundRack(r: Raster, b: BackgroundRack): void {
  r.drawBox({ x: b.x, y: b.y, z: 0, w: b.w, d: b.d, h: b.h, tex: hazed(rackBodyTex, 0.2) });
  r.drawBox({ x: b.x + 1, y: b.y + b.d, z: 1, w: b.w - 2, d: 2, h: b.h - 2, tex: hazed(bgDoorTex(b.variant), 0.18) });
  // roof accessories differ: a cable manager on B, a small fan tray on C
  if (b.variant === 0) r.drawBox({ x: b.x + 4, y: b.y + 4, z: b.h, w: b.w - 8, d: 12, h: 2, tex: hazed(trayTex, 0.3) });
  else r.drawBox({ x: b.x + 6, y: b.y + 5, z: b.h, w: 16, d: 12, h: 3, tex: hazed(rackBodyTex, 0.25) });
}

/** A few dim activity LEDs on Racks B and C. Fixed patterns, unrelated to Rack A's state. */
export function drawBackgroundLeds(r: Raster, time: number, reducedMotion: boolean): void {
  const lit = mix(PAL.ledIdle, PAL.bgHaze, 0.4) | EMISSIVE;
  for (let i = 0; i < BG_LEDS.length; i++) {
    const L = BG_LEDS[i];
    // slower and steadier than Rack 01, so the controlled rack reads as the live one
    const step = Math.floor(time * (reducedMotion ? 0.1 : L.rate * 0.45));
    if (hash2(i, step, 31) < 0.55) continue;
    r.drawBox({ x: L.x, y: L.y, z: L.z, w: 1, d: 0.3, h: 0.75, tex: lit });
  }
}

const cabinetTex: Tex = (face, u, v, w, h, t) => {
  if (rim(u, v, w, h, t)) return PAL.cabinetDark;
  if (face !== 2) return face === 0 ? shade(PAL.cabinet, 1.05) : PAL.cabinet;
  // two doors facing the room, handles near the split, louvres at the foot
  const split = w / 2;
  if (Math.abs(u - split) < t) return PAL.cabinetDark;
  if (v > 22 && v < 28 && (Math.abs(u - (split - 1.5)) < 0.4 || Math.abs(u - (split + 1.5)) < 0.4)) return PAL.steelLight;
  if (v > h - 9 && v < h - 3 && (v % 1.5) < 0.6 && Math.abs(u - split) > 2 && u > 2 && u < w - 2) return PAL.cabinetDark;
  return grain(PAL.cabinet, u, v, 0.03, 12);
};

const caseTex: Tex = (face, u, v, w, h, t) => {
  if (rim(u, v, w, h, t)) return shade(PAL.caseShell, 0.8);
  if (face === 0) return Math.abs(v - h / 2) < 0.6 && Math.abs(u - w / 2) < 2.5 ? PAL.steelDark : PAL.caseShell; // carry handle
  if (Math.abs(v - 1.6) < 0.5) return shade(PAL.caseShell, 0.75); // lid seam
  if (face === 1 && v > 1 && v < 2.6 && (Math.abs(u - 2.5) < 0.6 || Math.abs(u - (w - 2.5)) < 0.6)) return PAL.steel; // latches
  return PAL.caseShell;
};

/** Wall-mounted panel light: a housing with a lit lens strip on its underside edge. */
const fixtureTex: Tex = (face, u, v, w, h, t) => {
  if (face === 1 && v > h - 1.1 && u > 0.5 && u < w - 0.5) return PAL.fixtureLens | EMISSIVE;
  return rim(u, v, w, h, t) ? shade(PAL.fixture, 0.8) : PAL.fixture;
};

function drawTrolley(r: Raster): void {
  const { x, y, w, d } = TROLLEY;
  const steel = mix(PAL.steelDark, PAL.bgHaze, 0.3);
  for (const [lx, ly] of [[x, y], [x + w - 1, y], [x, y + d - 1], [x + w - 1, y + d - 1]]) {
    r.drawBox({ x: lx, y: ly, z: 1, w: 1, d: 1, h: 13, tex: steel });
    r.drawBox({ x: lx - 0.25, y: ly - 0.25, z: 0, w: 1.5, d: 1.5, h: 1, tex: PAL.fanRim }); // castor
  }
  const shelf: Tex = (face, u, v, sw, sh, t) => (rim(u, v, sw, sh, t) ? shade(steel, 0.85) : face === 0 ? mix(PAL.cabinet, PAL.bgHaze, 0.3) : steel);
  r.drawBox({ x, y, z: 3, w, d, h: 1, tex: shelf });
  r.drawBox({ x, y, z: 13.5, w, d, h: 1.25, tex: shelf });
  r.drawBox({ x: x + w - 1, y: y + 1, z: 14.75, w: 1, d: d - 2, h: 8, tex: steel }); // push handle
  r.drawBox({ x: x + w - 1, y: y + 1, z: 22, w: 1, d: d - 2, h: 1, tex: shade(steel, 1.15) });
  r.drawBox({ x: x + 2, y: y + 1.5, z: 14.75, w: 12, d: 7, h: 5, tex: caseTex }); // maintenance case
  r.drawBox({ x: x + 3, y: y + 2.5, z: 4, w: 8, d: 5, h: 3, tex: mix(PAL.caseShell, PAL.bgHaze, 0.2) }); // spare parts box
}

/** Black entrance mat with a bound edge; its logo lettering is a decal (see decals.ts). */
const matTex: Tex = (face, u, v, w, h, t) => {
  if (face !== 0) return v < t ? 0x1c1e21 : 0x0c0d0f;
  if (band(u, v, w, h, 0.9)) return rim(u, v, w, h, t) ? 0x2a2c30 : 0x1d1f22;
  return grain(0x111214, u, v, 0.1, 41, 0.5); // coir texture
};

/** Graphite team plaque with a steel rim; the CoreX lettering is a decal (see decals.ts). */
const teamSignTex: Tex = (face, u, v, w, h, t) => {
  if (face !== 1) return rim(u, v, w, h, t) ? PAL.steelDark : 0x1f2328;
  if (rim(u, v, w, h, t)) return PAL.steel;
  return band(u, v, w, h, 0.6) ? 0x2b3036 : 0x1a1d21;
};

const housingTex: Tex = (face, u, v, w, h, t) => {
  if (rim(u, v, w, h, t)) return PAL.resetHousingDark;
  if (face === 2) {
    if (v >= 1 && v < 6.5 && u >= 1 && u < w - 1) return textPixel("P0", w / 2 - 3.5, 1.25, u, v) ? PAL.serverLine : PAL.resetLabel;
    if (disc(u, v, 1.6, h - 1.6, 0.5) || disc(u, v, w - 1.6, h - 1.6, 0.5)) return PAL.bolt;
  }
  return PAL.resetHousing;
};

/** Wall schematic of the RackSentinel SoC: a block diagram in thin light lines on a blueprint board. */
const schematicTex: Tex = (face, u, v, w, h, t) => {
  if (face !== 1) return PAL.steelDark;
  if (rim(u, v, w, h, t)) return PAL.steel;
  if (band(u, v, w, h, 0.7)) return shade(PAL.blueprint, 0.8);
  const ink = PAL.blueprintInk;
  if (textPixel("SOC", 1.5, 1.3, u, v, 0.5)) return ink;
  if (v > 4 && v < 4 + t * 1.5 && u > 1.5 && u < w - 1.5) return shade(ink, 0.6);
  // blocks (CPU, memory, UART, GPIO, controller I/O) joined by a bus
  const boxes: [number, number, number, number][] = [[2, 6, 9, 11], [11, 6, 18, 11], [2, 13, 9, 18], [11, 13, 18, 18], [20, 6, 24, 18]];
  for (const [a0, b0, a1, b1] of boxes) {
    if (inRect(u, v, a0, b0, a1, b1)) return rim(u - a0, v - b0, a1 - a0, b1 - b0, t) ? ink : PAL.blueprint;
  }
  if (Math.abs(v - 12) < t && u > 5.5 && u < 20) return ink;
  if ((Math.abs(u - 5.5) < t || Math.abs(u - 14.5) < t) && v > 11 && v < 13) return ink;
  return PAL.blueprint;
};

/** Maintenance clipboard by P0: board, clip, a ticked checklist. */
const clipboardTex: Tex = (face, u, v, w, h, t) => {
  if (face !== 1) return PAL.clipboard;
  if (v < 1.2 && Math.abs(u - w / 2) < 1.6) return PAL.steelLight;
  if (rim(u, v, w, h, t) || u < 0.6 || u >= w - 0.6 || v < 1 || v >= h - 0.5) return PAL.clipboard;
  if (v > 2 && (v - 2) % 1.4 < Math.max(t, 0.3) && u > 1.6 && u < w - 1) return 0x8c949c;
  if (v > 2 && (v - 2) % 1.4 < 0.9 && u > 0.9 && u < 1.4) return 0x6d8a72;
  return PAL.paper;
};

/** Fire-extinguisher cabinet: muted red (never an alarm colour), glazed door, extinguisher inside. */
const extinguisherTex: Tex = (face, u, v, w, h, t) => {
  if (face !== 2 || rim(u, v, w, h, t)) return rim(u, v, w, h, t) ? shade(PAL.extinguisher, 0.7) : PAL.extinguisher;
  if (inRect(u, v, 1.2, 1.5, w - 1.2, h - 2.5)) {
    if (inRect(u, v, w / 2 - 1.4, 3.5, w / 2 + 1.4, h - 3)) return v < 4.5 ? 0x2b2b2b : 0x8f2f2a;
    return v - u * 0.6 > 4 && v - u * 0.6 < 4.6 ? 0x9fb2bd : 0x3a4650;
  }
  return PAL.extinguisher;
};

/** Spare cable reel: steel flanges, wound cable on top. */
const reelTex: Tex = (face, u, v, w, h, t) => {
  if (face === 0) {
    const r = Math.hypot(u - w / 2, v - h / 2);
    if (r > w / 2 - 0.4) return PAL.steelDark;
    if (r < 1) return PAL.steel;
    return Math.floor(r / 0.7) % 2 ? PAL.cable : shade(PAL.cable, 1.6);
  }
  if (v < 1 || v >= h - 1) return rim(u, v, w, h, t) ? shade(PAL.steelDark, 0.8) : PAL.steelDark;
  return Math.floor(u / 0.8) % 2 ? PAL.cable : shade(PAL.cable, 1.3);
};

const junctionTex: Tex = (face, u, v, w, h, t) => {
  if (rim(u, v, w, h, t)) return shade(PAL.steelDark, 0.8);
  if (face === 1 && disc(u, v, 1, 1, 0.35)) return PAL.bolt;
  if (face === 1 && inRect(u, v, 1.5, 3, w - 1.5, 4.6)) return PAL.safetyYellow;
  return PAL.steelDark;
};

const conduitTex: Tex = (face, u) => (face === 0 ? shade(PAL.conduit, 1.1) : u % 12 < 0.8 ? shade(PAL.conduit, 0.75) : PAL.conduit);

/** RackSentinel controller module on Rack 01's side. */
const moduleTex: Tex = (face, u, v, w, h, t) => {
  if (rim(u, v, w, h, t)) return PAL.serverLine;
  if (face === 2 && v > 1 && v < h - 1 && u > 3 && u < w - 1 && (u - 3) % 1.2 < 0.5) return PAL.vent;
  return 0x22272d;
};

/** Everything that never changes; rasterized once into the base layer. */
export function buildStatic(r: Raster): void {
  const { W, D, H, wall } = ROOM;
  r.clear(PAL.void);
  r.drawBox({ x: 0, y: 0, z: -6, w: W, d: D, h: 6, tex: floorTex });
  // left wall: u runs from the front corner (y = D) toward the back
  r.drawBox({ x: -wall, y: -wall, z: -6, w: wall, d: D + wall, h: H + 6, tex: wallTex({ door: [D - ACCESS_DOOR.y1, D - ACCESS_DOOR.y0], cornerAtStart: false }) });
  r.drawBox({ x: 0, y: -wall, z: -6, w: W, d: wall, h: H + 6, tex: wallTex({ vent: [22, 50, 36, 52], cornerAtStart: true }) });

  // wall-mounted panel lights: one over the desk side, a work light over Rack A's service aisle
  r.drawBox({ x: 22, y: 0, z: 75, w: 24, d: 2.5, h: 2.5, tex: fixtureTex });
  r.drawBox({ x: 124, y: 0, z: 75, w: 20, d: 2.5, h: 2.5, tex: fixtureTex });

  // power conduit along the back wall into Rack 01's side, fed from a junction box
  r.drawBox({ ...JUNCTION_BOX, tex: junctionTex });
  r.drawBox({ x: CONDUIT.x0, y: CONDUIT.y, z: CONDUIT.z, w: RACK.x - CONDUIT.x0, d: CONDUIT.size, h: CONDUIT.size, tex: conduitTex });
  r.drawBox({ x: 52.5, y: CONDUIT.y, z: JUNCTION_BOX.z + JUNCTION_BOX.h, w: CONDUIT.size, d: CONDUIT.size, h: ROOM.H - JUNCTION_BOX.z - JUNCTION_BOX.h, tex: conduitTex });

  // a few wall details: SoC schematic, maintenance clipboard by P0, extinguisher cabinet by the door
  r.drawBox({ ...SCHEMATIC, tex: schematicTex });
  r.drawBox({ ...CLIPBOARD, tex: clipboardTex });
  r.drawBox({ ...EXTINGUISHER, tex: extinguisherTex });

  // entrance mat with the competition logo, and the team plaque (both id NONE)
  r.drawBox({ x: DOOR_MAT.x, y: DOOR_MAT.y, z: 0, w: DOOR_MAT.w, d: DOOR_MAT.d, h: 0.4, tex: matTex });
  r.drawBox({ ...TEAM_SIGN, tex: teamSignTex });

  // background equipment, all with id NONE: storage cabinet, Racks B and C, a trolley
  r.drawBox({ ...CABINET, tex: hazed(cabinetTex, 0.12) });
  for (const b of BACKGROUND_RACKS) drawBackgroundRack(r, b);
  drawTrolley(r);
  r.drawBox({ ...CABLE_REEL, z: 0, tex: hazed(reelTex, 0.2) });

  // cable trays carrying the UART run from the terminal to the rack
  r.drawBox({ x: 0, y: 5, z: 68, w: 5, d: 79, h: 3, tex: trayTex });
  r.drawBox({ x: 0, y: 0, z: 68, w: 86, d: 5, h: 3, tex: trayTex });
  r.drawBox({ x: 0.5, y: 80, z: 24, w: 1.5, d: 1.5, h: 44, tex: PAL.cable });
  r.drawBox({ x: 0.5, y: 79, z: 66, w: 4, d: 3, h: 2, tex: PAL.trayLip }); // clamp

  // desk, keyboard, mouse, mug, monitor stand
  const T = OBJ.TERMINAL;
  r.drawBox({ x: 2, y: DESK.y + 1, z: 0, w: 22, d: 2, h: 21, tex: deskBodyTex, id: T });
  r.drawBox({ x: 2, y: 88, z: 0, w: 22, d: 11, h: 21, tex: deskBodyTex, id: T });
  r.drawBox({ x: DESK.x, y: DESK.y, z: 21, w: DESK.w, d: DESK.d, h: 3, tex: deskTopTex, id: T });
  r.drawBox({ x: 12, y: 68, z: 24, w: 5.5, d: 16, h: 0.75, tex: keyboardTex, id: T });
  r.drawBox({ x: 13.5, y: 86, z: 24, w: 2.5, d: 1.75, h: 0.75, tex: PAL.keyCap, id: T });
  r.drawBox({ x: 15, y: 91, z: 24, w: 3, d: 3, h: 4, tex: mugTex, id: T });
  r.drawBox({ x: 3.5, y: 72, z: 24, w: 5, d: 8, h: 0.75, tex: PAL.monitor, id: T });
  r.drawBox({ x: 4.5, y: 75, z: 24.75, w: 1.5, d: 2, h: 5, tex: shade(PAL.monitor, 1.2), id: T });

  // rack cabinet, the P0 station on its side, and the plinths on its roof
  r.drawBox({ ...RACK, tex: rackATex, id: OBJ.RACK });
  r.drawBox({ ...CONTROLLER_MODULE, tex: moduleTex, id: OBJ.RACK });
  r.drawBox({ ...RESET.housing, tex: housingTex, id: OBJ.BUTTON });
  r.drawBox({ x: RESET.cap.x, y: RESET.cap.y - 1, z: RESET.cap.z - 1, w: 1, d: RESET.cap.d + 2, h: RESET.cap.h + 2, tex: PAL.resetHousingDark, id: OBJ.BUTTON });
  r.drawBox({ x: BEACON.x - 1, y: BEACON.y - 1, z: 80, w: 8, d: 8, h: 2, tex: PAL.rackEdge, id: OBJ.RACK });
  r.drawBox({ x: AMBER_LAMP.x, y: AMBER_LAMP.y, z: 80, w: 6, d: 6, h: 2, tex: PAL.rackEdge, id: OBJ.RACK });

  vignette(r);
}

/** Hard-stepped vignette baked into the static layer: draws the eye toward the room centre. */
function vignette(r: Raster): void {
  const { w, h } = r;
  for (let y = 0; y < h; y++) {
    const dy = (y / h - 0.5) * 2;
    for (let x = 0; x < w; x++) {
      const dx = (x / w - 0.5) * 2;
      const d = dx * dx * 0.55 + dy * dy * 0.7;
      if (d < 0.5) continue;
      const i = y * w + x;
      if (r.depth[i] < -1e8) continue; // leave the empty background untouched
      const k = d > 0.85 ? 0.82 : 0.91;
      const c = r.color[i];
      r.color[i] = (0xff000000 | (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k)) >>> 0;
    }
  }
}

// ------------------------------------------------------------------ dynamic objects
export interface RackLook {
  time: number; // seconds
  tempClass: number; // 0 Normal, 1 Warm, 2 Hot, 3 Critical
  /** GPIO output byte: P4..P7 drive the four door lamps. */
  pins: number;
  overload: boolean;
  epo: boolean;
  /** Water on the leak sensor (P1). */
  leak: boolean;
  /**
   * Power to the eight servers, 0..1. It falls to 0 while the EPO has cut the rack and is eased,
   * so the servers go dark one unit at a time on a trip and boot one unit at a time on recovery.
   * The controller's own panel (P4–P7 lamps, class bar, beacon) is not on this feed: it stays lit
   * because it must keep running to hold the latch.
   */
  power: number;
  fanAngle: number;
  fanLevel: 0 | 1 | 2; // 0 normal, 1 boost (P4), 2 max (P5)
  ledRate: number;
  flash: boolean; // brief new-trip emphasis
  capPressed: boolean;
  capHeld: boolean;
  monitorState: "ok" | "warn" | "crit";
  monitorEpo: boolean;
  readings: { v: number; i: number; t: number; got: boolean };
  linkSilent: boolean;
  /** RackSentinel module heartbeat LED. */
  heartbeat: boolean;
  /** UART link indicator brightness 0..1 (fades when the link goes silent). */
  link: number;
  /** A rejected packet just arrived: the DCIM display tears briefly. */
  glitch: boolean;
}

const LAMP_U = [2.5, 8.5, 14.5, 20.5];
const semantic = (tempClass: number) => (tempClass === 3 ? PAL.crit : tempClass >= 1 ? PAL.warn : PAL.ok);

/** A round-cornered indicator lamp in [u0, u0+4) × [v0, v0+4); -2 means "outside the corner". */
function lamp(u: number, v: number, u0: number, v0: number, lit: boolean, color: number, t: number): number {
  const lu = u - u0, lv = v - v0;
  if ((lu < 0.75 || lu >= 3.25) && (lv < 0.75 || lv >= 3.25)) return -2;
  if (lu < 0.5 || lv < 0.5 || lu >= 3.5 || lv >= 3.5) return PAL.steelDark; // bezel
  if (!lit) return lu >= 1 && lu < 1.5 && lv >= 1 && lv < 1.5 ? shade(PAL.lampOff, 1.4) : PAL.lampOff;
  const spec = Math.max(t, 0.75);
  if (lu >= 1 && lu < 1 + spec && lv >= 1 && lv < 1 + spec) return 0xffffff | EMISSIVE;
  return (lv < 1.75 ? mix(color, 0xffffff, 0.25) : color) | EMISSIVE;
}

function doorTex(L: RackLook): Tex {
  const lamps = [!!(L.pins & 0x10), !!(L.pins & 0x20), !!(L.pins & 0x40), !!(L.pins & 0x80)];
  const lampColor = [PAL.warn, PAL.warn, PAL.warn, PAL.crit];
  const ledStep = Math.floor(L.time * L.ledRate);
  const bar = semantic(L.tempClass);
  const plate = 0x171b20;
  return (face: Face, u, v, w, h, t) => {
    if (face !== 1) return rim(u, v, w, h, t) ? PAL.rackEdge : PAL.rackFrame;
    if (v < 1 || v >= h - 1 || u < 0.75 || u >= w - 0.75) return v < t || u < t ? shade(PAL.rackEdge, 1.25) : PAL.rackEdge;

    // indicator group P4..P7
    if (v < 15) {
      if (v < 2 || v >= 14.5 || u < 1.5 || u >= w - 1.5) return PAL.serverLine;
      for (let k = 0; k < 4; k++) {
        const lu = LAMP_U[k];
        if (inRect(u, v, lu, 3, lu + 4, 7)) {
          const c = lamp(u, v, lu, 3, lamps[k], lampColor[k], t);
          return c === -2 ? plate : c;
        }
        if (textPixel(String(4 + k), lu + 0.5, 8.5, u, v)) return lamps[k] ? PAL.steelLight | EMISSIVE : PAL.steelDark;
      }
      return plate;
    }
    // temperature-class light bar; the segment pattern is a non-colour cue
    if (v < 18.5) {
      if (v < 16 || v >= 18 || u < 2 || u >= w - 2) return PAL.serverLine;
      if ((u - 2) % 2 < t) return PAL.serverLine;
      const idx = Math.floor((u - 2) / 2);
      // segment pattern by class: solid, every third off, alternate, every other pair
      const on = L.tempClass === 0 ? true : L.tempClass === 1 ? idx % 3 !== 2 : L.tempClass === 2 ? idx % 2 === 0 : idx % 4 < 1;
      return on ? bar | EMISSIVE : shade(bar, 0.3);
    }
    // eight 1U servers: unpowered units go dark, top unit first to come back, last to go
    if (v < 51) {
      const unit = Math.floor((v - 19) / 4), rv = (v - 19) % 4;
      const lit = L.power > (unit + 1) / 9;
      const body = lit ? PAL.serverFace : shade(PAL.serverFace, 0.5);
      if (rv < 0.5) return PAL.serverLine;
      if (u < 2.25 || u >= w - 2.25) {
        // rack ears with pull handles
        const handle = (u >= 1.1 && u < 1.6) || (u >= w - 1.6 && u < w - 1.1);
        return handle && rv > 1 && rv < 3.5 ? PAL.steelLight : shade(body, 0.85);
      }
      if (rv >= 1.6 && rv < 2.6 && ((u >= 19.5 && u < 20.5) || (u >= 21.5 && u < 22.5))) {
        if (!lit) return PAL.ledOff;
        const on = hash2(unit, ledStep + Math.floor(u), 7) > 0.45;
        return on ? PAL.ledIdle | EMISSIVE : PAL.ledOff;
      }
      // steady power LED: the clearest "this server is on" sign, and the first thing to go dark
      if (u >= 3 && u < 4 && rv >= 1.6 && rv < 2.6) return lit ? PAL.ledIdle | EMISSIVE : PAL.ledOff;
      if (u >= 4.6 && u < 12.5 && rv >= 1.25 && rv < 3.25) {
        const hu = frac((u - 4.6) / 1.2), hv = frac(rv - 1.25);
        return hu > 0.3 && hu < 0.75 && hv > 0.25 && hv < 0.75 ? PAL.vent : body;
      }
      if (u >= 13.5 && u < 18.5 && rv >= 1 && rv < 3.5) {
        const bayEdge = u < 13.5 + t || u >= 18.5 - t || rv < 1 + t || rv >= 3.5 - t || Math.abs(u - 16) < t / 2;
        return bayEdge ? PAL.serverLine : shade(body, lit ? 1.12 : 0.92);
      }
      return body;
    }
    // fan bank: two housings with corner screws
    if (v < 75) {
      if (v < 52) return PAL.serverLine;
      for (const [u0, u1] of [[1.5, 12.5], [13.5, 24.5]] as const) {
        if (u < u0 || u >= u1) continue;
        const cu = (u0 + u1) / 2, cv = 58;
        const hu = u - u0, hv = v - 52.5, size = u1 - u0;
        if (hv >= 0 && hv < size) {
          if (hu < t || hv < t || hu >= size - t || hv >= size - t) return PAL.serverLine;
          for (const [su, sv] of [[1.4, 1.4], [size - 1.4, 1.4], [1.4, size - 1.4], [size - 1.4, size - 1.4]]) {
            if (disc(hu, hv, su, sv, 0.5)) return PAL.bolt;
          }
          const r = Math.hypot(u - cu, v - cv);
          if (r > 5.1) return shade(PAL.fanRim, 1.6);
          if (r > 4.5) return PAL.fanRim;
          if (r < 0.5) return PAL.steelLight;
          if (r < 1.6) return PAL.fanHub;
          const a = Math.atan2(v - cv, u - cu) + L.fanAngle;
          const f = (((a / (Math.PI * 2)) * 5) % 1 + 1) % 1;
          const bladeW = L.fanLevel === 2 ? 0.56 : 0.42;
          if (f < bladeW) return f < 0.08 ? shade(PAL.fanBlade, 1.2) : PAL.fanBlade;
          return PAL.fanBg;
        }
        // speed bars under each fan: 1, 2 or 3 lit (non-colour speed cue)
        if (v >= 65.5 && v < 67) {
          const bu = u - (cu - 4.5);
          if (bu >= 0 && bu < 9 && bu % 3 < 2.25) return Math.floor(bu / 3) <= L.fanLevel ? PAL.steelLight | EMISSIVE : PAL.lampOff;
        }
      }
      return v >= 68 && (u % 2) < 1 ? PAL.vent : PAL.serverFace;
    }
    // kick plate
    return (u % 2) < 1 && v > 75.5 ? PAL.vent : shade(PAL.serverFace, 0.9);
  };
}

/** Caged beacon lens: bright core when lit, dark glass otherwise. */
function lensTex(lit: boolean, color: number, dim: number): Tex {
  return (face, u, v, w, h, t) => {
    if (face === 0) return lit ? mix(color, 0xffffff, rim(u, v, w, h, 0.75) ? 0.2 : 0.45) | EMISSIVE : shade(dim, 1.25);
    const cage = u % 2 < t * 1.5 || v % 3 < t * 1.5;
    if (cage) return lit ? shade(color, 0.45) : shade(dim, 0.6);
    if (!lit) return v < 1 ? shade(dim, 1.2) : dim;
    return (v < 1.5 || u < 1.5 ? mix(color, 0xffffff, 0.4) : color) | EMISSIVE;
  };
}

const capTex = (pressed: boolean, held: boolean): Tex => (face, u, v, w, h, t) => {
  if (held && v >= 2 && v < 3.6) return (u + v) % 2 < 1 ? 0x1c1c1c : PAL.resetLabel; // tape over a stuck button
  const c = pressed ? PAL.resetCapPressed : PAL.resetCap;
  if (face === 2 && rim(u, v, w, h, t)) return shade(c, 0.8);
  if (face === 2 && u < 2 && v < 2) return shade(c, 1.2);
  return c;
};

export function drawRackDynamic(r: Raster, L: RackLook): void {
  r.drawBox({ ...DOOR, tex: doorTex(L), id: OBJ.RACK });
  const beaconColor = L.flash ? mix(PAL.crit, 0xffffff, 0.5) : PAL.crit;
  r.drawBox({ x: BEACON.x, y: BEACON.y, z: 82, w: 6, d: 6, h: 7, tex: lensTex(L.epo, beaconColor, PAL.critDim), id: OBJ.RACK });
  r.drawBox({ x: BEACON.x + 1, y: BEACON.y + 1, z: 89, w: 4, d: 4, h: 1, tex: PAL.rackEdge, id: OBJ.RACK });
  r.drawBox({ x: AMBER_LAMP.x + 1, y: AMBER_LAMP.y + 1, z: 82, w: 4, d: 4, h: 4, tex: lensTex(L.overload, PAL.warn, PAL.warnDim), id: OBJ.RACK });
  // leak sensor: a small plate on the floor in front of the rack; water spreads around it when wet
  r.drawBox({ x: 92, y: 30, z: 0, w: 4, d: 3, h: 0.6, tex: L.leak ? PAL.water | EMISSIVE : PAL.steelDark, id: OBJ.RACK });
  if (L.leak) {
    for (const [x, y, w, d] of [[84, 27, 18, 8], [88, 34, 22, 6], [97, 26, 14, 5]] as const) {
      r.drawBox({ x, y, z: 0, w, d, h: 0.25, tex: (_f, u, v) => ((Math.floor(u * 2 + v * 3 + L.time * 2) % 7 === 0 ? mix(PAL.water, 0xffffff, 0.35) : PAL.water) | EMISSIVE) });
    }
  }
  const c = RESET.cap;
  r.drawBox({ x: c.x, y: c.y, z: c.z, w: L.capPressed ? 1.25 : c.w, d: c.d, h: c.h, tex: capTex(L.capPressed, L.capHeld), id: OBJ.BUTTON });
  // controller module heartbeat: neutral and quiet, present whenever the controller runs
  const m = CONTROLLER_MODULE;
  r.drawBox({ x: m.x + m.w, y: m.y + 1, z: m.z + m.h - 2, w: 0.3, d: 1.2, h: 1, tex: L.heartbeat ? PAL.ledIdle | EMISSIVE : PAL.ledOff, id: OBJ.RACK });
  // UART link indicator where the tray meets the rack
  const k = Math.max(0, Math.min(1, L.link));
  r.drawBox({ ...LINK_LED, tex: k > 0.05 ? mix(PAL.ledOff, PAL.ledIdle, k) | EMISSIVE : PAL.ledOff });
}

function monitorTex(L: RackLook): Tex {
  const head = L.monitorState === "crit" ? PAL.crit : L.monitorState === "warn" ? PAL.warn : PAL.ok;
  const { v: volts, i: amps, t: temp, got } = L.readings;
  const gauges = [
    { frac: (volts - 160) / 100, warnAt: -1, tripAt: -1 },
    { frac: amps / 200, warnAt: 128 / 200, tripAt: 160 / 200 },
    { frac: temp / 90, warnAt: 54 / 90, tripAt: 64 / 90 },
  ];
  const labels = ["V", "I", "T"];
  const screen = PAL.screenBg | EMISSIVE;
  return (face, u, v, w, h, t) => {
    if (face !== 2) return rim(u, v, w, h, t) ? shade(PAL.monitor, 1.3) : PAL.monitor;
    if (rim(u, v, w, h, t)) return shade(PAL.monitor, 1.5);
    if (u < 1 || v < 1 || u >= w - 1 || v >= h - 1.5) return v >= h - 1.25 && v < h - 0.5 && Math.abs(u - w / 2) < 0.6 ? PAL.ledIdle | EMISSIVE : PAL.monitor;
    const su = u - 1.5, sv = v - 1.5; // 23 × 16.5 screen
    if (su < 0 || sv < 0 || su >= 23 || sv >= 16.5) return screen;
    if (sv < 3) {
      // header: state colour + shape cue (check = normal, ! = warning, X = critical) and an EPO block
      if (L.monitorEpo && su >= 17) return (Math.floor(su) + Math.floor(sv)) % 2 ? PAL.crit | EMISSIVE : mix(PAL.crit, 0xffffff, 0.3) | EMISSIVE;
      const gu = su - 1, gv = sv - 0.25;
      let glyph = false;
      if (gu >= 0 && gu < 3 && gv >= 0 && gv < 2.5) {
        if (L.monitorState === "ok") glyph = gu < 1 ? Math.abs(gv - (1.3 + gu * 0.8)) < 0.45 : Math.abs(gv - (2.1 - (gu - 1) * 1.05)) < 0.45;
        else if (L.monitorState === "warn") glyph = gu >= 1.1 && gu < 1.9 && (gv < 1.4 || gv >= 1.9);
        else glyph = Math.abs(gu - gv * 1.2) < 0.5 || Math.abs(gu - (2.9 - gv * 1.2)) < 0.5;
      }
      return glyph ? screen : head | EMISSIVE;
    }
    // rejected packet: a brief horizontal tear across the display
    if (L.glitch && Math.floor(sv * 1.5 + L.time * 30) % 5 === 0) return mix(PAL.warn, PAL.screenBg, 0.45) | EMISSIVE;
    // link silent: frozen on the last reading, with a hold mark in the corner
    if (L.linkSilent && sv >= 15 && sv < 16.5 && su >= 19 && su < 22 && (su < 20 || su >= 21)) return PAL.warn | EMISSIVE;
    // live: a blinking cursor (stops with the link)
    if (!L.linkSilent && sv >= 15.25 && sv < 16.25 && su >= 0.5 && su < 1.5 && Math.floor(L.time * 1.8) % 2 === 0) return PAL.screenText | EMISSIVE;
    for (let g = 0; g < 3; g++) {
      const top = 4 + g * 4.25;
      if (sv >= top && sv < top + 3.5) {
        if (textPixel(labels[g], 0.5, top - 0.5, su, sv, 0.8)) return PAL.screenText | EMISSIVE;
        const bu = su - 4.5, span = 17.5;
        if (bu < 0) return screen;
        const gz = gauges[g];
        const tick = (at: number) => at > 0 && Math.abs(bu - at * span) < Math.max(t, 0.35);
        if (tick(gz.warnAt)) return PAL.warn | EMISSIVE;
        if (tick(gz.tripAt)) return PAL.crit | EMISSIVE;
        if (sv >= top + 0.75 && sv < top + 2.5 && bu < span) {
          const filled = got && bu < Math.max(0, Math.min(1, gz.frac)) * span;
          // live refresh: a soft scan line rolls down the gauges; frozen gauges dim
          const k = L.linkSilent ? 0.6 : Math.abs(sv - ((L.time * 5) % 16.5)) < 0.5 ? 1.18 : 1;
          return filled ? shade(PAL.screenText, k) | EMISSIVE : shade(PAL.screenText, 0.22) | EMISSIVE;
        }
        return screen;
      }
    }
    return screen;
  };
}

export function drawMonitor(r: Raster, L: RackLook): void {
  r.drawBox({ ...MONITOR, tex: monitorTex(L), id: OBJ.TERMINAL });
}
