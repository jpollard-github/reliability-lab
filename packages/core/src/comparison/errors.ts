/** Comparison errors name invalid input and missing persisted experiments. */
export class InvalidComparisonVariationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "InvalidComparisonVariationError";
  }
}
