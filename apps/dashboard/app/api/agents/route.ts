import { NextResponse } from "next/server";
import { createAgent, listAgents } from "@/lib/dashboard-service";

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
  const body = (await req.json()) as Partial<{
    id: string;
    name: string;
    owner: string;
    env: "prod" | "staging";
    version: string;
  }>;

  if (!body.id || !body.name || !body.owner || !body.env || !body.version) {
    return NextResponse.json(
      { error: "id, name, owner, env, and version are required" },
      { status: 400 }
    );
  }

  const agent = await createAgent({
    id: body.id,
    name: body.name,
    owner: body.owner,
    env: body.env,
    version: body.version
  });
  return NextResponse.json({ data: agent }, { status: 201 });
}
