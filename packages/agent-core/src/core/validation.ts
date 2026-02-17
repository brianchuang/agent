export interface ValidationDetail {
  field: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ObjectiveEventValidator {
  validate(eventType: string, payload: unknown): ValidationDetail[];
}

export class PayloadValidationError extends Error {
  readonly code = "PAYLOAD_VALIDATION_FAILED";

  constructor(
    readonly objectiveId: string,
    readonly eventType: string,
    readonly details: ValidationDetail[]
  ) {
    super(`Payload validation failed for ${objectiveId}/${eventType}`);
    this.name = "PayloadValidationError";
  }
}
