import { NextResponse } from "next/server";
import { listRecentEvents } from "@/lib/dashboard-service";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get("limit");
  const tenantId = searchParams.get("tenantId") ?? undefined;
  const workspaceId = searchParams.get("workspaceId") ?? undefined;
  if ((tenantId && !workspaceId) || (!tenantId && workspaceId)) {
    return NextResponse.json(
      { error: "tenantId and workspaceId must be provided together" },
      { status: 400 }
    );
  }
  const parsed = limitParam ? Number.parseInt(limitParam, 10) : 10;
  const limit = Number.isInteger(parsed) && parsed > 0 ? parsed : 10;

  const events = await listRecentEvents(limit, { tenantId, workspaceId });
  return NextResponse.json({ data: events });
}
