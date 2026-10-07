/** 3×5 pixel glyphs for the few labels painted directly onto objects in the room. */
const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  P: ["110", "101", "110", "100", "100"],
  V: ["101", "101", "101", "101", "010"],
  I: ["111", "010", "010", "010", "111"],
  T: ["111", "010", "010", "010", "010"],
  E: ["111", "100", "110", "100", "111"],
  O: ["111", "101", "101", "101", "111"],
  R: ["110", "101", "110", "101", "101"],
  S: ["111", "100", "111", "001", "111"],
  A: ["010", "101", "111", "101", "101"],
  C: ["111", "100", "100", "100", "111"],
  K: ["101", "101", "110", "101", "101"],
  N: ["111", "101", "101", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
};

/**
 * True when point (u, v) falls on a lit glyph pixel of `text` drawn at (x0, y0).
 * `px` is the world size of one glyph pixel; glyphs are 3 wide with a 1-pixel gap.
 */
export function textPixel(text: string, x0: number, y0: number, u: number, v: number, px = 1): boolean {
  const lx = Math.floor((u - x0) / px), ly = Math.floor((v - y0) / px);
  if (ly < 0 || ly > 4 || lx < 0) return false;
  const idx = Math.floor(lx / 4);
  if (idx >= text.length) return false;
  const gx = lx - idx * 4;
  if (gx > 2) return false;
  const g = GLYPHS[text[idx]];
  return !!g && g[ly][gx] === "1";
}

export const textWidth = (text: string, px = 1) => (text.length * 4 - 1) * px;
