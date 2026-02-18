import { z } from "zod";

const messagingChannelTypeSchema = z.enum(["web_ui", "slack"]);

export const slackSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  defaultChannel: z.string().optional()
});

export const messagingSettingsSchema = z.object({
  notifierCascade: z.array(messagingChannelTypeSchema).optional(),
  slack: slackSettingsSchema.optional()
});

export const messagingSettingsResponseSchema = z.object({
  data: messagingSettingsSchema.nullable()
});

export const messagingSettingsRequestSchema = z.object({
  workspaceId: z.string().trim().min(1),
  notifierCascade: z.array(messagingChannelTypeSchema).default(["web_ui", "slack"]),
  slack: z.object({
    enabled: z.boolean(),
    defaultChannel: z.string().optional()
  })
});

export const createAgentResponseSchema = z.object({
  data: z.object({
    agent: z.object({ id: z.string() }),
    run: z
      .object({
        id: z.string()
      })
      .optional(),
    events: z
      .array(
        z.object({
          tenantId: z.string(),
          workspaceId: z.string()
        })
      )
      .optional()
  })
});

export const createAgentRequestSchema = z.object({
  name: z.string().trim().min(1, "Agent name is required"),
  systemPrompt: z.string().optional(),
  enabledTools: z.array(z.string()).optional(),
  objectivePrompt: z.string().optional()
});

export const inboxMessageSchema = z.object({
  id: z.string(),
  runId: z.string(),
  threadId: z.string(),
  workflowId: z.string(),
  ts: z.string(),
  role: z.enum(["user", "agent"]),
  text: z.string()
});

export const inboxThreadSchema = z.object({
  threadId: z.string(),
  workflowId: z.string(),
  runId: z.string(),
  agentId: z.string(),
  objectivePrompt: z.string().optional(),
  lastMessage: z.string(),
  lastMessageAt: z.string(),
  unreadCount: z.number()
});

export const inboxThreadsResponseSchema = z.object({
  data: z.array(inboxThreadSchema)
});

export const inboxMessagesResponseSchema = z.object({
  data: z.array(inboxMessageSchema)
});

export const sendInboxMessageRequestSchema = z.object({
  workspaceId: z.string().trim().min(1),
  message: z.string().trim().min(1, "Message is required"),
  threadId: z.string().optional(),
  agentId: z.string().optional()
});

export const sendInboxMessageResponseSchema = z.object({
  data: z.object({
    threadId: z.string(),
    run: z.object({
      id: z.string(),
      agentId: z.string(),
      status: z.string()
    })
  })
});

export const markInboxReadRequestSchema = z.object({
  workspaceId: z.string().trim().min(1),
  readAt: z.string().optional()
});

export const markInboxReadResponseSchema = z.object({
  data: z.object({
    threadId: z.string(),
    readAt: z.string()
  })
});

export const runEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  ts: z.string(),
  type: z.string(),
  level: z.string(),
  message: z.string(),
  payload: z.unknown().optional()
});

export const runEventsResponseSchema = z.object({
  data: z.array(runEventSchema)
});

export type MessagingSettings = z.infer<typeof messagingSettingsSchema>;
export type MessagingSettingsRequest = z.infer<typeof messagingSettingsRequestSchema>;
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;
export type CreateAgentResponse = z.infer<typeof createAgentResponseSchema>;
export type SendInboxMessageRequest = z.infer<typeof sendInboxMessageRequestSchema>;
