import type {
  MessagingChannelType,
  ObservabilityStore,
  TenantMessagingSettings
} from "@agent/observability";
import type { WaitingSignalNotifier, WaitingSignalNotification } from "./runner";

type TenantMessagingStore = Pick<
  ObservabilityStore,
  "getTenantMessagingSettings" | "upsertWorkflowMessageThread"
>;

type SlackNotifierConfig = {
  botToken: string;
  defaultChannel?: string;
  channelByScope: Record<string, string>;
  dashboardBaseUrl?: string;
  fallbackCascade: MessagingChannelType[];
};

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  channel?: string;
  ts?: string;
  team_id?: string;
};

function parseScopeChannels(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const output: Record<string, string> = {};
    for (const [scope, channel] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof channel === "string" && channel.trim().length > 0) {
        output[scope] = channel.trim();
      }
    }
    return output;
  } catch {
    return {};
  }
}

function normalizeBaseUrl(raw: string | undefined): string | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  return raw.trim().replace(/\/$/, "");
}

function parseNotifierCascade(raw: string | undefined): MessagingChannelType[] {
  if (!raw || raw.trim().length === 0) return ["slack"];
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is MessagingChannelType => value === "slack");
  return values.length > 0 ? values : ["slack"];
}

function fallbackChannelFor(input: WaitingSignalNotification, config: SlackNotifierConfig): string {
  return (
    config.channelByScope[`${input.tenantId}:${input.workspaceId}`] ??
    config.defaultChannel ??
    ""
  ).trim();
}

function buildText(input: WaitingSignalNotification, config: SlackNotifierConfig): string {
  const runUrl = config.dashboardBaseUrl ? `${config.dashboardBaseUrl}/runs/${input.runId}` : undefined;
  const lines = [
    `Agent needs input for workflow ${input.workflowId}:`,
    input.waitingQuestion,
    `Tenant/workspace: ${input.tenantId}/${input.workspaceId}`,
    `Run: ${input.runId}`
  ];
  if (runUrl) {
    lines.push(`Run link: ${runUrl}`);
  }
  return lines.join("\n");
}

async function postToSlack(
  input: WaitingSignalNotification,
  config: SlackNotifierConfig,
  channel: string
): Promise<{
  channel: string;
  target: string;
  channelId: string;
  messageId: string;
  threadId: string;
  providerTeamId?: string;
}> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.botToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      channel,
      text: buildText(input, config)
    })
  });

  if (!response.ok) {
    throw new Error(`Slack API HTTP ${response.status}`);
  }

  const payload = (await response.json()) as SlackApiResponse;
  if (!payload.ok) {
    throw new Error(payload.error ? `Slack API error: ${payload.error}` : "Slack API error");
  }

  const messageId = typeof payload.ts === "string" && payload.ts.trim().length > 0 ? payload.ts : "";
  if (!messageId) {
    throw new Error("Slack API response missing message ts");
  }
  const channelId =
    typeof payload.channel === "string" && payload.channel.trim().length > 0
      ? payload.channel.trim()
      : channel;

  // Ensure the bot is actually a member of the channel; event subscriptions are scoped by membership.
  const joinResponse = await fetch("https://slack.com/api/conversations.join", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.botToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      channel: channelId
    })
  });
  if (!joinResponse.ok) {
    throw new Error(`Slack conversations.join HTTP ${joinResponse.status}`);
  }
  const joinPayload = (await joinResponse.json()) as SlackApiResponse;
  if (!joinPayload.ok && joinPayload.error !== "method_not_supported_for_channel_type") {
    throw new Error(
      joinPayload.error ? `Slack conversations.join error: ${joinPayload.error}` : "Slack conversations.join error"
    );
  }

  const authResponse = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.botToken}`,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
  const authPayload = authResponse.ok ? ((await authResponse.json()) as SlackApiResponse) : undefined;
  const providerTeamId =
    authPayload && authPayload.ok && typeof authPayload.team_id === "string"
      ? authPayload.team_id
      : undefined;
  return {
    channel: "slack",
    target: channel,
    channelId,
    messageId,
    threadId: messageId,
    providerTeamId
  };
}

function resolveSlackChannel(
  input: WaitingSignalNotification,
  config: SlackNotifierConfig,
  settings: TenantMessagingSettings | undefined
): string | undefined {
  if (!settings) {
    const fallback = fallbackChannelFor(input, config);
    return fallback || undefined;
  }

  const enabled = settings.slack?.enabled === true;
  if (!enabled) {
    return undefined;
  }

  const explicit = settings.slack?.defaultChannel?.trim();
  if (explicit) return explicit;
  const fallback = fallbackChannelFor(input, config);
  return fallback || undefined;
}

export function createSlackWaitingSignalNotifier(input: {
  store: TenantMessagingStore;
  config: SlackNotifierConfig;
}): WaitingSignalNotifier {
  return {
    async notifyWaitingSignal(waitingInput) {
      const tenantSettings = await input.store.getTenantMessagingSettings(
        waitingInput.tenantId,
        waitingInput.workspaceId
      );

      const cascade =
        tenantSettings?.notifierCascade && tenantSettings.notifierCascade.length > 0
          ? tenantSettings.notifierCascade
          : input.config.fallbackCascade;

      for (const notifierType of cascade) {
        if (notifierType !== "slack") continue;
        const channel = resolveSlackChannel(waitingInput, input.config, tenantSettings);
        if (!channel) continue;
        const result = await postToSlack(waitingInput, input.config, channel);
        await input.store.upsertWorkflowMessageThread({
          tenantId: waitingInput.tenantId,
          workspaceId: waitingInput.workspaceId,
          workflowId: waitingInput.workflowId,
          runId: waitingInput.runId,
          channelType: "slack",
          channelId: result.channelId,
          rootMessageId: result.messageId,
          threadId: result.threadId,
          providerTeamId: result.providerTeamId,
          status: "active"
        });
        return result;
      }

      throw new Error(
        `No configured messaging channels available for tenant/workspace ${waitingInput.tenantId}:${waitingInput.workspaceId}`
      );
    }
  };
}

export function createSlackWaitingSignalNotifierFromEnv(
  store: TenantMessagingStore
): WaitingSignalNotifier | undefined {
  if (process.env.WAITING_SIGNAL_NOTIFIER !== "slack") {
    return undefined;
  }
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || botToken.trim().length === 0) {
    throw new Error("WAITING_SIGNAL_NOTIFIER=slack requires SLACK_BOT_TOKEN");
  }

  return createSlackWaitingSignalNotifier({
    store,
    config: {
      botToken: botToken.trim(),
      defaultChannel: process.env.SLACK_DEFAULT_CHANNEL?.trim(),
      channelByScope: parseScopeChannels(process.env.SLACK_CHANNEL_BY_SCOPE_JSON),
      dashboardBaseUrl: normalizeBaseUrl(process.env.AGENT_DASHBOARD_BASE_URL),
      fallbackCascade: parseNotifierCascade(process.env.WAITING_SIGNAL_NOTIFIER_CASCADE)
    }
  });
}
