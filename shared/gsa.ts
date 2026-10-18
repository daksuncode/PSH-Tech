// Global Solar Atlas publishes monthly values only for PVOUT, so monthly GHI
// (= PSH) is estimated as annual GHI × (PVOUT that month / PVOUT annual).
// Used by both the map (src/lib/psh.ts) and the AI backend (worker/).

/** @param pvout PVOUT annual followed by Jan..Dec (kWh/kWp/day). */
export function gsaMonthlyEstimate(ghiAnnual: number, pvout: readonly number[]): number[] {
  const annual = pvout[0];
  return pvout.slice(1, 13).map((v) => (ghiAnnual * v) / annual);
}
