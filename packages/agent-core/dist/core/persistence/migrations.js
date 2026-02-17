"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_SCHEMA_MIGRATIONS = exports.AGENT_SCHEMA_RETENTION = exports.REQUIRED_AGENT_TABLES = void 0;
exports.createEmptySchemaCatalog = createEmptySchemaCatalog;
exports.applyMigration = applyMigration;
exports.createFreshAgentSchemaCatalog = createFreshAgentSchemaCatalog;
exports.validateReplayCriticalIndexes = validateReplayCriticalIndexes;
exports.REQUIRED_AGENT_TABLES = [
    "objective_requests",
    "workflow_instances",
    "planner_steps",
    "workflow_signals",
    "tool_executions",
    "policy_decisions",
    "memory_items",
    "working_memory"
];
exports.AGENT_SCHEMA_RETENTION = {
    objective_requests: {
        expectation: "Retain for 365 days for replay and compliance; archive cold data after retention window."
    },
    workflow_instances: {
        expectation: "Retain terminal workflow rows for 180 days to support resumability audits and incident forensics."
    },
    planner_steps: {
        expectation: "Retain step traces for 180 days; keep immutable for deterministic replay comparisons."
    },
    workflow_signals: {
        expectation: "Retain signal ingest/ack lifecycle for 180 days to debug pause/resume behavior."
    },
    tool_executions: {
        expectation: "Retain idempotency and execution outcomes for 365 days to prevent duplicate side effects during replay."
    },
    policy_decisions: {
        expectation: "Retain governance decisions for 365 days to support policy audits and dispute resolution."
    },
    memory_items: {
        expectation: "Retain promoted semantic/policy memory until archived/decayed per tenant policy lifecycle."
    },
    working_memory: {
        expectation: "Retain thread-local memory while workflow is active; prune stale lines after configured inactivity window."
    }
};
function requiredTenantColumns() {
    return [
        { name: "tenant_id", type: "text", nullable: false },
        { name: "workspace_id", type: "text", nullable: false }
    ];
}
function buildInitialTables() {
    return [
        {
            name: "objective_requests",
            tenantScoped: true,
            columns: [
                ...requiredTenantColumns(),
                { name: "request_id", type: "text", nullable: false },
                { name: "workflow_id", type: "text", nullable: false },
                { name: "thread_id", type: "text", nullable: false },
                { name: "schema_version", type: "text", nullable: false },
                { name: "objective_prompt", type: "text", nullable: false },
                { name: "occurred_at", type: "datetime", nullable: false },
                { name: "created_at", type: "datetime", nullable: false }
            ],
            constraints: [
                {
                    name: "pk_objective_requests",
                    kind: "primary_key",
                    columns: ["tenant_id", "workspace_id", "request_id"]
                }
            ]
        },
        {
            name: "workflow_instances",
            tenantScoped: true,
            columns: [
                ...requiredTenantColumns(),
                { name: "workflow_id", type: "text", nullable: false },
                { name: "request_id", type: "text", nullable: false },
                { name: "thread_id", type: "text", nullable: false },
                { name: "status", type: "text", nullable: false },
                { name: "current_step", type: "integer", nullable: false },
                { name: "waiting_signal_type", type: "text", nullable: true },
                { name: "last_signal_id", type: "text", nullable: true },
                { name: "created_at", type: "datetime", nullable: false },
                { name: "updated_at", type: "datetime", nullable: false }
            ],
            constraints: [
                {
                    name: "pk_workflow_instances",
                    kind: "primary_key",
                    columns: ["tenant_id", "workspace_id", "workflow_id"]
                }
            ]
        },
        {
            name: "planner_steps",
            tenantScoped: true,
            columns: [
                ...requiredTenantColumns(),
                { name: "workflow_id", type: "text", nullable: false },
                { name: "step_number", type: "integer", nullable: false },
                { name: "intent_type", type: "text", nullable: false },
                { name: "step_status", type: "text", nullable: false },
                { name: "planner_input_json", type: "json", nullable: false },
                { name: "planner_intent_json", type: "json", nullable: false },
                { name: "created_at", type: "datetime", nullable: false }
            ],
            constraints: [
                {
                    name: "pk_planner_steps",
                    kind: "primary_key",
                    columns: ["tenant_id", "workspace_id", "workflow_id", "step_number"]
                }
            ]
        },
        {
            name: "workflow_signals",
            tenantScoped: true,
            columns: [
                ...requiredTenantColumns(),
                { name: "signal_id", type: "text", nullable: false },
                { name: "workflow_id", type: "text", nullable: false },
                { name: "signal_type", type: "text", nullable: false },
                { name: "signal_status", type: "text", nullable: false },
                { name: "payload_json", type: "json", nullable: false },
                { name: "occurred_at", type: "datetime", nullable: false },
                { name: "acknowledged_at", type: "datetime", nullable: true }
            ],
            constraints: [
                {
                    name: "pk_workflow_signals",
                    kind: "primary_key",
                    columns: ["tenant_id", "workspace_id", "signal_id"]
                }
            ]
        },
        {
            name: "tool_executions",
            tenantScoped: true,
            columns: [
                ...requiredTenantColumns(),
                { name: "idempotency_key", type: "text", nullable: false },
                { name: "workflow_id", type: "text", nullable: false },
                { name: "step_number", type: "integer", nullable: false },
                { name: "tool_name", type: "text", nullable: false },
                { name: "payload_hash", type: "text", nullable: false },
                { name: "execution_status", type: "text", nullable: false },
                { name: "result_json", type: "json", nullable: true },
                { name: "error_code", type: "text", nullable: true },
                { name: "created_at", type: "datetime", nullable: false },
                { name: "updated_at", type: "datetime", nullable: false }
            ],
            constraints: [
                {
                    name: "pk_tool_executions",
                    kind: "primary_key",
                    columns: ["tenant_id", "workspace_id", "idempotency_key"]
                }
            ]
        },
        {
            name: "policy_decisions",
            tenantScoped: true,
            columns: [
                ...requiredTenantColumns(),
                { name: "decision_id", type: "text", nullable: false },
                { name: "workflow_id", type: "text", nullable: false },
                { name: "step_number", type: "integer", nullable: false },
                { name: "policy_pack_version", type: "text", nullable: false },
                { name: "decision", type: "text", nullable: false },
                { name: "reason_code", type: "text", nullable: false },
                { name: "correlation_signal_id", type: "text", nullable: true },
                { name: "created_at", type: "datetime", nullable: false }
            ],
            constraints: [
                {
                    name: "pk_policy_decisions",
                    kind: "primary_key",
                    columns: ["tenant_id", "workspace_id", "decision_id"]
                }
            ]
        },
        {
            name: "memory_items",
            tenantScoped: true,
            columns: [
                ...requiredTenantColumns(),
                { name: "memory_id", type: "text", nullable: false },
                { name: "objective_id", type: "text", nullable: false },
                { name: "channel", type: "text", nullable: false },
                { name: "tags_json", type: "json", nullable: false },
                { name: "content", type: "text", nullable: false },
                { name: "created_at", type: "datetime", nullable: false },
                { name: "archived_at", type: "datetime", nullable: true },
                { name: "decay_at", type: "datetime", nullable: true }
            ],
            constraints: [
                {
                    name: "pk_memory_items",
                    kind: "primary_key",
                    columns: ["tenant_id", "workspace_id", "memory_id"]
                }
            ]
        },
        {
            name: "working_memory",
            tenantScoped: true,
            columns: [
                ...requiredTenantColumns(),
                { name: "thread_id", type: "text", nullable: false },
                { name: "line_number", type: "integer", nullable: false },
                { name: "content", type: "text", nullable: false },
                { name: "updated_at", type: "datetime", nullable: false }
            ],
            constraints: [
                {
                    name: "pk_working_memory",
                    kind: "primary_key",
                    columns: ["tenant_id", "workspace_id", "thread_id", "line_number"]
                }
            ]
        }
    ];
}
function buildInitialIndexes() {
    return [
        {
            name: "idx_objective_requests_workflow",
            tableName: "objective_requests",
            columns: ["tenant_id", "workspace_id", "workflow_id"],
            unique: false
        },
        {
            name: "idx_objective_requests_thread",
            tableName: "objective_requests",
            columns: ["tenant_id", "workspace_id", "thread_id"],
            unique: false
        },
        {
            name: "idx_workflow_instances_status",
            tableName: "workflow_instances",
            columns: ["tenant_id", "workspace_id", "status", "updated_at"],
            unique: false
        },
        {
            name: "idx_planner_steps_replay",
            tableName: "planner_steps",
            columns: ["tenant_id", "workspace_id", "workflow_id", "step_number"],
            unique: false
        },
        {
            name: "idx_workflow_signals_resume",
            tableName: "workflow_signals",
            columns: ["tenant_id", "workspace_id", "workflow_id", "signal_status", "occurred_at"],
            unique: false
        },
        {
            name: "idx_tool_executions_workflow_step",
            tableName: "tool_executions",
            columns: ["tenant_id", "workspace_id", "workflow_id", "step_number"],
            unique: false
        },
        {
            name: "idx_policy_decisions_workflow_step",
            tableName: "policy_decisions",
            columns: ["tenant_id", "workspace_id", "workflow_id", "step_number"],
            unique: false
        },
        {
            name: "idx_memory_items_retrieval",
            tableName: "memory_items",
            columns: ["tenant_id", "workspace_id", "objective_id", "channel", "created_at"],
            unique: false
        },
        {
            name: "idx_working_memory_thread",
            tableName: "working_memory",
            columns: ["tenant_id", "workspace_id", "thread_id", "updated_at"],
            unique: false
        }
    ];
}
exports.AGENT_SCHEMA_MIGRATIONS = [
    {
        id: "001_agent_loop_initial_schema",
        description: "Create durable planner-loop and memory persistence tables with tenant scoping.",
        operations: [
            ...buildInitialTables().map((table) => ({ kind: "create_table", table })),
            ...buildInitialIndexes().map((index) => ({ kind: "create_index", index }))
        ]
    }
];
function createEmptySchemaCatalog() {
    return {
        tables: new Map(),
        indexes: new Map(),
        appliedMigrations: []
    };
}
function applyMigration(catalog, migration) {
    if (catalog.appliedMigrations.includes(migration.id)) {
        throw new Error(`Migration already applied: ${migration.id}`);
    }
    for (const operation of migration.operations) {
        if (operation.kind === "create_table") {
            if (catalog.tables.has(operation.table.name)) {
                throw new Error(`Duplicate table migration operation: ${operation.table.name}`);
            }
            catalog.tables.set(operation.table.name, {
                name: operation.table.name,
                tenantScoped: operation.table.tenantScoped,
                columns: new Map(operation.table.columns.map((column) => [column.name, column])),
                constraints: [...operation.table.constraints]
            });
            continue;
        }
        if (catalog.indexes.has(operation.index.name)) {
            throw new Error(`Duplicate index migration operation: ${operation.index.name}`);
        }
        if (!catalog.tables.has(operation.index.tableName)) {
            throw new Error(`Index references unknown table: ${operation.index.tableName}`);
        }
        catalog.indexes.set(operation.index.name, { ...operation.index });
    }
    catalog.appliedMigrations.push(migration.id);
}
function createFreshAgentSchemaCatalog() {
    const catalog = createEmptySchemaCatalog();
    for (const migration of exports.AGENT_SCHEMA_MIGRATIONS) {
        applyMigration(catalog, migration);
    }
    return catalog;
}
const REPLAY_CRITICAL_INDEXES = [
    {
        name: "idx_objective_requests_workflow",
        columns: ["tenant_id", "workspace_id", "workflow_id"]
    },
    {
        name: "idx_planner_steps_replay",
        columns: ["tenant_id", "workspace_id", "workflow_id", "step_number"]
    },
    {
        name: "idx_workflow_signals_resume",
        columns: ["tenant_id", "workspace_id", "workflow_id", "signal_status", "occurred_at"]
    },
    {
        name: "idx_tool_executions_workflow_step",
        columns: ["tenant_id", "workspace_id", "workflow_id", "step_number"]
    },
    {
        name: "idx_policy_decisions_workflow_step",
        columns: ["tenant_id", "workspace_id", "workflow_id", "step_number"]
    }
];
function validateReplayCriticalIndexes(catalog) {
    const missing = [];
    for (const requiredIndex of REPLAY_CRITICAL_INDEXES) {
        const found = catalog.indexes.get(requiredIndex.name);
        if (!found) {
            missing.push(requiredIndex.name);
            continue;
        }
        const sameColumns = found.columns.length === requiredIndex.columns.length &&
            found.columns.every((value, idx) => value === requiredIndex.columns[idx]);
        if (!sameColumns) {
            missing.push(requiredIndex.name);
        }
    }
    return missing;
}
