import { getObservabilityStore } from "@agent/observability";
import { createInlineExecutionAdapter } from "./executor";
import { createQueueRunner } from "./runner";
import { createSlackWaitingSignalNotifierFromEnv } from "./slackNotifier";

async function run() {
  const workerId = process.env.WORKER_ID ?? "agent-runner-worker";
  const limit = Number.parseInt(process.env.WORKER_BATCH_SIZE ?? "10", 10);
  const leaseMs = Number.parseInt(process.env.WORKER_LEASE_MS ?? "30000", 10);
  const pollMs = Number.parseInt(process.env.WORKER_POLL_MS ?? "1000", 10);
  const runOnce = process.env.WORKER_RUN_ONCE === "1";
  const tenantId = process.env.WORKER_TENANT_ID;
  const workspaceId = process.env.WORKER_WORKSPACE_ID;

  const store = getObservabilityStore();
  const executor = createInlineExecutionAdapter({ store });
  const notifier = createSlackWaitingSignalNotifierFromEnv(store);
  const runner = createQueueRunner({
    store,
    execute: (job) => executor.execute(job),
    notifier
  });

  console.log(`[Agent Runner] Starting worker ${workerId}...`);

  do {
    const result = await runner.runOnce({
      workerId,
      limit,
      leaseMs,
      tenantId,
      workspaceId
    });
    if (result.claimed > 0 || runOnce) {
      console.log(JSON.stringify({ workerId, ...result }));
    }
    if (runOnce) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (true);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
