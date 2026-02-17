"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryEngine = void 0;
const TIER_PRIORITY = { canonical: 3, distilled: 2, raw: 1 };
function nowUtc() {
    return new Date();
}
function tokenize(text) {
    return new Set(text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1));
}
function jaccardSimilarity(a, b) {
    const ta = tokenize(a);
    const tb = tokenize(b);
    if (ta.size === 0 || tb.size === 0) {
        return 0;
    }
    let inter = 0;
    for (const token of ta) {
        if (tb.has(token)) {
            inter += 1;
        }
    }
    const union = ta.size + tb.size - inter;
    return union === 0 ? 0 : inter / union;
}
function estimatedTokens(text) {
    return Math.ceil(text.length / 4);
}
class MemoryEngine {
    policies = [];
    items = [];
    workingMemory = new Map();
    addPolicy(rule) {
        this.policies.push(rule);
    }
    addMemory(item) {
        this.items.push(item);
    }
    markUsed(itemId, success) {
        const item = this.items.find((x) => x.id === itemId);
        if (!item)
            return;
        item.useCount += 1;
        item.lastUsedAt = nowUtc();
        if (success) {
            item.successCount += 1;
        }
    }
    updateWorkingMemory(threadId, line) {
        const existing = this.workingMemory.get(threadId) ?? {
            threadId,
            lines: [],
            updatedAt: nowUtc()
        };
        existing.lines.push(line);
        if (existing.lines.length > 30) {
            existing.lines = existing.lines.slice(existing.lines.length - 30);
        }
        existing.updatedAt = nowUtc();
        this.workingMemory.set(threadId, existing);
    }
    getWorkingMemory(threadId) {
        return this.workingMemory.get(threadId);
    }
    evaluatePolicies(ctx) {
        return this.policies.filter((p) => p.objective === ctx.objective &&
            p.condition({
                workspace: ctx.workspace,
                objective: ctx.objective,
                channel: ctx.channel,
                tags: ctx.tags
            }));
    }
    retrieve(query, budget) {
        const now = nowUtc();
        const minDate = query.withinDays !== undefined
            ? new Date(now.getTime() - query.withinDays * 24 * 60 * 60 * 1000)
            : undefined;
        const gated = this.items.filter((item) => {
            if (item.archivedAt)
                return false;
            if (item.metadata.workspace !== query.workspace)
                return false;
            if (item.metadata.objective !== query.objective)
                return false;
            if (query.channel && item.metadata.channel !== query.channel)
                return false;
            if (query.language && item.metadata.language !== query.language)
                return false;
            if (query.accountTier && item.metadata.accountTier !== query.accountTier)
                return false;
            if (minDate && item.createdAt < minDate && item.tier !== "canonical")
                return false;
            if (query.tags && query.tags.length > 0) {
                const overlap = query.tags.some((tag) => item.metadata.tags.includes(tag));
                if (!overlap)
                    return false;
            }
            return true;
        });
        const scored = gated
            .map((item) => {
            const relevance = jaccardSimilarity(`${item.summary} ${item.content}`, query.text);
            const reliability = (item.approvedByHuman ? 1.25 : 1) *
                (item.useCount > 0 ? Math.min(1.5, 0.8 + item.successCount / item.useCount) : 0.9);
            const ageDays = Math.max(1, (now.getTime() - item.createdAt.getTime()) / 86400000);
            const recency = item.tier === "canonical" ? 1.2 : Math.max(0.5, 1 / Math.log10(ageDays + 10));
            const score = relevance * reliability * recency * TIER_PRIORITY[item.tier];
            return { item, score };
        })
            .sort((a, b) => b.score - a.score);
        const picked = [];
        const categoryCounts = {};
        let tokens = 0;
        for (const candidate of scored) {
            const item = candidate.item;
            if (picked.length >= budget.maxItems)
                break;
            const categoryLimit = budget.maxByCategory[item.category];
            const usedInCategory = categoryCounts[item.category] ?? 0;
            if (categoryLimit !== undefined && usedInCategory >= categoryLimit)
                continue;
            const duplicate = picked.some((existing) => jaccardSimilarity(existing.summary, item.summary) > 0.9);
            if (duplicate)
                continue;
            const conflict = picked.find((existing) => existing.contradictionGroup &&
                item.contradictionGroup &&
                existing.contradictionGroup === item.contradictionGroup);
            if (conflict) {
                const conflictPriority = TIER_PRIORITY[conflict.tier];
                const itemPriority = TIER_PRIORITY[item.tier];
                if (itemPriority > conflictPriority || item.effectiveFrom > conflict.effectiveFrom) {
                    const idx = picked.findIndex((x) => x.id === conflict.id);
                    if (idx >= 0)
                        picked.splice(idx, 1);
                }
                else {
                    continue;
                }
            }
            const itemTokens = estimatedTokens(item.summary) + estimatedTokens(item.content);
            if (tokens + itemTokens > budget.maxTokens)
                continue;
            picked.push(item);
            categoryCounts[item.category] = usedInCategory + 1;
            tokens += itemTokens;
        }
        const policies = this.evaluatePolicies({
            workspace: query.workspace,
            objective: query.objective,
            channel: query.channel ?? "chat",
            tags: query.tags ?? []
        });
        return { policies: policies.slice(0, 1), items: picked };
    }
    promoteRawToDistilled(reasonTag) {
        const batch = this.items.filter((x) => x.tier === "raw" && !x.archivedAt && x.metadata.tags.includes(reasonTag));
        if (batch.length < 2)
            return undefined;
        const sample = batch[0];
        const distilled = {
            id: `distilled-${reasonTag}-${Date.now()}`,
            tier: "distilled",
            category: "incident",
            content: `Distilled from ${batch.length} raw incidents: ${batch
                .map((x) => x.summary)
                .slice(0, 4)
                .join(" | ")}`,
            summary: `Common issue pattern for "${reasonTag}" from ${batch.length} incidents.`,
            metadata: { ...sample.metadata, tags: Array.from(new Set(sample.metadata.tags.concat(reasonTag))) },
            approvedByHuman: false,
            useCount: 0,
            successCount: 0,
            effectiveFrom: nowUtc(),
            createdAt: nowUtc()
        };
        this.items.push(distilled);
        for (const item of batch) {
            item.archivedAt = nowUtc();
        }
        return distilled;
    }
    markCanonical(itemId, approvedByHuman = true) {
        const item = this.items.find((x) => x.id === itemId);
        if (!item)
            return undefined;
        item.tier = "canonical";
        item.approvedByHuman = approvedByHuman;
        item.effectiveFrom = nowUtc();
        return item;
    }
    applyDecayAndArchive(maxAgeDays = 90, minUseBeforeKeep = 2) {
        const now = nowUtc();
        let archived = 0;
        for (const item of this.items) {
            if (item.archivedAt)
                continue;
            const ageDays = (now.getTime() - item.createdAt.getTime()) / 86400000;
            if (item.tier !== "canonical" && ageDays > maxAgeDays && item.useCount < minUseBeforeKeep) {
                item.archivedAt = nowUtc();
                archived += 1;
            }
        }
        return archived;
    }
}
exports.MemoryEngine = MemoryEngine;
