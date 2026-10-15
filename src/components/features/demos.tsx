"use client";
/**
 * Live mini-demos for the feature cards. Every number comes from the same verified controller
 * model as the twin (sim/controller.ts), not from hand-written examples.
 */
import { useMemo, useState } from "react";
import { CLASS_NAME, DEFAULTS, RackSentinelController, computePins, statusFlags } from "@/sim/controller";
import { crcByte } from "@/sim/crc";
import { ECC_CHECK_BITS, ECC_WIDTH, eccDecode, eccEncode } from "@/sim/ecc";
import { CMD, CMD_NAME, encodeCommand, frameValue, hex } from "@/sim/protocol";
import { energyWh, fmtKW, rawToAmps, rawToDegC } from "@/sim/units";
import { Icon } from "../icons";
import { PacketBytes, PinByte, ReplyBytes } from "../site/bytes";

const [WARM, HOT, CRIT, RISE] = DEFAULTS;

/** Temperature classes: drag a reading, see the class and the pins. */
export function ClassDemo() {
  const [raw, setRaw] = useState(60);
  const cls = raw < WARM ? 0 : raw < HOT ? 1 : raw < CRIT ? 2 : 3;
  const pins = computePins({ tempClass: cls as 0 | 1 | 2 | 3, overload: false, epo: cls === 3 });
  const pct = (v: number) => `${((v - 40) / 40) * 100}%`;
  return (
    <div className="demo">
      <div className="scale" aria-hidden="true">
        <span className="scale-band tone-normal" style={{ left: 0, width: pct(WARM) }} />
        <span className="scale-band tone-warning" style={{ left: pct(WARM), width: `calc(${pct(HOT)} - ${pct(WARM)})` }} />
        <span className="scale-band tone-warning is-strong" style={{ left: pct(HOT), width: `calc(${pct(CRIT)} - ${pct(HOT)})` }} />
        <span className="scale-band tone-critical" style={{ left: pct(CRIT), right: 0 }} />
        {[WARM, HOT, CRIT].map((t) => <span key={t} className="scale-mark num" style={{ left: pct(t) }}>{rawToDegC(t)}</span>)}
        <span className="scale-thumb" style={{ left: pct(raw) }} />
      </div>
      <label className="demo-label" htmlFor="cls-raw">Inlet temperature <b className="num">{rawToDegC(raw).toFixed(1)} °C</b> is <b className={`tone-text tone-${cls === 0 ? "normal" : cls === 3 ? "critical" : "warning"}`}>{CLASS_NAME[cls]}</b></label>
      <input id="cls-raw" className="demo-range" type="range" min={40} max={80} value={raw} onChange={(e) => setRaw(Number(e.target.value))} />
      <PinByte out={pins} compact />
    </div>
  );
}

/** Thermal runaway: two readings and the rise between them. */
export function RunawayDemo() {
  const [rise, setRise] = useState(5);
  const a = 48, b = a + rise;
  const runaway = rise >= RISE;
  return (
    <div className="demo">
      <div className="rise">
        <span className="rise-bar" style={{ height: `${(a - 30) * 2.2}px` }}><b className="num">{rawToDegC(a).toFixed(1)}</b></span>
        <span className={`rise-arrow ${runaway ? "tone-critical" : "tone-normal"}`}><Icon name="rise" size={22} weight="bold" /><span className="num">+{rawToDegC(rise).toFixed(1)} °C</span></span>
        <span className={`rise-bar ${runaway ? "is-alarm" : ""}`} style={{ height: `${(b - 30) * 2.2}px` }}><b className="num">{rawToDegC(b).toFixed(1)}</b></span>
      </div>
      <label className="demo-label" htmlFor="rise">Rise between two readings: {runaway ? <b className="tone-text tone-critical">runaway, power-off</b> : <b>below the 2.0 °C limit</b>}</label>
      <input id="rise" className="demo-range" type="range" min={0} max={8} value={rise} onChange={(e) => setRise(Number(e.target.value))} />
    </div>
  );
}

/** Leak sensor on P1. */
export function LeakDemo() {
  const [wet, setWet] = useState(false);
  return (
    <div className="demo">
      <PinByte out={wet ? 0x80 : 0} inputs={wet ? 2 : 0} compact />
      <button className={`btn btn-sm ${wet ? "is-selected" : ""}`} aria-pressed={wet} onClick={() => setWet(!wet)}>
        <Icon name="drop" size={15} /> {wet ? "Sensor wet: P7 latched" : "Pour water on P1"}
      </button>
      <p className="demo-note">{wet ? "No packet was needed. Drying the sensor will not clear P7; a person must press P0." : "The chip reads P1 in its idle loop, between packets."}</p>
    </div>
  );
}

/** Power = V × I against the limit. */
export function PowerDemo() {
  const [amps, setAmps] = useState(130);
  const [volt, setVolt] = useState(230);
  const p = amps * volt;
  const lim = 59 * 500;
  const over = p >= lim;
  const max = 160 * 250;
  return (
    <div className="demo">
      <div className="meter" aria-hidden="true">
        <span className={`meter-fill ${over ? "tone-warning" : "tone-normal"}`} style={{ width: `${(p / max) * 100}%` }} />
        <span className="meter-limit" style={{ left: `${(lim / max) * 100}%` }}><span className="num">5.9 kW</span></span>
      </div>
      <p className="demo-eq num">{volt} V × {rawToAmps(amps).toFixed(1)} A = <b className={over ? "tone-text tone-warning" : ""}>{fmtKW(p)}</b>{over ? " · P6 overload alarm" : ""}</p>
      <div className="demo-two">
        <label className="demo-label" htmlFor="amps">Current</label>
        <input id="amps" className="demo-range" type="range" min={60} max={160} value={amps} onChange={(e) => setAmps(Number(e.target.value))} />
        <label className="demo-label" htmlFor="volt">Voltage setting</label>
        <input id="volt" className="demo-range" type="range" min={200} max={250} value={volt} onChange={(e) => setVolt(Number(e.target.value))} />
      </div>
    </div>
  );
}

/** Energy ÷ 300 as one multiply and a shift. */
export function EnergyDemo() {
  const [n, setN] = useState(3);
  const e = n * 23000;
  const product = BigInt(e) * BigInt(0xda740da8);
  return (
    <div className="demo">
      <div className="calc num">
        <span>E = {n} × 23,000 = {e.toLocaleString("en")}</span>
        <span>mulhu(E, 0xDA740DA8) = {(product >> BigInt(32)).toLocaleString("en")}</span>
        <span>&gt;&gt; 8 = <b>{energyWh(e)} Wh</b></span>
      </div>
      <label className="demo-label" htmlFor="mins">Readings at 4.6 kW (one per minute): <b className="num">{n}</b></label>
      <input id="mins" className="demo-range" type="range" min={1} max={60} value={n} onChange={(e2) => setN(Number(e2.target.value))} />
    </div>
  );
}

/** ECC: click bits of a real codeword and watch the decoder. */
export function EccDemo() {
  const value = CRIT; // the Critical threshold, 35.0 °C
  const clean = eccEncode(value);
  const [flips, setFlips] = useState<number[]>([]);
  const word = flips.reduce((w, b) => w ^ (1 << b), clean);
  const d = eccDecode(word);
  const toggle = (b: number) => setFlips((f) => (f.includes(b) ? f.filter((x) => x !== b) : f.length >= 2 ? [f[1], b] : [...f, b]));
  const status = d.status === 0 ? { t: "Clean: reads 35.0 °C", tone: "normal" } : d.status === 1 ? { t: `One flip at bit ${d.syndrome}: repaired, reads ${rawToDegC(d.value).toFixed(1)} °C`, tone: "warning" } : { t: "Two flips: unreadable, power-off until rewritten", tone: "critical" };
  return (
    <div className="demo">
      <div className="ecc-word" role="group" aria-label="13-bit codeword of the Critical threshold. Click a bit to flip it.">
        {Array.from({ length: ECC_WIDTH }, (_, i) => ECC_WIDTH - 1 - i).map((b) => {
          const bit = (word >> b) & 1;
          const kind = b === 0 ? "parity" : (ECC_CHECK_BITS as readonly number[]).includes(b) ? "check" : "data";
          return (
            <button key={b} className={`ecc-bit kind-${kind} ${flips.includes(b) ? "is-flipped" : ""}`} onClick={() => toggle(b)} aria-pressed={flips.includes(b)} aria-label={`Bit ${b}, ${kind}, value ${bit}`}>
              <span className="ecc-val num">{bit}</span>
              <span className="ecc-pos num">{b}</span>
            </button>
          );
        })}
      </div>
      <div className="ecc-legend"><span className="kind-data">data</span><span className="kind-check">check</span><span className="kind-parity">parity</span></div>
      <p className={`demo-status tone-${status.tone}`}><Icon name={d.status === 0 ? "ok" : d.status === 1 ? "shield" : "crit"} size={16} weight="bold" /> {status.t}</p>
      <button className="btn btn-sm" onClick={() => setFlips([])} disabled={!flips.length}>Restore</button>
    </div>
  );
}

const CRC_CMDS = [CMD.TEMP, CMD.CURRENT, CMD.SET_VOLTAGE, CMD.STATUS];

/** CRC: pick a command and value, see crcb twice. */
export function CrcDemo() {
  const [cmd, setCmd] = useState<number>(CMD.TEMP);
  const [data, setData] = useState(70);
  const c1 = crcByte(0xffff, cmd), c2 = crcByte(c1, data);
  const frame = encodeCommand(cmd, data);
  return (
    <div className="demo">
      <div className="demo-two">
        <label className="demo-label" htmlFor="crc-cmd">Command</label>
        <select id="crc-cmd" className="select" value={cmd} onChange={(e) => setCmd(Number(e.target.value))}>
          {CRC_CMDS.map((c) => <option key={c} value={c}>{CMD_NAME[c]} 0x{hex(c)}</option>)}
        </select>
        <label className="demo-label" htmlFor="crc-data">Value</label>
        <input id="crc-data" className="input num" type="number" min={0} max={255} value={data} onChange={(e) => setData(Math.max(0, Math.min(255, Number(e.target.value) || 0)))} />
      </div>
      <p className="crc-mini num">FFFF → crcb {hex(cmd)} → {hex(c1, 4)} → crcb {hex(data)} → <b>{hex(c2, 4)}</b></p>
      <PacketBytes frame={frame} size="sm" />
      <p className="demo-note num">-t4 0x{hex(frameValue(frame), 8)}</p>
    </div>
  );
}

/** A real trip record: the bytes R3 returns on the FPGA. */
export function TripDemo() {
  return (
    <div className="demo">
      <ReplyBytes bytes={[0x01, 0x46, 0x00, 0x01]} labels={["cause", "temp then", "current then", "trips"]} />
      <p className="demo-note"><b>01</b> Critical temperature · <b>46</b> = 70 × 0.5 = 35.0 °C · <b>00</b> no current reading in that run · <b>01</b> first trip. Read on the FPGA in run R3.</p>
    </div>
  );
}

/** STATUS flags of a real state: after a Critical reading. */
export function StatusDemo() {
  const flags = useMemo(() => {
    const c = new RackSentinelController();
    c.receiveFrame(encodeCommand(CMD.TEMP, 70));
    return statusFlags(c.state);
  }, []);
  const names = ["config fault", "temp received", "runaway", "leak now", "latched", "overload", "class hi", "class lo"];
  return (
    <div className="demo">
      <div className="flags" role="img" aria-label={`STATUS flags 0x${hex(flags)}`}>
        {names.map((n, i) => {
          const bit = 7 - i;
          const on = (flags >> bit) & 1;
          return <span key={n} className={`flag ${on ? "is-on" : ""}`}><b className="num">{on}</b><span>{n}</span></span>;
        })}
      </div>
      <p className="demo-note">STATUS byte 0 after a 35.0 °C reading: <span className="num">0x{hex(flags)}</span> = Critical, power-off latched, a temperature received. COUNTERS adds CRC rejects, ECC repairs and ECC failures.</p>
    </div>
  );
}

const SETTINGS_SHOWN: [string, number, string][] = [
  ["Warm", CMD.SET_WARM, "27.0 °C"],
  ["Hot", CMD.SET_HOT, "32.0 °C"],
  ["Critical", CMD.SET_CRIT, "35.0 °C"],
  ["Runaway limit", CMD.SET_RISE, "2.0 °C"],
  ["Voltage", CMD.SET_VOLTAGE, "230 V"],
  ["Power limit", CMD.SET_POWER_LIMIT, "5.9 kW"],
];

export function SettingsDemo() {
  return (
    <ul className="chips">
      {SETTINGS_SHOWN.map(([n, c, v]) => (
        <li key={n} className="chip-set"><span>{n}</span><b className="num">{v}</b><span className="num chip-cmd">0x{hex(c)}</span></li>
      ))}
    </ul>
  );
}

const PLATFORM: [string, string][] = [
  ["9 / 9", "rehearsed runs passed on the AWS FPGA"],
  ["1,000", "random cases replayed on the RTL"],
  ["44", "instructions, 3 of them our own CRC"],
  ["547", "instructions of v2 firmware"],
  ["31.25 MHz", "core clock on the FPGA"],
  ["0.42 mm²", "Stage 2 CPU layout on sky130"],
];

export function PlatformDemo() {
  return (
    <dl className="facts">
      {PLATFORM.map(([k, v]) => (
        <div key={k}><dt className="num">{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

/** The latch: the four pin states of run R3. */
export function LatchDemo() {
  const stages: [number, string][] = [
    [0xa0, "35.0 °C: Critical, P7 latched"],
    [0xa0, "P0 pressed: refused, still Critical"],
    [0x90, "Cooled to 30.0 °C: still latched"],
    [0x10, "New P0 press: cleared, fans boosted"],
  ];
  return (
    <ol className="latch">
      {stages.map(([pins, t], i) => (
        <li key={i} style={{ "--i": i } as React.CSSProperties}>
          <span className="latch-hex num">-o 0x{hex(pins)}</span>
          <PinByte out={pins} compact />
          <span className="latch-text">{t}</span>
        </li>
      ))}
    </ol>
  );
}
