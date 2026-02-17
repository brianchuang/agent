import { NextResponse } from "next/server";
import { dispatchObjectiveRun, getAgent, listAgentRuns } from "@/lib/dashboard-service";

type Params = {
  params: Promise<{ id: string }>;
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

  const { id } = await params;
  const agent = await getAgent(id);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const runs = await listAgentRuns(id, { tenantId, workspaceId });
  return NextResponse.json({ data: runs });
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json()) as Partial<{
    objectivePrompt: string;
    tenantId: string;
    workspaceId: string;
    threadId: string;
  }>;

  if (!body.objectivePrompt || !body.tenantId || !body.workspaceId) {
    return NextResponse.json(
      { error: "objectivePrompt, tenantId, and workspaceId are required" },
      { status: 400 }
    );
  }

  const agent = await getAgent(id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const created = await dispatchObjectiveRun({
    agentId: id,
    objectivePrompt: body.objectivePrompt,
    tenantId: body.tenantId,
    workspaceId: body.workspaceId,
    threadId: body.threadId
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
