import { NextResponse } from "next/server";
import { createAgentAndRun, listAgents } from "@/lib/dashboard-service";

import { auth } from "@/lib/auth";

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

  const agents = await listAgents({ tenantId, workspaceId });
  return NextResponse.json({ data: agents });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    name: string;
    systemPrompt?: string;
    enabledTools?: string[];
    objectivePrompt?: string;
    workspaceId?: string;
  };

  if (!body.name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  const result = await createAgentAndRun({
    name: body.name,
    systemPrompt: body.systemPrompt,
    enabledTools: body.enabledTools,
    objectivePrompt: body.objectivePrompt,
    tenantId: session.user.id,
    workspaceId: body.workspaceId ?? "personal"
  });
  return NextResponse.json({ data: result }, { status: 201 });
}
