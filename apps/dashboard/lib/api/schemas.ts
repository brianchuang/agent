import { z } from "zod";

export const slackSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  defaultChannel: z.string().optional()
});

export const messagingSettingsSchema = z.object({
  notifierCascade: z.array(z.literal("slack")).optional(),
  slack: slackSettingsSchema.optional()
});

export const messagingSettingsResponseSchema = z.object({
  data: messagingSettingsSchema.nullable()
});

export const messagingSettingsRequestSchema = z.object({
  workspaceId: z.string().trim().min(1),
  notifierCascade: z.array(z.literal("slack")).default(["slack"]),
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

export type MessagingSettings = z.infer<typeof messagingSettingsSchema>;
export type MessagingSettingsRequest = z.infer<typeof messagingSettingsRequestSchema>;
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;
export type CreateAgentResponse = z.infer<typeof createAgentResponseSchema>;
