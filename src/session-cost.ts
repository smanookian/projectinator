// Running total of money spent in THIS process (session). Every Pi session adds its
// own cost here after it finishes, so it captures builds, planning, breakdowns — all of it.
// Resets on process restart (module-level state).

let total = 0;

export function addSessionCost(n: number): void {
  if (Number.isFinite(n) && n > 0) total += n;
}

export function sessionCost(): number {
  return Math.round(total * 100) / 100;
}

export function resetSessionCost(): void {
  total = 0;
}
