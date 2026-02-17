import { NextResponse } from "next/server";
import { getRun, listRunEvents } from "@/lib/dashboard-service";

type Params = {
  params: Promise<{ runId: string }>;
};

export async function GET(req: Request, { params }: Params) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId") ?? undefined;
  const workspaceId = searchParams.get("workspaceId") ?? undefined;
  if ((tenantId && !workspaceId) || (!tenantId && workspaceId)) {
    return NextResponse.json(
      { error: "tenantId and workspaceId must be provided together" },
      { status: 400 }
    );
  }

  const { runId } = await params;
  const run = await getRun(runId);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const events = await listRunEvents(runId, { tenantId, workspaceId });
  return NextResponse.json({ data: events });
}
