/**
 * Presentation metadata for scenarios: category, the one value worth showing on the card,
 * the expected effect and its semantic tone. The scenario steps themselves live in
 * sim/scenarios.ts and are untouched by this file.
 */
import type { StateTone } from "@/lib/tokens";

export type CategoryId = "conditions" | "electrical" | "recovery" | "communication";

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "conditions", label: "Rack conditions" },
  { id: "electrical", label: "Electrical" },
  { id: "recovery", label: "Recovery & reset" },
  { id: "communication", label: "Communication" },
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
  normal: { category: "conditions", value: "26.5 °C · 25.4 A", effect: "No outputs requested", tone: "normal" },
  warm: { category: "conditions", value: "27.0 → 32.0 °C", effect: "P4 fan boost, no EPO", tone: "warning" },
  "critical-heat": { category: "conditions", value: "32.5 °C", effect: "Maximum fan + EPO request", tone: "critical" },
  "current-warning": { category: "electrical", value: "25.6 → 32.0 A", effect: "P6 current warning, no EPO", tone: "warning" },
  "current-trip": { category: "electrical", value: "32.2 A", effect: "Current warning + EPO request", tone: "critical" },
  combined: { category: "electrical", value: "32.5 °C · 32.2 A", effect: "Either fault keeps EPO latched", tone: "critical" },
  recover: { category: "recovery", value: "32.5 → 26.5 °C", effect: "Safe readings, EPO stays latched", tone: "critical" },
  "reset-warm": { category: "recovery", value: "27.0 °C", effect: "P0 refused while Warm", tone: "warning" },
  "reset-current": { category: "recovery", value: "25.6 A", effect: "P0 refused at warning current", tone: "warning" },
  "held-button": { category: "recovery", value: "P0 held", effect: "Held button cannot reset", tone: "warning" },
  invalid: { category: "communication", value: "Reply 0x3C", effect: "Invalid reading, nothing changes", tone: "warning" },
  corrupt: { category: "communication", value: "Reply 0x5A", effect: "Bad CRC cannot clear EPO", tone: "critical" },
  "no-telemetry": { category: "communication", value: "Link silent", effect: "State held, P0 still works", tone: "warning" },
};
