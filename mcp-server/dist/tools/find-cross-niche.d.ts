interface FindCrossNicheParams {
    psychological_trigger: string;
    exclude_niches?: string[];
    min_performance?: number;
    limit?: number;
}
/**
 * Find patterns from different niches that share psychological triggers
 * Returns raw data for Claude to analyze
 */
export declare function findCrossNichePatternsTool(params: FindCrossNicheParams): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
export {};
//# sourceMappingURL=find-cross-niche.d.ts.map