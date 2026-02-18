const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { Groq } = require("groq-sdk");

// Load compiled modules
const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");
const { ToolRegistry } = require("../dist/core/toolRegistry");
const { google } = require("googleapis");

/**
 * GoogleCalendarConnection (Inline for immediate execution without rebuild)
 */
class GoogleCalendarConnection {
  constructor() {
    // Uses GOOGLE_APPLICATION_CREDENTIALS or default auth
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  async listUpcomingEvents(maxResults = 10) {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const res = await this.calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: nextWeek.toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items || []).map((event) => ({
      id: event.id,
      subject: event.summary,
      startTime: event.start.dateTime || event.start.date,
      endTime: event.end.dateTime || event.end.date,
      location: event.location,
      description: event.description
    }));
  }
}

// Load Environment Variables
try {
  const paths = [
    path.resolve(__dirname, "../../.env.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../../.env.local")
  ];
  
  for (const envPath of paths) {
    if (fs.existsSync(envPath)) {
      console.log(`[Setup] Loading environment from ${envPath}`);
      const envContent = fs.readFileSync(envPath, "utf-8");
      
      envContent.split("\n").forEach(line => {
        if (!line || line.startsWith("#")) return; // Skip comments

        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const keyName = match[1].trim();
            let keyValue = match[2].trim();

            // Strip quotes
            if ((keyValue.startsWith('"') && keyValue.endsWith('"')) || (keyValue.startsWith("'") && keyValue.endsWith("'"))) {
                keyValue = keyValue.slice(1, -1);
            }

            if (keyName === "GROQ_API_KEY") {
                process.env.GROK_API_KEY = keyValue;
                console.log(`[Debug] Loaded GROQ_API_KEY: Length=${keyValue.length}, Start=${keyValue.substring(0, 4)}..., End=...${keyValue.substring(keyValue.length - 4)}`);
                console.log(`[Debug] First 5 char codes: ${keyValue.split('').slice(0, 5).map(c => c.charCodeAt(0))}`);
            } else if (keyName === "GOOGLE_APPLICATION_CREDENTIALS") {
                process.env.GOOGLE_APPLICATION_CREDENTIALS = keyValue;
                console.log(`[Debug] Loaded GOOGLE_APPLICATION_CREDENTIALS: ${keyValue}`);
            }
        }
      });
      break; 
    }
  }
} catch (e) {
  console.warn("Failed to load .env.local", e);
}

// LLM Client using Groq SDK
const groq = new Groq({ apiKey: process.env.GROK_API_KEY });

async function callLLM(messages) {
  try {
    const completion = await groq.chat.completions.create({
      messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
    });
    return completion.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("Groq SDK Error:", error.message);
    throw error;
  }
}

// Tool: Research via Wikipedia
async function searchWikipedia(query) {
  return new Promise((resolve, reject) => {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const body = JSON.parse(data);
          const results = body.query?.search?.map(s => ({
            title: s.title,
            snippet: s.snippet.replace(/<[^>]*>?/gm, "") // Strip HTML
          })) || [];
          resolve(results.slice(0, 3));
        } catch (err) {
            resolve([]);
        }
      });
    }).on("error", (err) => resolve([]));
  });
}

// Planner Implementation
async function llmPlanner(input) {
  console.log(`\n[Planner] Reviewing history (${input.prior_step_summaries.length} steps)...`);
  
  const toolsDescription = 
  `Available Tools:
  - calendar.list_events: Get upcoming interviews from Google Calendar. Args: { query: string (optional) }
  - research.search: Search Wikipedia for a topic. Args: { query: string }
  - document.create: Create a markdown document. Args: { title: string, content: string }
  `;

  const history = input.prior_step_summaries.map((step, index) => {
    let content = `Step ${index + 1}: Executed ${step.intentType}`;
    if (step.intentType === "tool_call") {
        content += ` (Tool: ${step.toolName || "unknown"})`;
        if (step.toolResult) {
            content += `\nResult: ${JSON.stringify(step.toolResult).substring(0, 500)}...`; 
        }
    }
    return { role: "user", content: `History: ${content}` };
  });

  const systemPrompt = `You are a helpful agent assisting with interview preparation.
  Your goal is to:
  1. Find upcoming interviews in the calendar (tool: calendar.list_events).
  2. Research the topic of the interview (tool: research.search).
  3. Create a briefing document with your research (tool: document.create).
  4. Complete the task when the document is created.
  
  ${toolsDescription}
  
  Respond with a JSON object ONLY.
  Format for tool call: { "type": "tool_call", "toolName": "name", "args": { ... } }
  Format for complete: { "type": "complete", "output": { "message": "Done" } }
  `;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input.objective_prompt },
    ...history
  ];

  const response = await callLLM(messages);
  console.log(`[LLM Output]: ${response}`);

  try {
    const cleanJson = response.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleanJson);
  } catch (e) {
    console.error("Failed to parse LLM response:", response);
    return { type: "complete", output: { error: "Failed to parse planner output" } };
  }
}

async function main() {
  const persistence = new InMemoryAgentPersistence();
  const runtime = new AgentRuntime("real-interview-agent", null, undefined, persistence);
  const registry = new ToolRegistry();

  // 1. Register Real Google Calendar Tool
  const googleCalendar = new GoogleCalendarConnection();
  
  registry.registerTool({
    name: "calendar.list_events",
    description: "List events from Google Calendar",
    validateArgs: () => [],
    execute: async ({ args }) => {
      console.log("[Tool] Querying Google Calendar...");
      try {
        const events = await googleCalendar.listUpcomingEvents();
        console.log(`[Tool] Found ${events.length} Google Calendar events.`);
        return { events };
      } catch (err) {
        console.error("[Tool] Google Calendar API Error:", err.message);
        return { 
            events: [], 
            error: "Failed to access Google Calendar. Ensure GOOGLE_APPLICATION_CREDENTIALS is set." 
        };
      }
    }
  });

  // 2. Register Real Research Tool
  registry.registerTool({
    name: "research.search",
    description: "Search Wikipedia",
    validateArgs: (args) => {
        if (!args.query) return [{ field: "query", message: "Missing query" }];
        return [];
    },
    execute: async ({ args }) => {
      console.log(`[Tool] Searching Wikipedia for: ${args.query}...`);
      const results = await searchWikipedia(args.query);
      return { results };
    }
  });

  // 3. Register Real Document Tool
  registry.registerTool({
    name: "document.create",
    description: "Write a document to disk",
    validateArgs: (args) => {
        if (!args.title || !args.content) return [{ field: "args", message: "Missing title or content" }];
        return [];
    },
    execute: async ({ args }) => {
      console.log(`[Tool] Creating document: ${args.title}...`);
      const fileName = `${args.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.md`;
      const filePath = path.resolve(__dirname, "../", fileName);
      fs.writeFileSync(filePath, `# ${args.title}\n\n${args.content}`);
      console.log(`[Tool] Wrote to ${filePath}`);
      return { success: true, path: filePath };
    }
  });

  console.log("Starting Real Interview Preparation Agent...");
  
  const result = await runtime.runPlannerLoop(
    {
      requestId: crypto.randomUUID(),
      schemaVersion: "v1",
      tenantId: "tenant-real",
      workspaceId: "real-interview-agent",
      workflowId: `wf-${crypto.randomUUID()}`,
      threadId: "thread-real",
      occurredAt: new Date().toISOString(),
      objective_prompt: "Help me prepare for my interviews"
    },
    {
      planner: llmPlanner,
      toolRegistry: registry,
      maxSteps: 10
    }
  );

  console.log("\nWorkflow Finished!");
  console.log("Final Status:", result.status);
  console.log("Completion Output:", result.completion);
}

main().catch(console.error);
