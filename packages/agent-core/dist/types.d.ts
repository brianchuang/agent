export type MemoryTier = "raw" | "distilled" | "canonical";
export type MemoryCategory = "incident" | "template" | "faq" | "note";
export interface MemoryMetadata {
    workspace: string;
    objective: string;
    channel: "email" | "calendar" | "chat";
    tags: string[];
    accountTier?: "standard" | "priority";
    language?: string;
}
export interface MemoryItem {
    id: string;
    tier: MemoryTier;
    category: MemoryCategory;
    content: string;
    summary: string;
    metadata: MemoryMetadata;
    approvedByHuman: boolean;
    useCount: number;
    successCount: number;
    contradictionGroup?: string;
    supersedesId?: string;
    effectiveFrom: Date;
    lastUsedAt?: Date;
    createdAt: Date;
    archivedAt?: Date;
}
export interface PolicyRule {
    id: string;
    name: string;
    objective: string;
    condition: (ctx: PolicyContext) => boolean;
    action: string;
}
export interface PolicyContext {
    workspace: string;
    objective: string;
    channel: "email" | "calendar" | "chat";
    tags: string[];
}
export interface RetrievalBudget {
    maxItems: number;
    maxTokens: number;
    maxByCategory: Partial<Record<MemoryCategory, number>>;
}
export interface RetrievalQuery {
    text: string;
    workspace: string;
    objective: string;
    channel?: "email" | "calendar" | "chat";
    tags?: string[];
    language?: string;
    accountTier?: "standard" | "priority";
    withinDays?: number;
}
export interface RetrievalResult {
    policies: PolicyRule[];
    items: MemoryItem[];
}
export interface WorkingMemorySnapshot {
    threadId: string;
    lines: string[];
    updatedAt: Date;
}
