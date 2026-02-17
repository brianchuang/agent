import { NextResponse } from "next/server";
import { getObservabilityStore } from "@agent/observability";
import { createInlineExecutionAdapter } from "@/lib/queue-executor";
import { createQueueRunner } from "@/lib/queue-runner";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    workerId: string;
    limit: number;
    leaseMs: number;
    tenantId: string;
    workspaceId: string;
  }>;

  if ((body.tenantId && !body.workspaceId) || (!body.tenantId && body.workspaceId)) {
    return NextResponse.json(
      { error: "tenantId and workspaceId must be provided together" },
      { status: 400 }
    );
  }

  const runner = createQueueRunner({
    store: getObservabilityStore(),
    execute: async (job) => createInlineExecutionAdapter().execute(job)
  });
  const result = await runner.runOnce({
    workerId: body.workerId ?? "dashboard-api-worker",
    limit: body.limit ?? 10,
    leaseMs: body.leaseMs ?? 30_000,
    tenantId: body.tenantId,
    workspaceId: body.workspaceId
  });
  return NextResponse.json({ data: result });
}
