"use client";
import { useEffect, useRef, useState } from "react";
import { useSim } from "../context";
import { Icon } from "../icons";
import { SCENARIOS, caseLabel, scenarioById } from "@/sim/scenarios";
import { DEMO_BEATS } from "@/sim/demo";
import { CATEGORIES, SCENARIO_META, type CategoryId } from "../scenarios/meta";
import { ScenarioIcon } from "../scenarios/ScenarioIcon";
import { ScenarioStageLine, STAGE_TONE } from "./Hud";

/** Width of the right-hand dock in CSS px (the scene re-centres beside it while it is open). */
export const DOCK_WIDTH = 344;

/**
 * Scenarios, docked at the middle right. Collapsed, a compact launcher shows what is selected;
 * open, one category of scenario cards at a time so the list never crowds the room.
 */
export function ScenarioDrawer({ open, onToggle, onPlay }: { open: boolean; onToggle: (open: boolean) => void; onPlay: (id: string) => void }) {
  const { scenario } = useSim();
  const [cat, setCat] = useState<CategoryId>(() => (scenario ? SCENARIO_META[scenario.id]?.category : undefined) ?? "conditions");
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) bodyRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  if (!open) {
    const def = scenario ? scenarioById(scenario.id) : undefined;
    return (
      <button className="dock-launcher panel" aria-expanded={false} aria-controls="scenario-list" onClick={() => onToggle(true)}>
        <span className="launcher-text">
          <span className="eyebrow">Scenarios</span>
          <span className="launcher-title">{def ? def.name : "Choose a scenario"}</span>
          <span className="launcher-sub">
            {def ? `${caseLabel(def)} · ${scenario?.running ? "Playing" : "Finished"}` : "13 scripted, from C01 to C12"}
          </span>
        </span>
        <Icon name="left" size={16} />
      </button>
    );
  }

  const list = SCENARIOS.filter((s) => SCENARIO_META[s.id]?.category === cat);
  const onTabKey = (e: React.KeyboardEvent) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = CATEGORIES.findIndex((c) => c.id === cat);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 2 : -2;
    const next = CATEGORIES[(i + step + CATEGORIES.length) % CATEGORIES.length];
    setCat(next.id);
    bodyRef.current?.querySelector<HTMLButtonElement>(`#tab-${next.id}`)?.focus();
  };

  return (
    <section className="dock-panel panel panel-major" id="scenario-list" ref={bodyRef} aria-label="Scenarios">
      <header className="dock-head">
        <div>
          <h2 className="panel-title">Scenarios</h2>
          <p className="dock-sub">Each starts from a controller power-on, like the official test cases.</p>
        </div>
        <button className="btn btn-icon btn-ghost" onClick={() => onToggle(false)} aria-label="Close scenarios (Escape)" data-tip="Close · Esc">
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="segmented seg-grid" role="tablist" aria-label="Scenario category" onKeyDown={onTabKey}>
        {CATEGORIES.map((c) => (
          <button key={c.id} id={`tab-${c.id}`} role="tab" aria-selected={cat === c.id} aria-controls="scenario-panel" tabIndex={cat === c.id ? 0 : -1} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="scn-list" id="scenario-panel" role="tabpanel" aria-labelledby={`tab-${cat}`}>
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
  );
}

/** The guided demonstration's text, docked at the middle right while the demo runs. */
export function DemoBar({ index, onPrev, onNext, onExit }: { index: number; onPrev: () => void; onNext: () => void; onExit: () => void }) {
  const beat = DEMO_BEATS[index];
  if (!beat) return null;
  return (
    <section className="dock-panel demo-panel panel panel-major" aria-label="Guided demonstration" aria-live="polite">
      <header className="dock-head">
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
