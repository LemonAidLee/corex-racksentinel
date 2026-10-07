/**
 * Original synthesized cues (WebAudio oscillators, no sample files). One cue per event:
 * the alarm plays once when a trip latches and never loops while the state persists.
 */
import type { EventBus, SimEvents } from "@/sim/events";

type Note = { f: number; t: number; d: number; type?: OscillatorType; g?: number };

export class SoundManager {
  private ctx: AudioContext | null = null;
  muted = false;
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
      }),
    );
  }

  /** Browsers only allow audio after a user gesture; call from one. */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  play(cue: "alarm" | "warn" | "click" | "accept" | "refuse" | "reject"): void {
    if (this.muted || !this.ctx || this.ctx.state !== "running") return;
    const seq: Record<typeof cue, Note[]> = {
      alarm: [
        { f: 880, t: 0, d: 0.16, type: "square", g: 0.05 },
        { f: 660, t: 0.2, d: 0.16, type: "square", g: 0.05 },
        { f: 880, t: 0.4, d: 0.16, type: "square", g: 0.05 },
        { f: 660, t: 0.6, d: 0.22, type: "square", g: 0.05 },
      ],
      warn: [{ f: 587, t: 0, d: 0.12, type: "triangle", g: 0.08 }, { f: 587, t: 0.16, d: 0.12, type: "triangle", g: 0.06 }],
      click: [{ f: 1800, t: 0, d: 0.025, type: "square", g: 0.03 }],
      accept: [
        { f: 523, t: 0, d: 0.1, type: "triangle", g: 0.09 },
        { f: 659, t: 0.1, d: 0.1, type: "triangle", g: 0.09 },
        { f: 784, t: 0.2, d: 0.2, type: "triangle", g: 0.09 },
      ],
      refuse: [{ f: 196, t: 0, d: 0.12, type: "sawtooth", g: 0.05 }, { f: 165, t: 0.15, d: 0.2, type: "sawtooth", g: 0.05 }],
      reject: [{ f: 330, t: 0, d: 0.08, type: "square", g: 0.03 }],
    };
    const now = this.ctx.currentTime + 0.01;
    for (const n of seq[cue]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.f;
      const g = n.g ?? 0.06;
      gain.gain.setValueAtTime(0, now + n.t);
      gain.gain.linearRampToValueAtTime(g, now + n.t + 0.008);
      gain.gain.setValueAtTime(g, now + n.t + n.d - 0.02);
      gain.gain.linearRampToValueAtTime(0, now + n.t + n.d);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.02);
    }
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    void this.ctx?.close();
    this.ctx = null;
  }
}
