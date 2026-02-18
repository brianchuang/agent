export const messagingKeys = {
  all: ["messaging"] as const,
  byWorkspace: (workspaceId: string) => [...messagingKeys.all, "workspace", workspaceId] as const
};

export const agentKeys = {
  all: ["agents"] as const,
  list: () => [...agentKeys.all, "list"] as const
};
