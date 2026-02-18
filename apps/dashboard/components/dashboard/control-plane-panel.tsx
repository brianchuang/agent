"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FormState = {
  error?: string;
  success?: string;
};

export function ControlPlanePanel() {
  const router = useRouter();
  const [createState, setCreateState] = useState<FormState>({});
  const [messagingState, setMessagingState] = useState<FormState>({});
  const [workspaceId, setWorkspaceId] = useState("personal");
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackDefaultChannel, setSlackDefaultChannel] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadMessagingSettings() {
      setMessagingState({});
      const response = await fetch(`/api/messaging?workspaceId=${encodeURIComponent(workspaceId)}`);
      const body = (await response.json()) as {
        error?: string;
        data?: {
          slack?: {
            enabled?: boolean;
            defaultChannel?: string;
          };
        } | null;
      };
      if (!response.ok) {
        if (!cancelled) setMessagingState({ error: body.error ?? "Failed to load messaging settings" });
        return;
      }
      if (!cancelled) {
        setSlackEnabled(Boolean(body.data?.slack?.enabled));
        setSlackDefaultChannel(body.data?.slack?.defaultChannel ?? "");
      }
    }
    void loadMessagingSettings();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);


  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Create Agent</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setCreateState({});
              const form = new FormData(event.currentTarget);

              const payload = {
                name: String(form.get("name") ?? ""),
                systemPrompt: String(form.get("systemPrompt") ?? ""),
                enabledTools: String(form.get("enabledTools") ?? "").split(",").map(s => s.trim()).filter(Boolean),
                objectivePrompt: String(form.get("objectivePrompt") ?? "")
              };
              const response = await fetch("/api/agents", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload)
              });
              const body = (await response.json()) as { 
                error?: string; 
                data?: { 
                  agent: { id: string };
                  run?: { id: string };
                  events?: { tenantId: string; workspaceId: string }[];
                } 
              };
              if (!response.ok) {
                setCreateState({ error: body.error ?? "Failed to create agent" });
                return;
              }
              setCreateState({ success: `Created ${body.data?.agent.id}` });
              if (body.data?.run?.id) {
                 const runId = body.data.run.id;
                 router.push(`/runs/${encodeURIComponent(runId)}`);
              }
              event.currentTarget.reset();
              router.refresh();
            }}
          >
            <input name="name" placeholder="Agent Name (e.g. Personal Assistant)" className="w-full rounded border px-3 py-2 text-sm" />
            <div className="border-t pt-2 mt-2">
              <p className="text-sm font-medium mb-1">Agent Configuration</p>
              <textarea
                name="systemPrompt"
                placeholder="System Prompt (e.g. You are a helpful assistant...)"
                className="h-24 w-full rounded border px-3 py-2 text-sm mb-2"
                defaultValue="You are a helpful agent. You have access to a calendar tool 'calendar_list_events'. If the user asks about schedule/calendar, use it. Output ONLY valid JSON."
              />
              <input 
                name="enabledTools" 
                placeholder="Enabled Tools (comma-separated, e.g. calendar_list_events, gmail_list_threads)" 
                className="w-full rounded border px-3 py-2 text-sm mb-2" 
                defaultValue="calendar_list_events, gmail_list_threads, gmail_get_thread, gmail_create_draft, gmail_send_email, planner_schedule_workflow"
              />
            </div>
            <div className="border-t pt-2 mt-2">
              <p className="text-sm font-medium mb-1">Objective</p>
              <textarea
                name="objectivePrompt"
                placeholder="Objective (e.g. Find me a time to meet with Brian tomorrow)"
                className="h-24 w-full rounded border px-3 py-2 text-sm mb-2"
              />
            </div>
            <Button type="submit" size="sm">
              Create Agent
            </Button>
            {createState.error ? <p className="text-sm text-destructive">{createState.error}</p> : null}
            {createState.success ? <p className="text-sm text-emerald-700">{createState.success}</p> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Messaging Channels</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setMessagingState({});
              const response = await fetch("/api/messaging", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  workspaceId,
                  notifierCascade: ["slack"],
                  slack: {
                    enabled: slackEnabled,
                    defaultChannel: slackDefaultChannel.trim()
                  }
                })
              });
              const body = (await response.json()) as {
                error?: string;
                data?: unknown;
              };
              if (!response.ok) {
                setMessagingState({ error: body.error ?? "Failed to save messaging settings" });
                return;
              }
              setMessagingState({ success: "Messaging settings saved" });
              router.refresh();
            }}
          >
            <div className="space-y-1">
              <label htmlFor="workspace-id" className="text-sm font-medium">
                Workspace
              </label>
              <input
                id="workspace-id"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                placeholder="personal"
                className="w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={slackEnabled}
                onChange={(event) => setSlackEnabled(event.target.checked)}
              />
              Enable Slack notifications
            </label>
            <div className="space-y-1">
              <label htmlFor="slack-default-channel" className="text-sm font-medium">
                Slack Default Channel
              </label>
              <input
                id="slack-default-channel"
                value={slackDefaultChannel}
                onChange={(event) => setSlackDefaultChannel(event.target.value)}
                placeholder="C0123456789"
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Used for waiting-signal questions when Slack is enabled for this workspace.
              </p>
            </div>
            <Button type="submit" size="sm">
              Save Messaging Settings
            </Button>
            {messagingState.error ? <p className="text-sm text-destructive">{messagingState.error}</p> : null}
            {messagingState.success ? <p className="text-sm text-emerald-700">{messagingState.success}</p> : null}
          </form>
        </CardContent>
      </Card>

    </section>
  );
}
