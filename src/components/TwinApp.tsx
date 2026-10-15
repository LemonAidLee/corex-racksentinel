"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SimulationRuntime } from "@/sim/runtime";
import { GuidedDemo, DEMO_BEATS } from "@/sim/demo";
import { SoundManager } from "@/audio/sound";
import { Game } from "@/scene/game";
import type { Interactive } from "@/scene/layout";
import { GameContext, RuntimeContext } from "./context";
import { Brand, ControlBar, LiveRegion, PrimaryStatus, PromptBar, TelemetrySummary, Toasts } from "./hud/Hud";
import { QUALITY_LABEL, type Quality } from "@/scene/raster";
import { readQuality, saveQuality } from "@/lib/quality";
import { DOCK_GAP, RAIL_WIDTH, SHEET_WIDTH, ScenarioDrawer, StageMini } from "./hud/ScenarioDrawer";
import { ButtonChip, RackChip, RackHoverCard, RackInspector, TerminalChip } from "./panels/RackPanels";
import { TerminalPanel } from "./panels/TerminalPanel";
import { HelpDialog, SceneDescription } from "./panels/HelpDialog";
import { ObserverPanel } from "./Observer";
import { Icon } from "./icons";
import { CausalityRibbon, DemoStrip, EvidencePanel, FocusLabels, ReplayButton, ScreenshotPresets, TimelineDrawer, type ShotPreset } from "./hud/Incident";
import type { FocusName } from "@/scene/camera";

type Panel = "rack" | "terminal" | null;

function useMedia(query: string): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

export default function TwinApp() {
  const [rt] = useState(() => new SimulationRuntime());
  const [game, setGame] = useState<Game | null>(null);
  const [demo] = useState(() => new GuidedDemo(rt));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const soundRef = useRef<SoundManager | null>(null);

  const [panel, setPanel] = useState<Panel>(null);
  const [hover, setHover] = useState<Interactive | null>(null);
  const [help, setHelp] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [muted, setMuted] = useState(false);
  const prefersReduced = useMedia("(prefers-reduced-motion: reduce)");
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null);
  const reducedMotion = motionOverride ?? prefersReduced;
  const [screenshot, setScreenshot] = useState(false);
  const [demoIndex, setDemoIndex] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [canvasFailed, setCanvasFailed] = useState(false);
  const observer = useMedia("(max-width: 760px), (max-height: 480px) and (max-width: 960px)");
  const [quality, setQuality] = useState<Quality>(() => readQuality());
  const qualityRef = useRef(quality);
  const [fullscreen, setFullscreen] = useState(false);
  const [focusing, setFocusing] = useState(false);
  const [timeline, setTimeline] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const [labels, setLabels] = useState(false);
  const [follow, setFollow] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [shot, setShot] = useState<ShotPreset>("room");

  // refs for handlers created once
  const state = useRef({ panel, demoIndex, game, observer });
  useEffect(() => {
    state.current = { panel, demoIndex, game, observer };
  }, [panel, demoIndex, game, observer]);

  const activate = useCallback(
    (target: Interactive) => {
      const g = state.current.game;
      soundRef.current?.unlock();
      if (target === "rack") {
        setDrawer(false);
        setPanel("rack");
        g?.setFocus("rack");
        if (!state.current.observer) g?.operator.goInspect();
      } else if (target === "terminal") {
        setDrawer(false);
        setPanel("terminal");
        g?.setFocus("desk");
        if (!state.current.observer) g?.operator.goToDesk();
      } else {
        rt.pressReset();
      }
    },
    [rt],
  );

  // ---------------------------------------------------------------- game + sound lifecycle
  useEffect(() => {
    const sound = new SoundManager(rt.bus);
    soundRef.current = sound;
    let g: Game | null = null;
    try {
      g = new Game(
        canvasRef.current!,
        rt,
        {
          onHover: setHover,
          onActivate: (t) => activate(t),
          onCue: (c) => soundRef.current?.play(c),
          onQualityFallback: (q) => {
            setQuality(q);
            rt.notify("Render quality lowered", `Switched to ${QUALITY_LABEL[q]} to keep the simulation smooth.`, "info");
          },
        },
        qualityRef.current,
      );
      setGame(g);
      // development-only handle for inspecting the simulation from the browser console
      if (process.env.NODE_ENV === "development") Object.assign(window, { __racksentinel: { rt, game: g } });
    } catch {
      setCanvasFailed(true);
    }
    return () => {
      g?.destroy();
      sound.dispose();
      setGame(null);
    };
  }, [rt, activate]);

  useEffect(() => {
    if (soundRef.current) soundRef.current.muted = muted;
  }, [muted]);
  useEffect(() => {
    game?.setReducedMotion(reducedMotion);
  }, [game, reducedMotion]);
  useEffect(() => {
    game?.setObserver(observer);
    if (observer) game?.operator.teleport("seat");
  }, [game, observer]);
  useEffect(() => rt.subscribe(() => setPaused(rt.paused)), [rt]);
  useEffect(() => {
    soundRef.current?.setPaused(paused);
  }, [paused]);
  useEffect(() => {
    game?.setFollow(follow);
  }, [game, follow]);
  // a panel the user opened owns the camera; incident following waits until it closes
  useEffect(() => {
    game?.setInteractionLock(panel !== null);
  }, [game, panel]);
  useEffect(() => {
    qualityRef.current = quality;
    game?.setQuality(quality);
  }, [game, quality]);
  // only an explicit toolbar choice is remembered; the automatic fallback is not
  const chooseQuality = useCallback((q: Quality) => {
    saveQuality(q);
    setQuality(q);
  }, []);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  // presentation focus: dim secondary HUD briefly while a scenario starts
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const off = rt.bus.on("scenario", ({ phase }) => {
      if (phase !== "start") return;
      setFocusing(true);
      clearTimeout(id);
      id = setTimeout(() => setFocusing(false), 1400);
    });
    return () => {
      off();
      clearTimeout(id);
    };
  }, [rt]);

  // ---------------------------------------------------------------- actions
  const closePanel = useCallback(() => {
    setPanel(null);
    state.current.game?.setFocus("room");
  }, []);

  const restart = useCallback(() => {
    setDemoIndex(-1);
    rt.restart();
    rt.setPaused(false);
    state.current.game?.resetOperator();
    state.current.game?.setFocus("room", true);
    setPanel(null);
  }, [rt]);

  const playScenario = useCallback(
    (id: string) => {
      setDemoIndex(-1);
      setDrawer(false);
      rt.setPaused(false);
      rt.playScenario(id);
    },
    [rt],
  );

  const focusBeat = useCallback((i: number) => {
    const f = DEMO_BEATS[i]?.focus;
    const g = state.current.game;
    if (!g || !f) return;
    g.setFocus(f === "desk" ? "desk" : f);
  }, []);

  const startDemo = useCallback(() => {
    soundRef.current?.unlock();
    setPanel(null);
    rt.setPaused(false);
    state.current.game?.resetOperator();
    demo.start();
    setDemoIndex(demo.index);
    focusBeat(demo.index);
  }, [rt, demo, focusBeat]);

  const demoNext = useCallback(() => {
    if (demo.index < 0) return;
    demo.next();
    setDemoIndex(demo.index);
    focusBeat(demo.index);
  }, [demo, focusBeat]);

  const demoPrev = useCallback(() => {
    if (demo.index <= 0) return;
    demo.previous();
    const g = state.current.game;
    // instant rebuild: put the operator where the story leaves them
    const prevSteps = DEMO_BEATS.slice(0, demo.index + 1).flatMap((b) => b.steps);
    if (prevSteps.some((s) => s.type === "press")) g?.operator.teleport("button");
    else g?.resetOperator();
    setDemoIndex(demo.index);
    focusBeat(demo.index);
  }, [demo, focusBeat]);

  const exitDemo = useCallback(() => {
    setDemoIndex(-1);
    demo.stop();
    rt.setStreaming(true);
    state.current.game?.setFocus("room");
  }, [demo, rt]);

  const replay = useCallback(
    (id: string) => {
      setDemoIndex(-1);
      rt.setPaused(false);
      state.current.game?.resetOperator();
      rt.playScenario(id);
    },
    [rt],
  );

  const focusScene = useCallback((f: FocusName) => state.current.game?.setFocus(f), []);

  const chooseShot = useCallback((p: ShotPreset) => {
    setShot(p);
    state.current.game?.setFocus(p === "room" ? "room" : "rack");
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      soundRef.current?.unlock();
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
      if (e.key === "Escape") {
        if (help) setHelp(false);
        else if (drawer) setDrawer(false);
        else if (screenshot) setScreenshot(false);
        else if (presenting) setPresenting(false);
        else if (evidence) setEvidence(false);
        else if (timeline) setTimeline(false);
        else closePanel();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === " " && el.tagName !== "BUTTON") { e.preventDefault(); rt.setPaused(!rt.paused); }
      else if (k === "r") restart();
      else if (k === "f") toggleFullscreen();
      else if (k === "m") setMuted((m) => !m);
      else if (k === "h") setScreenshot((s) => !s);
      else if (k === "g") (state.current.demoIndex >= 0 ? exitDemo : startDemo)();
      else if (k === "t") setTimeline((v) => !v);
      else if (k === "e") setEvidence((v) => !v);
      else if (k === "l") setLabels((v) => !v);
      else if (k === "c") setFollow((v) => !v);
      else if (k === "p") setPresenting((v) => !v);
      else if (e.key === "?") setHelp(true);
      else if (e.key === "ArrowRight" && state.current.demoIndex >= 0) demoNext();
      else if (e.key === "ArrowLeft" && state.current.demoIndex >= 0) demoPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rt, help, drawer, screenshot, presenting, evidence, timeline, closePanel, restart, toggleFullscreen, startDemo, exitDemo, demoNext, demoPrev]);

  const ringOn = (t: Interactive) => (e: React.FocusEvent<HTMLElement>) => {
    if (e.target.matches(":focus-visible")) game?.setFocusRing(t);
  };
  const ringOff = () => game?.setFocusRing(null);
  const demoActive = demoIndex >= 0;
  // what the audience should be looking at this beat; everything else in the HUD steps back
  const anchor = demoActive ? DEMO_BEATS[demoIndex]?.anchor : undefined;
  // the scenario rail is hidden while the rack inspector or evidence uses that side, and during the
  // demo, where the story owns the bottom of the screen and the scene gets the full width
  const dockVisible = !observer && !screenshot && panel !== "rack" && !evidence && !demoActive;
  const dockOpen = dockVisible && drawer;
  // the scene keeps clear of the rail always, and of the sheet or demo text while they show
  // evidence docks on the right (CSS: min(480px, 36vw), at least 360px wide)
  const evidenceInset = evidence && !observer && !screenshot && panel !== "rack" ? Math.max(360, Math.min(480, window.innerWidth * 0.36)) + 32 : 0;
  const dockInset = evidenceInset ? evidenceInset : !dockVisible ? 0 : RAIL_WIDTH + 24 + (drawer ? SHEET_WIDTH + DOCK_GAP : 0);
  useEffect(() => {
    game?.setViewInset(dockInset);
  }, [game, dockInset]);

  return (
    <RuntimeContext.Provider value={rt}>
      <GameContext.Provider value={game}>
        <main className={`twin ${screenshot ? "is-screenshot" : ""} ${presenting ? "is-presenting" : ""} ${observer ? "is-observer" : ""} ${focusing ? "is-focusing" : ""} ${reducedMotion ? "is-reduced" : ""} ${demoActive ? "is-demo" : ""}`} data-anchor={anchor} onPointerDown={() => soundRef.current?.unlock()}>
          <div className="stage">
            <canvas ref={canvasRef} className="scene" aria-hidden="true" />
            {canvasFailed && (
              <div className="fallback panel">
                <h2>Graphics unavailable</h2>
                <p>The scene could not start in this browser. The controller simulation still runs:</p>
                <SceneDescription />
              </div>
            )}
            <div className="overlay">
              {!observer && (
                <>
                  <TerminalChip onActivate={() => activate("terminal")} onFocus={ringOn("terminal")} onBlur={ringOff} />
                  <RackChip onActivate={() => activate("rack")} onFocus={ringOn("rack")} onBlur={ringOff} />
                  <ButtonChip onActivate={() => activate("button")} onFocus={ringOn("button")} onBlur={ringOff} />
                  {labels && <FocusLabels />}
                  {hover === "rack" && panel !== "rack" && !screenshot && <RackHoverCard />}
                  {panel === "rack" && !screenshot && <RackInspector onClose={closePanel} onPress={() => activate("button")} />}
                  {panel === "terminal" && !screenshot && <TerminalPanel onClose={closePanel} />}
                </>
              )}
            </div>
          </div>

          <h2 className="sr-only">Scene description</h2>
          <div className="sr-only"><SceneDescription /></div>

          {observer ? (
            <ObserverPanel onHelp={() => setHelp(true)} onRestart={restart} />
          ) : (
            <>
              <div className="hud hud-tl"><Brand onHelp={() => setHelp(true)} /></div>
              <div className="hud hud-tc"><PrimaryStatus /></div>
              <div className={`hud hud-toasts ${panel === "terminal" ? "at-br" : ""}`}><Toasts max={panel === "terminal" ? 1 : 3} /></div>
              {((evidence && panel !== "rack") || (screenshot && shot === "evidence")) && (
                <div className="hud hud-evidence"><EvidencePanel onClose={() => setEvidence(false)} onReplay={replay} /></div>
              )}
              <div className="hud hud-tr">
                <ControlBar
                  paused={paused}
                  muted={muted}
                  reducedMotion={reducedMotion}
                  demo={demoActive}
                  fullscreen={fullscreen}
                  quality={quality}
                  onQuality={chooseQuality}
                  follow={follow}
                  labels={labels}
                  timeline={timeline}
                  evidence={evidence}
                  presenting={presenting}
                  onFollow={() => setFollow((v) => !v)}
                  onLabels={() => setLabels((v) => !v)}
                  onTimeline={() => setTimeline((v) => !v)}
                  onEvidence={() => setEvidence((v) => !v)}
                  onPresent={() => setPresenting((v) => !v)}
                  onPause={() => rt.setPaused(!rt.paused)}
                  onMute={() => setMuted((m) => !m)}
                  onMotion={() => setMotionOverride(!reducedMotion)}
                  onFullscreen={toggleFullscreen}
                  onReset={restart}
                  onDemo={demoActive ? exitDemo : startDemo}
                  onScreenshot={() => setScreenshot(true)}
                />
              </div>
              {timeline ? (
                <div className="hud hud-bl is-timeline">
                  <TimelineDrawer onClose={() => { setTimeline(false); focusScene("room"); }} onFocus={focusScene} />
                </div>
              ) : (
                panel !== "terminal" && (
                  <div className="hud hud-bl">
                    <ReplayButton onReplay={replay} />
                    <PromptBar hover={hover} />
                  </div>
                )
              )}
              {dockVisible && (
                <div className={`hud hud-dock ${dockOpen ? "is-open" : ""}`}>
                  <ScenarioDrawer open={drawer} onToggle={setDrawer} onPlay={playScenario} />
                </div>
              )}
              <div className="hud hud-bc">
                <CausalityRibbon large={presenting} hold={demoActive} generation={demoIndex} />
                {demoActive && <DemoStrip index={demoIndex} onPrev={demoPrev} onNext={demoNext} onExit={exitDemo} />}
                <StageMini />
              </div>
              {panel !== "rack" && <div className="hud hud-br"><TelemetrySummary /></div>}
              {screenshot && <ScreenshotPresets value={shot} onChange={chooseShot} onExit={() => setScreenshot(false)} />}
              {presenting && !screenshot && (
                <button className="btn btn-sm present-exit" onClick={() => setPresenting(false)}><Icon name="present" size={16} /> Exit presentation (P)</button>
              )}
            </>
          )}
          <LiveRegion />
          {help && <HelpDialog onClose={() => setHelp(false)} />}
        </main>
      </GameContext.Provider>
    </RuntimeContext.Provider>
  );
}
