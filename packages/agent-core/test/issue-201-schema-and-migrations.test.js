const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AGENT_SCHEMA_MIGRATIONS,
  REQUIRED_AGENT_TABLES,
  createFreshAgentSchemaCatalog,
  validateReplayCriticalIndexes,
  AGENT_SCHEMA_RETENTION
} = require("../dist/core/persistence/migrations");

test("ISSUE-201: migrations bootstrap a fresh schema with all required tenant-scoped tables", async () => {
  const catalog = createFreshAgentSchemaCatalog();

  assert.ok(Array.isArray(AGENT_SCHEMA_MIGRATIONS));
  assert.ok(AGENT_SCHEMA_MIGRATIONS.length > 0);

  for (const tableName of REQUIRED_AGENT_TABLES) {
    const table = catalog.tables.get(tableName);
    assert.ok(table, `missing table: ${tableName}`);
    assert.equal(table.columns.get("tenant_id")?.nullable, false);
    assert.equal(table.columns.get("workspace_id")?.nullable, false);
  }
});

test("ISSUE-201: replay-critical query paths are indexed", async () => {
  const catalog = createFreshAgentSchemaCatalog();
  const missingIndexes = validateReplayCriticalIndexes(catalog);

  assert.deepEqual(missingIndexes, []);
});

test("ISSUE-201: retention expectations are documented for all core tables", async () => {
  for (const tableName of REQUIRED_AGENT_TABLES) {
    const retention = AGENT_SCHEMA_RETENTION[tableName];
    assert.ok(retention, `missing retention policy for ${tableName}`);
    assert.equal(typeof retention.expectation, "string");
    assert.ok(retention.expectation.length > 0);
  }
});
