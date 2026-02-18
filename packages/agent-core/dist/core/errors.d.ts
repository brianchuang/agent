export declare abstract class RuntimeError extends Error {
    abstract readonly code: string;
    constructor(message: string);
}
export declare class ValidationRuntimeError extends RuntimeError {
    readonly code = "VALIDATION_ERROR";
}
export declare class SignalValidationError extends ValidationRuntimeError {
}
export declare class PolicyBlockedError extends RuntimeError {
    readonly policyId: string;
    readonly code = "POLICY_BLOCKED";
    constructor(policyId: string, message: string);
}
export declare class ApprovalRequiredError extends RuntimeError {
    readonly reason: string;
    readonly code = "APPROVAL_REQUIRED";
    constructor(reason: string);
}
export declare class ToolExecutionError extends RuntimeError {
    readonly toolName: string;
    readonly retryable: boolean;
    readonly code = "TOOL_FAILURE";
    constructor(toolName: string, message: string, retryable: boolean);
}
export declare class InternalRuntimeError extends RuntimeError {
    readonly code = "INTERNAL_ERROR";
}
