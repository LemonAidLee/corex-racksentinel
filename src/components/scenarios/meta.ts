/**
 * Presentation metadata for scenarios: category, the one value worth showing on the card,
 * the expected effect and its semantic tone. The scenario steps themselves live in
 * sim/scenarios.ts and are untouched by this file.
 */
import type { StateTone } from "@/lib/tokens";

export type CategoryId = "heat" | "water-power" | "memory" | "reset-link";

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "heat", label: "Heat and cooling" },
  { id: "water-power", label: "Water and power" },
  { id: "memory", label: "Memory faults (ECC)" },
  { id: "reset-link", label: "Reset and link" },
];

export interface ScenarioMeta {
  category: CategoryId;
  /** Key value shown in mono on the card. */
  value: string;
  /** Expected outcome, one short line. */
  effect: string;
  tone: StateTone;
}

export const SCENARIO_META: Record<string, ScenarioMeta> = {
  normal: { category: "heat", value: "22.0 °C · 20 A", effect: "No outputs, STATUS 40 2C 64 00", tone: "normal" },
  "heat-up": { category: "heat", value: "26.5 → 32.0 °C", effect: "P4 boost, then P5 maximum", tone: "warning" },
  critical: { category: "heat", value: "35.0 °C", effect: "Power-off; reset once below Critical", tone: "critical" },
  runaway: { category: "heat", value: "+2.5 °C", effect: "Power-off before any threshold", tone: "critical" },
  leak: { category: "water-power", value: "P1 wet", effect: "Power-off with no packet", tone: "critical" },
  overload: { category: "water-power", value: "26 A · 5.98 kW", effect: "P6 alarm, never a power-off", tone: "warning" },
  energy: { category: "water-power", value: "3 × 4.6 kW", effect: "ENERGY reports 230 Wh", tone: "normal" },
  "ecc-one": { category: "memory", value: "1 bit flipped", effect: "Repaired; Critical still 35.0 °C", tone: "warning" },
  "ecc-two": { category: "memory", value: "2 bits flipped", effect: "Fail-safe power-off until rewritten", tone: "critical" },
  "held-button": { category: "reset-link", value: "P0 taped", effect: "Held button cannot reset", tone: "warning" },
  corrupt: { category: "reset-link", value: "Reply 5A", effect: "Damaged packet changes nothing", tone: "warning" },
  invalid: { category: "reset-link", value: "Reply 3C", effect: "Bad values rejected", tone: "warning" },
  "silent-leak": { category: "reset-link", value: "Link silent", effect: "Leak still caught; P0 still works", tone: "critical" },
};
