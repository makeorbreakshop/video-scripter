interface GetPatternInsightsParams {
    pattern_examples: string[];
    include_thumbnails?: boolean;
}
/**
 * Get deep insights about what makes specific patterns successful
 * Returns raw data about the videos for Claude to analyze
 */
export declare function getPatternInsightsTool(params: GetPatternInsightsParams): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
export {};
//# sourceMappingURL=get-pattern-insights.d.ts.map