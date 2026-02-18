"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresObservabilityStore = void 0;
const pg_1 = require("pg");
const uuidv7_1 = require("uuidv7");
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
        avgLatencyMs: row.avg_latency_ms,
        systemPrompt: row.system_prompt ?? undefined,
        enabledTools: row.enabled_tools
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
function mapWorkflowQueueJob(row) {
    return {
        id: row.id,
        runId: row.run_id,
        agentId: row.agent_id,
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        workflowId: row.workflow_id,
        requestId: row.request_id,
        threadId: row.thread_id,
        objectivePrompt: row.objective_prompt,
        status: row.status,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        availableAt: row.available_at.toISOString(),
        leaseToken: row.lease_token ?? undefined,
        leaseExpiresAt: row.lease_expires_at?.toISOString(),
        lastError: row.last_error ?? undefined,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
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
        const result = await this.pool.query(`SELECT id, name, owner, env, version, status, last_heartbeat_at, error_rate, avg_latency_ms, system_prompt, enabled_tools
         FROM agents
         ORDER BY last_heartbeat_at DESC`);
        return result.rows.map(mapAgent);
    }
    async getAgent(id) {
        const result = await this.pool.query(`SELECT id, name, owner, env, version, status, last_heartbeat_at, error_rate, avg_latency_ms, system_prompt, enabled_tools
         FROM agents
         WHERE id = $1`, [id]);
        return result.rowCount ? mapAgent(result.rows[0]) : undefined;
    }
    async upsertAgent(agent) {
        await this.pool.query(`INSERT INTO agents (id, name, owner, env, version, status, last_heartbeat_at, error_rate, avg_latency_ms, system_prompt, enabled_tools)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11::jsonb)
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
         system_prompt = EXCLUDED.system_prompt,
         enabled_tools = EXCLUDED.enabled_tools,
         updated_at = NOW()`, [
            agent.id,
            agent.name,
            agent.owner,
            agent.env,
            agent.version,
            agent.status,
            agent.lastHeartbeatAt,
            agent.errorRate,
            agent.avgLatencyMs,
            agent.systemPrompt ?? null,
            JSON.stringify(agent.enabledTools ?? [])
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
    async enqueueWorkflowJob(input) {
        const result = await this.pool.query(`INSERT INTO workflow_queue_jobs (
          id, run_id, agent_id, tenant_id, workspace_id, workflow_id, request_id, thread_id,
          objective_prompt, status, attempt_count, max_attempts, available_at
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', 0, $10, $11::timestamptz
       )
       ON CONFLICT (tenant_id, workspace_id, request_id)
       DO UPDATE SET
         run_id = EXCLUDED.run_id,
         agent_id = EXCLUDED.agent_id,
         workflow_id = EXCLUDED.workflow_id,
         thread_id = EXCLUDED.thread_id,
         objective_prompt = EXCLUDED.objective_prompt,
         max_attempts = EXCLUDED.max_attempts,
         available_at = EXCLUDED.available_at,
         status = 'queued',
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = NOW()
       RETURNING
         id, run_id, agent_id, tenant_id, workspace_id, workflow_id, request_id, thread_id,
         objective_prompt, status, attempt_count, max_attempts, available_at, lease_token,
         lease_expires_at, last_error, created_at, updated_at`, [
            input.id,
            input.runId,
            input.agentId,
            input.tenantId,
            input.workspaceId,
            input.workflowId,
            input.requestId,
            input.threadId,
            input.objectivePrompt,
            input.maxAttempts,
            input.availableAt
        ]);
        return mapWorkflowQueueJob(result.rows[0]);
    }
    async listWorkflowJobs(filter) {
        const clauses = [];
        const values = [];
        if (filter?.statuses && filter.statuses.length > 0) {
            values.push(filter.statuses);
            clauses.push(`status = ANY($${values.length}::text[])`);
        }
        if (filter?.availableAfter) {
            values.push(filter.availableAfter);
            clauses.push(`available_at >= $${values.length}::timestamptz`);
        }
        if (filter?.availableBefore) {
            values.push(filter.availableBefore);
            clauses.push(`available_at <= $${values.length}::timestamptz`);
        }
        if (filter?.tenantId) {
            values.push(filter.tenantId);
            clauses.push(`tenant_id = $${values.length}`);
        }
        if (filter?.workspaceId) {
            values.push(filter.workspaceId);
            clauses.push(`workspace_id = $${values.length}`);
        }
        const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
        const limit = Number.isInteger(filter?.limit) && filter?.limit > 0 ? filter?.limit : 100;
        values.push(limit);
        const result = await this.pool.query(`SELECT
          id, run_id, agent_id, tenant_id, workspace_id, workflow_id, request_id, thread_id,
          objective_prompt, status, attempt_count, max_attempts, available_at, lease_token,
          lease_expires_at, last_error, created_at, updated_at
         FROM workflow_queue_jobs
         ${where}
         ORDER BY available_at ASC, created_at ASC
         LIMIT $${values.length}`, values);
        return result.rows.map(mapWorkflowQueueJob);
    }
    async claimWorkflowJobs(input) {
        const now = input.now ?? new Date().toISOString();
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const whereClauses = [
                `available_at <= $1::timestamptz`,
                `(status = 'queued' OR (status = 'claimed' AND lease_expires_at <= $1::timestamptz))`
            ];
            const values = [now];
            if (input.tenantId && input.workspaceId) {
                values.push(input.tenantId, input.workspaceId);
                whereClauses.push(`tenant_id = $${values.length - 1}`);
                whereClauses.push(`workspace_id = $${values.length}`);
            }
            values.push(input.limit);
            const candidateRows = await client.query(`SELECT id
           FROM workflow_queue_jobs
           WHERE ${whereClauses.join(" AND ")}
           ORDER BY available_at ASC, created_at ASC
           LIMIT $${values.length}
           FOR UPDATE SKIP LOCKED`, values);
            const claimed = [];
            for (const row of candidateRows.rows) {
                const leaseToken = `${input.workerId}:${(0, uuidv7_1.uuidv7)()}`;
                const updated = await client.query(`UPDATE workflow_queue_jobs
              SET status = 'claimed',
                  lease_token = $2,
                  lease_expires_at = ($1::timestamptz + make_interval(secs => ($3::double precision / 1000.0))),
                  attempt_count = attempt_count + 1,
                  updated_at = NOW()
            WHERE id = $4
            RETURNING
              id, run_id, agent_id, tenant_id, workspace_id, workflow_id, request_id, thread_id,
              objective_prompt, status, attempt_count, max_attempts, available_at, lease_token,
              lease_expires_at, last_error, created_at, updated_at`, [now, leaseToken, input.leaseMs, row.id]);
                if (updated.rowCount) {
                    claimed.push(mapWorkflowQueueJob(updated.rows[0]));
                }
            }
            await client.query("COMMIT");
            return claimed;
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    async completeWorkflowJob(input) {
        await this.pool.query(`UPDATE workflow_queue_jobs
          SET status = 'completed',
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1
          AND lease_token = $2`, [input.jobId, input.leaseToken]);
    }
    async failWorkflowJob(input) {
        const retryAt = input.retryAt ?? new Date().toISOString();
        await this.pool.query(`UPDATE workflow_queue_jobs
          SET status =
                CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END,
              last_error = $3,
              lease_token = NULL,
              lease_expires_at = NULL,
              available_at =
                CASE WHEN attempt_count >= max_attempts THEN available_at ELSE $4::timestamptz END,
              updated_at = NOW()
        WHERE id = $1
          AND lease_token = $2`, [input.jobId, input.leaseToken, input.error, retryAt]);
    }
    async getWorkflowJob(jobId) {
        const result = await this.pool.query(`SELECT
          id, run_id, agent_id, tenant_id, workspace_id, workflow_id, request_id, thread_id,
          objective_prompt, status, attempt_count, max_attempts, available_at, lease_token,
          lease_expires_at, last_error, created_at, updated_at
         FROM workflow_queue_jobs
         WHERE id = $1`, [jobId]);
        return result.rowCount ? mapWorkflowQueueJob(result.rows[0]) : undefined;
    }
    async upsertUser(input) {
        // Check for existing user by email to avoid unique constraint violation
        const existing = await this.pool.query('SELECT id FROM users WHERE email = $1', [input.email]);
        const idToUse = existing.rowCount && existing.rowCount > 0 ? existing.rows[0].id : input.id;
        const result = await this.pool.query(`INSERT INTO users (id, email, name, image, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id)
       DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         image = EXCLUDED.image,
         updated_at = NOW()
       RETURNING id, email, name, image, created_at, updated_at`, [idToUse, input.email, input.name ?? null, input.image ?? null]);
        const row = result.rows[0];
        return {
            id: row.id,
            email: row.email,
            name: row.name ?? undefined,
            image: row.image ?? undefined,
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString()
        };
    }
    async upsertConnection(input) {
        const result = await this.pool.query(`INSERT INTO connections (
         user_id, provider_id, provider_account_id, access_token, refresh_token,
         expires_at, scope, token_type, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8, NOW())
       ON CONFLICT (user_id, provider_id)
       DO UPDATE SET
         provider_account_id = EXCLUDED.provider_account_id,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope,
         token_type = EXCLUDED.token_type,
         updated_at = NOW()
       RETURNING id, user_id, provider_id, provider_account_id, access_token, refresh_token, expires_at, scope, token_type, created_at, updated_at`, [
            input.userId,
            input.providerId,
            input.providerAccountId,
            input.accessToken ?? null,
            input.refreshToken ?? null,
            input.expiresAt ?? null,
            input.scope ?? null,
            input.tokenType ?? null
        ]);
        const row = result.rows[0];
        return {
            id: row.id,
            userId: row.user_id,
            providerId: row.provider_id,
            providerAccountId: row.provider_account_id,
            accessToken: row.access_token ?? undefined,
            refreshToken: row.refresh_token ?? undefined,
            expiresAt: row.expires_at ? Number(row.expires_at) : undefined,
            scope: row.scope ?? undefined,
            tokenType: row.token_type ?? undefined,
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString()
        };
    }
    async getConnection(userId, providerId) {
        const result = await this.pool.query(`SELECT id, user_id, provider_id, provider_account_id, access_token, refresh_token, expires_at, scope, token_type, created_at, updated_at
       FROM connections
       WHERE user_id = $1 AND provider_id = $2`, [userId, providerId]);
        if (result.rowCount === 0)
            return undefined;
        const row = result.rows[0];
        return {
            id: row.id,
            userId: row.user_id,
            providerId: row.provider_id,
            providerAccountId: row.provider_account_id,
            accessToken: row.access_token ?? undefined,
            refreshToken: row.refresh_token ?? undefined,
            expiresAt: row.expires_at ? Number(row.expires_at) : undefined,
            scope: row.scope ?? undefined,
            tokenType: row.token_type ?? undefined,
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString()
        };
    }
    async deleteConnection(userId, providerId) {
        await this.pool.query(`DELETE FROM connections
       WHERE user_id = $1 AND provider_id = $2`, [userId, providerId]);
    }
}
exports.PostgresObservabilityStore = PostgresObservabilityStore;
