import { NextResponse } from "next/server";
import { listRuns } from "@/lib/dashboard-service";
import { RunStatus } from "@agent/observability";

const allowedStatuses = new Set<RunStatus>(["success", "failed", "running", "queued"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agentId") ?? undefined;
  const query = searchParams.get("query") ?? undefined;
  const tenantId = searchParams.get("tenantId") ?? undefined;
  const workspaceId = searchParams.get("workspaceId") ?? undefined;

  if ((tenantId && !workspaceId) || (!tenantId && workspaceId)) {
    return NextResponse.json(
      { error: "tenantId and workspaceId must be provided together" },
      { status: 400 }
    );
  }

  const statusParam = searchParams.get("status") ?? undefined;
  const status = statusParam && allowedStatuses.has(statusParam as RunStatus)
    ? (statusParam as RunStatus)
    : undefined;

  const runs = await listRuns({ agentId, status, query, tenantId, workspaceId });
  return NextResponse.json({ data: runs });
}
