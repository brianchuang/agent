# Schema Retention Policy

This policy defines how long durable runtime records are retained for replay, compliance, and operations. All data is tenant/workspace scoped.

## Retention Targets

- `objective_requests`: 365 days.
- `workflow_instances`: 180 days after terminal status.
- `planner_steps`: 180 days.
- `workflow_signals`: 180 days.
- `tool_executions`: 365 days.
- `policy_decisions`: 365 days.
- `memory_items`: lifecycle-managed by tenant policy (promote/archive/decay).
- `working_memory`: retained while thread is active, then pruned by inactivity policy.

## Rationale

- 365-day records support governance and external audits.
- 180-day workflow traces preserve enough replay/debug depth while controlling storage growth.
- Memory retention stays product-driven because semantic value varies by tenant.

## Enforcement Expectations

- Retention jobs must run per tenant policy boundaries.
- Cold archival should preserve replay-critical metadata.
- Deletion/pruning must never violate tenant isolation guarantees.
