"use client";
import { createElement, lazy, Suspense, useMemo, useState } from "react";
import { Anchored, useSim } from "../context";
import { Icon } from "../icons";
import { Pill, Reading } from "../hud/Hud";
import { BLOCKER_TEXT, fanInfo, leakInfo, PIN_LABELS, pinIcon, pinTone, powerInfo, tempInfo } from "@/lib/present";
import { energyWh, fmtAmps, fmtDegC, powerKW, rawToAmps, rawToDegC } from "@/sim/units";
import { CMD_NAME, causeText, hex } from "@/sim/protocol";
import { CFG, CFG_NAMES, settingsView, settingText } from "@/sim/controller";
import { RESET_MESSAGES, type SimSnapshot } from "@/sim/runtime";
import { TECHNICAL_PANELS, type TechnicalPanelProps } from "./technical";

type FocusFn = (e: React.FocusEvent<HTMLElement>) => void;

/** Always-visible label above the rack: names it, lists active outputs, doubles as the keyboard hotspot. */
export function RackChip({ onActivate, onFocus, onBlur }: { onActivate: () => void; onFocus: FocusFn; onBlur: () => void }) {
  const { controller: s } = useSim();
  const active = PIN_LABELS.filter((p) => s.pins & p.bit);
  return (
    <Anchored at="rackTop" place="above" gap={10} className="rack-chip">
      <ul className="badges" aria-label="Active rack outputs">
        {[...active].reverse().map((p) => (
          <li key={p.pin} className={`badge tone-${pinTone(p.bit)} ${p.bit === 0x80 ? "badge-epo" : ""}`}>
            <Icon name={pinIcon(p.bit)} size={15} weight="bold" />
            <span className="pin">{p.pin}</span> {p.name}
          </li>
        ))}
      </ul>
      <button className="chip" onClick={onActivate} onFocus={onFocus} onBlur={onBlur} aria-label={`Rack 01. ${active.length ? `Active outputs: ${active.map((p) => p.name).join(", ")}.` : "No outputs active."} Press Enter to inspect.`}>
        RACK 01
      </button>
    </Anchored>
  );
}

export function ButtonChip({ onActivate, onFocus, onBlur }: { onActivate: () => void; onFocus: FocusFn; onBlur: () => void }) {
  const { p0Down, controller } = useSim();
  return (
    <Anchored at="button" place="right" gap={14} className="button-chip">
      <button className={`chip chip-p0 ${p0Down ? "is-held" : ""}`} onClick={onActivate} onFocus={onFocus} onBlur={onBlur}
        aria-label={`P0 reset button${p0Down ? ", currently held down" : ""}. ${controller.epo ? "EPO request latched." : "Nothing latched."} Press Enter to have the operator press it.`}>
        P0 RESET{p0Down && <span className="held-tag">HELD</span>}
      </button>
    </Anchored>
  );
}

export function TerminalChip({ onActivate, onFocus, onBlur }: { onActivate: () => void; onFocus: FocusFn; onBlur: () => void }) {
  return (
    <Anchored at="monitor" place="above" gap={12} className="terminal-chip">
      <button className="chip" onClick={onActivate} onFocus={onFocus} onBlur={onBlur} aria-label="DCIM monitoring terminal. Press Enter to adjust conditions and send telemetry.">
        DCIM TERMINAL
      </button>
    </Anchored>
  );
}

export function Readings({ s }: { s: SimSnapshot["controller"] }) {
  const t = tempInfo(s), p = powerInfo(s);
  return (
    <dl className="readings">
      <div className={`tone-${t.tone}`}><dt>Temp <i aria-hidden="true">●</i></dt><dd>{s.gotTemp ? <Reading value={rawToDegC(s.latestTemp).toFixed(1)} unit="°C" /> : "-"}</dd></div>
      <div><dt>Current</dt><dd>{s.gotCurrent ? <Reading value={rawToAmps(s.latestCurrent).toFixed(1)} unit="A" /> : "-"}</dd></div>
      <div className={`tone-${p.tone}`}><dt>Power <i aria-hidden="true">●</i></dt><dd>{s.power !== null ? <Reading value={powerKW(s.power).toFixed(2)} unit="kW" /> : "-"}</dd></div>
    </dl>
  );
}

/** The six safety settings with their ECC state. */
export function SettingsTable({ s }: { s: SimSnapshot["controller"] }) {
  const view = settingsView(s);
  return (
    <ul className="cfg-list">
      {view.slice(0, 6).map((v, k) => (
        <li key={k} className={v.status === 2 ? "tone-critical" : v.status === 1 ? "tone-warning" : ""}>
          <span>{CFG_NAMES[k]}</span>
          <span className="num">{v.status === 2 ? "UNREADABLE" : settingText(k, v.value)}{v.status === 1 && <small> 1 bit flipped</small>}</span>
        </li>
      ))}
    </ul>
  );
}

/** What TRIP_INFO would report, decoded without side effects. */
export function TripRecord({ s }: { s: SimSnapshot["controller"] }) {
  const v = settingsView(s);
  if (!s.epoTrips) return <p className="muted" style={{ margin: 0, fontSize: 13 }}>No trip yet.</p>;
  const bad = (k: number) => v[k].status === 2;
  return (
    <dl className="counters">
      <div><dt>Cause</dt><dd style={{ fontFamily: "var(--font-ui)" }}>{bad(CFG.TRIP_CAUSE) ? "unreadable" : causeText(v[CFG.TRIP_CAUSE].value)}</dd></div>
      <div><dt>Trip number</dt><dd>{s.epoTrips}</dd></div>
      <div><dt>Temperature then</dt><dd>{bad(CFG.TRIP_TEMP) ? "unreadable" : v[CFG.TRIP_TEMP].value ? fmtDegC(v[CFG.TRIP_TEMP].value) : "no reading"}</dd></div>
      <div><dt>Current then</dt><dd>{bad(CFG.TRIP_CURRENT) ? "unreadable" : fmtAmps(v[CFG.TRIP_CURRENT].value)}</dd></div>
    </dl>
  );
}

export function OutputRows({ pins }: { pins: number }) {
  return (
    <ul className="outputs">
      {PIN_LABELS.map((p) => {
        const on = !!(pins & p.bit);
        const tone = on ? pinTone(p.bit) : "off";
        const state = p.bit === 0x80 ? (on ? "LATCHED" : "CLEAR") : on ? "ON" : "OFF";
        return (
          <li key={p.pin} className={`out tone-${tone}`}>
            <span className="out-lamp" aria-hidden="true"><Icon name={on ? pinIcon(p.bit) : "info"} size={15} weight={on ? "bold" : "regular"} /></span>
            <span className="out-pin">{p.pin}</span>
            <span className="out-name">{p.name}</span>
            <span className="out-state">{state}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function RackHoverCard() {
  const { controller: s } = useSim();
  return (
    <Anchored at="rackSide" place="right" gap={28} className="hovercard panel" role="tooltip">
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <span className="panel-title">Rack 01</span>
        <Pill info={tempInfo(s)} label="Temp" />
      </div>
      <Readings s={s} />
      <div className="section-label">Output requests</div>
      <OutputRows pins={s.pins} />
    </Anchored>
  );
}

/** Lazy components for registered technical panels, created once at module load. */
const TECH_COMPONENTS = Object.fromEntries(TECHNICAL_PANELS.map((p) => [p.id, lazy(p.load)]));

function TechTab({ id, snapshot }: TechnicalPanelProps & { id: string }) {
  const C = TECH_COMPONENTS[id];
  return C ? createElement(C, { snapshot }) : null;
}

export function RackInspector({ onClose, onPress }: { onClose: () => void; onPress: () => void }) {
  const snap = useSim();
  const s = snap.controller;
  const [tab, setTab] = useState("overview");
  const tabs = useMemo(() => [{ id: "overview", title: "Overview" }, ...TECHNICAL_PANELS.map((p) => ({ id: p.id, title: p.title }))], []);
  const blockers = snap.resetBlockers.filter((b) => b !== "not-latched");
  const code = snap.lastFrame?.reply[0];

  return (
    <Anchored at="button" place="right" gap={136} className="inspector panel panel-major" role="dialog" aria-label="Rack 01 inspection">
      <header className="panel-head">
        <h2 className="panel-title">Rack 01<small>RackSentinel controller</small></h2>
        <button className="btn btn-icon" onClick={onClose} aria-label="Close inspection (Escape)" data-tip="Close · Esc"><Icon name="close" size={18} /></button>
      </header>
      {tabs.length > 1 && (
        <div className="segmented tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.title}</button>
          ))}
        </div>
      )}
      {tab !== "overview" ? (
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <TechTab id={tab} snapshot={snap} />
        </Suspense>
      ) : (
        <>
          <Readings s={s} />
          <div className="pills">
            <Pill info={tempInfo(s)} label="Temp" />
            <Pill info={powerInfo(s)} label="Power" />
            <Pill info={fanInfo(s)} label="Fans" />
            <Pill info={leakInfo(s)} label="Leak" />
          </div>
          <div className="section-label">Output requests</div>
          <OutputRows pins={s.pins} />
          <div className="section-label">Power-off reset</div>
          {s.epo ? (
            blockers.length ? (
              <div className="reset-box tone-warning">
                <div className="reset-box-title"><Icon name="lock" size={18} weight="bold" /> Reset blocked</div>
                <ul>{blockers.map((b) => <li key={b}>{BLOCKER_TEXT[b]}</li>)}</ul>
              </div>
            ) : (
              <div className="reset-box tone-normal">
                <div className="reset-box-title"><Icon name="ok" size={18} weight="bold" /> Reset available</div>
                <ul><li>Every cause is gone. A new P0 press will clear the power-off.</li></ul>
              </div>
            )
          ) : (
            <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>No power-off latched. Nothing to reset.</p>
          )}
          <button className="btn btn-primary btn-wide" onClick={onPress}>Send operator to press P0</button>
          <div className="section-label">Trip record (TRIP_INFO)</div>
          <TripRecord s={s} />
          <div className="section-label">Counters</div>
          <dl className="counters">
            <div><dt>CRC rejects</dt><dd>{s.crcRejects}</dd></div>
            <div><dt>Energy</dt><dd>{energyWh(s.energy)} Wh</dd></div>
            <div><dt>ECC corrected</dt><dd>{s.eccCorrected}</dd></div>
            <div><dt>ECC uncorrectable</dt><dd>{s.eccUncorrectable}</dd></div>
            <div><dt>Last packet</dt><dd>{snap.lastFrame ? `${CMD_NAME[snap.lastFrame.frame[0]] ?? hex(snap.lastFrame.frame[0])} → ${code === undefined ? "-" : `0x${hex(code)}`}` : "-"}</dd></div>
            <div><dt>Last P0 press</dt><dd style={{ fontFamily: "var(--font-ui)" }}>{snap.lastReset ? RESET_MESSAGES[snap.lastReset.outcome].title : "-"}</dd></div>
          </dl>
          <div className="section-label">Safety settings (ECC protected)</div>
          <SettingsTable s={s} />
          <p className="footnote">P7 is a power-off <em>request</em>; power-switching hardware would sit behind it. Fans, lamps and the beacon illustrate output commands.</p>
        </>
      )}
    </Anchored>
  );
}
