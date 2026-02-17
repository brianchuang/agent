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
  const [dispatchState, setDispatchState] = useState<FormState>({});

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
                id: String(form.get("id") ?? ""),
                name: String(form.get("name") ?? ""),
                owner: String(form.get("owner") ?? ""),
                env: String(form.get("env") ?? ""),
                version: String(form.get("version") ?? "")
              };
              const response = await fetch("/api/agents", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload)
              });
              const body = (await response.json()) as { error?: string; data?: { id: string } };
              if (!response.ok) {
                setCreateState({ error: body.error ?? "Failed to create agent" });
                return;
              }
              setCreateState({ success: `Created ${body.data?.id ?? payload.id}` });
              event.currentTarget.reset();
              router.refresh();
            }}
          >
            <input name="id" placeholder="agent id" className="w-full rounded border px-3 py-2 text-sm" />
            <input name="name" placeholder="display name" className="w-full rounded border px-3 py-2 text-sm" />
            <input name="owner" placeholder="owner email" className="w-full rounded border px-3 py-2 text-sm" />
            <select name="env" className="w-full rounded border px-3 py-2 text-sm" defaultValue="staging">
              <option value="staging">staging</option>
              <option value="prod">prod</option>
            </select>
            <input name="version" placeholder="version" className="w-full rounded border px-3 py-2 text-sm" defaultValue="1.0.0" />
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
          <CardTitle>Dispatch Objective</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setDispatchState({});
              const form = new FormData(event.currentTarget);
              const agentId = String(form.get("agentId") ?? "");
              const payload = {
                objectivePrompt: String(form.get("objectivePrompt") ?? ""),
                tenantId: String(form.get("tenantId") ?? ""),
                workspaceId: String(form.get("workspaceId") ?? ""),
                threadId: String(form.get("threadId") ?? "")
              };
              const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/runs`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload)
              });
              const body = (await response.json()) as {
                error?: string;
                data?: { run: { id: string } };
              };
              if (!response.ok || !body.data?.run?.id) {
                setDispatchState({ error: body.error ?? "Failed to dispatch objective" });
                return;
              }
              const runId = body.data.run.id;
              setDispatchState({ success: `Dispatched run ${runId}` });
              router.push(
                `/runs/${encodeURIComponent(runId)}?tenantId=${encodeURIComponent(payload.tenantId)}&workspaceId=${encodeURIComponent(payload.workspaceId)}`
              );
              router.refresh();
            }}
          >
            <input name="agentId" placeholder="agent id" className="w-full rounded border px-3 py-2 text-sm" />
            <textarea
              name="objectivePrompt"
              placeholder="objective_prompt"
              className="h-24 w-full rounded border px-3 py-2 text-sm"
            />
            <input name="tenantId" placeholder="tenant id" className="w-full rounded border px-3 py-2 text-sm" />
            <input
              name="workspaceId"
              placeholder="workspace id"
              className="w-full rounded border px-3 py-2 text-sm"
            />
            <input name="threadId" placeholder="thread id (optional)" className="w-full rounded border px-3 py-2 text-sm" />
            <Button type="submit" size="sm">
              Start Run
            </Button>
            {dispatchState.error ? <p className="text-sm text-destructive">{dispatchState.error}</p> : null}
            {dispatchState.success ? <p className="text-sm text-emerald-700">{dispatchState.success}</p> : null}
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
