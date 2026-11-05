/**
 * Raw-step units (stage4_fpga/SPEC.md):
 *   temperature 0.5 °C per step, current 0.2 A per step, voltage 1 V per step,
 *   power V × I_raw in 0.2 W units, power limit in 100 W steps,
 *   energy in 0.2 W·min units (one CURRENT reading counts as one minute).
 * Integer arithmetic is used internally so boundaries (27.0 °C, 5.9 kW, …) are exact.
 */
export const AMP_PER_STEP = 0.2;
export const DEGC_PER_STEP = 0.5;

export const ampsToRaw = (a: number) => Math.round(a / AMP_PER_STEP);
export const degCToRaw = (c: number) => Math.round(c / DEGC_PER_STEP);

/** Raw → real, rounded to one decimal so 0.2 A steps never print as 25.400000000000002. */
export const rawToAmps = (r: number) => Math.round(r * 2) / 10;
export const rawToDegC = (r: number) => Math.round(r * 5) / 10;

export const fmtVolts = (v: number) => `${v} V`;
export const fmtAmps = (r: number) => `${rawToAmps(r).toFixed(1)} A`;
export const fmtDegC = (r: number) => `${rawToDegC(r).toFixed(1)} °C`;
/** Power in 0.2 W units → kW. */
export const powerKW = (units: number) => units / 5000;
export const fmtKW = (units: number) => `${powerKW(units).toFixed(2)} kW`;
/** Power-limit setting (× 100 W) → kW. */
export const fmtLimit = (setting: number) => `${(setting / 10).toFixed(1)} kW`;

/** Wh = E / 300, exactly as the firmware: mulhu(E, 0xDA740DA8) >> 8. */
export function energyWh(e: number): number {
  return Number(((BigInt(e >>> 0) * BigInt(0xda740da8)) >> BigInt(32)) >> BigInt(8));
}
