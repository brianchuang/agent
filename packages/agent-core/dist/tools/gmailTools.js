"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailSendEmailTool = exports.GmailCreateDraftTool = exports.GmailGetThreadTool = exports.GmailListThreadsTool = void 0;
const googleGmail_1 = require("../connections/googleGmail");
exports.GmailListThreadsTool = {
    name: "gmail_list_threads",
    description: "List recent email threads from your inbox.",
    validateArgs: (args) => {
        const issues = [];
        if (args.maxResults !== undefined && typeof args.maxResults !== "number") {
            issues.push({ field: "maxResults", message: "maxResults must be a number" });
        }
        return issues;
    },
    execute: async (input) => {
        const userId = input.tenantId;
        if (!userId || userId === "default")
            throw new Error("User ID required for Gmail tools");
        const maxResults = input.args.maxResults || 5;
        const connection = new googleGmail_1.GoogleGmailConnection(userId);
        return await connection.listThreads(maxResults);
    }
};
exports.GmailGetThreadTool = {
    name: "gmail_get_thread",
    description: "Get details and messages of a specific email thread.",
    validateArgs: (args) => {
        const issues = [];
        if (!args.threadId || typeof args.threadId !== "string") {
            issues.push({ field: "threadId", message: "threadId is required and must be a string" });
        }
        return issues;
    },
    execute: async (input) => {
        const userId = input.tenantId;
        if (!userId || userId === "default")
            throw new Error("User ID required for Gmail tools");
        const threadId = input.args.threadId;
        const connection = new googleGmail_1.GoogleGmailConnection(userId);
        return await connection.getThread(threadId);
    }
};
exports.GmailCreateDraftTool = {
    name: "gmail_create_draft",
    description: "Create a draft email.",
    validateArgs: (args) => {
        const issues = [];
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
    execute: async (input) => {
        const userId = input.tenantId;
        if (!userId || userId === "default")
            throw new Error("User ID required for Gmail tools");
        const to = input.args.to;
        const subject = input.args.subject;
        const body = input.args.body;
        const connection = new googleGmail_1.GoogleGmailConnection(userId);
        return await connection.createDraft(to, subject, body);
    }
};
exports.GmailSendEmailTool = {
    name: "gmail_send_email",
    description: "Send an email immediately.",
    validateArgs: (args) => {
        const issues = [];
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
    execute: async (input) => {
        const userId = input.tenantId;
        if (!userId || userId === "default")
            throw new Error("User ID required for Gmail tools");
        const to = input.args.to;
        const subject = input.args.subject;
        const body = input.args.body;
        const connection = new googleGmail_1.GoogleGmailConnection(userId);
        return await connection.sendEmail(to, subject, body);
    }
};
