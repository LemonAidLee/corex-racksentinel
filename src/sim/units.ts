/**
 * Raw-step units from Documentation/09 and 10:
 *   voltage 1 V per step, current 0.2 A per step, temperature 0.5 °C per step.
 * Integer arithmetic is used internally so boundaries (25.6 A, 32.0 °C, …) are exact.
 */
export const VOLT_PER_STEP = 1;
export const AMP_PER_STEP = 0.2;
export const DEGC_PER_STEP = 0.5;

export const voltsToRaw = (v: number) => Math.round(v / VOLT_PER_STEP);
export const ampsToRaw = (a: number) => Math.round(a / AMP_PER_STEP);
export const degCToRaw = (c: number) => Math.round(c / DEGC_PER_STEP);

/** Raw → real, rounded to one decimal so 0.2 A steps never print as 25.400000000000002. */
export const rawToVolts = (r: number) => r * VOLT_PER_STEP;
export const rawToAmps = (r: number) => Math.round(r * 2) / 10;
export const rawToDegC = (r: number) => Math.round(r * 5) / 10;

export const fmtVolts = (r: number) => `${rawToVolts(r)} V`;
export const fmtAmps = (r: number) => `${rawToAmps(r).toFixed(1)} A`;
export const fmtDegC = (r: number) => `${rawToDegC(r).toFixed(1)} °C`;
