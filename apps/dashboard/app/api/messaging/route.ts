import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getTenantMessagingSettings,
  upsertTenantMessagingSettings
} from "@/lib/dashboard-service";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId") ?? "personal";
  const data = await getTenantMessagingSettings(session.user.id, workspaceId);
  return NextResponse.json({ data: data ?? null });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
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
    tenantId: session.user.id,
    workspaceId: body.workspaceId,
    notifierCascade: body.notifierCascade,
    slack: body.slack
  });
  return NextResponse.json({ data });
}
