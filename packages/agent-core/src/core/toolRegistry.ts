import { ValidationRuntimeError } from "./errors";
import {
  ToolExecutionInput,
  ToolMetadata,
  ToolRegistryPort,
  ToolTenantScope
} from "./contracts";

export interface ToolValidationIssue {
  field: string;
  message: string;
}

export interface ToolRegistration {
  name: string;
  description?: string;
  validateArgs: (args: Record<string, unknown>) => ToolValidationIssue[];
  execute: (input: ToolExecutionInput) => unknown;
  isAuthorized?: (scope: ToolTenantScope) => boolean;
}

export class ToolRegistry implements ToolRegistryPort {
  private readonly tools = new Map<string, ToolRegistration>();

  registerTool(tool: ToolRegistration): void {
    if (!tool.name || typeof tool.name !== "string") {
      throw new ValidationRuntimeError("Invalid tool registration: name is required");
    }
    if (typeof tool.validateArgs !== "function") {
      throw new ValidationRuntimeError(
        `Invalid tool registration for ${tool.name}: validateArgs is required`
      );
    }
    if (typeof tool.execute !== "function") {
      throw new ValidationRuntimeError(
        `Invalid tool registration for ${tool.name}: execute handler is required`
      );
    }
    if (this.tools.has(tool.name)) {
      throw new ValidationRuntimeError(`Duplicate tool registration: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);
  }

  listTools(scope: ToolTenantScope): ToolMetadata[] {
    return Array.from(this.tools.values())
      .filter((tool) => this.isAuthorized(tool, scope))
      .map((tool) => ({
        name: tool.name,
        description: tool.description
      }));
  }

  execute(input: ToolExecutionInput): unknown {
    const tool = this.tools.get(input.toolName);
    if (!tool) {
      throw new ValidationRuntimeError(`Unknown tool: ${input.toolName}`);
    }

    const scope: ToolTenantScope = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId
    };
    if (!this.isAuthorized(tool, scope)) {
      throw new ValidationRuntimeError(
        `Tool not authorized for tenant/workspace: ${input.toolName}`
      );
    }

    const issues = tool.validateArgs(input.args);
    if (!Array.isArray(issues)) {
      throw new ValidationRuntimeError(`Invalid tool validator return value: ${input.toolName}`);
    }
    if (issues.length > 0) {
      const detail = issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ");
      throw new ValidationRuntimeError(`Invalid args for tool ${input.toolName}: ${detail}`);
    }

    const execute = tool.execute;
    if (typeof execute !== "function") {
      throw new ValidationRuntimeError(`Missing execute handler for tool: ${input.toolName}`);
    }
    return execute(input);
  }

  private isAuthorized(tool: ToolRegistration, scope: ToolTenantScope): boolean {
    return tool.isAuthorized ? tool.isAuthorized(scope) : true;
  }
}
