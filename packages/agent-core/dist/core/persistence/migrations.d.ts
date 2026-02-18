export declare const REQUIRED_AGENT_TABLES: readonly ["objective_requests", "workflow_instances", "planner_steps", "workflow_signals", "tool_executions", "policy_decisions", "memory_items", "working_memory"];
export type RequiredAgentTable = (typeof REQUIRED_AGENT_TABLES)[number];
export interface RetentionPolicy {
    expectation: string;
}
export declare const AGENT_SCHEMA_RETENTION: Record<RequiredAgentTable, RetentionPolicy>;
export type ColumnType = "text" | "integer" | "json" | "datetime";
export interface ColumnDefinition {
    name: string;
    type: ColumnType;
    nullable: boolean;
}
export interface TableConstraint {
    name: string;
    kind: "primary_key" | "unique";
    columns: string[];
}
export interface TableDefinition {
    name: string;
    tenantScoped: boolean;
    columns: ColumnDefinition[];
    constraints: TableConstraint[];
}
export interface IndexDefinition {
    name: string;
    tableName: string;
    columns: string[];
    unique: boolean;
}
export interface CreateTableOperation {
    kind: "create_table";
    table: TableDefinition;
}
export interface CreateIndexOperation {
    kind: "create_index";
    index: IndexDefinition;
}
export type MigrationOperation = CreateTableOperation | CreateIndexOperation;
export interface SchemaMigration {
    id: string;
    description: string;
    operations: MigrationOperation[];
}
export interface CatalogTable {
    name: string;
    tenantScoped: boolean;
    columns: Map<string, ColumnDefinition>;
    constraints: TableConstraint[];
}
export interface SchemaCatalog {
    tables: Map<string, CatalogTable>;
    indexes: Map<string, IndexDefinition>;
    appliedMigrations: string[];
}
export declare const AGENT_SCHEMA_MIGRATIONS: SchemaMigration[];
export declare function createEmptySchemaCatalog(): SchemaCatalog;
export declare function applyMigration(catalog: SchemaCatalog, migration: SchemaMigration): void;
export declare function createFreshAgentSchemaCatalog(): SchemaCatalog;
export declare function validateReplayCriticalIndexes(catalog: SchemaCatalog): string[];
