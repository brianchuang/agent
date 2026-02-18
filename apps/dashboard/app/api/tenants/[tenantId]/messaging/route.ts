import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getTenantMessagingSettings,
  upsertTenantMessagingSettings
} from "@/lib/dashboard-service";

type Params = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(req: Request, { params }: Params) {
  const session = await auth();
  const { tenantId } = await params;
  if (!session?.user?.id || session.user.id !== tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const data = await getTenantMessagingSettings(tenantId, workspaceId);
  return NextResponse.json({ data: data ?? null });
}

export async function PUT(req: Request, { params }: Params) {
  const session = await auth();
  const { tenantId } = await params;
  if (!session?.user?.id || session.user.id !== tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    workspaceId?: string;
    notifierCascade?: Array<"slack">;
    slack?: {
      enabled?: boolean;
      defaultChannel?: string;
    };
  };

  const data = await upsertTenantMessagingSettings({
    tenantId,
    workspaceId: body.workspaceId,
    notifierCascade: body.notifierCascade,
    slack: body.slack
  });
  return NextResponse.json({ data });
}
