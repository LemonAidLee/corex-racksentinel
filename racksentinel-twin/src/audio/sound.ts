/**
 * Original synthesized sound (WebAudio oscillators and noise, no sample files), in layers:
 *
 *   ambience   a low HVAC wash and the rack's fan hum, whose pitch follows the fan request
 *              (normal, P4 boost, P5 maximum); silent while paused
 *   activity   quiet UART ticks per packet, footsteps, the chair, P0's mechanical click
 *   cues       warning, distinct EPO latch, refusal, rejection, recovery confirmation
 *
 * Cues follow state transitions only: the alarm plays once when a trip latches and never loops.
 */
import { TEMP_CLASS } from "@/sim/controller";
import type { EventBus, SimEvents } from "@/sim/events";

type Note = { f: number; t: number; d: number; type?: OscillatorType; g?: number };
export type Cue = "alarm" | "warn" | "click" | "accept" | "refuse" | "reject" | "tick" | "step" | "chair";

/** Fan hum per request level: base frequency and loudness. */
const FAN = [
  { f: 46, g: 0.012 },
  { f: 58, g: 0.017 },
  { f: 74, g: 0.024 },
];

export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private fanOsc: OscillatorNode[] = [];
  private fanGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private fanLevel = 0;
  private _muted = false;
  private paused = false;
  private unsubs: (() => void)[] = [];

  constructor(bus: EventBus<SimEvents>) {
    this.unsubs.push(
      bus.on("trip", () => this.play("alarm")),
      bus.on("warning", () => this.play("warn")),
      bus.on("button", ({ down }) => down && this.play("click")),
      bus.on("reset", ({ outcome }) => {
        if (outcome === "accepted") this.play("accept");
        else if (outcome !== "released" && outcome !== "not-latched") this.play("refuse");
      }),
      bus.on("telemetry", ({ result }) => {
        if (result.outcome === "invalid" || result.outcome === "bad-crc") this.play("reject");
        else this.play("tick");
      }),
      bus.on("state", (s) => this.setFanLevel(s.tempClass >= TEMP_CLASS.HOT ? 2 : s.tempClass === TEMP_CLASS.WARM ? 1 : 0)),
      bus.on("restart", () => this.setFanLevel(0)),
    );
  }

  get muted(): boolean {
    return this._muted;
  }
  set muted(m: boolean) {
    this._muted = m;
    this.applyLevels();
  }

  /** Ambience pauses with the simulation; one-shot cues are already tied to events. */
  setPaused(p: boolean): void {
    this.paused = p;
    this.applyLevels();
  }

  /** Browsers only allow audio after a user gesture; call from one. */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.build(this.ctx);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private build(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0;
    this.ambience.connect(this.master);

    // one second of white noise, reused by the HVAC loop and the short noise cues
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    this.noise = buf;

    // HVAC: looped noise, low-passed into a soft wash
    const hvac = ctx.createBufferSource();
    hvac.buffer = buf;
    hvac.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const hvacGain = ctx.createGain();
    hvacGain.gain.value = 0.05;
    hvac.connect(lp).connect(hvacGain).connect(this.ambience);
    hvac.start();

    // rack fans: a hum and its octave, filtered so it sits under everything else
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = FAN[0].g;
    const fanLp = ctx.createBiquadFilter();
    fanLp.type = "lowpass";
    fanLp.frequency.value = 260;
    this.fanGain.connect(fanLp).connect(this.ambience);
    for (const [type, mult, g] of [["sawtooth", 1, 0.6], ["triangle", 2, 0.4]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = FAN[0].f * mult;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.fanGain);
      o.start();
      this.fanOsc.push(o);
    }
    this.setFanLevel(this.fanLevel, true);
    this.applyLevels();
  }

  private applyLevels(): void {
    if (!this.ctx || !this.master || !this.ambience) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this._muted ? 0 : 1, now, 0.05);
    this.ambience.gain.setTargetAtTime(this._muted || this.paused ? 0 : 1, now, 0.4);
  }

  /** Fans spin up or down over about a second, like real ones. */
  private setFanLevel(level: number, instant = false): void {
    this.fanLevel = level;
    if (!this.ctx || !this.fanGain) return;
    const now = this.ctx.currentTime;
    const k = instant ? 0.01 : 0.6;
    this.fanOsc.forEach((o, i) => o.frequency.setTargetAtTime(FAN[level].f * (i + 1), now, k));
    this.fanGain.gain.setTargetAtTime(FAN[level].g, now, k);
  }

  play(cue: Cue): void {
    if (this._muted || !this.ctx || !this.master || this.ctx.state !== "running") return;
    switch (cue) {
      case "tick":
        return this.tones([{ f: 2600, t: 0, d: 0.012, type: "square", g: 0.008 }]);
      case "step":
        return this.burst(0.045, "bandpass", 170, 0.09);
      case "chair":
        return this.burst(0.32, "bandpass", 520, 0.035, 260);
      case "click":
        // mechanical: a sharp contact click plus a low body thunk
        this.burst(0.018, "highpass", 2200, 0.05);
        return this.tones([{ f: 140, t: 0, d: 0.06, type: "sine", g: 0.08 }]);
      default:
        return this.tones(CUES[cue]);
    }
  }

  private tones(seq: Note[]): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime + 0.01;
    for (const n of seq) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.f;
      const g = n.g ?? 0.06;
      gain.gain.setValueAtTime(0, now + n.t);
      gain.gain.linearRampToValueAtTime(g, now + n.t + Math.min(0.008, n.d / 3));
      gain.gain.setValueAtTime(g, now + n.t + Math.max(0.004, n.d - 0.02));
      gain.gain.linearRampToValueAtTime(0, now + n.t + n.d);
      osc.connect(gain).connect(this.master!);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.02);
    }
  }

  /** A short filtered noise burst; `sweepTo` glides the filter (chair casters). */
  private burst(d: number, type: BiquadFilterType, f: number, g: number, sweepTo?: number): void {
    const ctx = this.ctx!;
    if (!this.noise) return;
    const now = ctx.currentTime + 0.005;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f, now);
    if (sweepTo) filt.frequency.linearRampToValueAtTime(sweepTo, now + d);
    filt.Q.value = type === "bandpass" ? 1.2 : 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(g, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + d);
    src.connect(filt).connect(gain).connect(this.master!);
    src.start(now, Math.random() * 0.5);
    src.stop(now + d + 0.02);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    void this.ctx?.close();
    this.ctx = null;
  }
}

const CUES: Record<"alarm" | "warn" | "accept" | "refuse" | "reject", Note[]> = {
  // EPO latch: a falling two-tone, twice, unlike any other cue
  alarm: [
    { f: 880, t: 0, d: 0.16, type: "square", g: 0.05 },
    { f: 660, t: 0.2, d: 0.16, type: "square", g: 0.05 },
    { f: 880, t: 0.4, d: 0.16, type: "square", g: 0.05 },
    { f: 660, t: 0.6, d: 0.22, type: "square", g: 0.05 },
  ],
  warn: [{ f: 587, t: 0, d: 0.12, type: "triangle", g: 0.08 }, { f: 587, t: 0.16, d: 0.12, type: "triangle", g: 0.06 }],
  accept: [
    { f: 523, t: 0, d: 0.1, type: "triangle", g: 0.09 },
    { f: 659, t: 0.1, d: 0.1, type: "triangle", g: 0.09 },
    { f: 784, t: 0.2, d: 0.2, type: "triangle", g: 0.09 },
  ],
  refuse: [{ f: 196, t: 0, d: 0.12, type: "sawtooth", g: 0.05 }, { f: 165, t: 0.15, d: 0.2, type: "sawtooth", g: 0.05 }],
  reject: [{ f: 330, t: 0, d: 0.08, type: "square", g: 0.03 }],
};
