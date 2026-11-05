"use client";
import { useEffect, useRef, useState } from "react";
import { Anchored, useRuntime, useSim } from "../context";
import { Icon } from "../icons";
import { Reading } from "../hud/Hud";
import { CFG, CFG_NAMES, settingsView, settingText } from "@/sim/controller";
import { CMD, CMD_NAME, INPUT, hex, hexBytes, replyName } from "@/sim/protocol";
import { packetText, replyText } from "@/sim/timeline";
import { degCToRaw, rawToAmps, rawToDegC, ampsToRaw } from "@/sim/units";

type Tab = "readings" | "commands";

const PRESETS: { name: string; temp?: number; amps?: number }[] = [
  { name: "Normal 22.0 °C", temp: 22.0, amps: 20 },
  { name: "Warm 27.0 °C", temp: 27.0 },
  { name: "Hot 32.0 °C", temp: 32.0 },
  { name: "Critical 35.0 °C", temp: 35.0 },
  { name: "Overload 26 A", amps: 26 },
  { name: "Load 20 A", amps: 20 },
];

/** SET_* commands with their DATA range and units. */
const SETTINGS: { cfg: number; cmd: number; min: number; max: number; unit: (v: number) => string }[] = [
  { cfg: CFG.WARM, cmd: CMD.SET_WARM, min: 1, max: 254, unit: (v) => `${rawToDegC(v).toFixed(1)} °C` },
  { cfg: CFG.HOT, cmd: CMD.SET_HOT, min: 1, max: 254, unit: (v) => `${rawToDegC(v).toFixed(1)} °C` },
  { cfg: CFG.CRIT, cmd: CMD.SET_CRIT, min: 1, max: 254, unit: (v) => `${rawToDegC(v).toFixed(1)} °C` },
  { cfg: CFG.RISE, cmd: CMD.SET_RISE, min: 0, max: 254, unit: (v) => (v === 0 ? "off" : `${rawToDegC(v).toFixed(1)} °C`) },
  { cfg: CFG.VOLTAGE, cmd: CMD.SET_VOLTAGE, min: 180, max: 254, unit: (v) => `${v} V` },
  { cfg: CFG.POWER_LIMIT, cmd: CMD.SET_POWER_LIMIT, min: 1, max: 254, unit: (v) => `${(v / 10).toFixed(1)} kW` },
];

const QUERIES = [CMD.STATUS, CMD.ENERGY, CMD.COUNTERS, CMD.TRIP_INFO];

interface LogLine { id: number; text: string; bytes: string; reply: string; ok: boolean }

export function TerminalPanel({ onClose }: { onClose: () => void }) {
  const rt = useRuntime();
  const snap = useSim();
  const { conditions, streaming, controller: s } = snap;
  const [tab, setTab] = useState<Tab>("readings");
  const [gradual, setGradual] = useState(true);
  const [log, setLog] = useState<LogLine[]>([]);
  const [target, setTarget] = useState({ temp: conditions.tempRaw, cur: conditions.currentRaw });
  const seq = useRef(0);

  useEffect(
    () =>
      rt.bus.on("telemetry", ({ result }) => {
        const code = result.reply[0];
        const line: LogLine = {
          id: ++seq.current,
          text: packetText(result.command, result.frame[1]),
          bytes: hexBytes(result.frame),
          reply: result.reply.length > 1 ? hexBytes(result.reply) : `${hex(code)} ${replyName(code)}`,
          ok: code !== 0x5a && code !== 0x3c,
        };
        setLog((l) => [line, ...l].slice(0, 6));
      }),
    [rt],
  );

  // keep the sliders on the real readings when something else moves them (adjusted during render)
  const [seen, setSeen] = useState({ temp: conditions.tempRaw, cur: conditions.currentRaw });
  if (seen.temp !== conditions.tempRaw || seen.cur !== conditions.currentRaw) {
    const now = { temp: conditions.tempRaw, cur: conditions.currentRaw };
    setSeen(now);
    setTarget(now);
  }

  const apply = (t: { tempRaw?: number; currentRaw?: number }) => {
    if (gradual) rt.rampTo(t);
    else rt.setRawConditions(t, true);
  };
  const leakWet = !!(s.inputs & INPUT.LEAK);
  const view = settingsView(s);
  const q = snap.lastQuery;

  return (
    <Anchored at="desk" place="left" gap={250} className="terminal panel panel-major" role="dialog" aria-label="DCIM terminal">
      <header className="panel-head">
        <h2 className="panel-title">DCIM terminal<small>4-byte packets over UART</small></h2>
        <button className="btn btn-icon" onClick={onClose} aria-label="Close terminal (Escape)" data-tip="Close · Esc"><Icon name="close" size={18} /></button>
      </header>
      <div className="segmented tabs" role="tablist" aria-label="Terminal sections">
        <button role="tab" aria-selected={tab === "readings"} onClick={() => setTab("readings")}>Readings</button>
        <button role="tab" aria-selected={tab === "commands"} onClick={() => setTab("commands")}>Commands</button>
      </div>

      {tab === "readings" ? (
        <>
          <p className="panel-note">The rack as the DCIM measures it. Each reading cycle sends a TEMP packet, then a CURRENT packet.</p>
          <Slider label="Temperature" raw={target.temp} min={1} max={110} hint="TEMP · 0.5 °C per step"
            fmt={(r) => [rawToDegC(r).toFixed(1), "°C"]} onChange={(v) => setTarget((t) => ({ ...t, temp: v }))} />
          <Slider label="Current" raw={target.cur} min={0} max={200} hint="CURRENT · 0.2 A per step"
            fmt={(r) => [rawToAmps(r).toFixed(1), "A"]} onChange={(v) => setTarget((t) => ({ ...t, cur: v }))} />
          <div className="send-row">
            <button className="btn btn-primary" onClick={() => apply({ tempRaw: target.temp, currentRaw: target.cur })}><Icon name="send" size={16} /> Send readings</button>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={gradual} onChange={(e) => setGradual(e.target.checked)} />
            <span>Walk there gradually, one 0.5 °C step per reading</span>
          </label>
          {!gradual && <p className="field-hint warn-hint">A jump of 2.0 °C or more between two readings is a thermal runaway and cuts power.</p>}
          <div className="section-label">Presets</div>
          <div className="presets" role="group" aria-label="Preset conditions">
            {PRESETS.map((p) => (
              <button key={p.name} className="btn btn-sm" onClick={() => apply({ tempRaw: p.temp !== undefined ? degCToRaw(p.temp) : undefined, currentRaw: p.amps !== undefined ? ampsToRaw(p.amps) : undefined })}>{p.name}</button>
            ))}
            <button className="btn btn-sm" onClick={() => rt.setRawConditions({ tempRaw: conditions.tempRaw + 5 }, true)} title="+2.5 °C in one reading">Cooling failure +2.5 °C</button>
          </div>
          <div className="section-label">Leak sensor (P1)</div>
          <button className={`btn btn-wide ${leakWet ? "is-selected" : ""}`} aria-pressed={leakWet} onClick={() => rt.setLeak(!leakWet)}>
            <Icon name="drop" size={16} /> {leakWet ? "Sensor wet: click to dry" : "Pour water on the sensor"}
          </button>
          <div className="section-label">Faulty packets</div>
          <div className="send-row">
            <button className="btn" onClick={() => rt.runStep({ at: 0, type: "corrupt", degC: rawToDegC(conditions.tempRaw) }, false)} title="One DATA bit flipped on the wire">Damaged packet</button>
            <button className="btn" onClick={() => rt.runStep({ at: 0, type: "invalid" }, false)} title="TEMP raw 0">Reading raw 0</button>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={streaming} onChange={(e) => rt.setStreaming(e.target.checked)} />
            <span>Auto-send readings every 3 s</span>
          </label>
        </>
      ) : (
        <>
          <p className="panel-note">Settings are stored with an error-correcting code. Queries answer with four data bytes.</p>
          <div className="section-label">Queries</div>
          <div className="presets" role="group" aria-label="Queries">
            {QUERIES.map((c) => (
              <button key={c} className="btn btn-sm" onClick={() => rt.sendCommand(c, 0)}>{CMD_NAME[c]}</button>
            ))}
          </div>
          {q && (
            <div className="query-out">
              <span className="num">{CMD_NAME[q.frame[0]]} → {hexBytes(q.reply)}</span>
              <span>{replyText(q.frame[0], q.reply)}</span>
            </div>
          )}
          <div className="section-label">Settings</div>
          <div className="settings">
            {SETTINGS.map((st) => (
              <SettingRow key={st.cmd} name={CFG_NAMES[st.cfg]} cmd={st.cmd} view={view[st.cfg]} cfg={st.cfg} min={st.min} max={st.max} unit={st.unit} onSend={(v) => rt.sendCommand(st.cmd, v)} />
            ))}
          </div>
          <div className="section-label">ECC self-test (FLIP_TEST)</div>
          <FlipTest onFlip={(word, two) => rt.sendCommand(CMD.FLIP_TEST, word | (two ? 0x10 : 0))} />
        </>
      )}

      <div className="log" aria-label="Recent packets">
        <div className="section-label">Recent packets</div>
        {log.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No packets yet.</div>}
        <ol>
          {log.map((l) => (
            <li key={l.id}>
              <span className="log-what">{l.text}</span>
              <code>{l.bytes}</code> <span className={l.ok ? "ok" : "bad"}>{l.reply}</span>
            </li>
          ))}
        </ol>
      </div>
    </Anchored>
  );
}

function Slider({ label, raw, min, max, hint, fmt, onChange }: { label: string; raw: number; min: number; max: number; hint: string; fmt: (r: number) => [string, string]; onChange: (v: number) => void }) {
  const id = `f-${label}`;
  const [value, unit] = fmt(raw);
  return (
    <div className="field">
      <div className="field-top">
        <label htmlFor={id}>{label}</label>
        <output className="field-val" htmlFor={id}><Reading value={value} unit={unit} /></output>
        <span className="field-raw">raw {raw}</span>
      </div>
      <div className="field-row">
        <button className="btn btn-icon btn-sm" aria-label={`Decrease ${label} by one step`} onClick={() => onChange(Math.max(min, raw - 1))}><Icon name="left" size={16} /></button>
        <input id={id} type="range" min={min} max={max} step={1} value={raw} aria-valuetext={`${value} ${unit}`} onChange={(e) => onChange(Number(e.target.value))} />
        <button className="btn btn-icon btn-sm" aria-label={`Increase ${label} by one step`} onClick={() => onChange(Math.min(max, raw + 1))}><Icon name="right" size={16} /></button>
      </div>
      <div className="field-hint">{hint}</div>
    </div>
  );
}

function SettingRow({ name, cmd, cfg, view, min, max, unit, onSend }: {
  name: string; cmd: number; cfg: number; view: { value: number; status: number }; min: number; max: number; unit: (v: number) => string; onSend: (v: number) => void;
}) {
  const [v, setV] = useState(view.value || min);
  const id = `set-${cmd}`;
  const state = view.status === 2 ? "unreadable" : view.status === 1 ? "1 bit flipped" : settingText(cfg, view.value);
  return (
    <div className={`setting ${view.status === 2 ? "tone-critical" : view.status === 1 ? "tone-warning" : ""}`}>
      <label htmlFor={id} className="setting-name">{name}<span className="setting-now">{state}</span></label>
      <div className="setting-row">
        <input id={id} className="input num" type="number" min={min} max={max} value={v} onChange={(e) => setV(Math.max(0, Math.min(255, Number(e.target.value) || 0)))} />
        <span className="setting-unit">{unit(v)}</span>
        <button className="btn btn-sm" onClick={() => onSend(v)}>{CMD_NAME[cmd]}</button>
      </div>
    </div>
  );
}

function FlipTest({ onFlip }: { onFlip: (word: number, two: boolean) => void }) {
  const [word, setWord] = useState<number>(CFG.CRIT);
  return (
    <div className="flip">
      <label className="sr-only" htmlFor="flip-word">Protected word</label>
      <select id="flip-word" className="select" value={word} onChange={(e) => setWord(Number(e.target.value))}>
        {CFG_NAMES.map((n, k) => <option key={n} value={k}>{k} · {n}</option>)}
      </select>
      <div className="send-row">
        <button className="btn btn-sm" onClick={() => onFlip(word, false)}>Flip 1 bit</button>
        <button className="btn btn-sm" onClick={() => onFlip(word, true)}>Flip 2 bits</button>
      </div>
      <p className="field-hint">One bit is repaired at the next use. Two bits make the setting unreadable: the next reading cuts power until the DCIM rewrites it.</p>
    </div>
  );
}
