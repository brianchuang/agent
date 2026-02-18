export interface ValidationDetail {
    field: string;
    message: string;
    expected?: string;
    actual?: string;
}
export interface ObjectiveEventValidator {
    validate(eventType: string, payload: unknown): ValidationDetail[];
}
export declare class PayloadValidationError extends Error {
    readonly objectiveId: string;
    readonly eventType: string;
    readonly details: ValidationDetail[];
    readonly code = "PAYLOAD_VALIDATION_FAILED";
    constructor(objectiveId: string, eventType: string, details: ValidationDetail[]);
}
