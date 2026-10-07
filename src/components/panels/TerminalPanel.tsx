"use client";
import { useEffect, useRef, useState } from "react";
import { Anchored, useRuntime, useSim } from "../context";
import { Icon } from "../icons";
import { Reading } from "../hud/Hud";
import { hex, hexBytes, replyName } from "@/sim/protocol";
import { rawToAmps, rawToDegC } from "@/sim/units";
import type { RawConditions } from "@/sim/runtime";

interface FieldDef {
  key: keyof RawConditions;
  label: string;
  min: number;
  max: number;
  fmt: (raw: number) => string;
  step: string;
}

const FIELDS: FieldDef[] = [
  { key: "voltRaw", label: "Voltage", min: 180, max: 254, fmt: (r) => `${r} V`, step: "1 V per step" },
  { key: "currentRaw", label: "Current", min: 0, max: 254, fmt: (r) => `${rawToAmps(r).toFixed(1)} A`, step: "0.2 A per step" },
  { key: "tempRaw", label: "Temperature", min: 1, max: 120, fmt: (r) => `${rawToDegC(r).toFixed(1)} °C`, step: "0.5 °C per step" },
];

const PRESETS: { name: string; c: RawConditions }[] = [
  { name: "Normal", c: { voltRaw: 230, currentRaw: 127, tempRaw: 53 } },
  { name: "Warm 27.0", c: { voltRaw: 230, currentRaw: 127, tempRaw: 54 } },
  { name: "Warm 32.0", c: { voltRaw: 230, currentRaw: 127, tempRaw: 64 } },
  { name: "Critical 32.5", c: { voltRaw: 230, currentRaw: 127, tempRaw: 65 } },
  { name: "Warning 25.6 A", c: { voltRaw: 230, currentRaw: 128, tempRaw: 50 } },
  { name: "Warning 32.0 A", c: { voltRaw: 230, currentRaw: 160, tempRaw: 50 } },
  { name: "Trip 32.2 A", c: { voltRaw: 230, currentRaw: 161, tempRaw: 50 } },
];

interface LogLine { id: number; bytes: string; reply: string; tone: string }

export function TerminalPanel({ onClose }: { onClose: () => void }) {
  const rt = useRuntime();
  const { conditions, streaming } = useSim();
  const [log, setLog] = useState<LogLine[]>([]);
  const seq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      rt.bus.on("telemetry", ({ kind, result }) => {
        const code = result.reply[0];
        const line: LogLine = {
          id: ++seq.current,
          bytes: hexBytes(result.frame),
          reply: code === undefined ? "no reply" : `${hex(code)} ${replyName(code)}${kind !== "sample" ? ` · ${kind}` : ""}`,
          tone: code === 0xa5 ? "ok" : "warn",
        };
        setLog((l) => [line, ...l].slice(0, 5));
      }),
    [rt],
  );
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const change = (key: keyof RawConditions, raw: number) => {
    rt.setRawConditions({ ...rt.conditions, [key]: raw }, false);
    if (debounce.current) clearTimeout(debounce.current);
    if (rt.streaming) debounce.current = setTimeout(() => rt.transmit("sample"), 700);
  };

  return (
    <Anchored at="desk" place="left" gap={250} className="terminal panel panel-major" role="dialog" aria-label="DCIM terminal">
      <header className="panel-head">
        <h2 className="panel-title">DCIM terminal<small>simulated conditions</small></h2>
        <button className="btn btn-icon" onClick={onClose} aria-label="Close terminal (Escape)" data-tip="Close · Esc"><Icon name="close" size={18} /></button>
      </header>
      <p className="panel-note">External rack conditions measured by the DCIM and sent to the controller over UART.</p>
      {FIELDS.map((f) => {
        const raw = conditions[f.key];
        const [value, unit] = splitUnit(f.fmt(raw));
        return (
          <div className="field" key={f.key}>
            <div className="field-top">
              <label htmlFor={`f-${f.key}`}>{f.label}</label>
              <output className="field-val" htmlFor={`f-${f.key}`}><Reading value={value} unit={unit} /></output>
              <span className="field-raw">raw {raw}</span>
            </div>
            <div className="field-row">
              <button className="btn btn-icon btn-sm" aria-label={`Decrease ${f.label} by one step`} onClick={() => change(f.key, Math.max(f.min, raw - 1))}><Icon name="left" size={16} /></button>
              <input id={`f-${f.key}`} type="range" min={f.min} max={f.max} step={1} value={raw}
                aria-valuetext={f.fmt(raw)} onChange={(e) => change(f.key, Number(e.target.value))} />
              <button className="btn btn-icon btn-sm" aria-label={`Increase ${f.label} by one step`} onClick={() => change(f.key, Math.min(f.max, raw + 1))}><Icon name="right" size={16} /></button>
            </div>
            <div className="field-hint">{f.step}</div>
          </div>
        );
      })}
      <div className="section-label">Presets</div>
      <div className="presets" role="group" aria-label="Preset conditions">
        {PRESETS.map((p) => (
          <button key={p.name} className="btn btn-sm" onClick={() => rt.setRawConditions(p.c, true)}>{p.name}</button>
        ))}
      </div>
      <div className="send-row">
        <button className="btn btn-primary" onClick={() => rt.transmit("sample")}><Icon name="send" size={16} /> Send sample</button>
        <button className="btn" onClick={() => rt.transmit("corrupt")} title="Same reading with the CRC low bit flipped">Corrupt CRC</button>
        <button className="btn" onClick={() => rt.transmit("invalid")} title="Temperature raw value 0">Invalid reading</button>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={streaming} onChange={(e) => rt.setStreaming(e.target.checked)} />
        <span>Auto-send telemetry every 3 s</span>
      </label>
      <div className="log" aria-label="Recent packets">
        <div className="section-label">Recent packets</div>
        {log.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No packets yet.</div>}
        <ol>
          {log.map((l) => (
            <li key={l.id}>
              <code>{l.bytes}</code> <span className={l.tone === "ok" ? "ok" : "bad"}>{l.reply}</span>
            </li>
          ))}
        </ol>
      </div>
    </Anchored>
  );
}

function splitUnit(text: string): [string, string] {
  const i = text.lastIndexOf(" ");
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i + 1)];
}
