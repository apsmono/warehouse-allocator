export class StrategyNotAvailableError extends Error {
  public readonly code = "STRATEGY_NOT_AVAILABLE" as const;
  public readonly strategy: string;

  constructor(strategy: string) {
    super(`Allocation strategy "${strategy}" is not available in this engine version.`);
    this.name = "StrategyNotAvailableError";
    this.strategy = strategy;
  }
}

export { StrategyNotAvailableError as StrategyNotAvailable };
