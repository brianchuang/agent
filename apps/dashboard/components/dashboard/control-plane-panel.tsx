"use client";

import { useState } from "react";
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


  return (
    <section className="grid gap-4 lg:grid-cols-2">
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


    </section>
  );
}
