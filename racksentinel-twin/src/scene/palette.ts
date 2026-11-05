/**
 * Restrained industrial control-room palette. Semantic green / amber / red are reserved for
 * real system states (temperature class, P6, P7). Everything else is neutral steel and slate.
 */
export const PAL = {
  void: 0x0e1115, // matches --surface-base so the raster edge is invisible

  floorA: 0x3a4149,
  floorB: 0x363c44,
  floorSeam: 0x2a2f36,
  floorEdge: 0x22262c,
  perfTile: 0x4a525b,
  perfHole: 0x2c3138,

  wall: 0x56606b,
  wallDark: 0x4b545e,
  wallSeam: 0x414951,
  wallTrim: 0x2f353c,
  baseboard: 0x2a2f35,
  door: 0x67717c,
  doorDark: 0x4c555f,
  doorHandle: 0xa8b0b8,

  steel: 0x8a939c,
  steelDark: 0x5d6670,
  steelLight: 0xb4bcc4,
  bolt: 0x8d969f,

  rackBody: 0x24292f,
  rackFrame: 0x343b43,
  rackEdge: 0x4a525b,
  serverFace: 0x2e343b,
  serverLine: 0x1b1f24,
  vent: 0x20252a,
  ledIdle: 0x9fc9e8, // neutral activity blue-white, not a state colour
  ledOff: 0x2a3138,

  fanRim: 0x15181c,
  fanHub: 0x6f7882,
  fanBlade: 0x8f99a3,
  fanBg: 0x0d1013,

  deskTop: 0x7a6650,
  deskTopDark: 0x6b5843,
  deskBody: 0x4e5660,
  monitor: 0x1e2328,
  screenBg: 0x0f1a22,
  screenText: 0x8fb8cf,
  keyboard: 0x30363d,
  keyCap: 0x48505a,
  mug: 0xc9cfd5,

  chair: 0x2b3138,
  chairSeat: 0x3a424b,

  uniform: 0x2f4a6b,
  uniformDark: 0x263d58,
  trousers: 0x2a2f37,
  boots: 0x1a1d21,
  skin: 0xc49373,
  skinShade: 0xa87a5d,
  hair: 0x3b2a20,
  eye: 0x1a1414,
  badge: 0xd8dde2,

  resetHousing: 0x3f6a96,
  resetHousingDark: 0x305478,
  resetCap: 0xe8ebee,
  resetCapPressed: 0xb9bec4,
  resetLabel: 0xf2d24b, // small yellow label strip, industrial convention

  // background equipment and fittings: low contrast, pulled toward this haze
  bgHaze: 0x3c434b,
  cabinet: 0x5a636c,
  cabinetDark: 0x4a525b,
  caseShell: 0x30353b,
  fixture: 0x3b424a,
  fixtureLens: 0xd9e2e8,
  plate: 0xb4bcc4,
  hazard: 0x8c7b3e, // muted floor tape, not a state colour
  hazardDark: 0x2c3036,

  tray: 0x2d333a,
  trayLip: 0x3f464e,
  cable: 0x1f2328,

  pulse: 0xcfe9ff,
  pulseBad: 0xf2f2f2,

  // semantic
  ok: 0x3fb950,
  okDim: 0x1f4a2a,
  warn: 0xe3a51b,
  warnDim: 0x4d3a12,
  crit: 0xe5484d,
  critDim: 0x4a1a1c,
  lampOff: 0x2b2f34,

  highlight: 0xf3ecd2,

  // environment details
  water: 0x3c7fc4, // leak sensor puddle
  edgeLight: 0x3b5266, // floor-edge strip, cool and dim
  zonePaint: 0x6f8faa, // Rack 01 service-zone floor paint
  safetyYellow: 0xd9bf3f, // physical hazard marking, not a state colour
  blueprint: 0x22344a,
  blueprintInk: 0x9cc0dc,
  clipboard: 0x6b5843,
  paper: 0xd6dade,
  extinguisher: 0x7a3a36, // muted, so it never reads as an alarm
  conduit: 0x6a737c,
  coolLight: 0x9fc4e0,
} as const;
