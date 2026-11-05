"use client";
import { useEffect, useState } from "react";
import { useRuntime, useSim } from "../context";
import { Icon, type IconName } from "../icons";
import { conditionInfo, epoInfo, fmtSimTime, powerInfo, resetInfo, tempInfo, type StateInfo, type Tone } from "@/lib/present";
import Link from "next/link";
import { energyWh, powerKW, rawToAmps, rawToDegC } from "@/sim/units";
import { replyName, hex } from "@/sim/protocol";
import type { Notice, NoticeTone } from "@/sim/events";
import { QUALITY_LABEL, QUALITY_SIZE, type Quality } from "@/scene/raster";

export function Pill({ info, label }: { info: StateInfo; label?: string }) {
  return (
    <span className={`pill tone-${info.tone}`}>
      <Icon name={info.icon} size={14} weight="bold" />
      {label && <span className="pill-key">{label}</span>}
      <span>{info.label}</span>
    </span>
  );
}

/** A reading with a quieter unit: 26.5 plus a small "°C". */
export function Reading({ value, unit }: { value: string; unit: string }) {
  return (
    <>
      {value}
      <span className="unit">{unit}</span>
    </>
  );
}

/**
 * Wordmark plus the page switcher. The two explainer pages are siblings of the
 * simulation, so they sit in one segmented control with the current page marked:
 * a plain run of words read as prose and nobody clicked them.
 */
export function Brand({ onHelp }: { onHelp: () => void }) {
  return (
    <div className="brand">
      <div className="brand-row">
        <h1 className="brand-name">RackSentinel</h1>
        <button className="btn btn-icon" onClick={onHelp} aria-label="Help, rules and keyboard shortcuts" data-tip="Help · ?">
          <Icon name="help" size={18} />
        </button>
      </div>
      <nav className="brand-nav" aria-label="Pages">
        <span className="brand-tab is-current" aria-current="page">
          <Icon name="play" size={14} weight="fill" />
          Simulation
        </span>
        <Link href="/features" className="brand-tab">
          <Icon name="book" size={14} />
          Features
          <span className="brand-tab-go" aria-hidden="true"><Icon name="arrow" size={13} weight="bold" /></span>
        </Link>
        <Link href="/data-flow" className="brand-tab">
          <Icon name="flow" size={14} />
          Data flow
          <span className="brand-tab-go" aria-hidden="true"><Icon name="arrow" size={13} weight="bold" /></span>
        </Link>
      </nav>
    </div>
  );
}

export function StatusSeg({ cap, info, alarm }: { cap: string; info: StateInfo; alarm?: boolean }) {
  return (
    <div className={`status-seg tone-${info.tone} ${alarm ? "is-alarm" : ""}`}>
      <span className="status-icon"><Icon name={info.icon} size={16} weight="bold" /></span>
      <div>
        <div className="status-cap">{cap}</div>
        <div className="status-val">{info.label}</div>
      </div>
      {info.sub && <div className="status-sub">{info.sub}</div>}
    </div>
  );
}

/** Primary information: rack condition, EPO state, and what P0 can do. */
export function PrimaryStatus() {
  const { controller: s, paused, resetBlockers } = useSim();
  return (
    <div className="status panel" role="status" aria-label="Controller status">
      <StatusSeg cap="Rack condition" info={conditionInfo(s)} />
      <StatusSeg cap="EPO" info={epoInfo(s)} alarm={s.epo} />
      <StatusSeg cap="P0 reset" info={resetInfo(s, resetBlockers)} />
      {paused && (
        <div className="status-paused">
          <Icon name="pause" size={16} weight="bold" /> Paused
        </div>
      )}
    </div>
  );
}

function CtlButton({ icon, label, onClick, pressed, shortcut }: { icon: IconName; label: string; onClick: () => void; pressed?: boolean; shortcut?: string }) {
  return (
    <button className="btn btn-icon" onClick={onClick} aria-label={label} aria-pressed={pressed} data-tip={shortcut ? `${label} · ${shortcut}` : label}>
      <Icon name={icon} size={18} />
    </button>
  );
}

export function ControlBar(p: {
  paused: boolean; muted: boolean; reducedMotion: boolean; demo: boolean; fullscreen: boolean; quality: Quality;
  follow: boolean; labels: boolean; timeline: boolean; evidence: boolean; presenting: boolean;
  onFollow: () => void; onLabels: () => void; onTimeline: () => void; onEvidence: () => void; onPresent: () => void;
  onPause: () => void; onMute: () => void; onMotion: () => void; onFullscreen: () => void; onReset: () => void; onDemo: () => void; onScreenshot: () => void;
  onQuality: (q: Quality) => void;
}) {
  return (
    <div className="controls" role="toolbar" aria-label="Presentation controls">
      <button className={`btn ${p.demo ? "is-selected" : ""}`} onClick={p.onDemo} aria-pressed={p.demo} data-tip="Guided demonstration · G">
        <Icon name="play" size={16} weight={p.demo ? "fill" : "regular"} /> <span className="btn-label">{p.demo ? "Exit demo" : "Guided demo"}</span>
      </button>
      <label className="sr-only" htmlFor="quality">Render quality</label>
      <select id="quality" className="select" value={p.quality} onChange={(e) => p.onQuality(e.target.value as Quality)} title={`Render quality: ${QUALITY_LABEL[p.quality]}, ${QUALITY_SIZE(p.quality)} room raster`}>
        {(["performance", "balanced", "sharp"] as Quality[]).map((q) => (
          <option key={q} value={q}>{QUALITY_LABEL[q]}</option>
        ))}
      </select>
      <div className="toolgroup" role="group" aria-label="Incident views">
        <CtlButton icon="follow" label="Follow incident camera" onClick={p.onFollow} pressed={p.follow && !p.reducedMotion} shortcut="C" />
        <CtlButton icon="labels" label="P4–P7 focus labels" onClick={p.onLabels} pressed={p.labels} shortcut="L" />
        <CtlButton icon="timeline" label="Event timeline" onClick={p.onTimeline} pressed={p.timeline} shortcut="T" />
        <CtlButton icon="evidence" label="Evidence mode" onClick={p.onEvidence} pressed={p.evidence} shortcut="E" />
        <CtlButton icon="present" label="Presentation mode" onClick={p.onPresent} pressed={p.presenting} shortcut="P" />
      </div>
      <div className="toolgroup" role="group" aria-label="Simulation and view">
        <CtlButton icon={p.paused ? "play" : "pause"} label={p.paused ? "Resume simulation" : "Pause simulation"} onClick={p.onPause} pressed={p.paused} shortcut="Space" />
        <CtlButton icon={p.muted ? "mute" : "sound"} label={p.muted ? "Unmute sound" : "Mute sound"} onClick={p.onMute} pressed={p.muted} shortcut="M" />
        <CtlButton icon="motion" label="Reduced motion" onClick={p.onMotion} pressed={p.reducedMotion} />
        <CtlButton icon="screenshot" label="Screenshot mode" onClick={p.onScreenshot} shortcut="H" />
        <CtlButton icon={p.fullscreen ? "exitFull" : "full"} label={p.fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={p.onFullscreen} shortcut="F" />
        <CtlButton icon="restart" label="Restart simulation" onClick={p.onReset} shortcut="R" />
      </div>
    </div>
  );
}

export const STAGE_TONE: Record<NoticeTone, Tone> = { ok: "normal", warn: "warning", alarm: "critical", info: "neutral" };

/** What the running scenario is showing right now, for the prompt bar and the observer view. */
export function ScenarioStageLine({ compact = false }: { compact?: boolean }) {
  const { scenario } = useSim();
  const stage = scenario?.stage;
  if (!scenario || !stage) return null;
  return (
    <div className={`stage-line tone-${STAGE_TONE[stage.tone]} ${compact ? "is-compact" : ""}`}>
      <span className="eyebrow"><i className="dot" aria-hidden="true" />{scenario.running ? "Scenario" : "Scenario finished"} · {scenario.name}</span>
      <span className="stage-title">{stage.title}</span>
      {stage.detail && <span className="stage-detail">{stage.detail}</span>}
    </div>
  );
}

export function PromptBar({ hover }: { hover: string | null }) {
  const { controller: s, p0Down, streaming, resetBlockers, scenario } = useSim();
  let text: string;
  let tone: Tone = "neutral";
  const stage = scenario?.stage;
  if (!hover && stage) {
    return (
      <div className={`prompt panel tone-${STAGE_TONE[stage.tone]}`} aria-hidden="true">
        <ScenarioStageLine />
        <span className="prompt-note">Simulated rack environment · RackSentinel only measures it and requests outputs</span>
      </div>
    );
  }
  if (hover === "rack") text = "Rack 01: click to inspect readings, outputs and reset conditions.";
  else if (hover === "button") text = "P0 reset button: click to send the operator to press it.";
  else if (hover === "terminal") text = "DCIM terminal: click to change conditions and send telemetry.";
  else if (s.epo && p0Down && resetBlockers.includes("held")) { text = "P0 is held down. Release P0 and press again: click the reset button."; tone = "warning"; }
  else if (s.epo && resetBlockers.length === 0) { text = "Every trip cause is gone but the power-off is latched. Press P0 to acknowledge recovery."; tone = "warning"; }
  else if (s.epo) { text = "Power-off latched. Every trip cause must be gone before P0 can clear it."; tone = "critical"; }
  else if (!streaming) { text = "Telemetry is stopped. The controller holds its last state."; tone = "warning"; }
  else text = "Monitoring. Inspect the rack, change conditions at the terminal, or run a scenario.";
  return (
    <div className={`prompt panel tone-${tone}`} aria-hidden="true">
      <span className="eyebrow"><i className="dot" aria-hidden="true" />Next action</span>
      <span className="prompt-text">{text}</span>
      <span className="prompt-note">Simulation only · not connected to a physical rack or FPGA</span>
    </div>
  );
}

export function TelemetrySummary() {
  const rt = useRuntime();
  const { controller: s, lastSampleAt, streaming, lastFrame } = useSim();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const age = lastSampleAt === null ? null : Math.max(0, (rt.time - lastSampleAt) / 1000);
  const t = tempInfo(s), p = powerInfo(s);
  const code = lastFrame?.reply[0];
  return (
    <section className="telemetry panel panel-major" aria-label="Latest valid readings">
      <div className="tele-head">
        <span className="eyebrow">Last valid readings</span>
        <span className={`link ${streaming ? "" : "link-off"}`}>
          <span className="link-dot" aria-hidden="true" />
          {streaming ? "UART link" : "Link silent"}
          {age !== null && <span className="num muted">{age < 1 ? "now" : `${age.toFixed(0)} s`}</span>}
        </span>
      </div>
      <dl className="tele-grid">
        <div key={`t-${t.tone}`} className={`tone-${t.tone}`}><dt>Temperature <i aria-hidden="true">●</i><span className="sr-only">{t.label}</span></dt><dd>{s.gotTemp ? <Reading value={rawToDegC(s.latestTemp).toFixed(1)} unit="°C" /> : "-"}</dd></div>
        <div><dt>Current</dt><dd>{s.gotCurrent ? <Reading value={rawToAmps(s.latestCurrent).toFixed(1)} unit="A" /> : "-"}</dd></div>
        <div key={`p-${p.tone}`} className={`tone-${p.tone}`}><dt>Power <i aria-hidden="true">●</i><span className="sr-only">{p.label}</span></dt><dd>{s.power !== null ? <Reading value={powerKW(s.power).toFixed(2)} unit="kW" /> : "-"}</dd></div>
        <div><dt>Energy</dt><dd><Reading value={String(energyWh(s.energy))} unit="Wh" /></dd></div>
      </dl>
      {lastFrame && (
        <div className="tele-foot">
          <span>Last reply</span>
          <span className={code === 0xa5 ? "" : "tone-warning tone-text"}>
            <span className="num">{code === undefined ? "none" : `0x${hex(code)}`}</span> {code === undefined ? "timeout" : replyName(code)}
          </span>
        </div>
      )}
    </section>
  );
}

const TOAST_LOOK: Record<NoticeTone, { tone: Tone; icon: IconName }> = {
  ok: { tone: "normal", icon: "ok" },
  warn: { tone: "warning", icon: "warn" },
  alarm: { tone: "critical", icon: "crit" },
  info: { tone: "neutral", icon: "info" },
};

/** How long an alert stays on screen once it appears. Alarms linger longest. */
const TOAST_MS: Record<NoticeTone, number> = { alarm: 14000, warn: 12000, ok: 10000, info: 10000 };

function ToastItem({ n }: { n: Notice }) {
  const rt = useRuntime();
  useEffect(() => {
    const id = setTimeout(() => rt.dismissNotice(n.id), TOAST_MS[n.tone]);
    return () => clearTimeout(id);
  }, [rt, n]);
  const look = TOAST_LOOK[n.tone];
  const isEpo = n.tone === "alarm" && (n.title.startsWith("Power-off latched") || n.title.startsWith("Water leak"));
  return (
    <li className={`toast tone-${look.tone} ${isEpo ? "is-epo" : ""}`}>
      <span className="toast-icon"><Icon name={look.icon} size={16} weight="bold" /></span>
      <div>
        <div className="toast-title">{n.title}</div>
        {n.detail && <div className="toast-detail">{n.detail}</div>}
        <div className="toast-time">{fmtSimTime(n.at)}</div>
      </div>
      <button className="toast-x" onClick={() => rt.dismissNotice(n.id)} aria-label="Dismiss alert"><Icon name="close" size={14} /></button>
    </li>
  );
}

/** The runtime spaces alerts out on the simulation clock (ALERT_GAP_MS), so this just shows them. */
export function Toasts({ max = 3 }: { max?: number }) {
  const { notices } = useSim();
  return (
    <ul className="toasts" aria-hidden="true">
      {notices.slice(-max).map((n) => <ToastItem key={n.id} n={n} />)}
    </ul>
  );
}

/** Screen-reader announcements of major state changes. */
export function LiveRegion() {
  const rt = useRuntime();
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  useEffect(
    () =>
      rt.bus.on("notice", (n) => {
        const text = `${n.title}. ${n.detail ?? ""}`;
        if (n.tone === "alarm") setAssertive(text);
        else setPolite(text);
      }),
    [rt],
  );
  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{polite}</div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">{assertive}</div>
    </>
  );
}
