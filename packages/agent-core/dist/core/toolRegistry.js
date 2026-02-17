"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolRegistry = void 0;
const errors_1 = require("./errors");
class ToolRegistry {
    tools = new Map();
    registerTool(tool) {
        if (!tool.name || typeof tool.name !== "string") {
            throw new errors_1.ValidationRuntimeError("Invalid tool registration: name is required");
        }
        if (typeof tool.validateArgs !== "function") {
            throw new errors_1.ValidationRuntimeError(`Invalid tool registration for ${tool.name}: validateArgs is required`);
        }
        if (typeof tool.execute !== "function") {
            throw new errors_1.ValidationRuntimeError(`Invalid tool registration for ${tool.name}: execute handler is required`);
        }
        if (this.tools.has(tool.name)) {
            throw new errors_1.ValidationRuntimeError(`Duplicate tool registration: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
    }
    listTools(scope) {
        return Array.from(this.tools.values())
            .filter((tool) => this.isAuthorized(tool, scope))
            .map((tool) => ({
            name: tool.name,
            description: tool.description
        }));
    }
    execute(input) {
        const tool = this.tools.get(input.toolName);
        if (!tool) {
            throw new errors_1.ValidationRuntimeError(`Unknown tool: ${input.toolName}`);
        }
        const scope = {
            tenantId: input.tenantId,
            workspaceId: input.workspaceId
        };
        if (!this.isAuthorized(tool, scope)) {
            throw new errors_1.ValidationRuntimeError(`Tool not authorized for tenant/workspace: ${input.toolName}`);
        }
        const issues = tool.validateArgs(input.args);
        if (!Array.isArray(issues)) {
            throw new errors_1.ValidationRuntimeError(`Invalid tool validator return value: ${input.toolName}`);
        }
        if (issues.length > 0) {
            const detail = issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ");
            throw new errors_1.ValidationRuntimeError(`Invalid args for tool ${input.toolName}: ${detail}`);
        }
        const execute = tool.execute;
        if (typeof execute !== "function") {
            throw new errors_1.ValidationRuntimeError(`Missing execute handler for tool: ${input.toolName}`);
        }
        return execute(input);
    }
    isAuthorized(tool, scope) {
        return tool.isAuthorized ? tool.isAuthorized(scope) : true;
    }
}
exports.ToolRegistry = ToolRegistry;
