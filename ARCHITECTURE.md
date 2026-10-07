# Architecture

```
src/
  sim/        deterministic model: no DOM, no rendering, fully unit-tested
    crc.ts         CRC-16/CCITT (0x1021, init 0xFFFF), as the `crcb` instruction
    protocol.ts    frame encoders, command/reply/pin/status constants
    controller.ts  RackSentinelController: port of main.s (frames in, replies + pins out, P0 polls)
    units.ts       raw-step conversions (1 V, 0.2 A, 0.5 °C)
    events.ts      typed EventBus and the SimEvents vocabulary
    scenarios.ts   13 timed scenarios (step lists), including external recovery and operator acknowledgement
    recovery.ts    RecoveryCoordinator: when to send the operator to P0, result hold, scenario completion
    runtime.ts     SimulationRuntime: clock, telemetry stream, scenario playback, notices, React store
    demo.ts        GuidedDemo: beats built from scenario steps, instant rebuild for "back"
  scene/      2.5D renderer: a tiny isometric voxel rasterizer on Canvas 2D
    raster.ts      per-pixel box rasterizer at render scale S: z-buffer, id buffer, light pools, outlines
    world.ts       procedural room geometry and pixel textures; rack, beacon, monitor, button visuals
    operator.ts    operator movement (walk graph, press/release actions) and voxel model
    camera.ts      fixed-angle camera presets and the one-shot trip push-in
    game.ts        loop: advances the runtime, renders, picks, glues DOM anchors to world points
    layout.ts      world coordinates (room, Rack A, background racks, furniture), object ids, anchors, walk graph
  audio/sound.ts  WebAudio cues driven by SimEvents (alarm plays once per new trip)
  components/   React HUD, contextual panels, accessibility layer
    panels/technical.ts   extension point for technical tabs (empty on purpose)
```

## Data flow

1. **Time** moves only through `SimulationRuntime.advance(dt)`, called by the game loop. Pause stops it, and hidden tabs stop the loop entirely. Scenarios and the telemetry stream are scheduled on this clock, so playback is deterministic and testable without a browser.
2. **Telemetry**: `runtime.transmit()` encodes a real SAMPLE frame (with CRC) from the simulated rack conditions and feeds it to the controller. It emits `telemetry`, `trip`, `warning`, `notice` and `state` events.
3. **P0**: the operator's press animation calls `runtime.buttonDown()` and `buttonUp()`. Each level change runs the firmware's `check_reset` poll, which reports `accepted` or a specific refusal.
4. **React** reads an immutable snapshot through `useSyncExternalStore`. The snapshot changes only on events, never per frame. Continuous values (fan angle, operator position, camera) live in the game loop. DOM overlays are positioned by writing `transform` directly.
5. **Scene** derives everything visible from `runtime.controller.state` every frame. The rack shows what the controller requests; a heat shimmer reflects the external condition.

## Scenario recovery

RackSentinel has no thermal model and no actuators: P5 requests maximum fans but never changes a reading. A scenario recovers only through `recover` steps, which change the simulated rack environment and send a new SAMPLE through the DCIM path, exactly like any other telemetry.

When a scenario reaches an `acknowledge` step, `RecoveryCoordinator` arms. It sends the operator to P0 only when the EPO is latched, a valid temperature has been received, temperature is Normal, current is below the warning level, P0 is not held, and the operator is idle; and only after safe readings have been visible with P7 still latched for `dwell` ms (2 s by default). It acts solely through `runtime.pressReset()`, the same walk-and-press as a user's click, so the controller accepts or refuses the press by its normal rules. A refusal returns it to waiting; a manual press that clears the EPO first calls the operator off. After an accepted reset the result stays on screen for 2 s, the operator returns to the desk and the scenario completes. `restart()` and starting another scenario cancel pending steps, the coordinator and the operator, and release P0.

The `stage` of the running scenario (what it is demonstrating right now) is part of the snapshot and shown in the prompt bar, the compact bar above the Scenarios toggle on narrower screens, and the observer view.

## Adding a technical panel

The rack inspector renders a tab bar only when panels are registered. To add one, for example a UART packet inspector:

```ts
// src/components/panels/tech/UartInspector.tsx
import type { TechnicalPanelProps } from "../technical";
export default function UartInspector({ snapshot }: TechnicalPanelProps) { /* … */ }

// src/components/panels/technical.ts
export const TECHNICAL_PANELS: TechnicalPanel[] = [
  { id: "uart", title: "UART", load: () => import("./tech/UartInspector") },
];
```

Panels are lazy-loaded (`React.lazy` + `Suspense`), so they cost nothing until opened. Use these sources of data:

| Future panel | Data source |
|---|---|
| UART packet inspector | `bus.on("telemetry")` → `result.frame`, `result.reply` |
| CRC calculation view | `crc.ts` `crcByte()` step by step |
| GPIO bit view | `snapshot.controller.pins`, `snapshot.p0Down` |
| Status / counters | `controller.statusFlags()`, `epoTrips`, `crcRejects` |
| Configurable thresholds | send `STAGE_HIGH` / `SET_*` frames with `encodeCommand()`; the model already validates them |
| SoC, memory map, firmware trace, waveforms, evidence | static data under `src/data/` plus links to `Documentation/attachments` |
| Multiple racks | one `SimulationRuntime` per rack; `layout.ts` gains rack offsets and ids |

Keep a new feature out of the visible UI until it works. Don't add disabled buttons or placeholders.

## Rendering and quality levels

- **Logical space vs raster space.** World coordinates never change. The room is composed in a 576 × 324 *logical* frame; the raster renders that frame at a render scale S chosen so the buffers are 480 × 270 (Performance), 720 × 405 (Balanced) and 960 × 540 (Sharp, the default). `Raster.project()` returns raster pixels, `Raster.projectLogical()` returns logical pixels. Camera presets, DOM anchors and pointer picking all work in logical space and convert with S only at the raster boundary, so composition, picking, outlines and panel alignment are identical at every quality.
- **Textures resolve, not shrink.** Texture callbacks receive continuous world coordinates `(u, v)` plus the size of one texel `t = 1/S`. Rules written in world units (bolts, seams, vent holes, fan blades, monitor gauges) gain real detail at higher S; one-pixel lines use `t` so they stay one pixel thick.
- **Per frame.** The static room (floor, walls, desk, Rack A body, Racks B and C, cabinet, trolley, wall lights, contact shadows, vignette) is rasterized once per quality change. Racks B and C add only a dozen tiny idle-LED boxes per frame and carry object id 0, so they are never picked or outlined. Each frame copies it into a work raster that writes straight into the `ImageData` buffer (no extra copy), then draws only dynamic parts: chair, operator, rack door, beacon, lamps, monitor, button cap, pulses, light pools, shimmer and the hover outline. Outline and shimmer buffers are preallocated; per-id bounds keep outlines cheap.
- **Fallback.** `Game.watchPerformance` tracks render cost per frame; if Sharp stays above its budget for 2.5 s it switches to Balanced and reports it.
- Canvas 2D only, nearest-neighbour upscaling, no WebGL dependency. If the context can't be created, a text fallback is shown and the controller simulation keeps running.
- All art is procedural and original. There are no external image assets. The door-mat logo (ChampionCHIP eXperience) and the CoreX team plaque are lettered once into small canvases (`scene/decals.ts`) and drawn onto their surfaces with the projection as an affine transform, because that lettering is too fine for the voxel raster.

## Interface layer

- `src/app/globals.css` defines semantic tokens (`--surface-*`, `--border-*`, `--text-*`, `--accent-interface`, `--state-*`, `--focus-ring`, `--shadow-panel`, `--radius-*`). State colours are mirrored in `src/lib/tokens.ts` for canvas-drawn UI art.
- `src/lib/present.ts` turns controller state into labelled, iconified status (condition, EPO, reset availability and blockers).
- `src/components/icons.tsx` is the single entry point for Phosphor interface icons.
- `src/components/scenarios/` holds the scenario icon system (`scenarioIcons.ts`: a voxel base rendered with the room's rasterizer plus outlined 2D pixel badges, 48 × 48, generated once and cached) and the drawer metadata (`meta.ts`: category, key value, effect, tone). Scenario behaviour stays in `src/sim/scenarios.ts`.
