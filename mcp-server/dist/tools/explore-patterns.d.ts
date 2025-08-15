interface ExplorePatternParams {
    core_concept: string;
    current_hook: string;
    frame: string;
    channel_id?: string;
    exploration_depth?: number;
    min_performance?: number;
}
/**
 * Main tool handler - orchestrates multiple searches and returns raw data
 */
export declare function explorePatternsTool(params: ExplorePatternParams): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
export {};
//# sourceMappingURL=explore-patterns.d.ts.map