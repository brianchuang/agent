import { NextResponse } from "next/server";
import { getMetrics } from "@/lib/dashboard-service";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId") ?? undefined;
  const workspaceId = searchParams.get("workspaceId") ?? undefined;

  if ((tenantId && !workspaceId) || (!tenantId && workspaceId)) {
    return NextResponse.json(
      { error: "tenantId and workspaceId must be provided together" },
      { status: 400 }
    );
  }

  const metrics = await getMetrics({ tenantId, workspaceId });
  return NextResponse.json({ data: metrics });
}
