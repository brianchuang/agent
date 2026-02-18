import { ToolExecutionError } from "./errors";
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
export type TenantCredentialsResolver = (scope: AdapterTenantContext) => TenantCredentials | undefined;
export declare function resolveTenantCredentials(scope: AdapterTenantContext, resolver: TenantCredentialsResolver): TenantCredentials;
export declare function normalizeAdapterError(toolName: string, error: unknown): ToolExecutionError;
export interface CreateActionAdapterToolInput {
    toolName: string;
    actionClass: ActionClass;
    operation: string;
    adapter: ActionAdapter;
    validateArgs?: (args: Record<string, unknown>) => ToolValidationIssue[];
    resolveCredentials: TenantCredentialsResolver;
    isAuthorized?: (scope: ToolTenantScope) => boolean;
}
export declare function createActionAdapterTool(input: CreateActionAdapterToolInput): ToolRegistration;
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
export declare function createInMemoryIdempotencyStore(): IdempotencyStore;
export declare function createInMemoryRetryAttemptStore(): RetryAttemptStore;
export declare function defaultComposeIdempotencyKey(input: IdempotencyFingerprint | ToolExecutionInput): string;
export declare function createIdempotentActionAdapterTool(tool: ToolRegistration, input: CreateIdempotentActionAdapterToolInput): ToolRegistration;
export declare function createRetryingActionAdapterTool(tool: ToolRegistration, input: CreateRetryingActionAdapterToolInput): ToolRegistration;
export declare function defaultClassifyRetryableFailure(error: unknown): RetryClassifierResult;
export interface StubActionAdapterConfig {
    execute: (input: ActionAdapterExecuteInput) => ActionAdapterResult | Promise<ActionAdapterResult>;
}
export declare class StubActionAdapter implements ActionAdapter {
    private readonly config;
    constructor(config: StubActionAdapterConfig);
    execute(input: ActionAdapterExecuteInput): ActionAdapterResult | Promise<ActionAdapterResult>;
}
export declare class InMemoryActionAdapter implements ActionAdapter {
    private readonly actionCounters;
    execute(input: ActionAdapterExecuteInput): ActionAdapterSuccess;
}
