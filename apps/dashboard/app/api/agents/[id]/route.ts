import { NextResponse } from "next/server";
import { getAgent } from "@/lib/dashboard-service";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(req: Request, { params }: Params) {
  const reqUrl = new URL(req.url);
  const tenantId = reqUrl.searchParams.get("tenantId") ?? undefined;
  const workspaceId = reqUrl.searchParams.get("workspaceId") ?? undefined;
  if ((tenantId && !workspaceId) || (!tenantId && workspaceId)) {
    return NextResponse.json(
      { error: "tenantId and workspaceId must be provided together" },
      { status: 400 }
    );
  }

  const { id } = await params;
  const agent = await getAgent(id, { tenantId, workspaceId });

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ data: agent });
}
