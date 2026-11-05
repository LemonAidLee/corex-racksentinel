"use client";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { ScenarioIcon } from "../scenarios/ScenarioIcon";
import {
  ClassDemo,
  CrcDemo,
  EccDemo,
  EnergyDemo,
  LatchDemo,
  LeakDemo,
  PlatformDemo,
  PowerDemo,
  RunawayDemo,
  SettingsDemo,
  StatusDemo,
  TripDemo,
} from "./demos";

interface Feature {
  id: string;
  title: string;
  /** Command codes or pins involved. */
  tag: string;
  icon: IconName;
  /** Scenario icon shown on the card, when one fits. */
  art?: string;
  eli5: string;
  why: string;
  standout: string;
  demo: ReactNode;
  /** Data-flow case that shows it byte by byte. */
  run: string;
  span: 2 | 3 | 4 | 6;
  /** Surface variant, for rhythm in the grid. */
  surface?: "plain" | "inset" | "accent";
}

const FEATURES: Feature[] = [
  {
    id: "latch",
    title: "A power-off that stays off",
    tag: "P7 · latched",
    icon: "crit",
    art: "critical",
    eli5: "Like a circuit breaker: once it trips, it stays off until a person resets it, and only when the danger is gone.",
    why: "A flickering sensor or a cooling unit that recovers for a minute can never switch a damaged rack back on by itself.",
    standout: "Every reset re-checks every cause, and a taped-down button is ignored: only a new press counts.",
    demo: <LatchDemo />,
    run: "R3",
    span: 4,
    surface: "accent",
  },
  {
    id: "classes",
    title: "Four temperature classes",
    tag: "TEMP 0x20 · P4 P5",
    icon: "temp",
    eli5: "Like a car's temperature gauge with three warning marks: 27, 32 and 35 °C.",
    why: "Fans react early; power is cut only at the real danger line.",
    standout: "The limits are the ASHRAE data-centre guidelines, and a reading on a line takes the safer class.",
    demo: <ClassDemo />,
    run: "R2",
    span: 2,
  },
  {
    id: "runaway",
    title: "Cooling-failure detection",
    tag: "SET_RISE 0x44",
    icon: "rise",
    art: "runaway",
    eli5: "If the room heats up too fast, the air conditioning has probably died, even if it is not hot yet.",
    why: "It cuts power minutes before any threshold would be reached.",
    standout: "One subtraction per reading spots a failure that no fixed limit can see.",
    demo: <RunawayDemo />,
    run: "R4",
    span: 2,
  },
  {
    id: "leak",
    title: "Water-leak sensor",
    tag: "P1 input",
    icon: "drop",
    art: "leak",
    eli5: "A water sensor on the floor, wired straight to the chip.",
    why: "Water and servers do not mix: one leak can destroy a rack in seconds.",
    standout: "The chip watches the pin itself, so it reacts even when the network is down.",
    demo: <LeakDemo />,
    run: "R5",
    span: 2,
    surface: "inset",
  },
  {
    id: "crc",
    title: "A fingerprint on every message",
    tag: "crcb · CRC-16",
    icon: "shield",
    art: "corrupt",
    eli5: "Every packet carries a fingerprint. If one bit changes on the wire, the fingerprint no longer matches.",
    why: "A damaged reading can never switch an output or clear the power-off.",
    standout: "CRC-16 runs in our own custom crcb instruction: two instructions per packet instead of a loop.",
    demo: <CrcDemo />,
    run: "X1",
    span: 2,
  },
  {
    id: "ecc",
    title: "Memory that repairs itself",
    tag: "SECDED · FLIP_TEST 0x31",
    icon: "chip",
    art: "ecc-two",
    eli5: "Every safety setting is stored with check bits, like a phone number with extra digits that reveal a typo.",
    why: "A single flipped bit could silently move the Critical limit to 99.5 °C, and the rack would never trip.",
    standout: "One flipped bit is repaired at the next use. Two make the chip refuse to guess and cut power until the setting is rewritten.",
    demo: <EccDemo />,
    run: "R9",
    span: 4,
    surface: "accent",
  },
  {
    id: "settings",
    title: "Tunable for each site",
    tag: "0x41 to 0x46",
    icon: "sliders",
    eli5: "Each site can tune its limits: thresholds, the runaway limit, voltage and power budget.",
    why: "A 240 V site or a warmer hall needs different numbers.",
    standout: "One command per setting, checked for sense: Warm < Hot < Critical can never be broken.",
    demo: <SettingsDemo />,
    run: "X3",
    span: 2,
    surface: "inset",
  },
  {
    id: "power",
    title: "Power limit, V × I",
    tag: "CURRENT 0x21 · P6",
    icon: "bolt",
    art: "overload",
    eli5: "The chip multiplies volts by amps to know how much power the rack draws.",
    why: "Too much load trips breakers and takes every server down. An early warning lets the operator shed load.",
    standout: "One mul instruction does it, and the alarm warns without causing an outage itself.",
    demo: <PowerDemo />,
    run: "R6",
    span: 3,
  },
  {
    id: "energy",
    title: "Energy meter without a divider",
    tag: "ENERGY 0x51 · mulhu",
    icon: "energy",
    art: "energy",
    eli5: "Each reading adds one minute of power to a running total, like a home electricity meter.",
    why: "Power says what the rack draws right now; energy says what it has used since power-on. The electricity bill comes from that total, and comparing it week to week shows a rack that has started drawing more than it used to.",
    standout: "Our CPU has no divide instruction, so dividing by 300 is one multiply and a shift, exact for every value.",
    demo: <EnergyDemo />,
    run: "R7",
    span: 3,
  },
  {
    id: "trip",
    title: "A black box for every trip",
    tag: "TRIP_INFO 0x53",
    icon: "evidence",
    eli5: "When the power is cut, the chip writes down why, and how hot and loaded the rack was.",
    why: "The operator knows what happened at 3 a.m. without guessing.",
    standout: "The record is protected by ECC and survives the reset until the next trip.",
    demo: <TripDemo />,
    run: "R3",
    span: 3,
    surface: "inset",
  },
  {
    id: "status",
    title: "Status and error counters",
    tag: "STATUS 0x50 · COUNTERS 0x52",
    icon: "gauge",
    eli5: "The management system can ask the chip at any time how it is doing and how many errors it caught.",
    why: "Problems the chip handled quietly still show up in the logs.",
    standout: "Eight status flags and three error counters fit in two 4-byte answers.",
    demo: <StatusDemo />,
    run: "R8",
    span: 3,
  },
];

const STATS: [string, string][] = [
  ["9 of 9", "rehearsed runs passed on the AWS FPGA"],
  ["4", "independent reasons to cut power"],
  ["9", "safety words protected by ECC"],
  ["1,000", "random cases checked on the RTL"],
];

export default function FeaturesPage() {
  return (
    <>
      <section className="site-wrap feat-hero">
        <div className="feat-hero-text">
          <h1 className="site-h1">Eleven ways RackSentinel guards a rack</h1>
          <p className="site-lede">Each feature in plain words, why it matters, and a live demo running the verified chip model.</p>
          <div className="hero-cta">
            <Link href="/" className="btn btn-primary"><Icon name="play" size={16} /> Open the twin</Link>
            <Link href="/data-flow" className="btn"><Icon name="flow" size={16} /> Data flow</Link>
          </div>
        </div>
        <figure className="feat-hero-shot">
          <div className="shot-crop">
            <Image src="/evidence/fpga_emu_R3.png" alt="Terminal output of run R3 on the AWS FPGA: every line reads [ok]" width={1506} height={264} priority />
          </div>
          <figcaption>Run R3 on the AWS FPGA: overheat, refused reset, accepted reset, trip record. Every line [ok].</figcaption>
        </figure>
      </section>

      <section className="site-wrap stats" aria-label="Key numbers">
        {STATS.map(([k, v]) => (
          <div key={k} className="stat"><span className="stat-k num">{k}</span><span className="stat-v">{v}</span></div>
        ))}
      </section>

      <section className="site-wrap" aria-label="Features">
        <div className="bento">
          {FEATURES.map((f) => <FeatureCard key={f.id} f={f} />)}
          <article className="card span-6 surface-platform">
            <div className="card-head">
              <span className="card-icon"><Icon name="chip" size={18} /></span>
              <span className="card-tag num">RVBL-2 · AWS FPGA</span>
            </div>
            <div className="platform">
              <div>
                <h2 className="card-title">On our own CPU, on real hardware</h2>
                <p className="card-eli5">All of this runs on a RISC-V processor we designed in Stage 2, extended with pins and a serial port in Stage 3, and built on an AWS FPGA in Stage 4.</p>
                <p className="card-why">Nothing here is a software mock-up of the chip: the nine rehearsed runs passed on the hardware, line by line.</p>
                <Link href="/data-flow#R1" className="card-link">Start with run R1 <Icon name="arrow" size={15} /></Link>
              </div>
              <PlatformDemo />
            </div>
          </article>
        </div>
      </section>
    </>
  );
}

function FeatureCard({ f }: { f: Feature }) {
  return (
    <article className={`card span-${f.span} surface-${f.surface ?? "plain"}`} id={f.id}>
      <div className="card-head">
        <span className="card-icon"><Icon name={f.icon} size={18} /></span>
        <span className="card-tag num">{f.tag}</span>
        {f.art && <span className="card-art"><ScenarioIcon id={f.art} size={40} /></span>}
      </div>
      <h2 className="card-title">{f.title}</h2>
      <p className="card-eli5">{f.eli5}</p>
      <div className="card-demo">{f.demo}</div>
      <dl className="card-why-grid">
        <div><dt>Why it matters</dt><dd>{f.why}</dd></div>
        <div><dt>Why it stands out</dt><dd>{f.standout}</dd></div>
      </dl>
      <Link href={`/data-flow#${f.run}`} className="card-link">See it byte by byte in {f.run} <Icon name="arrow" size={15} /></Link>
    </article>
  );
}
