"use client";
import { useEffect, useRef } from "react";
import { useSim } from "../context";
import { Icon } from "../icons";
import { epoInfo, fanInfo, leakInfo, PIN_LABELS, powerInfo, tempInfo } from "@/lib/present";
import { fmtAmps, fmtDegC, fmtKW } from "@/sim/units";

/** Text alternative to the graphical scene, always current. */
export function SceneDescription() {
  const { controller: s, p0Down, streaming } = useSim();
  const active = PIN_LABELS.filter((p) => s.pins & p.bit).map((p) => `${p.pin} ${p.name}`);
  return (
    <p className="scene-desc">
      An operator room with a monitoring desk, a DCIM terminal and a row of three server racks. Only the rack nearest the desk is
      connected to RackSentinel; the two racks beside it are background equipment with no readings or controls. The controlled
      rack has four output lamps (P4 to P7), two fans, a red power-off beacon, an amber overload lamp, a leak sensor on the
      floor in front of it and a P0 reset button on its side.{" "}
      {s.gotTemp
        ? `Latest readings: ${fmtDegC(s.latestTemp)}, ${fmtAmps(s.latestCurrent)}${s.power !== null ? `, ${fmtKW(s.power)}` : ""}. Temperature ${tempInfo(s).label}, power ${powerInfo(s).label}, fans ${fanInfo(s).label}, leak sensor ${leakInfo(s).label}. `
        : "No readings received yet. "}
      {active.length ? `Active outputs: ${active.join(", ")}. ` : "No outputs active. "}
      {epoInfo(s).label}. {p0Down ? "P0 is held down. " : ""}
      {streaming ? "Telemetry is streaming." : "Telemetry is stopped."}
    </p>
  );
}

const KEYS: [string, string][] = [
  ["Space", "Pause or resume"],
  ["R", "Reset simulation"],
  ["F", "Fullscreen"],
  ["M", "Mute"],
  ["H", "Screenshot mode (hide controls)"],
  ["G", "Start or exit guided demo"],
  ["← →", "Guided demo: previous / next step"],
  ["C", "Follow incident camera on or off"],
  ["T", "Event timeline"],
  ["E", "Evidence mode: expected vs observed"],
  ["L", "P4–P7 focus labels"],
  ["P", "Presentation mode"],
  ["Esc", "Close the active panel"],
  ["Tab", "Move between Terminal, Rack and P0"],
  ["?", "Open this help"],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="help panel panel-major" role="dialog" aria-modal="true" aria-label="About this simulation" ref={ref} onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h2 className="panel-title">About this digital twin</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close help"><Icon name="close" size={18} /></button>
        </header>
        <div className="help-cols">
          <section>
            <h3 className="section-label">What you are looking at</h3>
            <p>
              RackSentinel is a RISC-V system-on-chip whose firmware guards one server rack. A DCIM terminal sends temperature and
              current over UART in 4-byte packets, a leak sensor sits on P1, and the controller decides locally and drives four outputs.
              This twin models <b>v2</b>, the firmware that runs on the AWS FPGA.
            </p>
            <ul className="legend">
              <li><b>Simulated:</b> the room, the rack&apos;s conditions and the telemetry stream. Scenario recovery (cooling, load
                falling) is an external change sent as new telemetry: P5 requests fans but never changes the reading itself.</li>
              <li><b>One rack:</b> RackSentinel guards Rack 01 only. The two racks beside it are scenery.</li>
              <li><b>The operator</b> stands in for a person. In scenarios they press P0 once readings are safe; the controller still decides.</li>
              <li><b>Verified behaviour:</b> the controller logic is a byte-level model of the v2 firmware. It reproduces all nine runs that passed on the AWS FPGA (R1 to R9) and 1,000 cases replayed on the RTL.</li>
              <li><b>Illustrative:</b> fan spin, lamps and beacon show the output commands. No physical actuators, sensors or contactors are part of the project.</li>
              <li><b>P7 is a power-off request</b>, not a disconnect. Switching hardware would sit behind it.</li>
              <li>Not connected to a physical rack or a live FPGA.</li>
            </ul>
            <h3 className="section-label">Rules</h3>
            <ul className="legend">
              <li>Warm from 27.0 °C → P4 fan boost. Hot from 32.0 °C → P5 fans at maximum. A reading on a threshold takes the higher class.</li>
              <li>Critical from 35.0 °C → P5 + P7 power-off (latched).</li>
              <li>A rise of 2.0 °C or more between two readings is a thermal runaway → P7.</li>
              <li>Water on the leak sensor (P1) → P7, with no message needed.</li>
              <li>Power = V × I. At or above the limit (5.9 kW) → P6 overload alarm. It follows the reading and never cuts power.</li>
              <li>Settings carry an error-correcting code: one flipped bit is repaired; two make the setting unreadable → P7 until it is rewritten.</li>
              <li>The power-off clears only on a <b>new</b> P0 press once every cause is gone: below Critical, no runaway, dry, no unreadable setting.</li>
              <li>Bad CRC (5A) and invalid values (3C) change nothing.</li>
            </ul>
          </section>
          <section>
            <h3 className="section-label">Shape legend</h3>
            <ul className="legend shapes">
              <li className="tone-normal"><Icon name="ok" size={18} weight="bold" /> Normal</li>
              <li className="tone-warning"><Icon name="warn" size={18} weight="bold" /> Warm / Warning</li>
              <li className="tone-critical"><Icon name="crit" size={18} weight="bold" /> Critical / Trip / EPO latched</li>
              <li className="tone-warning"><Icon name="lock" size={18} weight="bold" /> Reset blocked</li>
            </ul>
            <h3 className="section-label">Keyboard</h3>
            <dl className="keys">
              {KEYS.map(([k, v]) => (
                <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
              ))}
            </dl>
            <h3 className="section-label">Scene, in words</h3>
            <SceneDescription />
          </section>
        </div>
      </div>
    </div>
  );
}
