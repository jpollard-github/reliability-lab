/** Input and tenant-safe not-found errors for saved investigation cases. */
export class InvestigationCaseInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvestigationCaseInputError";
  }
}

export class InvestigationCaseNotFoundError extends Error {
  constructor() {
    super("Investigation case not found");
    this.name = "InvestigationCaseNotFoundError";
  }
}
