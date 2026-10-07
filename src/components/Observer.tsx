"use client";
import { useRuntime, useSim } from "./context";
import { ScenarioStageLine, StatusSeg, Toasts } from "./hud/Hud";
import { Readings, OutputRows } from "./panels/RackPanels";
import { Icon } from "./icons";
import { conditionInfo, epoInfo, resetInfo } from "@/lib/present";
import { SCENARIOS, caseLabel } from "@/sim/scenarios";
import { SCENARIO_META } from "./scenarios/meta";
import { ScenarioIcon } from "./scenarios/ScenarioIcon";

/** Simplified phone layout: rack close-up above, status, readings and controls below. No walking. */
export function ObserverPanel({ onHelp, onRestart }: { onHelp: () => void; onRestart: () => void }) {
  const rt = useRuntime();
  const snap = useSim();
  const s = snap.controller;
  return (
    <section className="observer" aria-label="Rack observer">
      <div className="obs-head">
        <span className="brand-name" style={{ fontSize: 16 }}>RackSentinel</span>
        <button className="btn btn-icon" onClick={onHelp} aria-label="About this simulation"><Icon name="help" size={20} /></button>
      </div>
      <Toasts max={1} />
      <div className="obs-status" role="status" aria-label="Controller status">
        <StatusSeg cap="Rack condition" info={conditionInfo(s)} />
        <StatusSeg cap="EPO" info={epoInfo(s)} alarm={s.epo} />
        <StatusSeg cap="P0 reset" info={resetInfo(s, snap.resetBlockers)} />
      </div>
      <ScenarioStageLine compact />
      <button className="btn btn-primary btn-wide btn-lg" onClick={() => rt.pressReset()}>Press P0 reset</button>
      <div className="obs-readings-wrap"><Readings s={s} /></div>
      <div>
        <div className="section-label" style={{ marginTop: 0 }}>Output requests</div>
        <OutputRows pins={s.pins} />
      </div>
      <div>
        <div className="section-label" style={{ marginTop: 0 }}>Scenarios</div>
        <div className="obs-scenarios" role="list">
          {SCENARIOS.map((sc) => {
            const m = SCENARIO_META[sc.id];
            const current = snap.scenario?.id === sc.id;
            return (
              <button key={sc.id} role="listitem" className={`obs-scn tone-${m.tone} ${current ? "is-current" : ""}`} onClick={() => rt.playScenario(sc.id)}
                aria-label={`${sc.name}. ${caseLabel(sc)}. ${m.effect}.${current ? " Selected." : ""}`}>
                <ScenarioIcon id={sc.id} />
                {sc.name}
                <span className="scn-case">{caseLabel(sc)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="obs-foot">
        <button className="btn btn-sm" onClick={onRestart}><Icon name="restart" size={16} /> Restart simulation</button>
      </div>
      <p className="prompt-note" style={{ margin: 0 }}>Simulation only · not connected to a physical rack or FPGA</p>
    </section>
  );
}
