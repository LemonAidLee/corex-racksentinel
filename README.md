# RackSentinel Digital Twin

An interactive, single-page behavioural digital twin of **RackSentinel**, the RISC-V rack safety controller in this repository. The page opens straight into a pixel-art operator room: an operator at a DCIM terminal, a row of three server racks, and a physical P0 reset button. Only the rack nearest the desk (Rack 01) is controlled by RackSentinel: it carries the P4–P7 indicators, the P0 station and the UART run. The two racks beside it are background equipment with no readings, controls or connection to the controller.

> **Simulation only.** The page is not connected to a physical rack or a live FPGA. Rack conditions and telemetry are simulated. The controller behaviour is a model of the submitted firmware, tested against the official cases. Fan spin, lamps and the beacon only illustrate output commands. P7 is an **EPO request** output, not a power disconnect.

## What it demonstrates

- Temperature classes: Normal below 27.0 °C, Warm from 27.0 °C through 32.0 °C (P4 Fan Boost), Critical above 32.0 °C (P5 Maximum Fan and a latched P7 EPO request).
- Current: Warning at 25.6 A and above (P6), trip above 32.0 A (P6 and a latched P7).
- The EPO request **stays latched**. Safe readings alone never clear it. Only a **new** P0 press clears it, and only when temperature is Normal and current is below 25.6 A. A held button can't clear a later trip.
- Invalid readings (reply `0x3C`) and bad CRCs (reply `0x5A`) change nothing. Voltage is validated and stored, but it never triggers protection.
- If telemetry stops, the controller keeps its last state, and P0 still works locally.

## Using it

| Action | How |
|---|---|
| Inspect the rack | Click the rack (or Tab to **RACK 01** and press Enter) |
| Press P0 | Click the reset button on the rack's side, or **P0 RESET**. The operator walks over and presses it |
| Change conditions / send packets | Click the DCIM terminal: sliders use real step sizes (1 V, 0.2 A, 0.5 °C), plus presets, a corrupted-CRC packet and an invalid reading |
| Scenarios | **Scenarios** rail at the middle right: pick a category (Rack, Power, Reset, Comms) and its scenarios slide out beside it, with the room re-centring alongside. 13 scripted, deterministic scenarios, each tagged with the official case it demonstrates. Each one shows the fault, then a simulated **external** recovery (new telemetry from the DCIM), and, when an EPO request is latched, the operator walks over and makes a new P0 press once readings are safe. The prompt bar says what each phase shows |
| Guided demo | **Guided demo** button in the toolbar or `G`; the step text appears at the middle right. Use `←` / `→` to step through it |

The room renders at three quality levels, chosen in the toolbar and remembered in the browser:

| Quality | Room raster | Use |
|---|---|---|
| Performance | 480 × 270 | Older or integrated graphics |
| Balanced | 720 × 405 | Laptops |
| Sharp (default) | 960 × 540 | Presentations and 1080p projectors |

Only a mode picked in the toolbar is remembered. If Sharp rendering keeps exceeding its frame budget, the app drops to Balanced for that session and says so in an alert; the next visit starts in Sharp again.

Keyboard: `Space` pause · `R` reset · `F` fullscreen · `M` mute · `H` screenshot mode · `G` guided demo · `Esc` close panel · `?` help.

On phones the page switches to a simplified observer view: a rack close-up, readings, outputs, a scenario picker and a large P0 button. Reduced motion follows the OS setting and can be toggled in the toolbar.

## Interface conventions

- **Room vs interface.** The room is pixel art and voxels; text painted in the room (P0, P4–P7, rack and terminal labels) uses the Silkscreen pixel font. Everything that belongs to the website (buttons, status, alerts, panels, help) is set in IBM Plex Sans, with measurements, raw values and protocol codes in IBM Plex Mono with tabular figures.
- **Colour.** Green, amber and red appear only for real controller states, and always next to an icon or shape. Steel blue is the neutral interface accent.
- **Primary status** at the top answers three questions: the rack condition, whether the EPO request is latched, and whether a P0 reset is available or blocked (and why).
- **Icons.** Interface icons come from one family, [Phosphor](https://phosphoricons.com) (`@phosphor-icons/react`). The 13 scenario icons are original voxel art generated in `src/components/scenarios/scenarioIcons.ts`.

## Develop

Requires Node 20 or later.

```bash
cd racksentinel-twin
npm install
npm run dev        # http://localhost:3000
npm test           # controller, scenario and demo unit tests (Vitest)
npm run lint
npm run typecheck
npm run build && npm start
```

## Deploy on Vercel

The app is a standard Next.js project inside the `racksentinel-twin/` folder of the repository.

1. Push the repository to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Set **Root Directory** to `racksentinel-twin`. Vercel detects Next.js automatically; the defaults (`npm install`, `next build`) need no changes.
4. Deploy. The page is fully static (prerendered), with no environment variables and no server functions.

Fonts (Silkscreen, IBM Plex Sans/Mono) are downloaded by `next/font` at build time and served from the deployment.

## Testing against the project evidence

`src/sim/controller.test.ts` replays every step of the official test cases **C01–C12** (`Equipe31_Submission_Files/TESTCASES_FINAL_C01-C12.md`, `testbench/tb_data_center_application.v`). It checks reply bytes, output pins and STATUS bytes, and checks every CRC against the verified `./emu` command lines. It also covers the 20 required behaviours: boundaries, independent and combined trips, latch persistence, refused resets, held P0, invalid telemetry, bad CRC, trip counting and no telemetry.

`src/sim/runtime.test.ts` plays every scenario and the guided demo and checks their end states and determinism.

## Relationship to the submission

Nothing in the submitted RTL, firmware, testbenches, evidence or documentation was modified. The controller model (`src/sim/controller.ts`) is a TypeScript port of `firmware/firmware_application/main.s`, with comments naming the matching firmware labels.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the system layout and for how to add technical panels.
