"use client";
/**
 * Incident presentation: the causality ribbon, the event timeline, evidence mode, focus labels
 * for P4–P7, guided-demo captions and screenshot framing. Everything here reads the runtime's
 * snapshot; none of it changes controller state.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useGame, useSim } from "../context";
import { Icon, type IconName } from "../icons";
import { STAGE_TONE } from "./Hud";
import type { NoticeTone } from "@/sim/events";
import { CLASS_NAME, type CauseChain, type StateDigest, type TimelineEntry } from "@/sim/timeline";
import { evaluateEvidence, type CheckStatus } from "@/sim/evidence";
import { hexBytes, hex, replyName } from "@/sim/protocol";
import { scenarioById } from "@/sim/scenarios";
import { fmtAmps, fmtDegC } from "@/sim/units";
import { fmtSimTime, PIN_LABELS, pinTone } from "@/lib/present";
import { DEMO_BEATS } from "@/sim/demo";
import type { AnchorName } from "@/scene/layout";
import type { FocusName } from "@/scene/camera";

const pinsText = (pins: number) => PIN_LABELS.filter((p) => pins & p.bit).map((p) => p.pin).join(" ") || "none";
const tempText = (d: StateDigest) => (d.temp === null ? "—" : fmtDegC(d.temp));

/** Only what changed between two states, as "before → after" pairs. */
function diff(b: StateDigest, a: StateDigest): { label: string; from: string; to: string; tone: NoticeTone }[] {
  const out: { label: string; from: string; to: string; tone: NoticeTone }[] = [];
  if (b.temp !== a.temp) out.push({ label: "Temp", from: tempText(b), to: tempText(a), tone: "info" });
  if (b.current !== a.current) out.push({ label: "Current", from: b.current === null ? "—" : fmtAmps(b.current), to: a.current === null ? "—" : fmtAmps(a.current), tone: "info" });
  if (b.tempClass !== a.tempClass) out.push({ label: "Class", from: CLASS_NAME[b.tempClass], to: CLASS_NAME[a.tempClass], tone: a.tempClass === 3 ? "alarm" : a.tempClass >= 1 ? "warn" : "ok" });
  if (b.leak !== a.leak) out.push({ label: "P1", from: b.leak ? "wet" : "dry", to: a.leak ? "wet" : "dry", tone: a.leak ? "alarm" : "ok" });
  if ((b.pins & 0x70) !== (a.pins & 0x70)) out.push({ label: "Outputs", from: pinsText(b.pins & 0x70), to: pinsText(a.pins & 0x70), tone: a.pins & 0x70 ? "warn" : "ok" });
  if (b.epo !== a.epo) out.push({ label: "P7", from: b.epo ? "latched" : "clear", to: a.epo ? "latched" : "clear", tone: a.epo ? "alarm" : "ok" });
  if (b.fault !== a.fault) out.push({ label: "Settings", from: b.fault ? "fault" : "OK", to: a.fault ? "fault" : "OK", tone: a.fault ? "alarm" : "ok" });
  return out;
}

const NODE_MS = 280;

/**
 * Causality ribbon: input → validation → classification → output, each node lighting up in
 * order, with the state before and after the decision underneath. A follow-up chain with the
 * same shape (a ramp step) updates in place instead of replaying. With `hold` the ribbon never
 * fades by itself: it stays until the next chain replaces it, so a guided demo beat keeps its
 * decision on screen for as long as the presenter talks about it.
 */
export function CausalityRibbon({ large = false, hold = false, generation = 0 }: { large?: boolean; hold?: boolean; generation?: number }) {
  const { chain, paused } = useSim();
  // which chain is on screen, its shape, and how many times the reveal has been replayed
  const [track, setTrack] = useState({ id: -1, sig: "", replay: 0 });
  const [hiddenId, setHiddenId] = useState(-1);
  const [gen, setGen] = useState(generation);
  // a new guided-demo beat clears the ribbon: the screen goes quiet while the audience reads the
  // new line, and the panel comes back only when this beat's decision actually happens
  if (generation !== gen) {
    setGen(generation);
    setHiddenId(chain ? chain.id : -1);
  }
  if (chain && chain.id !== track.id) {
    const sig = chain.kind + chain.nodes.slice(1).map((n) => n.label).join("|");
    setTrack({ id: chain.id, sig, replay: sig === track.sig && hiddenId !== track.id ? track.replay : track.replay + 1 });
  }
  const shown: CauseChain | null = chain && chain.id !== hiddenId ? chain : null;
  const replay = track.replay;

  useEffect(() => {
    if (!shown || paused || hold) return;
    const id = setTimeout(() => setHiddenId(shown.id), 5200 + shown.nodes.length * NODE_MS);
    return () => clearTimeout(id);
  }, [shown, paused, hold]);

  if (!shown) return null;
  const changes = diff(shown.before, shown.after);
  return (
    <section className={`ribbon panel ${large ? "is-large" : ""} ${hold ? "is-cue" : ""}`} aria-label="Controller decision" key={replay}>
      {hold && <span className="ribbon-cap" aria-hidden="true">What the chip just decided</span>}
      <ol className="ribbon-nodes">
        {shown.nodes.map((n, i) => (
          <Fragment key={i}>
            {i > 0 && <li className="ribbon-arrow" aria-hidden="true" style={{ "--i": i } as React.CSSProperties}>→</li>}
            <li className={`ribbon-node tone-${STAGE_TONE[n.tone]}`} style={{ "--i": i } as React.CSSProperties}>{n.label}</li>
          </Fragment>
        ))}
      </ol>
      {changes.length > 0 && (
        <div className="ribbon-diff" style={{ "--i": shown.nodes.length } as React.CSSProperties}>
          <span className="ribbon-diff-cap">Before → after</span>
          {changes.map((c) => (
            <span key={c.label} className="ribbon-change">
              <span className="muted">{c.label}</span> <span className="num">{c.from}</span>
              <span aria-hidden="true"> → </span>
              <span className={`num tone-${STAGE_TONE[c.tone]} tone-text`}>{c.to}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

const KIND_ICON: Record<TimelineEntry["kind"], IconName> = {
  scenario: "play",
  telemetry: "send",
  command: "sliders",
  query: "evidence",
  validation: "warn",
  class: "temp",
  output: "bolt",
  ecc: "chip",
  epo: "crit",
  leak: "drop",
  link: "link",
  reset: "restart",
};

/** Collapsible event timeline. Selecting an event frames its object and shows its values. */
export function TimelineDrawer({ onClose, onFocus }: { onClose: () => void; onFocus: (f: FocusName) => void }) {
  const { timeline } = useSim();
  const [sel, setSel] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const selected = timeline.find((e) => e.id === sel) ?? null;

  useEffect(() => {
    const el = listRef.current;
    if (el && sel === null) el.scrollTop = el.scrollHeight;
  }, [timeline, sel]);

  return (
    <section className="timeline panel" aria-label="Event timeline">
      <header className="panel-head">
        <h2 className="panel-title">Event timeline<small>{timeline.length} events</small></h2>
        <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close timeline (T)" data-tip="Close · T"><Icon name="close" size={18} /></button>
      </header>
      {timeline.length === 0 ? (
        <p className="panel-note">Nothing yet. Run a scenario or send telemetry from the terminal.</p>
      ) : (
        <ol className="tl-list" ref={listRef}>
          {timeline.map((e) => (
            <li key={e.id}>
              <button className={`tl-item tone-${STAGE_TONE[e.tone]} ${sel === e.id ? "is-selected" : ""}`} aria-pressed={sel === e.id}
                onClick={() => {
                  const next = sel === e.id ? null : e.id;
                  setSel(next);
                  onFocus(next === null ? "room" : e.focus);
                }}>
                <span className="tl-time num">{fmtSimTime(e.at)}</span>
                <span className="tl-icon" aria-hidden="true"><Icon name={KIND_ICON[e.kind]} size={14} weight="bold" /></span>
                <span className="tl-title">{e.title}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {selected && (
        <div className="tl-detail">
          {selected.detail && <p>{selected.detail}</p>}
          <dl className="tl-values">
            <div><dt>Temp</dt><dd className="num">{tempText(selected.values)}</dd></div>
            <div><dt>Current</dt><dd className="num">{selected.values.current === null ? "—" : fmtAmps(selected.values.current)}</dd></div>
            <div><dt>Outputs</dt><dd className="num">{pinsText(selected.values.pins)}</dd></div>
            <div><dt>P0</dt><dd>{selected.values.p0 ? "held" : "up"}</dd></div>
          </dl>
        </div>
      )}
    </section>
  );
}

const STATUS_ICON: Record<CheckStatus, IconName> = { pass: "ok", fail: "crit", pending: "info" };
const STATUS_TONE: Record<CheckStatus, string> = { pass: "normal", fail: "critical", pending: "off" };

/** Evidence mode: scenario, exact input, expected and observed output. */
export function EvidencePanel({ onClose, onReplay }: { onClose: () => void; onReplay: (id: string) => void }) {
  const snap = useSim();
  const sc = snap.scenario ? scenarioById(snap.scenario.id) : undefined;
  const checks = useMemo(
    () => (sc ? evaluateEvidence(sc.id, snap.timeline, snap.controller, !snap.scenario?.running) : []),
    [sc, snap.timeline, snap.controller, snap.scenario?.running],
  );
  const lf = snap.lastFrame;
  const passed = checks.filter((c) => c.status === "pass").length;
  return (
    <section className="evidence panel panel-major" aria-label="Evidence">
      <header className="panel-head">
        <h2 className="panel-title">Evidence{sc && <small>{sc.testCase}</small>}</h2>
        <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close evidence (E)" data-tip="Close · E"><Icon name="close" size={18} /></button>
      </header>
      {!sc ? (
        <p className="panel-note">Run a scenario to compare what the rehearsed FPGA run expects with what the controller model does.</p>
      ) : (
        <>
          <dl className="ev-meta">
            <div><dt>Scenario</dt><dd>{sc.name} <span className="num muted">{sc.id}</span></dd></div>
            <div><dt>Last input</dt><dd className="num">{lf ? hexBytes(lf.frame) : "—"}</dd></div>
            <div><dt>Reply</dt><dd className="num">{lf?.reply[0] !== undefined ? `0x${hex(lf.reply[0])} ${replyName(lf.reply[0])}` : "—"}</dd></div>
            <div><dt>Outputs</dt><dd className="num">0x{hex(snap.controller.pins)} · {pinsText(snap.controller.pins)}</dd></div>
          </dl>
          <table className="ev-checks">
            <thead><tr><th scope="col">Check</th><th scope="col">Expected</th><th scope="col">Observed</th></tr></thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.label} className={`tone-${STATUS_TONE[c.status]}`}>
                  <th scope="row"><span className="ev-status"><Icon name={STATUS_ICON[c.status]} size={14} weight="bold" /><span className="sr-only">{c.status}</span></span>{c.label}</th>
                  <td>{c.expected}</td>
                  <td className="num">{c.observed}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ev-foot">
            <span className="muted">{passed} of {checks.length} observed{snap.scenario?.running ? " · running" : ""}</span>
            <button className="btn btn-sm" onClick={() => onReplay(sc.id)}><Icon name="replay" size={16} /> Replay incident</button>
          </div>
        </>
      )}
    </section>
  );
}

/** Shown under the prompt once a scenario has finished: rerun the same deterministic sequence. */
export function ReplayButton({ onReplay }: { onReplay: (id: string) => void }) {
  const { scenario } = useSim();
  if (!scenario || scenario.running) return null;
  return (
    <button className="btn btn-sm replay-btn" onClick={() => onReplay(scenario.id)}>
      <Icon name="replay" size={16} /> Replay {scenario.name}
    </button>
  );
}

const LAMPS: AnchorName[] = ["lampP4", "lampP5", "lampP6", "lampP7"];

/**
 * Focus labels: P4–P7 names in a column beside Rack 01, each joined to its physical lamp by a
 * leader line. Positions are written every frame by the game loop (no React re-render).
 */
export function FocusLabels() {
  const game = useGame();
  const { controller } = useSim();
  const svg = useRef<SVGSVGElement>(null);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (!game) return;
    return game.onFrame(() => {
      const pts = LAMPS.map((a) => game.anchorToCss(a));
      const colRight = Math.min(...pts.map((p) => p[0])) - 56;
      const lines = svg.current?.querySelectorAll("line");
      pts.forEach(([x, y], k) => {
        const el = labels.current[k];
        if (!el) return;
        const ly = pts[0][1] - 84 + k * 34;
        el.style.transform = `translate3d(${Math.round(colRight - el.offsetWidth)}px, ${Math.round(ly - el.offsetHeight / 2)}px, 0)`;
        const ln = lines?.[k];
        if (ln) {
          ln.setAttribute("x1", String(colRight + 4));
          ln.setAttribute("y1", String(ly));
          ln.setAttribute("x2", String(x));
          ln.setAttribute("y2", String(y));
        }
      });
    });
  }, [game]);
  return (
    <div className="focus-labels" aria-hidden="true">
      <svg ref={svg} className="leaders">
        {LAMPS.map((a, k) => <line key={a} className={controller.pins & PIN_LABELS[k].bit ? `on tone-${pinTone(PIN_LABELS[k].bit)}` : ""} />)}
      </svg>
      {PIN_LABELS.map((p, k) => {
        const on = !!(controller.pins & p.bit);
        return (
          <div key={p.pin} ref={(el) => { labels.current[k] = el; }} className={`focus-label anchored tone-${on ? pinTone(p.bit) : "off"}`}>
            <span className="num">{p.pin}</span> {p.name}
            <span className="focus-state">{p.bit === 0x80 ? (on ? "latched" : "clear") : on ? "on" : "off"}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Short narration captions while the guided demo plays. */
/**
 * The guided demo's single block of words: step, title, the line the audience reads, the detail
 * underneath, and the controls. It replaces the side panel while the demo runs so the beat is
 * never written on screen twice.
 */
export function DemoStrip({ index, onPrev, onNext, onExit }: { index: number; onPrev: () => void; onNext: () => void; onExit: () => void }) {
  const beat = DEMO_BEATS[index];
  if (!beat) return null;
  const last = index >= DEMO_BEATS.length - 1;
  return (
    <section className="demo-strip panel" aria-label="Guided demonstration" aria-live="polite">
      <header className="demo-strip-head">
        <span className="demo-step">{index + 1} / {DEMO_BEATS.length}</span>
        {beat.run && <span className="demo-run" data-tip={`Matches hardware run ${beat.run}`}>{beat.run}</span>}
        <h2 className="demo-strip-title">{beat.title}</h2>
        <span className="demo-progress" aria-hidden="true">
          {DEMO_BEATS.map((_, i) => <span key={i} className={i <= index ? "on" : ""} />)}
        </span>
        <button className="btn btn-icon btn-ghost" onClick={onExit} aria-label="Exit demo" data-tip="Exit demo · G">
          <Icon name="close" size={18} />
        </button>
      </header>
      <p className="demo-say" key={index}>{beat.say}</p>
      <p className="demo-detail">{beat.caption}</p>
      <div className="demo-nav">
        <button className="btn" onClick={onPrev} disabled={index <= 0} aria-label="Previous step (Left arrow)"><Icon name="left" size={16} /> Back</button>
        <button className="btn btn-primary" onClick={onNext} disabled={last} aria-label="Next step (Right arrow)">{last ? "End" : "Next"} <Icon name="right" size={16} /></button>
      </div>
    </section>
  );
}

export type ShotPreset = "room" | "rack" | "evidence";

/** Screenshot framing presets, visible on hover while controls are hidden. */
export function ScreenshotPresets({ value, onChange, onExit }: { value: ShotPreset; onChange: (p: ShotPreset) => void; onExit: () => void }) {
  const opts: [ShotPreset, string][] = [["room", "Full room"], ["rack", "Controlled rack"], ["evidence", "Technical evidence"]];
  return (
    <div className="shot-presets" role="group" aria-label="Screenshot framing">
      <div className="segmented">
        {opts.map(([id, label]) => (
          <button key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>
        ))}
      </div>
      <button className="btn btn-sm" onClick={onExit}>Show controls (H)</button>
    </div>
  );
}
