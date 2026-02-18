"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api/client";
import { createAgentRequestSchema, createAgentResponseSchema, CreateAgentRequest } from "@/lib/api/schemas";
import { agentKeys } from "@/lib/query/keys";

export function useCreateAgentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateAgentRequest) => {
      const parsedPayload = createAgentRequestSchema.parse(payload);
      return apiPost("/api/agents", parsedPayload, createAgentResponseSchema);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.list() });
    }
  });
}
