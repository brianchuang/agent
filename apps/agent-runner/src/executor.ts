import { 
  AgentRuntime, 
  CalendarListEventsTool, 
  GmailListThreadsTool,
  GmailGetThreadTool,
  GmailCreateDraftTool,
  GmailSendEmailTool,
  InMemoryAgentPersistence,
  ToolRegistry,
  PlannerInputV1,
  PlannerIntent
} from "@agent/core";
import type { JsonValue, WorkflowQueueJob, ObservabilityStore } from "@agent/observability";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { uuidv7 } from "uuidv7";
import { createPlannerScheduleWorkflowTool } from "./schedulerTool";
import {
  createMemorySearchTool,
  createMemoryWriteTool,
  loadLongTermMemorySnapshot
} from "./memoryTools";

export type QueueExecutionAdapter = {
  execute(job: WorkflowQueueJob): Promise<Record<string, JsonValue>>;
};

type InlineAdapterDeps = {
  store: ObservabilityStore;
};

const DEFAULT_LLM_API_BASE_URL =
  process.env.LLM_API_BASE_URL ?? process.env.OPENAI_API_BASE_URL ?? "https://api.groq.com/openai/v1";
const DEFAULT_LLM_MODEL =
  process.env.LLM_MODEL ?? process.env.GROQ_MODEL ?? process.env.OPENAI_MODEL ?? "llama-3.3-70b-versatile";
const DEFAULT_LLM_TEMPERATURE = Number.parseFloat(process.env.LLM_TEMPERATURE ?? "0.1");
const DEFAULT_GROQ_MODEL_CHAIN =
  process.env.GROQ_MODEL_CHAIN ??
  [
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "qwen/qwen3-32b",
    "openai/gpt-oss-20b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.1-8b-instant"
  ].join(",");
const DEFAULT_OPENAI_MODEL_CHAIN = process.env.OPENAI_MODEL_CHAIN ?? "gpt-4o-mini";
const DEFAULT_OPENROUTER_MODEL_CHAIN = process.env.OPENROUTER_MODEL_CHAIN ?? "openai/gpt-4o-mini";
const SHORT_TERM_STEP_LIMIT = Number.parseInt(process.env.SHORT_TERM_STEP_LIMIT ?? "6", 10);
const LONG_TERM_MEMORY_LIMIT = Number.parseInt(process.env.LONG_TERM_MEMORY_LIMIT ?? "5", 10);

type LlmProviderId = "primary" | "groq" | "openai" | "openrouter";

type LlmProviderConfig = {
  providerId: LlmProviderId;
  apiKey: string;
  apiBaseUrl: string;
  models: string[];
  temperature: number;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const SHORT_RATE_LIMIT_RETRY_MS = Number.parseInt(process.env.SHORT_RATE_LIMIT_RETRY_MS ?? "3000", 10);

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function stripCodeFences(input: string): string {
  return input.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function parsePlannerIntent(raw: string): PlannerIntent | null {
  try {
    const parsed = JSON.parse(stripCodeFences(raw)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const intent = parsed as Record<string, unknown>;
    if (intent.type === "tool_call") {
      if (typeof intent.toolName !== "string" || !intent.toolName) return null;
      if (intent.args !== undefined && (typeof intent.args !== "object" || intent.args === null)) return null;
      return {
        type: "tool_call",
        toolName: intent.toolName,
        args: (intent.args as Record<string, unknown>) ?? {}
      };
    }

    if (intent.type === "ask_user") {
      if (typeof intent.question !== "string" || !intent.question.trim()) return null;
      return { type: "ask_user", question: intent.question };
    }

    if (intent.type === "complete") {
      if (
        intent.output !== undefined &&
        (typeof intent.output !== "object" || intent.output === null || Array.isArray(intent.output))
      ) {
        return null;
      }
      return { type: "complete", output: intent.output as Record<string, unknown> | undefined };
    }

    return null;
  } catch {
    return null;
  }
}

function parseModelChain(raw: string | undefined, fallbackSingleModel: string): string[] {
  const source = raw && raw.trim().length > 0 ? raw : fallbackSingleModel;
  return source
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function isRetryableRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("429") ||
    normalized.includes("tpm") ||
    normalized.includes("tpd")
  );
}

function isGroqApiBaseUrl(url: string): boolean {
  return /(^https?:\/\/)?api\.groq\.com/i.test(url.trim());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRetryAfterMs(message: string): number | null {
  const retryAfterMatch = message.match(/retry-after[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
  if (retryAfterMatch) {
    const seconds = Number.parseFloat(retryAfterMatch[1] ?? "");
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
  }

  const minSecMatch = message.match(/try again in\s*([0-9]+)m([0-9]+(?:\.[0-9]+)?)s/i);
  if (minSecMatch) {
    const minutes = Number.parseInt(minSecMatch[1] ?? "", 10);
    const seconds = Number.parseFloat(minSecMatch[2] ?? "");
    if (Number.isFinite(minutes) && Number.isFinite(seconds) && minutes >= 0 && seconds >= 0) {
      return Math.round((minutes * 60 + seconds) * 1000);
    }
  }

  const secMatch = message.match(/try again in\s*([0-9]+(?:\.[0-9]+)?)s/i);
  if (secMatch) {
    const seconds = Number.parseFloat(secMatch[1] ?? "");
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
  }

  return null;
}

function buildProviderChain(): LlmProviderConfig[] {
  const temp = Number.isFinite(DEFAULT_LLM_TEMPERATURE) ? DEFAULT_LLM_TEMPERATURE : 0.1;
  const providers: LlmProviderConfig[] = [];

  const primaryApiKey = process.env.LLM_API_KEY;
  if (primaryApiKey) {
    providers.push({
      providerId: "primary",
      apiKey: primaryApiKey,
      apiBaseUrl: DEFAULT_LLM_API_BASE_URL,
      models: parseModelChain(process.env.LLM_MODEL_CHAIN, DEFAULT_LLM_MODEL),
      temperature: temp
    });
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  if (groqApiKey) {
    providers.push({
      providerId: "groq",
      apiKey: groqApiKey,
      apiBaseUrl: process.env.GROQ_API_BASE_URL ?? "https://api.groq.com/openai/v1",
      models: parseModelChain(process.env.GROQ_MODEL_CHAIN, DEFAULT_GROQ_MODEL_CHAIN),
      temperature: temp
    });
  }

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (openAiApiKey) {
    providers.push({
      providerId: "openai",
      apiKey: openAiApiKey,
      apiBaseUrl: process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com/v1",
      models: parseModelChain(process.env.OPENAI_MODEL_CHAIN, DEFAULT_OPENAI_MODEL_CHAIN),
      temperature: temp
    });
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (openRouterApiKey) {
    providers.push({
      providerId: "openrouter",
      apiKey: openRouterApiKey,
      apiBaseUrl: process.env.OPENROUTER_API_BASE_URL ?? "https://openrouter.ai/api/v1",
      models: parseModelChain(process.env.OPENROUTER_MODEL_CHAIN, DEFAULT_OPENROUTER_MODEL_CHAIN),
      temperature: temp
    });
  }

  const deduped: LlmProviderConfig[] = [];
  const seen = new Map<string, number>();
  for (const provider of providers) {
    const key = `${provider.apiBaseUrl}:${provider.apiKey}`;
    const existingIndex = seen.get(key);
    if (existingIndex === undefined) {
      seen.set(key, deduped.length);
      deduped.push(provider);
      continue;
    }

    const existing = deduped[existingIndex];
    const mergedModels = [...existing.models];
    for (const model of provider.models) {
      if (!mergedModels.includes(model)) mergedModels.push(model);
    }
    deduped[existingIndex] = { ...existing, models: mergedModels };
  }

  return deduped;
}

async function callChatCompletions(input: {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  temperature: number;
  messages: ChatMessage[];
}): Promise<string> {
  const provider = createOpenAI({
    apiKey: input.apiKey,
    baseURL: input.apiBaseUrl.replace(/\/$/, "")
  });
  const { text } = await generateText({
    model: provider(input.model),
    temperature: input.temperature,
    messages: input.messages
  });
  return text ?? "";
}

export function createInlineExecutionAdapter(deps: InlineAdapterDeps): QueueExecutionAdapter {
  return {
    async execute(job) {
      console.log(`[Worker] Executing job ${job.workflowId} for user ${job.tenantId}`);
      
      const agent = await deps.store.getAgent(job.agentId);
      const systemPrompt = agent?.systemPrompt || "You are a helpful agent. You have access to a calendar tool 'calendar_list_events'. If the user asks about schedule/calendar, use it. Output ONLY valid JSON.";
      
      const persistence = new InMemoryAgentPersistence(); // In real app, use Postgres persistence
      const runtime = new AgentRuntime(job.workspaceId, null, undefined, persistence);
      
      // Initialize Tool Registry
      const toolRegistry = new ToolRegistry();
      const enabledTools = new Set(
        agent?.enabledTools || [
          "calendar_list_events",
          "gmail_list_threads",
          "gmail_get_thread",
          "gmail_create_draft",
          "gmail_send_email",
          "planner_schedule_workflow",
          "memory_write",
          "memory_search"
        ]
      );
      enabledTools.add("memory_write");
      enabledTools.add("memory_search");

      if (enabledTools.has("calendar_list_events")) toolRegistry.registerTool(CalendarListEventsTool);
      if (enabledTools.has("gmail_list_threads")) toolRegistry.registerTool(GmailListThreadsTool);
      if (enabledTools.has("gmail_get_thread")) toolRegistry.registerTool(GmailGetThreadTool);
      if (enabledTools.has("gmail_create_draft")) toolRegistry.registerTool(GmailCreateDraftTool);
      if (enabledTools.has("gmail_send_email")) toolRegistry.registerTool(GmailSendEmailTool);
      if (enabledTools.has("planner_schedule_workflow")) {
        toolRegistry.registerTool(
          createPlannerScheduleWorkflowTool({
            store: deps.store,
            defaults: {
              agentId: job.agentId,
              objectivePrompt: job.objectivePrompt,
              threadId: job.threadId
            }
          })
        );
      }
      if (enabledTools.has("memory_write")) {
        toolRegistry.registerTool(createMemoryWriteTool({ store: deps.store }));
      }
      if (enabledTools.has("memory_search")) {
        toolRegistry.registerTool(createMemorySearchTool({ store: deps.store }));
      }

      const llmProviders = buildProviderChain();
      if (llmProviders.length === 0) {
        throw new Error(
          "Missing LLM API configuration. Set at least one of: LLM_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY."
        );
      }

      // Planner wrapper backed by an OpenAI-compatible LLM API with strict JSON planner-intent output.
      const dynamicPlanner = async (input: PlannerInputV1): Promise<PlannerIntent> => {
        const longTermMemory = await loadLongTermMemorySnapshot({
          store: deps.store,
          tenantId: job.tenantId,
          workspaceId: job.workspaceId,
          query: input.objective_prompt,
          maxItems: Number.isFinite(LONG_TERM_MEMORY_LIMIT) ? LONG_TERM_MEMORY_LIMIT : 5
        });
        const recentSteps = input.prior_step_summaries.slice(
          Math.max(0, input.prior_step_summaries.length - Math.max(1, SHORT_TERM_STEP_LIMIT))
        );
        const droppedSteps = Math.max(0, input.prior_step_summaries.length - recentSteps.length);
        const allowedTools = new Set(input.available_tools.map((tool) => tool.name));
        const allowedToolNames = Array.from(allowedTools).join(", ");
        const availableTools = input.available_tools
          .map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`)
          .join("\n");
        const priorSummaries = JSON.stringify(recentSteps);
        const longTermSummary = JSON.stringify(
          longTermMemory.map((record) => ({
            id: record.id,
            summary: record.summary,
            tags: record.tags,
            createdAt: record.createdAt
          }))
        );
        const plannerPrompt = [
          "Return ONLY a single valid JSON object as the next planner intent.",
          "Allowed shape:",
          `{"type":"tool_call","toolName":"<tool name>","args":{}}`,
          `{"type":"ask_user","question":"<string>"}`,
          `{"type":"complete","output":{"message":"<string>"}}`,
          "",
          "Rules:",
          "- Use only tools listed below.",
          "- Prefer tool_call when a tool can make progress.",
          "- Use memory_search when you need additional historical facts not in the working set.",
          "- Use memory_write to persist durable facts that should help future runs.",
          "- For deferred or recurring work, call planner_schedule_workflow first, then complete.",
          "- Use ask_user when missing required user details.",
          "- Use complete only when objective is done or cannot proceed safely.",
          "",
          "Planner Input:",
          `objective_prompt: ${input.objective_prompt}`,
          `step_index: ${input.step_index}`,
          `available_tools:\n${availableTools || "(none)"}`,
          `short_term_recent_steps:\n${priorSummaries}`,
          `short_term_dropped_count: ${droppedSteps}`,
          `long_term_memory:\n${longTermSummary}`
        ].join("\n");
        console.log(
          `[Planner] estimated_tokens=${estimateTokens(systemPrompt) + estimateTokens(plannerPrompt)} steps=${recentSteps.length} long_term_memories=${longTermMemory.length}`
        );

        const attemptErrors: string[] = [];
        const deferredGroqFallbacks: Array<{ provider: LlmProviderConfig; model: string; cause: string }> = [];
        const deferredGroqSeen = new Set<string>();
        const shortRetryMs =
          Number.isFinite(SHORT_RATE_LIMIT_RETRY_MS) && SHORT_RATE_LIMIT_RETRY_MS >= 0
            ? SHORT_RATE_LIMIT_RETRY_MS
            : 3000;

        for (const provider of llmProviders) {
          for (const model of provider.models) {
            try {
              const content = await callChatCompletions({
                apiKey: provider.apiKey,
                apiBaseUrl: provider.apiBaseUrl,
                model,
                temperature: provider.temperature,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: plannerPrompt }
                ]
              });

              const parsedIntent = parsePlannerIntent(content);
              if (parsedIntent) {
                if (parsedIntent.type === "tool_call" && !allowedTools.has(parsedIntent.toolName)) {
                  attemptErrors.push(
                    `[${provider.providerId}/${model}] unknown_tool: ${parsedIntent.toolName}`
                  );
                  try {
                    const repairPrompt = [
                      plannerPrompt,
                      "",
                      `Previous model output (invalid because of unavailable tool "${parsedIntent.toolName}")`,
                      stripCodeFences(content),
                      "",
                      `Return only JSON and use only these tools: ${allowedToolNames || "(none)"}.`
                    ].join("\n");
                    const repairContent = await callChatCompletions({
                      apiKey: provider.apiKey,
                      apiBaseUrl: provider.apiBaseUrl,
                      model,
                      temperature: provider.temperature,
                      messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: repairPrompt }
                      ]
                    });
                    const repairedIntent = parsePlannerIntent(repairContent);
                    if (repairedIntent) {
                      if (
                        repairedIntent.type === "tool_call" &&
                        !allowedTools.has(repairedIntent.toolName)
                      ) {
                        attemptErrors.push(
                          `[${provider.providerId}/${model}] unknown_tool_after_repair: ${repairedIntent.toolName}`
                        );
                      } else {
                        return repairedIntent;
                      }
                    } else {
                      attemptErrors.push(
                        `[${provider.providerId}/${model}] invalid_planner_json_after_repair: ${stripCodeFences(repairContent).slice(0, 240)}`
                      );
                    }
                  } catch (repairError) {
                    const repairMessage =
                      repairError instanceof Error ? repairError.message : String(repairError);
                    attemptErrors.push(
                      `[${provider.providerId}/${model}] repair_failed: ${repairMessage}`
                    );
                  }
                  continue;
                }
                return parsedIntent;
              }

              attemptErrors.push(
                `[${provider.providerId}/${model}] invalid_planner_json: ${stripCodeFences(content).slice(0, 240)}`
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              attemptErrors.push(`[${provider.providerId}/${model}] ${message}`);
              if (!isRetryableRateLimitError(error)) {
                break;
              }

              const retryAfterMs = extractRetryAfterMs(message);
              if (retryAfterMs !== null && retryAfterMs > 0 && retryAfterMs <= shortRetryMs) {
                await sleep(retryAfterMs);
                continue;
              }

              // On Groq rate limits, prefer shifting to non-Groq providers first, then try smaller Groq models.
              if (isGroqApiBaseUrl(provider.apiBaseUrl)) {
                const currentIndex = provider.models.indexOf(model);
                for (const fallbackModel of provider.models.slice(currentIndex + 1)) {
                  const fallbackKey = `${provider.providerId}:${provider.apiBaseUrl}:${fallbackModel}`;
                  if (deferredGroqSeen.has(fallbackKey)) continue;
                  deferredGroqSeen.add(fallbackKey);
                  deferredGroqFallbacks.push({
                    provider,
                    model: fallbackModel,
                    cause: `[${provider.providerId}/${model}] rate_limited`
                  });
                }
              }
              break;
            }
          }
        }

        for (const fallback of deferredGroqFallbacks) {
          try {
            const content = await callChatCompletions({
              apiKey: fallback.provider.apiKey,
              apiBaseUrl: fallback.provider.apiBaseUrl,
              model: fallback.model,
              temperature: fallback.provider.temperature,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: plannerPrompt }
              ]
            });

            const parsedIntent = parsePlannerIntent(content);
            if (parsedIntent) {
              if (parsedIntent.type === "tool_call" && !allowedTools.has(parsedIntent.toolName)) {
                attemptErrors.push(
                  `[${fallback.provider.providerId}/${fallback.model}] unknown_tool: ${parsedIntent.toolName}`
                );
                try {
                  const repairPrompt = [
                    plannerPrompt,
                    "",
                    `Previous model output (invalid because of unavailable tool "${parsedIntent.toolName}")`,
                    stripCodeFences(content),
                    "",
                    `Return only JSON and use only these tools: ${allowedToolNames || "(none)"}.`
                  ].join("\n");
                  const repairContent = await callChatCompletions({
                    apiKey: fallback.provider.apiKey,
                    apiBaseUrl: fallback.provider.apiBaseUrl,
                    model: fallback.model,
                    temperature: fallback.provider.temperature,
                    messages: [
                      { role: "system", content: systemPrompt },
                      { role: "user", content: repairPrompt }
                    ]
                  });
                  const repairedIntent = parsePlannerIntent(repairContent);
                  if (repairedIntent) {
                    if (repairedIntent.type === "tool_call" && !allowedTools.has(repairedIntent.toolName)) {
                      attemptErrors.push(
                        `[${fallback.provider.providerId}/${fallback.model}] unknown_tool_after_repair: ${repairedIntent.toolName}`
                      );
                    } else {
                      return repairedIntent;
                    }
                  } else {
                    attemptErrors.push(
                      `[${fallback.provider.providerId}/${fallback.model}] invalid_planner_json_after_repair: ${stripCodeFences(repairContent).slice(0, 240)}`
                    );
                  }
                } catch (repairError) {
                  const repairMessage = repairError instanceof Error ? repairError.message : String(repairError);
                  attemptErrors.push(
                    `[${fallback.provider.providerId}/${fallback.model}] repair_failed: ${repairMessage}`
                  );
                }
                continue;
              }
              return parsedIntent;
            }

            attemptErrors.push(
              `[${fallback.provider.providerId}/${fallback.model}] invalid_planner_json: ${stripCodeFences(content).slice(0, 240)}`
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            attemptErrors.push(
              `[${fallback.provider.providerId}/${fallback.model}] ${fallback.cause}; ${message}`
            );
          }
        }

        throw new Error(`LLM chain exhausted without valid planner intent. ${attemptErrors.join(" | ")}`);
      };

      try {
          const result = await runtime.runPlannerLoop(
            {
              requestId: uuidv7(),
              schemaVersion: "v1",
              tenantId: job.tenantId, // Passed as userId to tools
              workspaceId: job.workspaceId,
              workflowId: job.workflowId,
              threadId: job.workflowId, // Simple 1:1 mapping for now
              occurredAt: new Date().toISOString(),
              objective_prompt: job.objectivePrompt
            },
            {
              planner: dynamicPlanner,
              toolRegistry,
              contextProvider: {
                memory: () => ({
                  scheduler_defaults: {
                    agent_id: job.agentId,
                    thread_id: job.threadId,
                    objective_prompt: job.objectivePrompt,
                    timezone: "UTC"
                  },
                  memory_tiers: {
                    short_term_window_steps: Math.max(1, SHORT_TERM_STEP_LIMIT),
                    long_term_memory_tool: "memory_search",
                    long_term_write_tool: "memory_write"
                  }
                })
              }
            }
          );

          return {
            status: result.status,
            workflowId: job.workflowId,
            result: (result.completion || "No completion output") as any
          };
      } catch (error) {
          console.error("Agent Execution Failed:", error);
          throw error;
      }
    }
  };
}
