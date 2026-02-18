import type {
  MessagingChannelType,
  ObservabilityStore,
  TenantMessagingSettings
} from "@agent/observability";
import type { WaitingSignalNotifier, WaitingSignalNotification } from "./runner";

type TenantMessagingStore = Pick<ObservabilityStore, "getTenantMessagingSettings">;

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
): Promise<{ channel: string; target: string }> {
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

  return { channel: "slack", target: channel };
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
        return await postToSlack(waitingInput, input.config, channel);
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
