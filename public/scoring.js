// Flip 7 scoring rules, shared by the worker (authoritative) and the client
// (live preview). Served as a static asset and bundled into the worker.

export const TARGET = 200;
export const MODS = [2, 4, 6, 8, 10];

export function uniqInts(arr, min, max) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= min && v <= max))];
}

export function computeScore(n, m, x2) {
  let base = n.reduce((sum, v) => sum + v, 0);
  if (x2) base *= 2;
  const modifiers = m.reduce((sum, v) => sum + v, 0);
  const flip7Bonus = n.length === 7 ? 15 : 0;
  return base + modifiers + flip7Bonus;
}

// Normalize a raw addRound op into the stored round fields, score included.
export function sanitizeRound(op) {
  const bust = !!op.bust;
  const n = bust ? [] : uniqInts(op.n, 0, 12).slice(0, 7);
  const m = bust ? [] : uniqInts(op.m, 2, 10).filter((v) => MODS.includes(v));
  const x2 = bust ? false : !!op.x2;
  return { n, m, x2, bust, score: bust ? 0 : computeScore(n, m, x2) };
}
