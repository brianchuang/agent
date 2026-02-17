"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryActionAdapter = exports.StubActionAdapter = void 0;
exports.resolveTenantCredentials = resolveTenantCredentials;
exports.normalizeAdapterError = normalizeAdapterError;
exports.createActionAdapterTool = createActionAdapterTool;
exports.createInMemoryIdempotencyStore = createInMemoryIdempotencyStore;
exports.createInMemoryRetryAttemptStore = createInMemoryRetryAttemptStore;
exports.defaultComposeIdempotencyKey = defaultComposeIdempotencyKey;
exports.createIdempotentActionAdapterTool = createIdempotentActionAdapterTool;
exports.createRetryingActionAdapterTool = createRetryingActionAdapterTool;
exports.defaultClassifyRetryableFailure = defaultClassifyRetryableFailure;
const node_crypto_1 = require("node:crypto");
const errors_1 = require("./errors");
function resolveTenantCredentials(scope, resolver) {
    const credentials = resolver(scope);
    if (!credentials) {
        throw new errors_1.ValidationRuntimeError(`Missing tenant-scoped credentials for ${scope.tenantId}/${scope.workspaceId}`);
    }
    if (credentials.tenantId !== scope.tenantId || credentials.workspaceId !== scope.workspaceId) {
        throw new errors_1.ValidationRuntimeError(`Tenant credential scope mismatch for ${scope.tenantId}/${scope.workspaceId}`);
    }
    return credentials;
}
function normalizeAdapterError(toolName, error) {
    if (error instanceof errors_1.ToolExecutionError) {
        return error;
    }
    const known = error;
    const code = typeof known?.code === "string" ? known.code : "ADAPTER_EXECUTION_FAILED";
    const message = typeof known?.message === "string" ? known.message : "adapter execution failed";
    const retryable = Boolean(known?.retryable);
    return new errors_1.ToolExecutionError(toolName, `[${code}] ${message}`, retryable);
}
function createActionAdapterTool(input) {
    return {
        name: input.toolName,
        validateArgs: input.validateArgs ?? (() => []),
        isAuthorized: input.isAuthorized,
        execute: async (toolInput) => {
            const tenantScope = {
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
                    throw new errors_1.ToolExecutionError(toolInput.toolName, `[${result.errorCode}] ${result.message}`, result.retryable);
                }
                return result;
            }
            catch (error) {
                throw normalizeAdapterError(toolInput.toolName, error);
            }
        }
    };
}
function createInMemoryIdempotencyStore() {
    const records = new Map();
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
function createInMemoryRetryAttemptStore() {
    const records = new Map();
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
function defaultComposeIdempotencyKey(input) {
    const fingerprint = isIdempotencyFingerprint(input) ? input : buildIdempotencyFingerprint(input);
    return [
        fingerprint.tenantId,
        fingerprint.requestId,
        String(fingerprint.stepNumber),
        fingerprint.toolName,
        fingerprint.payloadHash
    ].join(":");
}
function createIdempotentActionAdapterTool(tool, input) {
    const composeKey = input.composeKey ?? defaultComposeIdempotencyKey;
    const inFlight = new Map();
    return {
        ...tool,
        execute: async (toolInput) => {
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
                const record = {
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
            }
            finally {
                inFlight.delete(key);
            }
        }
    };
}
function createRetryingActionAdapterTool(tool, input) {
    const composeKey = input.composeKey ?? defaultComposeRetryKey;
    const classifyFailure = input.policy.classifyFailure ?? defaultClassifyRetryableFailure;
    const now = input.policy.now ?? (() => new Date().toISOString());
    const random = input.policy.random ?? Math.random;
    const sleep = input.policy.sleep ??
        (async (ms) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
        });
    return {
        ...tool,
        execute: async (toolInput) => {
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
                        requestId: toolInput.requestId,
                        stepNumber: toolInput.stepNumber,
                        toolName: toolInput.toolName,
                        attemptCount: attempt,
                        lastAttemptAt: now()
                    });
                    return result;
                }
                catch (error) {
                    const classified = classifyFailure(error);
                    const terminalReason = !classified.retryable
                        ? "non_retryable"
                        : attempt >= input.policy.maxAttempts
                            ? "max_attempts_exhausted"
                            : undefined;
                    input.store.put({
                        key,
                        tenantId: toolInput.tenantId,
                        workspaceId: toolInput.workspaceId,
                        workflowId: toolInput.workflowId,
                        requestId: toolInput.requestId,
                        stepNumber: toolInput.stepNumber,
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
            throw new errors_1.ValidationRuntimeError(`Retry policy exhausted without terminal classification: ${toolInput.toolName}`);
        }
    };
}
function buildIdempotencyFingerprint(input) {
    if (!input.requestId || typeof input.requestId !== "string") {
        throw new errors_1.ValidationRuntimeError("Invalid idempotency input: requestId is required");
    }
    if (!Number.isInteger(input.stepNumber) || (input.stepNumber ?? -1) < 0) {
        throw new errors_1.ValidationRuntimeError("Invalid idempotency input: stepNumber must be a non-negative integer");
    }
    const stepNumber = input.stepNumber;
    return {
        tenantId: input.tenantId,
        requestId: input.requestId,
        stepNumber,
        toolName: input.toolName,
        payloadHash: hashPayload(input.args)
    };
}
function assertRetryIdentity(input) {
    if (!input.requestId || typeof input.requestId !== "string") {
        throw new errors_1.ValidationRuntimeError("Invalid retry input: requestId is required");
    }
    if (!Number.isInteger(input.stepNumber) || (input.stepNumber ?? -1) < 0) {
        throw new errors_1.ValidationRuntimeError("Invalid retry input: stepNumber must be a non-negative integer");
    }
}
function defaultComposeRetryKey(input) {
    return [
        input.tenantId,
        input.workflowId,
        input.requestId,
        String(input.stepNumber),
        input.toolName
    ].join(":");
}
function computeRetryDelayMs(input) {
    const baseDelay = Math.min(input.maxDelayMs, input.baseDelayMs * 2 ** (input.attempt - 1));
    if (input.jitterRatio <= 0) {
        return baseDelay;
    }
    const randomUnit = Math.min(Math.max(input.random(), 0), 1);
    const jitterRange = baseDelay * input.jitterRatio;
    const jitterOffset = (randomUnit * 2 - 1) * jitterRange;
    return Math.max(0, Math.round(baseDelay + jitterOffset));
}
function defaultClassifyRetryableFailure(error) {
    if (error instanceof errors_1.ToolExecutionError) {
        const codeMatch = error.message.match(/\[([A-Z0-9_]+)\]/i);
        const code = codeMatch?.[1] ?? "TOOL_FAILURE";
        return {
            retryable: error.retryable || isRetryableCode(code) || isRetryableMessage(error.message),
            code,
            message: error.message
        };
    }
    const known = error;
    const code = typeof known?.code === "string" ? known.code : "ADAPTER_EXECUTION_FAILED";
    const message = typeof known?.message === "string" ? known.message : "adapter execution failed";
    const retryable = Boolean(known?.retryable) || isRetryableCode(code) || isRetryableMessage(message);
    return { retryable, code, message };
}
function isRetryableCode(code) {
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
function isRetryableMessage(message) {
    const normalized = message.toLowerCase();
    return normalized.includes("timeout") || normalized.includes("timed out");
}
function isIdempotencyFingerprint(input) {
    const value = input;
    return Boolean(value &&
        typeof value.tenantId === "string" &&
        typeof value.requestId === "string" &&
        Number.isInteger(value.stepNumber) &&
        typeof value.toolName === "string" &&
        typeof value.payloadHash === "string");
}
function assertFingerprintMatch(key, existing, incoming) {
    if (existing.tenantId !== incoming.tenantId ||
        existing.requestId !== incoming.requestId ||
        existing.stepNumber !== incoming.stepNumber ||
        existing.toolName !== incoming.toolName ||
        existing.payloadHash !== incoming.payloadHash) {
        throw new errors_1.ValidationRuntimeError(`Idempotency key collision with mismatched fingerprint: ${key}`);
    }
}
function hashPayload(payload) {
    return (0, node_crypto_1.createHash)("sha256").update(stableSerialize(payload)).digest("hex");
}
function stableSerialize(value) {
    return JSON.stringify(toStableValue(value));
}
function toStableValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => toStableValue(entry));
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    const record = value;
    const output = {};
    for (const key of Object.keys(record).sort()) {
        output[key] = toStableValue(record[key]);
    }
    return output;
}
class StubActionAdapter {
    config;
    constructor(config) {
        this.config = config;
    }
    execute(input) {
        return this.config.execute(input);
    }
}
exports.StubActionAdapter = StubActionAdapter;
class InMemoryActionAdapter {
    actionCounters = new Map();
    execute(input) {
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
exports.InMemoryActionAdapter = InMemoryActionAdapter;
