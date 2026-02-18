import { ToolExecutionInput, ToolMetadata, ToolRegistryPort, ToolTenantScope } from "./contracts";
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
export declare class ToolRegistry implements ToolRegistryPort {
    private readonly tools;
    registerTool(tool: ToolRegistration): void;
    listTools(scope: ToolTenantScope): ToolMetadata[];
    execute(input: ToolExecutionInput): unknown;
    private isAuthorized;
}
