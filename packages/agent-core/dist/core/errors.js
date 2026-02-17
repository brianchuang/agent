"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalRuntimeError = exports.ToolExecutionError = exports.ApprovalRequiredError = exports.PolicyBlockedError = exports.SignalValidationError = exports.ValidationRuntimeError = exports.RuntimeError = void 0;
class RuntimeError extends Error {
    constructor(message) {
        super(message);
        this.name = new.target.name;
    }
}
exports.RuntimeError = RuntimeError;
class ValidationRuntimeError extends RuntimeError {
    code = "VALIDATION_ERROR";
}
exports.ValidationRuntimeError = ValidationRuntimeError;
class SignalValidationError extends ValidationRuntimeError {
}
exports.SignalValidationError = SignalValidationError;
class PolicyBlockedError extends RuntimeError {
    policyId;
    code = "POLICY_BLOCKED";
    constructor(policyId, message) {
        super(message);
        this.policyId = policyId;
    }
}
exports.PolicyBlockedError = PolicyBlockedError;
class ApprovalRequiredError extends RuntimeError {
    reason;
    code = "APPROVAL_REQUIRED";
    constructor(reason) {
        super(`Approval required: ${reason}`);
        this.reason = reason;
    }
}
exports.ApprovalRequiredError = ApprovalRequiredError;
class ToolExecutionError extends RuntimeError {
    toolName;
    retryable;
    code = "TOOL_FAILURE";
    constructor(toolName, message, retryable) {
        super(message);
        this.toolName = toolName;
        this.retryable = retryable;
    }
}
exports.ToolExecutionError = ToolExecutionError;
class InternalRuntimeError extends RuntimeError {
    code = "INTERNAL_ERROR";
}
exports.InternalRuntimeError = InternalRuntimeError;
