import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRun, getTenantMessagingSettings, listRunEvents, sendInboxMessage } from "@/lib/dashboard-service";

type SendSlackDebugPayload = {
  action: "send_test_message";
  workspaceId?: string;
  runId?: string;
  waitingQuestion?: string;
};

type SimulateResponsePayload = {
  action: "simulate_response";
  workspaceId?: string;
  runId: string;
  responseMessage: string;
};

type DebugPayload = SendSlackDebugPayload | SimulateResponsePayload;

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildRunUrl(runId: string): string | undefined {
  const base = process.env.AGENT_DASHBOARD_BASE_URL?.trim().replace(/\/$/, "");
  return base ? `${base}/runs/${runId}` : undefined;
}

function extractQueuedPayload(events: Awaited<ReturnType<typeof listRunEvents>>): {
  objectivePrompt?: string;
  workflowId?: string;
  threadId?: string;
  tenantId?: string;
  workspaceId?: string;
} {
  const queued = events.find((event) => event.message === "Run queued");
  const payload = queued?.payload ?? {};
  const objectivePrompt =
    typeof payload.objective_prompt === "string" ? payload.objective_prompt : undefined;
  const workflowId = typeof payload.workflow_id === "string" ? payload.workflow_id : undefined;
  const threadId = typeof payload.thread_id === "string" ? payload.thread_id : undefined;
  return {
    objectivePrompt,
    workflowId,
    threadId,
    tenantId: queued?.tenantId,
    workspaceId: queued?.workspaceId
  };
}

async function postSlackMessage(input: { channel: string; text: string }) {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is not configured");
  }
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text
    })
  });
  if (!response.ok) {
    throw new Error(`Slack API HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { ok?: boolean; error?: string };
  if (!payload.ok) {
    throw new Error(payload.error ? `Slack API error: ${payload.error}` : "Slack API error");
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<DebugPayload>;
  const action = asString(body.action);
  const workspaceId = asString((body as { workspaceId?: unknown }).workspaceId) ?? "personal";
  const tenantId = session.user.id;

  const settings = await getTenantMessagingSettings(tenantId, workspaceId);
  const channel =
    (settings?.slack?.enabled ? settings?.slack?.defaultChannel?.trim() : undefined) ??
    process.env.SLACK_DEFAULT_CHANNEL?.trim();
  if (!channel) {
    return NextResponse.json(
      { error: "No enabled Slack default channel for this workspace." },
      { status: 400 }
    );
  }

  if (action === "send_test_message") {
    const runId = asString((body as { runId?: unknown }).runId);
    const requestedQuestion = asString((body as { waitingQuestion?: unknown }).waitingQuestion);
    let waitingQuestion = requestedQuestion ?? "Debug ping: waiting signal question test.";
    let workflowId = "debug-workflow";

    if (runId) {
      const run = await getRun(runId, { tenantId, workspaceId });
      if (!run) {
        return NextResponse.json({ error: "Run not found for workspace scope." }, { status: 404 });
      }
      const events = await listRunEvents(runId, { tenantId, workspaceId });
      const waitingEvent = events.find((event) => event.message === "Run waiting for signal");
      const waitingFromPayload =
        typeof waitingEvent?.payload?.output === "object" &&
        waitingEvent.payload.output &&
        typeof (waitingEvent.payload.output as { waitingQuestion?: unknown }).waitingQuestion === "string"
          ? ((waitingEvent.payload.output as { waitingQuestion?: string }).waitingQuestion ?? "").trim()
          : "";
      const meta = extractQueuedPayload(events);
      waitingQuestion = waitingFromPayload || waitingQuestion;
      workflowId = meta.workflowId ?? workflowId;
    }

    const lines = [`[debug] Agent waiting question`, `Workflow: ${workflowId}`, waitingQuestion];
    if (runId) {
      lines.push(`Run: ${runId}`);
      const runUrl = buildRunUrl(runId);
      if (runUrl) lines.push(`Run link: ${runUrl}`);
    }
    await postSlackMessage({ channel, text: lines.join("\n") });
    return NextResponse.json({
      data: {
        sent: true,
        channel,
        runId: runId ?? null,
        waitingQuestion
      }
    });
  }

  if (action === "simulate_response") {
    const runId = asString((body as { runId?: unknown }).runId);
    const responseMessage = asString((body as { responseMessage?: unknown }).responseMessage);
    if (!runId || !responseMessage) {
      return NextResponse.json(
        { error: "runId and responseMessage are required for simulate_response." },
        { status: 400 }
      );
    }

    const run = await getRun(runId, { tenantId, workspaceId });
    if (!run) {
      return NextResponse.json({ error: "Run not found for workspace scope." }, { status: 404 });
    }
    const events = await listRunEvents(runId, { tenantId, workspaceId });
    const meta = extractQueuedPayload(events);
    if (!meta.objectivePrompt) {
      return NextResponse.json(
        { error: "Unable to infer objective prompt from run events." },
        { status: 400 }
      );
    }

    if (!meta.threadId) {
      return NextResponse.json(
        { error: "Unable to infer threadId from run events." },
        { status: 400 }
      );
    }

    const resumed = await sendInboxMessage({
      tenantId,
      workspaceId,
      threadId: meta.threadId,
      agentId: run.agentId,
      message: responseMessage
    });
    const resumedSameRun = resumed.run.id === runId;

    const debugText = [
      "[debug] Simulated user response routed through resume signal path",
      `Prior run: ${runId}`,
      `Result run: ${resumed.run.id}`,
      `Response: ${responseMessage}`
    ].join("\n");
    await postSlackMessage({ channel, text: debugText });

    return NextResponse.json({
      data: {
        accepted: true,
        priorRunId: runId,
        resultRunId: resumed.run.id,
        resumedSameRun
      }
    });
  }

  return NextResponse.json(
    {
      error:
        "Unsupported action. Use action='send_test_message' or action='simulate_response'."
    },
    { status: 400 }
  );
}
