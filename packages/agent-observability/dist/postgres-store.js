"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresObservabilityStore = void 0;
const pg_1 = require("pg");
function mapAgent(row) {
    return {
        id: row.id,
        name: row.name,
        owner: row.owner,
        env: row.env,
        version: row.version,
        status: row.status,
        lastHeartbeatAt: row.last_heartbeat_at.toISOString(),
        errorRate: Number(row.error_rate),
        avgLatencyMs: row.avg_latency_ms
    };
}
function mapRun(row) {
    return {
        id: row.id,
        agentId: row.agent_id,
        status: row.status,
        startedAt: row.started_at.toISOString(),
        endedAt: row.ended_at?.toISOString(),
        latencyMs: row.latency_ms ?? undefined,
        errorSummary: row.error_summary ?? undefined,
        traceId: row.trace_id,
        retries: row.retries
    };
}
function mapRunEvent(row) {
    return {
        id: row.event_id,
        runId: row.run_id,
        type: row.event_type,
        level: row.level,
        message: row.message,
        payload: row.payload,
        ts: row.occurred_at.toISOString(),
        correlationId: row.correlation_id ?? undefined,
        causationId: row.causation_id ?? undefined,
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        idempotencyKey: row.idempotency_key ?? undefined,
        metadata: row.metadata ?? undefined
    };
}
class PostgresObservabilityStore {
    pool;
    constructor(connectionString) {
        this.pool = new pg_1.Pool({ connectionString });
    }
    async read() {
        const [agents, runs, runEvents] = await Promise.all([
            this.listAgents(),
            this.listRuns(),
            this.listRecentEvents(500)
        ]);
        return { agents, runs, runEvents };
    }
    async listRecentEvents(limit) {
        const result = await this.pool.query(`SELECT event_id, run_id, event_type, level, message, payload, occurred_at,
              correlation_id, causation_id, tenant_id, workspace_id, idempotency_key, metadata
         FROM run_events
         ORDER BY event_sequence DESC
         LIMIT $1`, [limit]);
        return result.rows.map(mapRunEvent);
    }
    async listAgents() {
        const result = await this.pool.query(`SELECT id, name, owner, env, version, status, last_heartbeat_at, error_rate, avg_latency_ms
         FROM agents
         ORDER BY last_heartbeat_at DESC`);
        return result.rows.map(mapAgent);
    }
    async getAgent(id) {
        const result = await this.pool.query(`SELECT id, name, owner, env, version, status, last_heartbeat_at, error_rate, avg_latency_ms
         FROM agents
         WHERE id = $1`, [id]);
        return result.rowCount ? mapAgent(result.rows[0]) : undefined;
    }
    async upsertAgent(agent) {
        await this.pool.query(`INSERT INTO agents (id, name, owner, env, version, status, last_heartbeat_at, error_rate, avg_latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9)
       ON CONFLICT (id)
       DO UPDATE SET
         name = EXCLUDED.name,
         owner = EXCLUDED.owner,
         env = EXCLUDED.env,
         version = EXCLUDED.version,
         status = EXCLUDED.status,
         last_heartbeat_at = EXCLUDED.last_heartbeat_at,
         error_rate = EXCLUDED.error_rate,
         avg_latency_ms = EXCLUDED.avg_latency_ms,
         updated_at = NOW()`, [
            agent.id,
            agent.name,
            agent.owner,
            agent.env,
            agent.version,
            agent.status,
            agent.lastHeartbeatAt,
            agent.errorRate,
            agent.avgLatencyMs
        ]);
    }
    async listRuns(filter) {
        const clauses = [];
        const values = [];
        if (filter?.agentId) {
            values.push(filter.agentId);
            clauses.push(`agent_id = $${values.length}`);
        }
        if (filter?.status) {
            values.push(filter.status);
            clauses.push(`status = $${values.length}`);
        }
        if (filter?.query) {
            values.push(`%${filter.query}%`);
            clauses.push(`(id ILIKE $${values.length} OR agent_id ILIKE $${values.length} OR trace_id ILIKE $${values.length})`);
        }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const result = await this.pool.query(`SELECT id, agent_id, status, started_at, ended_at, latency_ms, error_summary, trace_id, retries
         FROM runs
         ${where}
         ORDER BY started_at DESC`, values);
        return result.rows.map(mapRun);
    }
    async getRun(id) {
        const result = await this.pool.query(`SELECT id, agent_id, status, started_at, ended_at, latency_ms, error_summary, trace_id, retries
         FROM runs
         WHERE id = $1`, [id]);
        return result.rowCount ? mapRun(result.rows[0]) : undefined;
    }
    async upsertRun(run) {
        await this.pool.query(`INSERT INTO runs (id, agent_id, status, started_at, ended_at, latency_ms, error_summary, trace_id, retries)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9)
       ON CONFLICT (id)
       DO UPDATE SET
         agent_id = EXCLUDED.agent_id,
         status = EXCLUDED.status,
         started_at = EXCLUDED.started_at,
         ended_at = EXCLUDED.ended_at,
         latency_ms = EXCLUDED.latency_ms,
         error_summary = EXCLUDED.error_summary,
         trace_id = EXCLUDED.trace_id,
         retries = EXCLUDED.retries,
         updated_at = NOW()`, [
            run.id,
            run.agentId,
            run.status,
            run.startedAt,
            run.endedAt ?? null,
            run.latencyMs ?? null,
            run.errorSummary ?? null,
            run.traceId,
            run.retries
        ]);
    }
    async listRunEvents(runId) {
        const result = await this.pool.query(`SELECT event_id, run_id, event_type, level, message, payload, occurred_at,
              correlation_id, causation_id, tenant_id, workspace_id, idempotency_key, metadata
         FROM run_events
         WHERE run_id = $1
         ORDER BY stream_position DESC`, [runId]);
        return result.rows.map(mapRunEvent);
    }
    async appendRunEvent(runEvent) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1));", [runEvent.runId]);
            const nextStreamPosition = await client.query(`SELECT (COALESCE(MAX(stream_position), 0) + 1)::bigint AS position
           FROM run_events
           WHERE run_id = $1`, [runEvent.runId]);
            await client.query(`INSERT INTO run_events (
          event_id,
          run_id,
          stream_position,
          event_type,
          level,
          message,
          payload,
          occurred_at,
          correlation_id,
          causation_id,
          tenant_id,
          workspace_id,
          idempotency_key,
          metadata
        ) VALUES ($1, $2, $3::bigint, $4, $5, $6, $7::jsonb, $8::timestamptz, $9, $10, $11, $12, $13, $14::jsonb)
        ON CONFLICT (event_id) DO NOTHING`, [
                runEvent.id,
                runEvent.runId,
                nextStreamPosition.rows[0].position,
                runEvent.type,
                runEvent.level,
                runEvent.message,
                JSON.stringify(runEvent.payload ?? {}),
                runEvent.ts,
                runEvent.correlationId ?? null,
                runEvent.causationId ?? null,
                runEvent.tenantId ?? "default",
                runEvent.workspaceId ?? "default",
                runEvent.idempotencyKey ?? null,
                JSON.stringify(runEvent.metadata ?? {})
            ]);
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
}
exports.PostgresObservabilityStore = PostgresObservabilityStore;
