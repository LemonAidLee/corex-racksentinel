import { describe, expect, it } from "vitest";
import { LOGICAL_H, LOGICAL_W, QUALITY_SCALE, QUALITY_SIZE, Raster, type Quality } from "./raster";
import { ANCHORS, BACKGROUND_RACKS, CHAIN, NODES, OBJ, OBSTACLES, OPERATOR_RADIUS, ORIGIN, RACK, ROOM, projectLogical } from "./layout";
import { FOCUS } from "./camera";
import { BG_LEDS, buildStatic, drawBackgroundLeds, drawMonitor, drawRackDynamic, type RackLook } from "./world";

const LOOK: RackLook = {
  time: 0, tempClass: 0, overload: false, epo: false, fanAngle: 0, fanLevel: 0, ledRate: 1, flash: false,
  capPressed: false, capHeld: false, monitorState: "ok", monitorEpo: false, readings: { v: 230, i: 127, t: 53, got: true }, linkSilent: false,
};
/** Every output on: Critical, current trip, EPO latched, P0 pressed. */
const ALARM: RackLook = {
  ...LOOK, tempClass: 3, overload: true, epo: true, fanLevel: 2, fanAngle: 1.3, flash: true, capPressed: true,
  monitorState: "crit", monitorEpo: true, readings: { v: 230, i: 161, t: 65, got: true },
};
const QUALITIES: Quality[] = ["performance", "balanced", "sharp"];

function scene(q: Quality, look = LOOK) {
  const S = QUALITY_SCALE[q];
  const r = new Raster(S, ORIGIN.ox, ORIGIN.oy);
  buildStatic(r);
  drawRackDynamic(r, look);
  drawBackgroundLeds(r, 0, true);
  drawMonitor(r, look);
  return r;
}

/** Object id under a world point, looking at the pixel its projection lands on. */
function idAt(r: Raster, p: readonly [number, number, number], dz = 0) {
  const [x, y] = r.project(p[0], p[1], p[2] - dz);
  return r.id[Math.floor(y) * r.w + Math.floor(x)];
}

describe("render quality scaling", () => {
  it("rasters are 480×270, 720×405 and 960×540", () => {
    expect(QUALITIES.map(QUALITY_SIZE)).toEqual(["480×270", "720×405", "960×540"]);
  });

  for (const q of QUALITIES) {
    it(`${q}: buffer size, logical projection and picking`, () => {
      const r = scene(q);
      expect(r.w).toBe(Math.round(LOGICAL_W * QUALITY_SCALE[q]));
      expect(r.h).toBe(Math.round(LOGICAL_H * QUALITY_SCALE[q]));
      // logical projection is identical at every quality (camera and anchors rely on it)
      expect(r.projectLogical(100, 26, 40)).toEqual([ORIGIN.ox + 74, ORIGIN.oy + 63 - 40]);
      expect(r.projectLogical(100, 26, 40)).toEqual(projectLogical(100, 26, 40));
      // Rack A, P0 and the terminal stay clickable at their anchors
      expect(idAt(r, ANCHORS.rackFront)).toBe(OBJ.RACK);
      expect(idAt(r, [119.5, 13, 29])).toBe(OBJ.BUTTON);
      expect(idAt(r, [9, 76, 40])).toBe(OBJ.TERMINAL);
      // outline bounds are tracked per id
      expect(r.bounds[OBJ.RACK * 4 + 2]).toBeGreaterThan(r.bounds[OBJ.RACK * 4]);
    });
  }

  it("higher quality resolves more pixels for the same object", () => {
    const area = (r: Raster) => r.id.reduce((n, id) => n + (id === OBJ.RACK ? 1 : 0), 0);
    const a1 = area(scene("performance")), a2 = area(scene("sharp"));
    expect(a2 / a1).toBeGreaterThan(3.6); // ≈ (S_sharp / S_performance)² = 4
    expect(a2 / a1).toBeLessThan(4.4);
  });
});

describe("background racks", () => {
  /** Points on each background rack's door front, body side and roof. */
  const probes = BACKGROUND_RACKS.flatMap((b) => [
    [b.x + b.w / 2, b.y + b.d + 2, b.h / 2],
    [b.x + b.w / 2, b.y + b.d + 2, b.h - 8],
    [b.x + b.w, b.y + b.d / 2, b.h / 2],
    [b.x + b.w / 2, b.y + b.d / 2, b.h + 0.5],
  ] as [number, number, number][]);

  for (const q of QUALITIES) {
    it(`${q}: Racks B and C carry no interactive id`, () => {
      const r = scene(q);
      for (const p of probes) expect(idAt(r, p), String(p)).toBe(OBJ.NONE);
      // nothing in Rack B/C's screen footprint is Rack A or the P0 button
      for (const b of BACKGROUND_RACKS) {
        const [x0] = r.project(b.x + 2, b.y + b.d, 40);
        const [x1] = r.project(b.x + b.w, b.y + 2, 40);
        const [, y] = r.project(b.x + b.w / 2, b.y + b.d, 40);
        for (let x = Math.ceil(x0); x < Math.floor(x1); x++) expect([OBJ.RACK, OBJ.BUTTON]).not.toContain(r.id[Math.floor(y) * r.w + x]);
      }
    });
  }

  it("do not respond to Rack A's outputs", () => {
    const calm = scene("sharp", LOOK), alarm = scene("sharp", ALARM);
    for (const b of BACKGROUND_RACKS) {
      const [x0] = calm.project(b.x, b.y + b.d + 2, 0);
      const [x1] = calm.project(b.x + b.w, b.y, 0);
      const [, y0] = calm.project(b.x, b.y, b.h + 3);
      const [, y1] = calm.project(b.x + b.w, b.y + b.d + 2, 0);
      let differ = 0, compared = 0;
      for (let y = Math.max(0, Math.floor(y0)); y < Math.min(calm.h, Math.ceil(y1)); y++)
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(calm.w, Math.ceil(x1)); x++) {
          const i = y * calm.w + x;
          // compare only Rack B/C pixels (Rack A's beacon may overlap the area at the top)
          if (calm.id[i] !== OBJ.NONE || alarm.id[i] !== OBJ.NONE || calm.depth[i] < -1e8) continue;
          compared++;
          if (calm.color[i] !== alarm.color[i]) differ++;
        }
      expect(compared).toBeGreaterThan(5000);
      expect(differ).toBe(0);
    }
  });

  it("idle LEDs are few and sit on the background racks only", () => {
    expect(BG_LEDS.length).toBeLessThanOrEqual(16);
    for (const L of BG_LEDS) {
      const onBg = BACKGROUND_RACKS.some((b) => L.x >= b.x && L.x < b.x + b.w && L.z > 0 && L.z < b.h);
      expect(onBg).toBe(true);
      expect(L.x).toBeGreaterThan(RACK.x + RACK.w);
    }
  });
});

describe("enlarged room layout", () => {
  it("is larger than the original 156 × 136 room and holds three racks", () => {
    expect(ROOM.W).toBeGreaterThan(156);
    expect(ROOM.D).toBeGreaterThan(136);
    expect(BACKGROUND_RACKS).toHaveLength(2);
    for (const b of BACKGROUND_RACKS) expect(b.x + b.w).toBeLessThanOrEqual(ROOM.W);
  });

  it("the whole room fits in the logical frame, so the room view shows all three racks and the desk", () => {
    const corners: [number, number, number][] = [
      [-ROOM.wall, -ROOM.wall, ROOM.H], [ROOM.W, -ROOM.wall, ROOM.H], [-ROOM.wall, ROOM.D, ROOM.H],
      [ROOM.W, ROOM.D, -6], [-ROOM.wall, ROOM.D, -6], [ROOM.W, -ROOM.wall, -6],
    ];
    for (const c of corners) {
      const [x, y] = projectLogical(...c);
      expect(x, String(c)).toBeGreaterThanOrEqual(0);
      expect(x, String(c)).toBeLessThanOrEqual(LOGICAL_W);
      expect(y, String(c)).toBeGreaterThanOrEqual(0);
      expect(y, String(c)).toBeLessThanOrEqual(LOGICAL_H);
    }
    expect(FOCUS.room.zoom).toBe(1);
  });

  it("anchors stay on their objects and inside the frame", () => {
    const r = scene("sharp");
    expect(idAt(r, ANCHORS.rackFront)).toBe(OBJ.RACK);
    expect(idAt(r, ANCHORS.rackSide, 0.5)).toBe(OBJ.RACK);
    expect(idAt(r, ANCHORS.monitor, 2)).toBe(OBJ.TERMINAL);
    expect(idAt(r, ANCHORS.desk, 0.5)).toBe(OBJ.TERMINAL);
    const [bx, by] = r.project(...ANCHORS.button);
    let near = false;
    for (let dy = -6; dy <= 6 && !near; dy++) for (let dx = -6; dx <= 6 && !near; dx++) near = r.id[(Math.floor(by) + dy) * r.w + Math.floor(bx) + dx] === OBJ.BUTTON;
    expect(near).toBe(true);
    for (const a of Object.values(ANCHORS)) {
      const [x, y] = projectLogical(a[0], a[1], a[2]);
      expect(x > 0 && x < LOGICAL_W && y > 0 && y < LOGICAL_H).toBe(true);
    }
  });

  it("the operator's walk graph stays clear of racks and furniture", () => {
    const dist = (x: number, y: number, [x0, y0, x1, y1]: number[]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
    for (let i = 1; i < CHAIN.length; i++) {
      const a = NODES[CHAIN[i - 1]], b = NODES[CHAIN[i]];
      for (let k = 0; k <= 20; k++) {
        const x = a.x + ((b.x - a.x) * k) / 20, y = a.y + ((b.y - a.y) * k) / 20;
        for (const o of OBSTACLES) expect(dist(x, y, o), `${CHAIN[i - 1]}→${CHAIN[i]} vs ${o}`).toBeGreaterThanOrEqual(OPERATOR_RADIUS);
      }
    }
    // the operator only ever reaches Rack A: P0 is the last node, beside Rack A and before Rack B
    expect(CHAIN[CHAIN.length - 1]).toBe("button");
    expect(NODES.button.x).toBeLessThan(BACKGROUND_RACKS[0].x - OPERATOR_RADIUS);
  });
});
