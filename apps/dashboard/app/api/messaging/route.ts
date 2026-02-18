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
    notifierCascade?: Array<"web_ui" | "slack">;
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

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let workspaceId: string | undefined;
  let slackEnabled = false;
  let slackDefaultChannel: string | undefined;

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as {
      workspaceId?: string;
      slack?: { enabled?: boolean; defaultChannel?: string };
    };
    workspaceId = body.workspaceId;
    slackEnabled = Boolean(body.slack?.enabled);
    slackDefaultChannel = body.slack?.defaultChannel;
  } else {
    const form = await req.formData();
    workspaceId = String(form.get("workspaceId") ?? "") || undefined;
    slackEnabled = form.get("slackEnabled") === "on" || form.get("slackEnabled") === "true";
    slackDefaultChannel = String(form.get("slackDefaultChannel") ?? "") || undefined;
  }

  const data = await upsertTenantMessagingSettings({
    tenantId: session.user.id,
    workspaceId,
    notifierCascade: ["web_ui", "slack"],
    slack: {
      enabled: slackEnabled,
      defaultChannel: slackDefaultChannel
    }
  });
  return NextResponse.json({ data });
}
