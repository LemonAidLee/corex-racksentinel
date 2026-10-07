"use client";
import { useRef, useState } from "react";
import { useSim } from "../context";
import { Icon, type IconName } from "../icons";
import { SCENARIOS, caseLabel } from "@/sim/scenarios";
import { DEMO_BEATS } from "@/sim/demo";
import { CATEGORIES, SCENARIO_META, type CategoryId } from "../scenarios/meta";
import { ScenarioIcon } from "../scenarios/ScenarioIcon";
import { ScenarioStageLine, STAGE_TONE } from "./Hud";

/** Right-hand dock geometry in CSS px; the scene re-centres beside whatever is showing. */
export const RAIL_WIDTH = 74;
export const SHEET_WIDTH = 320;
export const DEMO_WIDTH = 344;
export const DOCK_GAP = 8;

/** Short rail labels and icons for the four scenario categories. */
const RAIL: Record<CategoryId, { label: string; icon: IconName }> = {
  conditions: { label: "Rack", icon: "temp" },
  electrical: { label: "Power", icon: "bolt" },
  recovery: { label: "Reset", icon: "restart" },
  communication: { label: "Comms", icon: "link" },
};

/**
 * Scenarios as a slim vertical rail at the middle right. Each rail button is a category;
 * choosing one slides that category's scenarios out in a sheet beside the rail.
 */
export function ScenarioDrawer({ open, onToggle, onPlay }: { open: boolean; onToggle: (open: boolean) => void; onPlay: (id: string) => void }) {
  const { scenario } = useSim();
  const currentCat = scenario ? SCENARIO_META[scenario.id]?.category : undefined;
  const [cat, setCat] = useState<CategoryId>(currentCat ?? "conditions");
  const railRef = useRef<HTMLDivElement>(null);

  const choose = (c: CategoryId) => {
    if (open && c === cat) onToggle(false);
    else {
      setCat(c);
      onToggle(true);
    }
  };
  const onRailKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = [...(railRef.current?.querySelectorAll<HTMLButtonElement>(".rail-btn") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(i + (e.key === "ArrowDown" ? 1 : btns.length - 1)) % btns.length]?.focus();
  };

  const meta = CATEGORIES.find((c) => c.id === cat)!;
  const list = SCENARIOS.filter((s) => SCENARIO_META[s.id]?.category === cat);

  return (
    <>
      {open && (
        <section className="sheet panel" id="scenario-sheet" aria-label={`${meta.label} scenarios`} style={{ width: SHEET_WIDTH }}>
          <header className="sheet-head">
            <div>
              <h2 className="panel-title">{meta.label}</h2>
              <p className="sheet-sub">Each scenario starts from a controller power-on.</p>
            </div>
            <button className="btn btn-icon btn-ghost" onClick={() => onToggle(false)} aria-label="Close scenarios (Escape)" data-tip="Close · Esc">
              <Icon name="close" size={18} />
            </button>
          </header>
          <div className="scn-list">
            {list.map((s) => {
              const m = SCENARIO_META[s.id];
              const current = scenario?.id === s.id;
              return (
                <button
                  key={s.id}
                  className={`scn tone-${m.tone} ${current ? "is-current" : ""}`}
                  aria-label={`${s.name}. ${caseLabel(s)}. ${m.value}. ${m.effect}.${current ? " Currently selected." : ""}`}
                  title={s.summary}
                  onClick={() => onPlay(s.id)}
                >
                  <ScenarioIcon id={s.id} size={40} />
                  <span className="scn-body">
                    <span className="scn-top">
                      <span className="scn-name">{s.name}</span>
                      {current && <span className="scn-playing">{scenario?.running ? "Playing" : "Selected"}</span>}
                    </span>
                    <span className="scn-meta">
                      <span className="scn-case">{caseLabel(s)}</span>
                      <span className="scn-value">{m.value}</span>
                    </span>
                    <span className="scn-effect">{m.effect}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      <nav className="rail panel" ref={railRef} aria-label="Scenario categories" onKeyDown={onRailKey} style={{ width: RAIL_WIDTH }}>
        <span className="rail-title" aria-hidden="true">Scenarios</span>
        {CATEGORIES.map((c) => {
          const r = RAIL[c.id];
          const active = open && cat === c.id;
          return (
            <button
              key={c.id}
              className="rail-btn"
              aria-expanded={active}
              aria-controls={active ? "scenario-sheet" : undefined}
              aria-label={`${c.label} scenarios${currentCat === c.id ? ", contains the current scenario" : ""}`}
              onClick={() => choose(c.id)}
            >
              {currentCat === c.id && <span className="rail-live" aria-hidden="true" />}
              <Icon name={r.icon} size={20} />
              <span>{r.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

/** The guided demonstration's text, docked at the middle right while the demo runs. */
export function DemoBar({ index, onPrev, onNext, onExit }: { index: number; onPrev: () => void; onNext: () => void; onExit: () => void }) {
  const beat = DEMO_BEATS[index];
  if (!beat) return null;
  return (
    <section className="sheet demo-panel panel" aria-label="Guided demonstration" aria-live="polite" style={{ width: DEMO_WIDTH }}>
      <header className="sheet-head">
        <span className="eyebrow">Guided demo · step {index + 1} of {DEMO_BEATS.length}</span>
        <button className="btn btn-icon btn-ghost" onClick={onExit} aria-label="Exit demo" data-tip="Exit demo · G">
          <Icon name="close" size={18} />
        </button>
      </header>
      <span className="demo-progress" aria-hidden="true">
        {DEMO_BEATS.map((_, i) => <span key={i} className={i <= index ? "on" : ""} />)}
      </span>
      <h2 className="demo-title">{beat.title}</h2>
      <p className="demo-caption">{beat.caption}</p>
      <div className="demo-nav">
        <button className="btn" onClick={onPrev} disabled={index <= 0} aria-label="Previous step (Left arrow)"><Icon name="left" size={16} /> Back</button>
        <button className="btn btn-primary" onClick={onNext} disabled={index >= DEMO_BEATS.length - 1} aria-label="Next step (Right arrow)">Next <Icon name="right" size={16} /></button>
      </div>
    </section>
  );
}

/** Below 1180 px the prompt bar is hidden: the running scenario's stage shows at the bottom centre. */
export function StageMini() {
  const { scenario } = useSim();
  if (!scenario?.stage) return null;
  return (
    <div className={`stage-mini panel tone-${STAGE_TONE[scenario.stage.tone]}`} aria-hidden="true">
      <ScenarioStageLine compact />
    </div>
  );
}
