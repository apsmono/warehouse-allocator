/**
 * Rounds a cost to 0.1 so sums of decimal distances (numeric(6,1) in the DB) compare and print
 * cleanly: 60 - 40.3 is 19.7, not 19.700000000000003.
 */
export function roundCost(value: number): number {
  return Math.round(value * 10) / 10;
}

/** `1 unit`, `12 units`. */
export function formatUnits(count: number): string {
  return `${count} ${count === 1 ? "unit" : "units"}`;
}
