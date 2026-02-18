"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/lib/api/client";
import {
  messagingSettingsRequestSchema,
  MessagingSettingsRequest,
  messagingSettingsResponseSchema
} from "@/lib/api/schemas";
import { messagingKeys } from "@/lib/query/keys";

function normalizeWorkspaceId(workspaceId: string) {
  const trimmed = workspaceId.trim();
  return trimmed.length > 0 ? trimmed : "personal";
}

export function useMessagingSettingsQuery(workspaceId: string) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);

  return useQuery({
    queryKey: messagingKeys.byWorkspace(normalizedWorkspaceId),
    queryFn: () =>
      apiGet(
        `/api/messaging?workspaceId=${encodeURIComponent(normalizedWorkspaceId)}`,
        messagingSettingsResponseSchema
      ),
    select: (response) => response.data
  });
}

export function useSaveMessagingSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: MessagingSettingsRequest) => {
      const parsedPayload = messagingSettingsRequestSchema.parse(payload);
      return apiPut("/api/messaging", parsedPayload, messagingSettingsResponseSchema);
    },
    onSuccess: (response, payload) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(payload.workspaceId);
      queryClient.setQueryData(messagingKeys.byWorkspace(normalizedWorkspaceId), response);
      void queryClient.invalidateQueries({ queryKey: messagingKeys.byWorkspace(normalizedWorkspaceId) });
    }
  });
}
