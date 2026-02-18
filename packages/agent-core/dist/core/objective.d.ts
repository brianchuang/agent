import { MemoryEngine } from "../memory";
import { MemoryItem, RetrievalBudget, RetrievalResult, WorkingMemorySnapshot } from "../types";
import { ObjectiveEventValidator } from "./validation";
export interface ObjectiveEvent {
    type: string;
    threadId: string;
    payload: unknown;
}
export interface ObjectiveRetrievalPlan {
    queryText: string;
    channel?: "email" | "calendar" | "chat";
    tags?: string[];
    accountTier?: "standard" | "priority";
    language?: string;
    withinDays?: number;
    budget: RetrievalBudget;
}
export interface ObjectiveExecutionContext {
    workspace: string;
    objectiveId: string;
    event: ObjectiveEvent;
    memory: MemoryEngine;
    retrieved: RetrievalResult;
    workingMemory?: WorkingMemorySnapshot;
}
export interface ObjectiveResult {
    output?: Record<string, unknown>;
    memoryWrites?: MemoryItem[];
    workingMemoryLines?: string[];
}
export interface ObjectivePlugin {
    id: string;
    validator?: ObjectiveEventValidator;
    planRetrieval(event: ObjectiveEvent): ObjectiveRetrievalPlan | undefined;
    handle(context: ObjectiveExecutionContext): ObjectiveResult;
}
