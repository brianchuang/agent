import test from "node:test";
import assert from "node:assert/strict";
import { createSlackWaitingSignalNotifier, createSlackWaitingSignalNotifierFromEnv } from "./slackNotifier";

const BASE_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...BASE_ENV };
});

test("slack notifier posts waiting question to configured channel", async () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    called = true;
    assert.equal(String(url), "https://slack.com/api/chat.postMessage");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.channel, "C-ABC");
    assert.match(body.text, /Needs label/);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
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
    assert.deepEqual(result, { channel: "slack", target: "C-ABC" });
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
    const body = JSON.parse(String(init?.body));
    assert.equal(body.channel, "C-SCOPED");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
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
    const body = JSON.parse(String(init?.body));
    assert.equal(body.channel, "C-TENANT-DEFAULT");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
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
