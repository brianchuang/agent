import test from "node:test";
import assert from "node:assert/strict";
import { createSlackWaitingSignalNotifier, createSlackWaitingSignalNotifierFromEnv } from "./slackNotifier";

const BASE_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...BASE_ENV };
});

test("slack notifier posts waiting question to configured channel", async () => {
  let called = false;
  const persisted: Array<Record<string, string>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "https://slack.com/api/chat.postMessage") {
      called = true;
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.channel, "C-ABC");
      assert.match(body.text, /Needs label/);
      return new Response(
        JSON.stringify({ ok: true, ts: "1730000000.123456", channel: "C123456" }),
        { status: 200 }
      );
    }
    if (u === "https://slack.com/api/conversations.join") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u === "https://slack.com/api/auth.test") {
      return new Response(JSON.stringify({ ok: true, team_id: "TTEAM123" }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  }) as typeof fetch;

  try {
    const notifier = createSlackWaitingSignalNotifier({
      store: {
        async getTenantMessagingSettings() {
          return {
            tenantId: "tenant-a",
            workspaceId: "workspace-a",
            notifierCascade: ["slack"],
            slack: {
              enabled: true,
              defaultChannel: "C-ABC"
            }
          };
        },
        async upsertWorkflowMessageThread(input) {
          persisted.push({
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            workflowId: input.workflowId,
            runId: input.runId,
            channelId: input.channelId,
            rootMessageId: input.rootMessageId,
            threadId: input.threadId
          });
          return {
            id: "thread-1",
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            workflowId: input.workflowId,
            runId: input.runId,
            channelType: "slack",
            channelId: input.channelId,
            rootMessageId: input.rootMessageId,
            threadId: input.threadId,
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
        }
      },
      config: {
        botToken: "xoxb-test",
        defaultChannel: "C-FALLBACK",
        channelByScope: {},
        fallbackCascade: ["slack"]
      }
    });
    const result = await notifier.notifyWaitingSignal({
      runId: "run-1",
      jobId: "job-1",
      workflowId: "wf-1",
      threadId: "thread-1",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      waitingQuestion: "Needs label"
    });
    assert.ok(called);
    assert.deepEqual(result, {
      channel: "slack",
      target: "C-ABC",
      channelId: "C123456",
      messageId: "1730000000.123456",
      threadId: "1730000000.123456",
      providerTeamId: "TTEAM123"
    });
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]?.rootMessageId, "1730000000.123456");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("env factory reads scoped channel map", async () => {
  process.env.WAITING_SIGNAL_NOTIFIER = "slack";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_CHANNEL_BY_SCOPE_JSON = JSON.stringify({
    "tenant-a:workspace-a": "C-SCOPED"
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    const u = String(_url);
    if (u === "https://slack.com/api/chat.postMessage") {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.channel, "C-SCOPED");
      return new Response(
        JSON.stringify({ ok: true, ts: "1730000000.200000", channel: "C-SCOPED-ID" }),
        { status: 200 }
      );
    }
    if (u === "https://slack.com/api/conversations.join") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u === "https://slack.com/api/auth.test") {
      return new Response(JSON.stringify({ ok: true, team_id: "TTEAM123" }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  }) as typeof fetch;

  try {
    const notifier = createSlackWaitingSignalNotifierFromEnv({
      async getTenantMessagingSettings() {
        return {
          tenantId: "tenant-a",
          workspaceId: "workspace-a",
          notifierCascade: ["slack"],
          slack: {
            enabled: true
          }
        };
      },
      async upsertWorkflowMessageThread(input) {
        return {
          id: "thread-env-1",
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          workflowId: input.workflowId,
          runId: input.runId,
          channelType: "slack",
          channelId: input.channelId,
          rootMessageId: input.rootMessageId,
          threadId: input.threadId,
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
    });
    assert.ok(notifier);
    await notifier.notifyWaitingSignal({
      runId: "run-1",
      jobId: "job-1",
      workflowId: "wf-1",
      threadId: "thread-1",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      waitingQuestion: "Which label?"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("env notifier falls back to tenant default settings when workspace config is missing", async () => {
  process.env.WAITING_SIGNAL_NOTIFIER = "slack";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_DEFAULT_CHANNEL = "C-ENV";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    const u = String(_url);
    if (u === "https://slack.com/api/chat.postMessage") {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.channel, "C-TENANT-DEFAULT");
      return new Response(
        JSON.stringify({ ok: true, ts: "1730000000.222222", channel: "C-TENANT-ID" }),
        { status: 200 }
      );
    }
    if (u === "https://slack.com/api/conversations.join") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u === "https://slack.com/api/auth.test") {
      return new Response(JSON.stringify({ ok: true, team_id: "TTEAM123" }), { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  }) as typeof fetch;

  try {
    const notifier = createSlackWaitingSignalNotifierFromEnv({
      async getTenantMessagingSettings() {
        return {
          tenantId: "tenant-a",
          notifierCascade: ["slack"],
          slack: {
            enabled: true,
            defaultChannel: "C-TENANT-DEFAULT"
          }
        };
      },
      async upsertWorkflowMessageThread(input) {
        return {
          id: "thread-env-2",
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          workflowId: input.workflowId,
          runId: input.runId,
          channelType: "slack",
          channelId: input.channelId,
          rootMessageId: input.rootMessageId,
          threadId: input.threadId,
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
    });
    assert.ok(notifier);
    await notifier.notifyWaitingSignal({
      runId: "run-1",
      jobId: "job-1",
      workflowId: "wf-1",
      threadId: "thread-1",
      tenantId: "tenant-a",
      workspaceId: "workspace-z",
      waitingQuestion: "Which label?"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
