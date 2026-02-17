import { createHash } from "node:crypto";
import { ToolExecutionError, ValidationRuntimeError } from "./errors";
import { ToolExecutionInput, ToolTenantScope } from "./contracts";
import { ToolRegistration, ToolValidationIssue } from "./toolRegistry";

export type ActionClass = "message" | "calendar" | "task";

export interface AdapterTenantContext {
  tenantId: string;
  workspaceId: string;
}

export interface TenantCredentials {
  tenantId: string;
  workspaceId: string;
  [key: string]: unknown;
}

export interface AdapterAction {
  actionClass: ActionClass;
  operation: string;
  input: Record<string, unknown>;
}

export interface ActionAdapterExecuteInput {
  action: AdapterAction;
  tenant: AdapterTenantContext;
  credentials: TenantCredentials;
}

export interface ActionAdapterSuccess {
  status: "ok";
  actionClass: ActionClass;
  provider: string;
  data: Record<string, unknown>;
  id?: string;
}

export interface ActionAdapterFailure {
  status: "error";
  actionClass: ActionClass;
  provider: string;
  errorCode: string;
  message: string;
  retryable: boolean;
}

export type ActionAdapterResult = ActionAdapterSuccess | ActionAdapterFailure;

export interface ActionAdapter {
  execute: (input: ActionAdapterExecuteInput) => ActionAdapterResult | Promise<ActionAdapterResult>;
}

export interface AdapterExecutionError {
  code?: string;
  message: string;
  retryable?: boolean;
}

export type TenantCredentialsResolver = (
  scope: AdapterTenantContext
) => TenantCredentials | undefined;

export function resolveTenantCredentials(
  scope: AdapterTenantContext,
  resolver: TenantCredentialsResolver
): TenantCredentials {
  const credentials = resolver(scope);
  if (!credentials) {
    throw new ValidationRuntimeError(
      `Missing tenant-scoped credentials for ${scope.tenantId}/${scope.workspaceId}`
    );
  }
  if (credentials.tenantId !== scope.tenantId || credentials.workspaceId !== scope.workspaceId) {
    throw new ValidationRuntimeError(
      `Tenant credential scope mismatch for ${scope.tenantId}/${scope.workspaceId}`
    );
  }
  return credentials;
}

export function normalizeAdapterError(toolName: string, error: unknown): ToolExecutionError {
  if (error instanceof ToolExecutionError) {
    return error;
  }

  const known = error as AdapterExecutionError;
  const code = typeof known?.code === "string" ? known.code : "ADAPTER_EXECUTION_FAILED";
  const message = typeof known?.message === "string" ? known.message : "adapter execution failed";
  const retryable = Boolean(known?.retryable);
  return new ToolExecutionError(toolName, `[${code}] ${message}`, retryable);
}

export interface CreateActionAdapterToolInput {
  toolName: string;
  actionClass: ActionClass;
  operation: string;
  adapter: ActionAdapter;
  validateArgs?: (args: Record<string, unknown>) => ToolValidationIssue[];
  resolveCredentials: TenantCredentialsResolver;
  isAuthorized?: (scope: ToolTenantScope) => boolean;
}

export function createActionAdapterTool(input: CreateActionAdapterToolInput): ToolRegistration {
  return {
    name: input.toolName,
    validateArgs: input.validateArgs ?? (() => []),
    isAuthorized: input.isAuthorized,
    execute: async (toolInput: ToolExecutionInput) => {
      const tenantScope: AdapterTenantContext = {
        tenantId: toolInput.tenantId,
        workspaceId: toolInput.workspaceId
      };
      const credentials = resolveTenantCredentials(tenantScope, input.resolveCredentials);

      try {
        const result = await input.adapter.execute({
          action: {
            actionClass: input.actionClass,
            operation: input.operation,
            input: toolInput.args
          },
          tenant: tenantScope,
          credentials
        });

        if (result.status === "error") {
          throw new ToolExecutionError(
            toolInput.toolName,
            `[${result.errorCode}] ${result.message}`,
            result.retryable
          );
        }

        return result;
      } catch (error) {
        throw normalizeAdapterError(toolInput.toolName, error);
      }
    }
  };
}

export interface IdempotencyFingerprint {
  tenantId: string;
  requestId: string;
  stepNumber: number;
  toolName: string;
  payloadHash: string;
}

export interface IdempotencyRecord {
  key: string;
  fingerprint: IdempotencyFingerprint;
  result: unknown;
}

export interface IdempotencyStore {
  get: (key: string) => IdempotencyRecord | undefined;
  put: (record: IdempotencyRecord) => void;
}

export interface CreateIdempotentActionAdapterToolInput {
  store: IdempotencyStore;
  composeKey?: (fingerprint: IdempotencyFingerprint) => string;
}

export type RetryTerminalReason = "non_retryable" | "max_attempts_exhausted";

export interface RetryAttemptRecord {
  key: string;
  tenantId: string;
  workspaceId: string;
  workflowId: string;
  requestId: string;
  stepNumber: number;
  toolName: string;
  attemptCount: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastAttemptAt: string;
  terminalReason?: RetryTerminalReason;
}

export interface RetryAttemptStore {
  get: (key: string) => RetryAttemptRecord | undefined;
  put: (record: RetryAttemptRecord) => void;
}

export interface RetryClassifierResult {
  retryable: boolean;
  code: string;
  message: string;
}

export type RetryFailureClassifier = (error: unknown) => RetryClassifierResult;

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  classifyFailure?: RetryFailureClassifier;
  random?: () => number;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export interface CreateRetryingActionAdapterToolInput {
  store: RetryAttemptStore;
  policy: RetryPolicy;
  composeKey?: (input: ToolExecutionInput) => string;
}

export function createInMemoryIdempotencyStore(): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();
  return {
    get: (key) => {
      const found = records.get(key);
      return found ? structuredClone(found) : undefined;
    },
    put: (record) => {
      records.set(record.key, structuredClone(record));
    }
  };
}

export function createInMemoryRetryAttemptStore(): RetryAttemptStore {
  const records = new Map<string, RetryAttemptRecord>();
  return {
    get: (key) => {
      const found = records.get(key);
      return found ? structuredClone(found) : undefined;
    },
    put: (record) => {
      records.set(record.key, structuredClone(record));
    }
  };
}

export function defaultComposeIdempotencyKey(
  input: IdempotencyFingerprint | ToolExecutionInput
): string {
  const fingerprint = isIdempotencyFingerprint(input) ? input : buildIdempotencyFingerprint(input);
  return [
    fingerprint.tenantId,
    fingerprint.requestId,
    String(fingerprint.stepNumber),
    fingerprint.toolName,
    fingerprint.payloadHash
  ].join(":");
}

export function createIdempotentActionAdapterTool(
  tool: ToolRegistration,
  input: CreateIdempotentActionAdapterToolInput
): ToolRegistration {
  const composeKey = input.composeKey ?? defaultComposeIdempotencyKey;
  const inFlight = new Map<string, Promise<unknown>>();

  return {
    ...tool,
    execute: async (toolInput: ToolExecutionInput) => {
      const fingerprint = buildIdempotencyFingerprint(toolInput);
      const key = composeKey(fingerprint);
      const existing = input.store.get(key);
      if (existing) {
        assertFingerprintMatch(key, existing.fingerprint, fingerprint);
        return existing.result;
      }

      const pending = inFlight.get(key);
      if (pending) {
        return await pending;
      }

      const execution = (async () => {
        const result = await tool.execute(toolInput);
        const record: IdempotencyRecord = {
          key,
          fingerprint,
          result
        };
        input.store.put(record);
        return result;
      })();
      inFlight.set(key, execution);

      try {
        return await execution;
      } finally {
        inFlight.delete(key);
      }
    }
  };
}

export function createRetryingActionAdapterTool(
  tool: ToolRegistration,
  input: CreateRetryingActionAdapterToolInput
): ToolRegistration {
  const composeKey = input.composeKey ?? defaultComposeRetryKey;
  const classifyFailure = input.policy.classifyFailure ?? defaultClassifyRetryableFailure;
  const now = input.policy.now ?? (() => new Date().toISOString());
  const random = input.policy.random ?? Math.random;
  const sleep =
    input.policy.sleep ??
    (async (ms: number) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });

  return {
    ...tool,
    execute: async (toolInput: ToolExecutionInput) => {
      assertRetryIdentity(toolInput);
      const key = composeKey(toolInput);

      for (let attempt = 1; attempt <= input.policy.maxAttempts; attempt += 1) {
        try {
          const result = await tool.execute(toolInput);
          input.store.put({
            key,
            tenantId: toolInput.tenantId,
            workspaceId: toolInput.workspaceId,
            workflowId: toolInput.workflowId,
            requestId: toolInput.requestId as string,
            stepNumber: toolInput.stepNumber as number,
            toolName: toolInput.toolName,
            attemptCount: attempt,
            lastAttemptAt: now()
          });
          return result;
        } catch (error) {
          const classified = classifyFailure(error);
          const terminalReason =
            !classified.retryable
              ? "non_retryable"
              : attempt >= input.policy.maxAttempts
                ? "max_attempts_exhausted"
                : undefined;

          input.store.put({
            key,
            tenantId: toolInput.tenantId,
            workspaceId: toolInput.workspaceId,
            workflowId: toolInput.workflowId,
            requestId: toolInput.requestId as string,
            stepNumber: toolInput.stepNumber as number,
            toolName: toolInput.toolName,
            attemptCount: attempt,
            lastErrorCode: classified.code,
            lastErrorMessage: classified.message,
            lastAttemptAt: now(),
            terminalReason
          });

          if (terminalReason) {
            throw normalizeAdapterError(toolInput.toolName, error);
          }

          const delayMs = computeRetryDelayMs({
            attempt,
            baseDelayMs: input.policy.baseDelayMs,
            maxDelayMs: input.policy.maxDelayMs,
            jitterRatio: input.policy.jitterRatio,
            random
          });
          await sleep(delayMs);
        }
      }

      throw new ValidationRuntimeError(
        `Retry policy exhausted without terminal classification: ${toolInput.toolName}`
      );
    }
  };
}

function buildIdempotencyFingerprint(input: ToolExecutionInput): IdempotencyFingerprint {
  if (!input.requestId || typeof input.requestId !== "string") {
    throw new ValidationRuntimeError("Invalid idempotency input: requestId is required");
  }
  if (!Number.isInteger(input.stepNumber) || (input.stepNumber ?? -1) < 0) {
    throw new ValidationRuntimeError(
      "Invalid idempotency input: stepNumber must be a non-negative integer"
    );
  }
  const stepNumber = input.stepNumber as number;

  return {
    tenantId: input.tenantId,
    requestId: input.requestId,
    stepNumber,
    toolName: input.toolName,
    payloadHash: hashPayload(input.args)
  };
}

function assertRetryIdentity(input: ToolExecutionInput): void {
  if (!input.requestId || typeof input.requestId !== "string") {
    throw new ValidationRuntimeError("Invalid retry input: requestId is required");
  }
  if (!Number.isInteger(input.stepNumber) || (input.stepNumber ?? -1) < 0) {
    throw new ValidationRuntimeError("Invalid retry input: stepNumber must be a non-negative integer");
  }
}

function defaultComposeRetryKey(input: ToolExecutionInput): string {
  return [
    input.tenantId,
    input.workflowId,
    input.requestId,
    String(input.stepNumber),
    input.toolName
  ].join(":");
}

function computeRetryDelayMs(input: {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  random: () => number;
}): number {
  const baseDelay = Math.min(input.maxDelayMs, input.baseDelayMs * 2 ** (input.attempt - 1));
  if (input.jitterRatio <= 0) {
    return baseDelay;
  }

  const randomUnit = Math.min(Math.max(input.random(), 0), 1);
  const jitterRange = baseDelay * input.jitterRatio;
  const jitterOffset = (randomUnit * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(baseDelay + jitterOffset));
}

export function defaultClassifyRetryableFailure(error: unknown): RetryClassifierResult {
  if (error instanceof ToolExecutionError) {
    const codeMatch = error.message.match(/\[([A-Z0-9_]+)\]/i);
    const code = codeMatch?.[1] ?? "TOOL_FAILURE";
    return {
      retryable: error.retryable || isRetryableCode(code) || isRetryableMessage(error.message),
      code,
      message: error.message
    };
  }

  const known = error as AdapterExecutionError;
  const code = typeof known?.code === "string" ? known.code : "ADAPTER_EXECUTION_FAILED";
  const message = typeof known?.message === "string" ? known.message : "adapter execution failed";
  const retryable =
    Boolean(known?.retryable) || isRetryableCode(code) || isRetryableMessage(message);
  return { retryable, code, message };
}

function isRetryableCode(code: string): boolean {
  const normalized = code.toUpperCase();
  if (normalized === "HTTP_429") {
    return true;
  }
  const statusMatch = normalized.match(/^HTTP_(\d{3})$/);
  if (!statusMatch) {
    return false;
  }
  const status = Number(statusMatch[1]);
  return status >= 500 && status <= 599;
}

function isRetryableMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("timeout") || normalized.includes("timed out");
}

function isIdempotencyFingerprint(input: unknown): input is IdempotencyFingerprint {
  const value = input as IdempotencyFingerprint;
  return Boolean(
    value &&
      typeof value.tenantId === "string" &&
      typeof value.requestId === "string" &&
      Number.isInteger(value.stepNumber) &&
      typeof value.toolName === "string" &&
      typeof value.payloadHash === "string"
  );
}

function assertFingerprintMatch(
  key: string,
  existing: IdempotencyFingerprint,
  incoming: IdempotencyFingerprint
): void {
  if (
    existing.tenantId !== incoming.tenantId ||
    existing.requestId !== incoming.requestId ||
    existing.stepNumber !== incoming.stepNumber ||
    existing.toolName !== incoming.toolName ||
    existing.payloadHash !== incoming.payloadHash
  ) {
    throw new ValidationRuntimeError(`Idempotency key collision with mismatched fingerprint: ${key}`);
  }
}

function hashPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(stableSerialize(payload)).digest("hex");
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(toStableValue(value));
}

function toStableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    output[key] = toStableValue(record[key]);
  }
  return output;
}

export interface StubActionAdapterConfig {
  execute: (input: ActionAdapterExecuteInput) => ActionAdapterResult | Promise<ActionAdapterResult>;
}

export class StubActionAdapter implements ActionAdapter {
  constructor(private readonly config: StubActionAdapterConfig) {}

  execute(input: ActionAdapterExecuteInput): ActionAdapterResult | Promise<ActionAdapterResult> {
    return this.config.execute(input);
  }
}

export class InMemoryActionAdapter implements ActionAdapter {
  private readonly actionCounters = new Map<string, number>();

  execute(input: ActionAdapterExecuteInput): ActionAdapterSuccess {
    const key = `${input.tenant.tenantId}:${input.tenant.workspaceId}:${input.action.actionClass}`;
    const next = (this.actionCounters.get(key) ?? 0) + 1;
    this.actionCounters.set(key, next);

    return {
      status: "ok",
      actionClass: input.action.actionClass,
      provider: "in-memory",
      id: `${input.action.actionClass}:${next}`,
      data: {
        operation: input.action.operation,
        input: input.action.input
      }
    };
  }
}
