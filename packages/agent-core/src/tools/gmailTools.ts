import { ToolExecutionInput } from "../core/contracts";
import { ToolRegistration, ToolValidationIssue } from "../core/toolRegistry";
import { GoogleGmailConnection } from "../connections/googleGmail";

export const GmailListThreadsTool: ToolRegistration = {
  name: "gmail_list_threads",
  description: "List recent email threads from your inbox.",
  
  validateArgs: (args: Record<string, unknown>): ToolValidationIssue[] => {
    const issues: ToolValidationIssue[] = [];
    if (args.maxResults !== undefined && typeof args.maxResults !== "number") {
      issues.push({ field: "maxResults", message: "maxResults must be a number" });
    }
    return issues;
  },

  execute: async (input: ToolExecutionInput) => {
    const userId = input.tenantId;
    if (!userId || userId === "default") throw new Error("User ID required for Gmail tools");

    const maxResults = (input.args.maxResults as number) || 5;
    const connection = new GoogleGmailConnection(userId);
    return await connection.listThreads(maxResults);
  }
};

export const GmailGetThreadTool: ToolRegistration = {
  name: "gmail_get_thread",
  description: "Get details and messages of a specific email thread.",
  
  validateArgs: (args: Record<string, unknown>): ToolValidationIssue[] => {
    const issues: ToolValidationIssue[] = [];
    if (!args.threadId || typeof args.threadId !== "string") {
      issues.push({ field: "threadId", message: "threadId is required and must be a string" });
    }
    return issues;
  },

  execute: async (input: ToolExecutionInput) => {
    const userId = input.tenantId;
    if (!userId || userId === "default") throw new Error("User ID required for Gmail tools");

    const threadId = input.args.threadId as string;
    const connection = new GoogleGmailConnection(userId);
    return await connection.getThread(threadId);
  }
};

export const GmailCreateDraftTool: ToolRegistration = {
  name: "gmail_create_draft",
  description: "Create a draft email.",
  
  validateArgs: (args: Record<string, unknown>): ToolValidationIssue[] => {
    const issues: ToolValidationIssue[] = [];
    if (!args.to || typeof args.to !== "string") {
      issues.push({ field: "to", message: "to address is required" });
    }
    if (!args.subject || typeof args.subject !== "string") {
      issues.push({ field: "subject", message: "subject is required" });
    }
    if (!args.body || typeof args.body !== "string") {
      issues.push({ field: "body", message: "body is required" });
    }
    return issues;
  },

  execute: async (input: ToolExecutionInput) => {
    const userId = input.tenantId;
    if (!userId || userId === "default") throw new Error("User ID required for Gmail tools");

    const to = input.args.to as string;
    const subject = input.args.subject as string;
    const body = input.args.body as string;

    const connection = new GoogleGmailConnection(userId);
    return await connection.createDraft(to, subject, body);
  }
};

export const GmailSendEmailTool: ToolRegistration = {
  name: "gmail_send_email",
  description: "Send an email immediately.",
  
  validateArgs: (args: Record<string, unknown>): ToolValidationIssue[] => {
    const issues: ToolValidationIssue[] = [];
    if (!args.to || typeof args.to !== "string") {
      issues.push({ field: "to", message: "to address is required" });
    }
    if (!args.subject || typeof args.subject !== "string") {
      issues.push({ field: "subject", message: "subject is required" });
    }
    if (!args.body || typeof args.body !== "string") {
      issues.push({ field: "body", message: "body is required" });
    }
    return issues;
  },

  execute: async (input: ToolExecutionInput) => {
    const userId = input.tenantId;
    if (!userId || userId === "default") throw new Error("User ID required for Gmail tools");

    const to = input.args.to as string;
    const subject = input.args.subject as string;
    const body = input.args.body as string;

    const connection = new GoogleGmailConnection(userId);
    return await connection.sendEmail(to, subject, body);
  }
};
