/**
 * Extension point for deeper technical views (UART packet inspector, CRC view, GPIO bits,
 * SoC / memory-map explorer, firmware trace, waveforms, verification evidence, …).
 *
 * Register a panel here and it appears as a tab in the rack inspector. Each panel is
 * lazy-loaded, receives the immutable simulation snapshot, and must not mutate state except
 * through the runtime API. The list is empty on purpose: nothing unfinished is shown.
 *
 *   export const TECHNICAL_PANELS: TechnicalPanel[] = [
 *     { id: "uart", title: "UART", load: () => import("./tech/UartInspector") },
 *   ];
 */
import type { ComponentType } from "react";
import type { SimSnapshot } from "@/sim/runtime";

export interface TechnicalPanelProps {
  snapshot: SimSnapshot;
}

export interface TechnicalPanel {
  id: string;
  title: string;
  load: () => Promise<{ default: ComponentType<TechnicalPanelProps> }>;
}

export const TECHNICAL_PANELS: TechnicalPanel[] = [];
