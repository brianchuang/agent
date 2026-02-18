const test = require("node:test");
const assert = require("node:assert/strict");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { uuidv7 } = require("uuidv7");

const { AgentRuntime } = require("../dist/core/agentRuntime");
const { InMemoryAgentPersistence } = require("../dist/core/persistence/repositories");

// Load .env.local manually since dotenv is not installed
try {
  const envPath = path.resolve(__dirname, "../../../.env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach(line => {
      const match = line.match(/^GROQ_API_KEY=(.*)$/);
      if (match) {
        process.env.GROK_API_KEY = match[1].trim();
      } else if (line.startsWith("GROQ_API_KEY=")) {
          process.env.GROK_API_KEY = line.split("=")[1].trim();
      }
    });
  }
} catch (e) {
  console.warn("Failed to load .env.local", e);
}

// Simple LLM API client (Supports Groq and xAI)
async function callLLM(messages) {
  let apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error("GROK_API_KEY not found in environment");
  }

  let endpoint = "https://api.x.ai/v1/chat/completions";
  let model = "grok-beta";

  // Detect Groq key
  if (apiKey.startsWith("gsk_")) {
    if (apiKey.length > 60) {
       apiKey = apiKey.substring(0, 56);
    }
    endpoint = "https://api.groq.com/openai/v1/chat/completions";
    model = "llama-3.3-70b-versatile";
    console.log("Detected Groq API Key. Using model:", model);
  } else {
    // Assume xAI
    console.log("Detected xAI API Key (or unknown). Using model:", model);
  }

  const payload = JSON.stringify({
    model: model,
    messages: messages,
    stream: false,
    temperature: 0.7
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`API Error: ${res.statusCode} ${data}`));
            return;
          }
          try {
            const body = JSON.parse(data);
            const content = body.choices[0].message.content;
            resolve(content);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Planner that uses LLM to decide next step
async function llmPlanner(input) {
  // Construct prompt from input
  const history = input.prior_step_summaries.map(step => {
    if (step.intentType === "ask_user") {
      return { role: "assistant", content: step.waitingQuestion || "Question?" };
    }
    if (step.intentType === "complete") {
      return { role: "assistant", content: "Interview complete." };
    }
    return { role: "assistant", content: `[Step ${step.intentType}]` };
  });

  const messages = [
    { role: "system", content: "You are an expert interviewer. Your goal is to help the user prepare for a systems design interview. Ask one question at a time. If the user answers well, ask a follow-up. If they struggle, give a hint. If the interview is done (3-4 turns), allow them to complete." },
    { role: "user", content: input.objective_prompt },
    ...history
  ];
  
  if (input.prior_step_summaries.length === 0) {
      const response = await callLLM(messages);
      return { type: "ask_user", question: response };
  }
  
  return { type: "complete", output: { result: "Mock completion for integration test" } };
}

test("Integration: LLM API Connectivity", { skip: !process.env.GROK_API_KEY }, async (t) => {
  try {
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime("agent-interview", null, undefined, persistence);
    
    const result = await runtime.runPlannerLoop(
      {
        requestId: uuidv7(),
        schemaVersion: "v1",
        tenantId: "tenant-int",
        workspaceId: "agent-interview",
        workflowId: "wf-int-001",
        threadId: "thread-int",
        occurredAt: new Date().toISOString(),
        objective_prompt: "Help me prepare for a coding interview."
      },
      {
        planner: llmPlanner
      }
    );
    
    console.log("LLM Planner Initial Result:", result.status, result.waitingQuestion);
    assert.ok(result.status === "waiting_signal" || result.status === "completed");
  } catch (err) {
    if (err.message && (err.message.includes("Incorrect API key") || err.message.includes("Model not found") || err.message.includes("API Error: 401"))) {
      t.skip(`Skipping integration test due to API error: ${err.message}`);
      return;
    }
    throw err;
  }
});
