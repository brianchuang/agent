"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayloadValidationError = void 0;
class PayloadValidationError extends Error {
    objectiveId;
    eventType;
    details;
    code = "PAYLOAD_VALIDATION_FAILED";
    constructor(objectiveId, eventType, details) {
        super(`Payload validation failed for ${objectiveId}/${eventType}`);
        this.objectiveId = objectiveId;
        this.eventType = eventType;
        this.details = details;
        this.name = "PayloadValidationError";
    }
}
exports.PayloadValidationError = PayloadValidationError;
