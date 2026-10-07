"use client";
import { useEffect, useRef, useState } from "react";
import { useSim } from "../context";
import { Icon } from "../icons";
import { SCENARIOS } from "@/sim/scenarios";
import { DEMO_BEATS } from "@/sim/demo";
import { CATEGORIES, SCENARIO_META, type CategoryId } from "../scenarios/meta";
import { ScenarioIcon } from "../scenarios/ScenarioIcon";
import { ScenarioStageLine, STAGE_TONE } from "./Hud";

export function ScenarioDrawer({ open, onToggle, onPlay }: { open: boolean; onToggle: (open: boolean) => void; onPlay: (id: string) => void }) {
  const { scenario } = useSim();
  const [cat, setCat] = useState<CategoryId>(() => (scenario ? SCENARIO_META[scenario.id]?.category : undefined) ?? "conditions");
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) bodyRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  const list = SCENARIOS.filter((s) => SCENARIO_META[s.id]?.category === cat);
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = CATEGORIES.findIndex((c) => c.id === cat);
    const next = CATEGORIES[(i + (e.key === "ArrowRight" ? 1 : CATEGORIES.length - 1)) % CATEGORIES.length];
    setCat(next.id);
    bodyRef.current?.querySelector<HTMLButtonElement>(`#tab-${next.id}`)?.focus();
  };

  return (
    <div className="drawer">
      {open && (
        <div className="drawer-body panel panel-major" id="scenario-list" ref={bodyRef} role="group" aria-label="Scenarios">
          <div className="drawer-head">
            <div>
              <div className="panel-title">Scenarios</div>
              <div className="muted" style={{ fontSize: 12.5 }}>Each starts from a controller power-on, like the official test cases.</div>
            </div>
            <div className="segmented" role="tablist" aria-label="Scenario category" onKeyDown={onTabKey}>
              {CATEGORIES.map((c) => (
                <button key={c.id} id={`tab-${c.id}`} role="tab" aria-selected={cat === c.id} aria-controls="scenario-panel" tabIndex={cat === c.id ? 0 : -1} onClick={() => setCat(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="scn-grid" id="scenario-panel" role="tabpanel" aria-labelledby={`tab-${cat}`}>
            {list.map((s) => {
              const m = SCENARIO_META[s.id];
              const current = scenario?.id === s.id;
              return (
                <button
                  key={s.id}
                  className={`scn tone-${m.tone} ${current ? "is-current" : ""}`}
                  aria-label={`${s.name}. ${m.value}. ${m.effect}.${current ? " Currently selected." : ""}`}
                  title={s.summary}
                  onClick={() => {
                    onPlay(s.id);
                    onToggle(false);
                  }}
                >
                  <ScenarioIcon id={s.id} />
                  <span>
                    <span className="scn-name">{s.name}{current && <span className="scn-playing">{scenario?.running ? "Playing" : "Selected"}</span>}</span>
                    <span className="scn-value">{m.value}</span>
                    <span className="scn-effect">{m.effect}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {!open && scenario?.stage && (
        <div className={`stage-mini panel tone-${STAGE_TONE[scenario.stage.tone]}`} aria-hidden="true">
          <ScenarioStageLine compact />
        </div>
      )}
      <button className="btn drawer-toggle" aria-expanded={open} aria-controls="scenario-list" onClick={() => onToggle(!open)}>
        <Icon name={open ? "down" : "up"} size={16} />
        <span>Scenarios</span>
        {scenario && <span className="drawer-current">· {scenario.name}</span>}
      </button>
    </div>
  );
}

export function DemoBar({ index, onPrev, onNext, onExit }: { index: number; onPrev: () => void; onNext: () => void; onExit: () => void }) {
  const beat = DEMO_BEATS[index];
  if (!beat) return null;
  return (
    <section className="demobar panel panel-major" aria-label="Guided demonstration" aria-live="polite">
      <div className="demo-step">
        <span className="eyebrow">Guided demo · step {index + 1} of {DEMO_BEATS.length}</span>
        <span className="demo-progress" aria-hidden="true">
          {DEMO_BEATS.map((_, i) => <span key={i} className={i <= index ? "on" : ""} />)}
        </span>
      </div>
      <h2 className="demo-title">{beat.title}</h2>
      <p className="demo-caption">{beat.caption}</p>
      <div className="demo-nav">
        <button className="btn" onClick={onPrev} disabled={index <= 0} aria-label="Previous step (Left arrow)"><Icon name="left" size={16} /> Back</button>
        <button className="btn" onClick={onExit}>Exit demo</button>
        <button className="btn btn-primary" onClick={onNext} disabled={index >= DEMO_BEATS.length - 1} aria-label="Next step (Right arrow)">Next <Icon name="right" size={16} /></button>
      </div>
    </section>
  );
}
