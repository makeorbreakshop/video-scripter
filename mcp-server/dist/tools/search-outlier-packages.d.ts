export type OutlierPackageSearchIntent = 'topic' | 'package_transfer';
export interface TargetPackage {
    title: string;
    description: string;
    thumbnail_url?: string;
    viewer_job?: string;
    available_evidence?: string[];
    hard_constraints?: string[];
}
export interface SearchOutlierPackagesParams {
    search_intent: OutlierPackageSearchIntent;
    target: TargetPackage;
    topic_query?: string;
    package_hints?: string[];
    exclude_channel_id?: string;
    min_outlier_score?: number;
    min_baseline?: number;
    top_k?: number;
    candidate_pool_size?: number;
    max_cost_usd?: number;
}
export interface ParsedSearchOutlierPackagesParams {
    search_intent: OutlierPackageSearchIntent;
    target: TargetPackage;
    topic_query?: string;
    package_hints?: string[];
    exclude_channel_id?: string;
    min_outlier_score: number;
    min_baseline: number;
    top_k: number;
    candidate_pool_size: number;
    max_cost_usd: number;
}
export interface OutlierCandidate {
    id: string;
    title: string;
    description: string;
    thumbnail_url: string;
    channel_id: string;
    channel_name: string;
    published_at: number | null;
    score: number;
    n_baseline: number;
    confidence: string;
    score_model_version: string | null;
    baseline: number | null;
    package_family?: string;
}
export interface SemanticOutlierCandidate extends OutlierCandidate {
    similarity: number;
}
export interface InlineImage {
    mime_type: string;
    data: string;
}
export interface PackageTransferModelResult {
    id: string;
    package_family: string;
    viewer_promise: string;
    title_mechanism: string;
    thumbnail_grammar: string;
    source_title_thumbnail_relationship: 'repeats' | 'completes' | 'contrasts' | 'amplifies' | 'withholds';
    source_opening_expectation: string;
    transfer_fit: 'strong_candidate' | 'conditional_candidate' | 'surface_only' | 'reject';
    preserved_invariants: string[];
    ported_title: string;
    ported_thumbnail: string;
    ported_opening: string;
    why_transfer: string;
    evidence_required: string[];
    risk_flags: string[];
}
export interface PackageAnalysisInput {
    target: TargetPackage;
    target_image: InlineImage | null;
    candidates: Array<OutlierCandidate & {
        image: InlineImage;
    }>;
}
export interface PackageAnalysisOutput {
    results: PackageTransferModelResult[];
    model: string;
    usage: Record<string, number>;
    estimated_cost_usd: number;
}
export interface PackageShortlistResult {
    id: string;
    reason: string;
}
export interface PackageShortlistInput {
    target: TargetPackage;
    package_hints: string[];
    candidates: OutlierCandidate[];
    limit: number;
}
export interface PackageShortlistOutput {
    results: PackageShortlistResult[];
    model: string;
    usage: Record<string, number>;
    estimated_cost_usd: number;
}
export interface OutlierPackageSearchDependencies {
    embed(text: string): Promise<{
        vector: number[];
        token_count?: number;
        estimated_cost_usd?: number;
    }>;
    semanticSearch(vector: number[], options: {
        limit: number;
        min_outlier_score: number;
        min_baseline: number;
        exclude_channel_id?: string;
    }): Promise<SemanticOutlierCandidate[]>;
    scanOutliers(options: {
        min_outlier_score: number;
        min_baseline: number;
        exclude_channel_id?: string;
    }): Promise<OutlierCandidate[]>;
    shortlistCandidates(input: PackageShortlistInput): Promise<PackageShortlistOutput>;
    loadImage(url: string): Promise<InlineImage | null>;
    analyzeBatch(input: PackageAnalysisInput): Promise<PackageAnalysisOutput>;
    corpus: {
        collection: string;
        version: string;
    };
}
export declare const searchOutlierPackagesDefinition: {
    readonly name: "search_outlier_packages";
    readonly description: "Search proven outliers either by topic similarity or by cross-topic whole-package transfer. Package transfer deliberately ignores subject similarity, then uses title, description, and the real thumbnail together to identify portable click/story patterns.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly search_intent: {
                readonly type: "string";
                readonly enum: readonly ["topic", "package_transfer"];
                readonly description: "topic finds videos about the same subject; package_transfer finds unrelated-topic outliers whose complete title/thumbnail/promise pattern could transfer.";
            };
            readonly target: {
                readonly type: "object";
                readonly properties: {
                    readonly title: {
                        readonly type: "string";
                        readonly description: "Working or published title for the target video.";
                    };
                    readonly description: {
                        readonly type: "string";
                        readonly description: "What the target video can truthfully deliver.";
                    };
                    readonly thumbnail_url: {
                        readonly type: "string";
                        readonly description: "Optional YouTube-CDN thumbnail URL for the target.";
                    };
                    readonly viewer_job: {
                        readonly type: "string";
                        readonly description: "The decision, feeling, or outcome promised to the viewer.";
                    };
                    readonly available_evidence: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                        readonly description: "Facts, footage, tests, and visual assets actually available.";
                    };
                    readonly hard_constraints: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                        readonly description: "Claims, numbers, or story directions the transfer must not invent.";
                    };
                };
                readonly required: readonly ["title", "description"];
            };
            readonly topic_query: {
                readonly type: "string";
                readonly description: "Optional explicit query for topic mode. Defaults to the target title and description.";
            };
            readonly package_hints: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly description: "Optional package moves to seek across unrelated topics, such as hidden reveal, costly mistake, or reputation reversal.";
            };
            readonly exclude_channel_id: {
                readonly type: "string";
                readonly description: "Optional source channel to exclude.";
            };
            readonly min_outlier_score: {
                readonly type: "number";
                readonly minimum: 2;
                readonly default: 2;
            };
            readonly min_baseline: {
                readonly type: "number";
                readonly minimum: 0;
                readonly default: 5000;
                readonly description: "Minimum channel baseline views; removes tiny-baseline score explosions.";
            };
            readonly top_k: {
                readonly type: "integer";
                readonly minimum: 1;
                readonly maximum: 12;
                readonly default: 8;
            };
            readonly candidate_pool_size: {
                readonly type: "integer";
                readonly minimum: 1;
                readonly maximum: 16;
                readonly default: 12;
                readonly description: "Maximum candidates promoted from cheap text screening into thumbnail analysis. Keep this small to control cost.";
            };
            readonly max_cost_usd: {
                readonly type: "number";
                readonly minimum: 0.01;
                readonly maximum: 0.03;
                readonly default: 0.02;
                readonly description: "Soft Gemini list-price budget. The tool reserves room before each thumbnail batch and reports the usage-based estimate.";
            };
        };
        readonly required: readonly ["search_intent", "target"];
    };
};
export declare function parseSearchOutlierPackagesParams(value: unknown): ParsedSearchOutlierPackagesParams;
export declare function inferPackageFamily(title: string): string;
export declare function selectCrossTopicCandidatePool(candidates: OutlierCandidate[], semanticallyNearIds: Set<string>, excludeChannelId: string | undefined, limit: number, minBaseline?: number, minOutlierScore?: number): Array<OutlierCandidate & {
    package_family: string;
}>;
export declare function applyTransferGuard(target: TargetPackage, result: PackageTransferModelResult): {
    guard: {
        status: "candidate" | "needs_revision" | "needs_evidence" | "rejected";
        issues: string[];
        note: string;
    };
    id: string;
    package_family: string;
    viewer_promise: string;
    title_mechanism: string;
    thumbnail_grammar: string;
    source_title_thumbnail_relationship: "repeats" | "completes" | "contrasts" | "amplifies" | "withholds";
    source_opening_expectation: string;
    transfer_fit: "strong_candidate" | "conditional_candidate" | "surface_only" | "reject";
    preserved_invariants: string[];
    ported_title: string;
    ported_thumbnail: string;
    ported_opening: string;
    why_transfer: string;
    evidence_required: string[];
    risk_flags: string[];
};
export declare function runOutlierPackageSearch(rawParams: SearchOutlierPackagesParams | unknown, dependencies?: OutlierPackageSearchDependencies): Promise<any>;
export declare function searchOutlierPackagesTool(params: SearchOutlierPackagesParams | unknown, dependencies?: OutlierPackageSearchDependencies): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=search-outlier-packages.d.ts.map