export { allocate, normaliseOrderLines } from "./allocate.js";
export { evaluateEligibility, isWarehouseEligibleForProduct } from "./eligibility.js";
export { StrategyNotAvailable, StrategyNotAvailableError } from "./errors.js";
export { buildAlternativeWhyNot, buildReasons, buildSummary } from "./explain.js";
export type * from "./types.js";
export { ENGINE_VERSION } from "./version.js";
