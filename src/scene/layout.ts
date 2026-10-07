/**
 * Room layout in world units (see raster.ts for axes).
 *
 * The desk stands against the left wall; three racks stand in a row against the back wall.
 * Rack A, nearest the operator, is the one RackSentinel controls: it carries the P4–P7 lamps,
 * the P0 station and the UART run. Racks B and C are background equipment with no id, no
 * readings and no controls. The service aisle between A and B gives the operator room at P0.
 */

export const ROOM = { W: 216, D: 152, H: 84, wall: 6 } as const;
/** Projection origin inside the logical frame, chosen to centre the diorama. */
export const ORIGIN = { ox: 256, oy: 112 } as const;

/** Interactive object ids written into the raster id buffer. Background objects use NONE. */
export const OBJ = { NONE: 0, RACK: 1, BUTTON: 2, TERMINAL: 3, OPERATOR: 4 } as const;
export type ObjId = (typeof OBJ)[keyof typeof OBJ];
export type Interactive = "rack" | "button" | "terminal";
export const OBJ_BY_NAME: Record<Interactive, number> = { rack: OBJ.RACK, button: OBJ.BUTTON, terminal: OBJ.TERMINAL };
export const NAME_BY_OBJ: Record<number, Interactive | undefined> = { [OBJ.RACK]: "rack", [OBJ.BUTTON]: "button", [OBJ.TERMINAL]: "terminal" };

/** Rack A: the RackSentinel-controlled rack. */
export const RACK = { x: 86, y: 0, z: 0, w: 28, d: 24, h: 80 } as const;
export const DOOR = { x: 87, y: 24, z: 1, w: 26, d: 2, h: 78 } as const;
export const BEACON = { x: 100, y: 9, z: 80 } as const;
export const AMBER_LAMP = { x: 89, y: 9, z: 80 } as const;
/** P0 reset station on the rack's right side, at the operator's shoulder height. */
export const RESET = { housing: { x: 114, y: 6, z: 22, w: 4, d: 14, h: 16 }, cap: { x: 118, y: 10, z: 26, w: 3, d: 6, h: 6 } } as const;

/** Racks B and C: environmental only. Same cabinet, different fit-out and height. */
export interface BackgroundRack { x: number; y: number; w: number; d: number; h: number; variant: 0 | 1 }
export const BACKGROUND_RACKS: readonly BackgroundRack[] = [
  { x: 150, y: 0, w: 28, d: 24, h: 80, variant: 0 },
  { x: 180, y: 0, w: 28, d: 24, h: 76, variant: 1 },
];
/** Clear floor between Rack A's P0 station and Rack B. */
export const SERVICE_AISLE = { x0: 122, x1: 150 } as const;

export const DESK = { x: 0, y: 56, w: 26, d: 44, top: 24 } as const;
export const MONITOR = { x: 5, y: 63, z: 29, w: 4, d: 26, h: 20 } as const;
export const CHAIR = { x: 38, y: 76 } as const;

/** Background furniture (no interaction). */
export const CABINET = { x: 0, y: 14, z: 0, w: 10, d: 22, h: 50 } as const;
export const TROLLEY = { x: 186, y: 46, w: 18, d: 10 } as const;
/** Access door in the left wall, between y0 and y1. */
export const ACCESS_DOOR = { y0: 114, y1: 134 } as const;
/** Entrance mat on the floor in front of the access door (ChampionCHIP eXperience logo). */
export const DOOR_MAT = { x: 3, y: 103, w: 17, d: 44 } as const;
/** Small CoreX team plaque on the back wall, above the ventilation grille. */
export const TEAM_SIGN = { x: 24, y: 0, z: 55, w: 24, d: 0.8, h: 10 } as const;

/** Points on the UART cable tray, from the DCIM terminal to Rack A (and only Rack A). */
export const UART_PATH: [number, number, number][] = [
  [1.5, 81, 26],
  [1.5, 81, 71],
  [2.5, 2.5, 71.5],
  [86, 2.5, 71.5],
];

/** Operator walk graph: a simple chain from the chair, down the service lane, to P0. */
export const NODES = {
  seat: { x: 38, y: 76 },
  stand: { x: 50, y: 76 },
  laneW: { x: 50, y: 40 },
  rack: { x: 100, y: 40 },
  laneE: { x: 130, y: 40 },
  button: { x: 130, y: 13 },
} as const;
export type NodeName = keyof typeof NODES;
export const CHAIN: NodeName[] = ["seat", "stand", "laneW", "rack", "laneE", "button"];

/** Half the operator's footprint, used to check that walk segments stay clear of furniture. */
export const OPERATOR_RADIUS = 7;

/** Footprints the operator must never walk through: [x0, y0, x1, y1]. */
export const OBSTACLES: [number, number, number, number][] = [
  [RACK.x, RACK.y, RACK.x + RACK.w + 7, RACK.y + RACK.d + 2], // Rack A with its door and P0 station
  ...BACKGROUND_RACKS.map((r) => [r.x, r.y, r.x + r.w, r.y + r.d + 2] as [number, number, number, number]),
  [DESK.x, DESK.y, DESK.x + DESK.w, DESK.y + DESK.d],
  [CABINET.x, CABINET.y, CABINET.x + CABINET.w, CABINET.y + CABINET.d],
  [TROLLEY.x, TROLLEY.y, TROLLEY.x + TROLLEY.w, TROLLEY.y + TROLLEY.d],
];

/** World points the camera and DOM overlays anchor to. */
export const ANCHORS = {
  rackTop: [100, 12, 92],
  rackFront: [100, 26, 40],
  rackSide: [114, 12, 70],
  button: [121, 13, 32],
  monitor: [9, 76, 52],
  desk: [14, 78, 24],
  room: [108, 76, 30],
} as const satisfies Record<string, readonly [number, number, number]>;
export type AnchorName = keyof typeof ANCHORS;

/** World → logical frame pixels (same formula as Raster.projectLogical). */
export const projectLogical = (x: number, y: number, z: number): [number, number] => [ORIGIN.ox + (x - y), ORIGIN.oy + (x + y) / 2 - z];
