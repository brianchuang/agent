import { NextResponse } from "next/server";
import { listIncidents } from "@/lib/dashboard-service";

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
  const incidents = await listIncidents({ tenantId, workspaceId });
  return NextResponse.json({ data: incidents });
}
