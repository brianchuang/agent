import { MemoryItem, PolicyContext, PolicyRule, RetrievalBudget, RetrievalQuery, RetrievalResult, WorkingMemorySnapshot } from "./types";
export declare class MemoryEngine {
    private readonly policies;
    private readonly items;
    private readonly workingMemory;
    addPolicy(rule: PolicyRule): void;
    addMemory(item: MemoryItem): void;
    markUsed(itemId: string, success: boolean): void;
    updateWorkingMemory(threadId: string, line: string): void;
    getWorkingMemory(threadId: string): WorkingMemorySnapshot | undefined;
    evaluatePolicies(ctx: PolicyContext): PolicyRule[];
    retrieve(query: RetrievalQuery, budget: RetrievalBudget): RetrievalResult;
    promoteRawToDistilled(reasonTag: string): MemoryItem | undefined;
    markCanonical(itemId: string, approvedByHuman?: boolean): MemoryItem | undefined;
    applyDecayAndArchive(maxAgeDays?: number, minUseBeforeKeep?: number): number;
}
