"use client";

import { useEffect, useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api/client";
import { useCreateAgentMutation } from "@/lib/query/hooks/use-create-agent";
import {
  useMessagingSettingsQuery,
  useSaveMessagingSettingsMutation
} from "@/lib/query/hooks/use-messaging-settings";
import { useControlPlaneUiStore } from "@/lib/state/control-plane-store";

const createAgentFormSchema = z.object({
  name: z.string().trim().min(1, "Agent name is required"),
  systemPrompt: z.string().optional(),
  enabledTools: z.string().optional(),
  objectivePrompt: z.string().optional()
});

const messagingFormSchema = z.object({
  workspaceId: z.string().trim().min(1, "Workspace is required"),
  slackEnabled: z.boolean(),
  slackDefaultChannel: z.string().optional()
});

type CreateAgentFormValues = z.infer<typeof createAgentFormSchema>;
type MessagingFormValues = z.infer<typeof messagingFormSchema>;

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}

export function ControlPlanePanel() {
  const router = useRouter();
  const workspaceId = useControlPlaneUiStore((state) => state.workspaceId);
  const setWorkspaceId = useControlPlaneUiStore((state) => state.setWorkspaceId);

  const messagingQuery = useMessagingSettingsQuery(workspaceId);
  const saveMessagingMutation = useSaveMessagingSettingsMutation();
  const createAgentMutation = useCreateAgentMutation();

  const messagingForm = useForm<MessagingFormValues>({
    resolver: zodResolver(messagingFormSchema),
    defaultValues: {
      workspaceId,
      slackEnabled: false,
      slackDefaultChannel: ""
    }
  });

  const createAgentForm = useForm<CreateAgentFormValues>({
    resolver: zodResolver(createAgentFormSchema),
    defaultValues: {
      name: "",
      systemPrompt:
        "You are a helpful agent. You have access to a calendar tool 'calendar_list_events'. If the user asks about schedule/calendar, use it. Output ONLY valid JSON.",
      enabledTools:
        "calendar_list_events, gmail_list_threads, gmail_get_thread, gmail_create_draft, gmail_send_email, planner_schedule_workflow",
      objectivePrompt: ""
    }
  });

  useEffect(() => {
    messagingForm.setValue("workspaceId", workspaceId, { shouldDirty: false, shouldTouch: false });
  }, [workspaceId, messagingForm]);

  useEffect(() => {
    if (!messagingQuery.data) {
      return;
    }

    messagingForm.reset({
      workspaceId,
      slackEnabled: Boolean(messagingQuery.data.slack?.enabled),
      slackDefaultChannel: messagingQuery.data.slack?.defaultChannel ?? ""
    });
  }, [messagingForm, messagingQuery.data, workspaceId]);

  const createAgentError = useMemo(
    () =>
      createAgentMutation.isError
        ? toErrorMessage(createAgentMutation.error, "Failed to create agent")
        : undefined,
    [createAgentMutation.error, createAgentMutation.isError]
  );

  const messagingError = useMemo(
    () =>
      saveMessagingMutation.isError
        ? toErrorMessage(saveMessagingMutation.error, "Failed to save messaging settings")
        : undefined,
    [saveMessagingMutation.error, saveMessagingMutation.isError]
  );
  const workspaceField = messagingForm.register("workspaceId");

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Create Agent</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={createAgentForm.handleSubmit(async (values) => {
              const enabledTools = (values.enabledTools ?? "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean);

              const result = await createAgentMutation.mutateAsync({
                name: values.name,
                systemPrompt: values.systemPrompt,
                enabledTools,
                objectivePrompt: values.objectivePrompt
              });

              createAgentForm.reset();
              if (result.data.run?.id) {
                router.push(`/runs/${encodeURIComponent(result.data.run.id)}`);
              }
              router.refresh();
            })}
          >
            <input
              {...createAgentForm.register("name")}
              placeholder="Agent Name (e.g. Personal Assistant)"
              className="w-full rounded border px-3 py-2 text-sm"
            />
            <div className="border-t pt-2 mt-2">
              <p className="text-sm font-medium mb-1">Agent Configuration</p>
              <textarea
                {...createAgentForm.register("systemPrompt")}
                placeholder="System Prompt (e.g. You are a helpful assistant...)"
                className="h-24 w-full rounded border px-3 py-2 text-sm mb-2"
              />
              <input
                {...createAgentForm.register("enabledTools")}
                placeholder="Enabled Tools (comma-separated, e.g. calendar_list_events, gmail_list_threads)"
                className="w-full rounded border px-3 py-2 text-sm mb-2"
              />
            </div>
            <div className="border-t pt-2 mt-2">
              <p className="text-sm font-medium mb-1">Objective</p>
              <textarea
                {...createAgentForm.register("objectivePrompt")}
                placeholder="Objective (e.g. Find me a time to meet with Brian tomorrow)"
                className="h-24 w-full rounded border px-3 py-2 text-sm mb-2"
              />
            </div>
            <Button type="submit" size="sm" disabled={createAgentMutation.isPending}>
              {createAgentMutation.isPending ? "Creating..." : "Create Agent"}
            </Button>
            {createAgentForm.formState.errors.name ? (
              <p className="text-sm text-destructive">{createAgentForm.formState.errors.name.message}</p>
            ) : null}
            {createAgentError ? <p className="text-sm text-destructive">{createAgentError}</p> : null}
            {createAgentMutation.isSuccess ? (
              <p className="text-sm text-emerald-700">Created {createAgentMutation.data.data.agent.id}</p>
            ) : null}
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
            noValidate
            onSubmit={messagingForm.handleSubmit(async (values) => {
              const response = await saveMessagingMutation.mutateAsync({
                workspaceId: values.workspaceId.trim(),
                notifierCascade: ["slack"],
                slack: {
                  enabled: values.slackEnabled,
                  defaultChannel: values.slackDefaultChannel?.trim() ?? ""
                }
              });

              messagingForm.reset({
                workspaceId: values.workspaceId.trim(),
                slackEnabled: Boolean(response.data?.slack?.enabled),
                slackDefaultChannel: response.data?.slack?.defaultChannel ?? ""
              });
            })}
          >
            <div className="space-y-1">
              <label htmlFor="workspace-id" className="text-sm font-medium">
                Workspace
              </label>
              <input
                id="workspace-id"
                {...workspaceField}
                value={workspaceId}
                onChange={(event) => {
                  workspaceField.onChange(event);
                  setWorkspaceId(event.target.value);
                }}
                placeholder="personal"
                className="w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            {messagingQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading messaging settings...</p>
            ) : null}
            {messagingQuery.isError ? (
              <p className="text-sm text-destructive">
                {toErrorMessage(messagingQuery.error, "Failed to load messaging settings")}
              </p>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...messagingForm.register("slackEnabled")} />
              Enable Slack notifications
            </label>
            <div className="space-y-1">
              <label htmlFor="slack-default-channel" className="text-sm font-medium">
                Slack Default Channel
              </label>
              <input
                id="slack-default-channel"
                {...messagingForm.register("slackDefaultChannel")}
                placeholder="C0123456789"
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Used for waiting-signal questions when Slack is enabled for this workspace.
              </p>
            </div>
            <Button type="submit" size="sm" disabled={saveMessagingMutation.isPending}>
              {saveMessagingMutation.isPending ? "Saving..." : "Save Messaging Settings"}
            </Button>
            {messagingForm.formState.errors.workspaceId ? (
              <p className="text-sm text-destructive">{messagingForm.formState.errors.workspaceId.message}</p>
            ) : null}
            {messagingError ? <p className="text-sm text-destructive">{messagingError}</p> : null}
            {saveMessagingMutation.isSuccess ? (
              <p className="text-sm text-emerald-700">Messaging settings saved</p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
