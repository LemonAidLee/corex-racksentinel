"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FLOW_CASES, type FlowCase } from "@/sim/cases";
import { CLASS_NAME, CFG, settingsView, type Note } from "@/sim/controller";
import { crcByte } from "@/sim/crc";
import { runEmu, type EmuStep } from "@/sim/emu";
import { CMD_NAME, causeText, hex } from "@/sim/protocol";
import { packetText, replyText } from "@/sim/timeline";
import { energyWh, fmtDegC, fmtKW } from "@/sim/units";
import { Icon, type IconName } from "../icons";
import { PacketBytes, PinByte, ReplyBytes } from "../site/bytes";

type Lane = "emu" | "rx" | "cpu" | "gpio" | "tx";

const LANES: { id: Lane; label: string; sub: string; icon: IconName }[] = [
  { id: "emu", label: "./emu on AWS", sub: "the test host", icon: "quality" },
  { id: "rx", label: "UART RX", sub: "115,200 baud in", icon: "arrow" },
  { id: "cpu", label: "RVBL-2 CPU", sub: "firmware decides", icon: "chip" },
  { id: "tx", label: "UART TX", sub: "reply out", icon: "send" },
  { id: "gpio", label: "GPIO pins", sub: "P7..P0", icon: "bolt" },
];

/** Which blocks a step travels through, in order. */
const PATH: Record<string, Lane[]> = {
  d: ["emu", "gpio"],
  t4: ["emu", "rx", "cpu"],
  r1: ["cpu", "tx", "emu"],
  r4: ["cpu", "tx", "emu"],
  o: ["gpio", "emu"],
  i: ["emu", "gpio", "cpu"],
};

const REPLY_LABELS: Record<number, string[]> = {
  0x50: ["flags", "temp", "current", "trips"],
  0x51: ["Wh lo", "Wh", "Wh", "Wh hi"],
  0x52: ["CRC rej", "corrected", "uncorr", "unused"],
  0x53: ["cause", "temp then", "current then", "trips"],
};

function pinsText(v: number): string {
  const on = [[0x80, "P7 power-off"], [0x40, "P6 overload"], [0x20, "P5 fans max"], [0x10, "P4 fan boost"]].filter(([b]) => v & (b as number)).map(([, t]) => t);
  return on.length ? on.join(" + ") : "all outputs off";
}

function inputsText(v: number): string {
  return `leak sensor ${v & 2 ? "wet" : "dry"}, P0 ${v & 1 ? "pressed" : "released"}`;
}

interface StepView {
  title: string;
  kind: "setup" | "send" | "reply" | "pins" | "inputs";
  /** For replies: the command they answer. */
  cmd?: number;
  replyBytes?: number[];
}

function describe(steps: EmuStep[]): StepView[] {
  let lastCmd = 0;
  return steps.map((s) => {
    switch (s.op) {
      case "d":
        return { title: "Set the pin directions: P7 to P4 outputs, P3 to P0 inputs", kind: "setup" };
      case "t4":
        lastCmd = s.frame![0];
        return { title: `Send ${packetText(s.frame![0], s.frame![1])}`, kind: "send" };
      case "r1":
      case "r4": {
        const n = s.op === "r1" ? 1 : 4;
        const bytes = Array.from({ length: n }, (_, i) => (s.value >>> (8 * i)) & 0xff);
        const meaning = n === 1 ? (bytes[0] === 0xa5 ? "accepted" : bytes[0] === 0x5a ? "bad CRC, ignored" : "invalid, rejected") : replyText(lastCmd, bytes);
        return { title: `Reply ${bytes.map((b) => hex(b)).join(" ")}: ${meaning}`, kind: "reply", cmd: lastCmd, replyBytes: bytes };
      }
      case "o":
        return { title: `Read the pins: ${pinsText(s.value)}`, kind: "pins" };
      case "i":
        return { title: `Drive the inputs: ${inputsText(s.value)}`, kind: "inputs" };
      default:
        return { title: s.arg, kind: "setup" };
    }
  });
}

const NOTE_ICON: Record<Note["kind"], IconName> = { info: "info", warn: "warn", bad: "crit", fix: "ok", trip: "crit" };
const NOTE_TONE: Record<Note["kind"], string> = { info: "neutral", warn: "warning", bad: "critical", fix: "normal", trip: "critical" };

export default function DataFlowPage() {
  const [caseId, setCaseId] = useState("R3");
  const [sel, setSel] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stepListRef = useRef<HTMLOListElement>(null);

  // deep links: /data-flow#R5
  useEffect(() => {
    const read = () => {
      const id = window.location.hash.slice(1).toUpperCase();
      if (FLOW_CASES.some((c) => c.id === id)) {
        setCaseId(id);
        setSel(0);
      }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const fc = FLOW_CASES.find((c) => c.id === caseId) ?? FLOW_CASES[0];
  const run = useMemo(() => runEmu(fc.line), [fc]);
  const views = useMemo(() => describe(run.steps), [run]);
  const step = run.steps[sel];

  useEffect(() => {
    if (!playing) return;
    const last = run.steps.length - 1;
    const id = setTimeout(() => (sel >= last ? setPlaying(false) : setSel(sel + 1)), sel >= last ? 0 : 1700);
    return () => clearTimeout(id);
  }, [playing, sel, run.steps.length]);

  useEffect(() => {
    stepListRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (c: FlowCase) => {
    setCaseId(c.id);
    setSel(0);
    setPlaying(false);
    history.replaceState(null, "", `#${c.id}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setSel((i) => Math.min(run.steps.length - 1, i + 1)); }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
  };

  return (
    <div className="site-wrap flow">
      <header className="flow-head">
        <h1 className="site-h1">Data flow, byte by byte</h1>
        <p className="site-lede">Pick a test case and step through it: every packet the AWS host sends, how the chip checks it, what it decides, and what comes back.</p>
      </header>

      <div className="flow-grid">
        <nav className="case-rail" aria-label="Test cases">
          <div className="case-group">Passed on the AWS FPGA</div>
          {FLOW_CASES.filter((c) => c.fpga).map((c) => <CaseButton key={c.id} c={c} active={c.id === fc.id} onClick={() => choose(c)} />)}
          <div className="case-group">Extra cases (model)</div>
          {FLOW_CASES.filter((c) => !c.fpga).map((c) => <CaseButton key={c.id} c={c} active={c.id === fc.id} onClick={() => choose(c)} />)}
        </nav>

        <section className="case-main" aria-label={`${fc.id} ${fc.title}`}>
          <div className="case-intro">
            <div>
              <h2 className="case-title"><span className="case-id">{fc.id}</span> {fc.title}</h2>
              <p className="case-moment">{fc.moment}</p>
              <p className="case-story">{fc.story}</p>
              <div className="case-actions">
                {fc.scenario && <Link className="btn btn-sm" href="/">Play it in the twin</Link>}
                <span className={`badge-run ${run.passed ? "tone-normal" : "tone-critical"}`}>
                  <Icon name={run.passed ? "ok" : "crit"} size={14} weight="bold" />
                  {run.passed ? `${run.steps.filter((s) => s.ok !== undefined).length} checks match the model` : "Mismatch"}
                </span>
              </div>
            </div>
            {fc.fpga && (
              <a className="fpga-shot" href={fc.fpga} target="_blank" rel="noreferrer">
                <Image src={fc.fpga} alt={`Terminal output of ${fc.id} on the AWS FPGA: every line [ok]`} width={fc.fpgaSize?.[0] ?? 1600} height={fc.fpgaSize?.[1] ?? 260} />
                <span>{fc.id} on the AWS FPGA, every line [ok]. Open full size.</span>
              </a>
            )}
          </div>

          <div className="emu-line" aria-label="The ./emu command">
            <span className="emu-prompt">$ ./emu</span>
            {run.steps.map((s, i) => (
              <button key={i} className={`emu-tok ${i === sel ? "is-sel" : ""} ${s.ok === false ? "is-bad" : ""}`} onClick={() => { setSel(i); setPlaying(false); }}>
                {s.arg}
              </button>
            ))}
          </div>

          <div className="flow-body">
            <div className="steps-col">
              <div className="steps-bar">
                <button className="btn btn-sm" onClick={() => setSel((i) => Math.max(0, i - 1))} disabled={sel === 0} aria-label="Previous step"><Icon name="left" size={16} /></button>
                <button className="btn btn-sm btn-primary" onClick={() => { if (sel >= run.steps.length - 1) setSel(0); setPlaying((p) => !p); }}>
                  <Icon name={playing ? "pause" : "play"} size={16} /> {playing ? "Pause" : "Play"}
                </button>
                <button className="btn btn-sm" onClick={() => setSel((i) => Math.min(run.steps.length - 1, i + 1))} disabled={sel === run.steps.length - 1} aria-label="Next step"><Icon name="right" size={16} /></button>
                <span className="steps-count num">{sel + 1} / {run.steps.length}</span>
              </div>
              <ol className="steps" ref={stepListRef} tabIndex={0} onKeyDown={onKey} aria-label="Steps (arrow keys move)">
                {run.steps.map((s, i) => (
                  <li key={i} data-i={i}>
                    <button className={`step-row kind-${views[i].kind} ${i === sel ? "is-sel" : ""}`} onClick={() => { setSel(i); setPlaying(false); }} aria-current={i === sel ? "step" : undefined}>
                      <span className="step-n num">{i + 1}</span>
                      <span className="step-body">
                        <span className="step-arg num">{s.arg}</span>
                        <span className="step-title">{views[i].title}</span>
                      </span>
                      {s.ok !== undefined && <span className={`step-ok ${s.ok ? "tone-normal" : "tone-critical"}`}><Icon name={s.ok ? "ok" : "crit"} size={15} weight="bold" /></span>}
                    </button>
                  </li>
                ))}
              </ol>
            </div>

            <Inspector key={`${fc.id}-${sel}`} step={step} view={views[sel]} prev={run.steps[sel - 1]} />
          </div>
        </section>
      </div>
    </div>
  );
}

function CaseButton({ c, active, onClick }: { c: FlowCase; active: boolean; onClick: () => void }) {
  return (
    <button className={`case-btn ${active ? "is-active" : ""}`} onClick={onClick} aria-current={active ? "true" : undefined}>
      <span className="case-btn-id num">{c.id}</span>
      <span className="case-btn-text">
        <span className="case-btn-title">{c.title}</span>
        <span className="case-btn-moment">{c.moment}</span>
      </span>
    </button>
  );
}

function Pipeline({ op }: { op: string }) {
  const path = PATH[op] ?? [];
  return (
    <div className="pipe" aria-hidden="true">
      {LANES.map((l) => {
        const at = path.indexOf(l.id);
        return (
          <div key={l.id} className={`pipe-node ${at >= 0 ? "is-on" : ""}`} style={{ "--k": Math.max(0, at) } as React.CSSProperties}>
            <span className="pipe-icon"><Icon name={l.icon} size={18} /></span>
            <span className="pipe-label">{l.label}</span>
            <span className="pipe-sub">{l.sub}</span>
          </div>
        );
      })}
    </div>
  );
}

function Inspector({ step, view, prev }: { step: EmuStep; view: StepView; prev?: EmuStep }) {
  const s = step.state;
  const v = settingsView(s);
  return (
    <aside className="inspector-card" aria-live="polite">
      <Pipeline op={step.op} />
      <h3 className="insp-title">{view.title}</h3>

      {step.op === "t4" && step.frame && <SendDetail frame={step.frame} />}

      {(step.op === "r1" || step.op === "r4") && view.replyBytes && (
        <div className="insp-block">
          <div className="insp-label">Bytes back from the chip, in the order sent</div>
          <ReplyBytes bytes={view.replyBytes} labels={view.replyBytes.length === 4 ? REPLY_LABELS[view.cmd ?? 0] : undefined} />
          <p className="insp-note">
            <span className="num">-{step.op} 0x{hex(step.value, view.replyBytes.length * 2)}</span> reads the first byte as the least significant, so the value looks reversed.
            {view.replyBytes.length === 4 && <> Decoded: <b>{replyText(view.cmd ?? 0, view.replyBytes)}</b>.</>}
          </p>
          <Verdict ok={step.ok} />
        </div>
      )}

      {step.op === "o" && (
        <div className="insp-block">
          <div className="insp-label">Output pins read by <span className="num">-o</span></div>
          <PinByte out={step.actual ?? 0} inputs={s.inputs} />
          <Verdict ok={step.ok} />
        </div>
      )}

      {(step.op === "i" || step.op === "d") && (
        <div className="insp-block">
          <div className="insp-label">{step.op === "d" ? "Direction mask 0xF0: upper four pins are outputs" : "Input pins driven by -i"}</div>
          <PinByte out={s.pins} inputs={step.op === "i" ? step.value : 0} />
          {step.op === "i" && step.reset && <p className="insp-note">P0 evaluation: <b>{step.reset}</b>.</p>}
        </div>
      )}

      {step.notes.length > 0 && (
        <div className="insp-block">
          <div className="insp-label">What the firmware did</div>
          <ul className="notes">
            {step.notes.map((n, i) => (
              <li key={i} className={`note tone-${NOTE_TONE[n.kind]}`} style={{ "--i": i } as React.CSSProperties}>
                <Icon name={NOTE_ICON[n.kind]} size={15} weight="bold" />
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {step.op === "t4" && step.notes.length === 0 && prev && <p className="insp-note">No change in any decision.</p>}

      <div className="insp-block">
        <div className="insp-label">Chip state after this step</div>
        <dl className="state-grid">
          <div><dt>Temperature</dt><dd>{s.gotTemp ? `${fmtDegC(s.latestTemp)} ${CLASS_NAME[s.tempClass]}` : "no reading"}</dd></div>
          <div><dt>Power</dt><dd>{s.power === null ? "no reading" : `${fmtKW(s.power)}${s.overload ? " over" : ""}`}</dd></div>
          <div><dt>Energy</dt><dd>{energyWh(s.energy)} Wh</dd></div>
          <div className={s.epo ? "tone-critical" : ""}><dt>Power-off</dt><dd>{s.epo ? `latched: ${causeText(v[CFG.TRIP_CAUSE].value)}` : "armed"}</dd></div>
          <div><dt>Trips</dt><dd>{s.epoTrips}</dd></div>
          <div><dt>Counters</dt><dd>{s.crcRejects} CRC · {s.eccCorrected} fixed · {s.eccUncorrectable} bad</dd></div>
        </dl>
      </div>
    </aside>
  );
}

function SendDetail({ frame }: { frame: number[] }) {
  const c1 = crcByte(0xffff, frame[0]);
  const c2 = crcByte(c1, frame[1]);
  const received = frame[2] | (frame[3] << 8);
  const ok = c2 === received;
  return (
    <>
      <div className="insp-block">
        <div className="insp-label">Four bytes on the wire, left to right</div>
        <PacketBytes frame={frame} crcOk={ok} />
        <p className="insp-note">
          In the command it is written <span className="num">0x<span className="c-crc">{hex(frame[3])}{hex(frame[2])}</span><span className="c-data">{hex(frame[1])}</span><span className="c-cmd">{hex(frame[0])}</span></span>: <span className="num">./emu</span> sends the least-significant byte first.
        </p>
      </div>
      <div className="insp-block">
        <div className="insp-label">CRC check with the custom <span className="num">crcb</span> instruction</div>
        <div className="crc-trace num">
          <span className="crc-v">FFFF</span>
          <span className="crc-op">crcb {hex(frame[0])}</span>
          <span className="crc-v">{hex(c1, 4)}</span>
          <span className="crc-op">crcb {hex(frame[1])}</span>
          <span className={`crc-v ${ok ? "tone-normal" : "tone-critical"}`}>{hex(c2, 4)}</span>
          <span className="crc-op">{ok ? "=" : "≠"}</span>
          <span className="crc-v">{hex(received, 4)} received</span>
        </div>
        <p className="insp-note">{ok ? `Match: the packet is trusted and ${CMD_NAME[frame[0]] ?? "the command"} runs.` : "Mismatch: the packet is ignored, reply 5A, and the CRC-reject counter goes up."}</p>
      </div>
    </>
  );
}

function Verdict({ ok }: { ok?: boolean }) {
  if (ok === undefined) return null;
  return (
    <p className={`verdict ${ok ? "tone-normal" : "tone-critical"}`}>
      <Icon name={ok ? "ok" : "crit"} size={15} weight="bold" /> {ok ? "Matches the value the test expects" : "Differs from the expected value"}
    </p>
  );
}
