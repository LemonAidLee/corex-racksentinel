# RackSentinel Digital Twin

An interactive behavioural digital twin of **RackSentinel v2**, the RISC-V rack safety controller that runs on the AWS FPGA (`../stage4_fpga/`). The main page opens straight into a pixel-art operator room: an operator at a DCIM terminal, a row of three server racks, a leak sensor on the floor and a physical P0 reset button. Only the rack nearest the desk (Rack 01) is controlled by RackSentinel. Two explainer pages sit beside it:

| Route | Page |
|---|---|
| `/` | The twin: the operator room, scenarios, guided demo, DCIM terminal |
| `/features` | Eleven feature cards: in plain words, why it matters, why it stands out, with live mini-demos |
| `/data-flow` | Each test case byte by byte: packets, the `crcb` CRC trace, firmware decisions, replies, pins, and the FPGA screenshot. Deep links: `/data-flow#R5` |

> **Simulation only.** The pages are not connected to a physical rack or a live FPGA. Rack conditions and telemetry are simulated. The controller is a byte-level model of the v2 firmware, checked against the nine runs that passed on the AWS FPGA and 1,000 cases replayed on the RTL. Fan spin, lamps and the beacon only illustrate output commands. P7 is a **power-off request**, not a disconnect.

## What it demonstrates

- **Temperature classes** (ASHRAE): Warm from 27.0 °C (P4 fan boost), Hot from 32.0 °C (P5 fans at maximum), Critical from 35.0 °C (P5 + P7 power-off, latched). A reading on a threshold takes the higher class.
- **Thermal runaway**: a rise of 2.0 °C or more between two readings latches P7 before any threshold.
- **Water leak** on P1: latches P7 with no message on the link.
- **Power = V × I** with a 5.9 kW limit: the P6 overload alarm follows the reading and never cuts power. **Energy** is metered in Wh.
- **ECC on the settings**: one flipped bit is repaired at the next use; two make the setting unreadable and latch P7 until the DCIM rewrites it.
- **Trip record** (cause, temperature, current), **STATUS** and **COUNTERS**.
- The latch clears only on a **new** P0 press once every cause is gone: below Critical, no runaway on the latest reading, leak sensor dry, no unreadable setting. A held button never clears it.
- Bad CRC (`5A`) and invalid values (`3C`) change nothing.

## Using it

| Action | How |
|---|---|
| Inspect the rack | Click the rack (or Tab to **RACK 01** and press Enter) |
| Press P0 | Click the reset button on the rack's side, or **P0 RESET**. The operator walks over and presses it |
| Change conditions / send packets | Click the DCIM terminal. **Readings**: temperature and current sliders (0.5 °C and 0.2 A steps) that walk gradually by default, presets, a cooling-failure jump, the leak sensor, a damaged packet and a raw-0 reading. **Commands**: STATUS, ENERGY, COUNTERS, TRIP_INFO, the six settings and the ECC self-test |
| Scenarios | **Scenarios** rail at the middle right, in four categories (Heat, Water, ECC, Reset). Thirteen deterministic scenarios tell Ali's day as an operator: nine match the FPGA runs R1 to R9 one to one (tagged "FPGA run R3" …), four are extras. Each shows the fault, then a simulated **external** recovery, and, when the power-off is latched, the operator walks over and presses P0 once a reset would be accepted |
| Guided demo | **Guided demo** button in the toolbar or `G`: Ali's shift in eleven steps (warm, hot, critical, refused and accepted reset, leak, a two-bit memory fault). Use `←` / `→` to step |

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
- **Primary status** at the top answers three questions: the rack condition, whether the power-off is latched (and why), and whether a P0 reset is available or blocked (and why).
- **Icons.** Interface icons come from one family, [Phosphor](https://phosphoricons.com) (`@phosphor-icons/react`). The scenario icons are original voxel art generated in `src/components/scenarios/scenarioIcons.ts`.

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

`src/sim/controller.test.ts` replays every step of the nine `./emu` runs that passed on the AWS FPGA and of the 1,000 demo cases JX replayed on the RTL (`src/sim/__fixtures__/emu-golden.json`, generated from `../stage4_fpga/rack_demo.html`). Each line carries its own expected replies and pins, so a single wrong byte fails the test. It also checks CRC-16, every ECC single and double error, the energy division and the data-flow cases.

`src/sim/runtime.test.ts` plays every scenario and the guided demo, checks their end states, the trip records they produce, and that the operator only presses P0 when a reset would be accepted. `src/sim/timeline.test.ts` checks the incident record, the causality chains and that every evidence check passes.

## Relationship to the project

The controller model (`src/sim/controller.ts`) is a port of the v2 firmware model in `stage4_fpga/rack_demo.html`, with comments naming the firmware routines (`cfg_get`, `epo_trip`, `check_inputs`, `update_outputs`). Nothing in the submitted RTL, firmware or evidence was modified. The FPGA screenshots used by `/data-flow` and `/features` are copies of `stage4_fpga/evidence/` in `public/evidence/`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the system layout.
