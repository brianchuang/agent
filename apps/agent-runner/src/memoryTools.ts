import type { ToolExecutionInput, ToolRegistration, ToolValidationIssue } from "@agent/core";
import type { JsonValue, ObservabilityStore, RunEvent } from "@agent/observability";
import { uuidv7 } from "uuidv7";

const MEMORY_WRITE_EVENT = "memory.write";

export type MemoryRecord = {
  id: string;
  fact: string;
  summary: string;
  tags: string[];
  createdAt: string;
  workflowId: string;
  threadId?: string;
};

type MemoryToolDeps = {
  store: ObservabilityStore;
};

type LongTermMemoryQuery = {
  store: ObservabilityStore;
  tenantId: string;
  workspaceId: string;
  query: string;
  maxItems: number;
};

export async function loadLongTermMemorySnapshot(query: LongTermMemoryQuery): Promise<MemoryRecord[]> {
  const all = await listMemoryRecords(query.store, query.tenantId, query.workspaceId);
  const ranked = all
    .map((record) => ({ record, score: scoreRecord(record, query.query) }))
    .sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt));

  return ranked.slice(0, Math.max(1, query.maxItems)).map((entry) => entry.record);
}

export function createMemoryWriteTool(input: MemoryToolDeps): ToolRegistration {
  return {
    name: "memory_write",
    description: "Persist a durable long-term memory fact for future runs.",
    validateArgs(args) {
      return validateWriteArgs(args);
    },
    async execute(toolInput: ToolExecutionInput) {
      const fact = asOptionalString(toolInput.args.fact) ?? "";
      const summary = asOptionalString(toolInput.args.summary) ?? fact.slice(0, 220);
      const tags = asStringArray(toolInput.args.tags);
      const runId = await resolveRunIdByWorkflow(
        input.store,
        toolInput.workflowId,
        toolInput.tenantId,
        toolInput.workspaceId
      );
      if (!runId) {
        throw new Error(`Unable to resolve runId for workflow ${toolInput.workflowId}`);
      }

      const record: MemoryRecord = {
        id: `mem_${uuidv7()}`,
        fact,
        summary,
        tags,
        createdAt: new Date().toISOString(),
        workflowId: toolInput.workflowId
      };

      const event: RunEvent = {
        id: uuidv7(),
        runId,
        ts: record.createdAt,
        type: "log",
        level: "info",
        message: MEMORY_WRITE_EVENT,
        payload: {
          memory_record: memoryRecordToJson(record)
        },
        tenantId: toolInput.tenantId,
        workspaceId: toolInput.workspaceId,
        correlationId: runId,
        causationId: toolInput.requestId
      };
      await input.store.appendRunEvent(event);

      return {
        ok: true,
        memoryId: record.id,
        storedAt: record.createdAt
      };
    }
  };
}

export function createMemorySearchTool(input: MemoryToolDeps): ToolRegistration {
  return {
    name: "memory_search",
    description: "Search durable long-term memory facts by query.",
    validateArgs(args) {
      return validateSearchArgs(args);
    },
    async execute(toolInput: ToolExecutionInput) {
      const query = asOptionalString(toolInput.args.query) ?? "";
      const maxResults = asOptionalNumber(toolInput.args.maxResults) ?? 5;
      const results = await loadLongTermMemorySnapshot({
        store: input.store,
        tenantId: toolInput.tenantId,
        workspaceId: toolInput.workspaceId,
        query,
        maxItems: Math.max(1, Math.min(10, Math.floor(maxResults)))
      });

      return {
        query,
        results: results.map((item) => ({
          id: item.id,
          summary: item.summary,
          fact: item.fact,
          tags: item.tags,
          createdAt: item.createdAt
        }))
      };
    }
  };
}

function validateWriteArgs(args: Record<string, unknown>): ToolValidationIssue[] {
  const issues: ToolValidationIssue[] = [];
  if (!asOptionalString(args.fact)?.trim()) {
    issues.push({ field: "fact", message: "fact is required and must be a non-empty string" });
  }
  if (args.summary !== undefined && typeof args.summary !== "string") {
    issues.push({ field: "summary", message: "summary must be a string" });
  }
  if (args.tags !== undefined && !Array.isArray(args.tags)) {
    issues.push({ field: "tags", message: "tags must be an array of strings" });
  }
  if (Array.isArray(args.tags) && args.tags.some((tag) => typeof tag !== "string")) {
    issues.push({ field: "tags", message: "tags must be an array of strings" });
  }
  return issues;
}

function validateSearchArgs(args: Record<string, unknown>): ToolValidationIssue[] {
  const issues: ToolValidationIssue[] = [];
  if (!asOptionalString(args.query)?.trim()) {
    issues.push({ field: "query", message: "query is required and must be a non-empty string" });
  }
  if (args.maxResults !== undefined && typeof args.maxResults !== "number") {
    issues.push({ field: "maxResults", message: "maxResults must be a number" });
  }
  return issues;
}

async function listMemoryRecords(
  store: ObservabilityStore,
  tenantId: string,
  workspaceId: string
): Promise<MemoryRecord[]> {
  const data = await store.read();
  const records: MemoryRecord[] = [];
  for (const event of data.runEvents) {
    if (event.message !== MEMORY_WRITE_EVENT) continue;
    if (event.tenantId !== tenantId || event.workspaceId !== workspaceId) continue;
    const payloadRecord = parseMemoryRecord(event.payload.memory_record);
    if (payloadRecord) {
      records.push(payloadRecord);
    }
  }
  return records;
}

async function resolveRunIdByWorkflow(
  store: ObservabilityStore,
  workflowId: string,
  tenantId: string,
  workspaceId: string
): Promise<string | undefined> {
  const data = await store.read();
  const events = data.runEvents
    .filter(
      (event) =>
        event.tenantId === tenantId &&
        event.workspaceId === workspaceId &&
        asOptionalString(event.payload.workflow_id) === workflowId
    )
    .sort((a, b) => b.ts.localeCompare(a.ts));

  return events[0]?.runId;
}

function memoryRecordToJson(record: MemoryRecord): Record<string, JsonValue> {
  return {
    id: record.id,
    fact: record.fact,
    summary: record.summary,
    tags: record.tags,
    createdAt: record.createdAt,
    workflowId: record.workflowId
  };
}

function parseMemoryRecord(value: JsonValue | undefined): MemoryRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const obj = value as Record<string, JsonValue>;
  const id = asOptionalString(obj.id);
  const fact = asOptionalString(obj.fact);
  const summary = asOptionalString(obj.summary);
  const createdAt = asOptionalString(obj.createdAt);
  const workflowId = asOptionalString(obj.workflowId);
  if (!id || !fact || !summary || !createdAt || !workflowId) return undefined;

  return {
    id,
    fact,
    summary,
    createdAt,
    workflowId,
    tags: asStringArray(obj.tags),
    threadId: asOptionalString(obj.threadId)
  };
}

function scoreRecord(record: MemoryRecord, query: string): number {
  const text = `${record.summary} ${record.fact} ${record.tags.join(" ")}`.toLowerCase();
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;

  let hits = 0;
  for (const token of tokens) {
    if (text.includes(token)) hits += 1;
  }
  const recencyBias = Date.parse(record.createdAt) / 1_000_000_000_000;
  return hits / tokens.length + recencyBias;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
