export abstract class RuntimeError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationRuntimeError extends RuntimeError {
  readonly code = "VALIDATION_ERROR";
}

export class SignalValidationError extends ValidationRuntimeError {}

export class PolicyBlockedError extends RuntimeError {
  readonly code = "POLICY_BLOCKED";

  constructor(
    readonly policyId: string,
    message: string
  ) {
    super(message);
  }
}

export class ApprovalRequiredError extends RuntimeError {
  readonly code = "APPROVAL_REQUIRED";

  constructor(readonly reason: string) {
    super(`Approval required: ${reason}`);
  }
}

export class ToolExecutionError extends RuntimeError {
  readonly code = "TOOL_FAILURE";

  constructor(
    readonly toolName: string,
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export class InternalRuntimeError extends RuntimeError {
  readonly code = "INTERNAL_ERROR";
}
