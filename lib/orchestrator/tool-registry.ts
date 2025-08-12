/**
 * Tool Registry for Idea Heist Agentic Mode
 * Manages all 18 tools with descriptions, handlers, and metadata
 */

import { ToolDefinition, ToolRegistry, ToolContext } from '@/types/orchestrator';

/**
 * Implementation of the tool registry
 */
export class ToolRegistryImpl implements ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a new tool
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool ${tool.name} already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * List all tools or filter by category
   */
  list(category?: string): ToolDefinition[] {
    const tools = Array.from(this.tools.values());
    if (category) {
      return tools.filter(t => t.category === category);
    }
    return tools;
  }

  /**
   * Get tools that can be executed in parallel
   */
  getParallelSafe(): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(t => t.parallelSafe);
  }

  /**
   * Estimate total cost for a set of tools
   */
  estimateCost(toolNames: string[]): number {
    return toolNames.reduce((total, name) => {
      const tool = this.tools.get(name);
      return total + (tool?.costEstimate || 0);
    }, 0);
  }
}

/**
 * Create and initialize the tool registry with all 18 tools
 */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistryImpl();

  // Phase 1: Context Tools (3)
  registry.register({
    name: 'get_video_bundle',
    description: 'Fetch comprehensive video data including performance metrics, channel baseline, and metadata',
    category: 'context',
    parameters: {
      type: 'object',
      properties: {
        video_id: { type: 'string', description: 'YouTube video ID' }
      },
      required: ['video_id']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/get-video-bundle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId,
          'x-analysis-mode': context.mode
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 500,
    costEstimate: 0.001
  });

  registry.register({
    name: 'get_channel_baseline',
    description: 'Calculate channel performance baseline from recent videos before target date',
    category: 'context',
    parameters: {
      type: 'object',
      properties: {
        channel_id: { type: 'string' },
        before_date: { type: 'string', format: 'date-time' },
        video_count: { type: 'number', default: 10 }
      },
      required: ['channel_id', 'before_date']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/get-channel-baseline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 800,
    costEstimate: 0.001
  });

  registry.register({
    name: 'list_channel_history',
    description: 'List recent videos from a channel with flexible field selection',
    category: 'context',
    parameters: {
      type: 'object',
      properties: {
        channel_id: { type: 'string' },
        limit: { type: 'number', default: 20, maximum: 50 },
        fields: { type: 'array', items: { type: 'string' } }
      },
      required: ['channel_id']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/list-channel-history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 600,
    costEstimate: 0.001
  });

  // Phase 1: Search Tools (3)
  registry.register({
    name: 'search_titles',
    description: 'Semantic search on video titles using OpenAI embeddings',
    category: 'search',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        filters: { type: 'object' },
        limit: { type: 'number', default: 20 }
      },
      required: ['query']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/search-titles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 1200,
    costEstimate: 0.002
  });

  registry.register({
    name: 'search_summaries',
    description: 'Conceptual search on video summaries in llm-summaries namespace',
    category: 'search',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        filters: { type: 'object' },
        limit: { type: 'number', default: 20 }
      },
      required: ['query']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/search-summaries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 1200,
    costEstimate: 0.002
  });

  registry.register({
    name: 'search_thumbs',
    description: 'Visual similarity search using CLIP embeddings',
    category: 'search',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        image_url: { type: 'string' },
        limit: { type: 'number', default: 20 }
      },
      required: []
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/search-thumbs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 1500,
    costEstimate: 0.003
  });

  // Phase 1: Enrichment Tools (3)
  registry.register({
    name: 'perf_snapshot',
    description: 'Batch fetch temporal performance scores and distribution statistics',
    category: 'performance',
    parameters: {
      type: 'object',
      properties: {
        video_ids: { type: 'array', items: { type: 'string' }, maxItems: 200 }
      },
      required: ['video_ids']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/perf-snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 800,
    costEstimate: 0.001
  });

  registry.register({
    name: 'fetch_thumbs',
    description: 'Batch fetch thumbnail URLs with validation',
    category: 'context',
    parameters: {
      type: 'object',
      properties: {
        video_ids: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        validate_urls: { type: 'boolean', default: false }
      },
      required: ['video_ids']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/fetch-thumbs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 600,
    costEstimate: 0.001
  });

  registry.register({
    name: 'topic_lookup',
    description: 'Fetch topic classifications and cluster information',
    category: 'context',
    parameters: {
      type: 'object',
      properties: {
        video_ids: { type: 'array', items: { type: 'string' }, maxItems: 200 }
      },
      required: ['video_ids']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/topic-lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 500,
    costEstimate: 0.001
  });

  // Phase 2: Performance Analysis Tools (3)
  registry.register({
    name: 'get_performance_timeline',
    description: 'Analyze TPS evolution over time from view snapshots',
    category: 'performance',
    parameters: {
      type: 'object',
      properties: {
        video_id: { type: 'string' },
        include_milestones: { type: 'boolean', default: true }
      },
      required: ['video_id']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/get-performance-timeline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 700,
    costEstimate: 0.001
  });

  registry.register({
    name: 'get_channel_performance_distribution',
    description: 'Calculate channel TPS distribution and percentiles',
    category: 'performance',
    parameters: {
      type: 'object',
      properties: {
        channel_id: { type: 'string' },
        days_back: { type: 'number', default: 180 }
      },
      required: ['channel_id']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/get-channel-performance-distribution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 900,
    costEstimate: 0.001
  });

  registry.register({
    name: 'find_competitive_successes',
    description: 'Find high-performing videos in same topic/cluster from other channels',
    category: 'performance',
    parameters: {
      type: 'object',
      properties: {
        topic_cluster_id: { type: 'number' },
        topic_niche: { type: 'string' },
        min_tps: { type: 'number', default: 2.0 },
        exclude_channel_id: { type: 'string' }
      },
      required: []
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/find-competitive-successes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 1000,
    costEstimate: 0.002
  });

  // Phase 2: Novelty Detection Tools (2)
  registry.register({
    name: 'detect_novelty_factors',
    description: 'Identify what makes a video unique compared to channel history',
    category: 'performance',
    parameters: {
      type: 'object',
      properties: {
        video_id: { type: 'string' },
        compare_last_n: { type: 'number', default: 100 }
      },
      required: ['video_id']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/detect-novelty-factors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 800,
    costEstimate: 0.001
  });

  registry.register({
    name: 'find_content_gaps',
    description: 'Identify untried formats and topics by comparing to competitors',
    category: 'performance',
    parameters: {
      type: 'object',
      properties: {
        channel_id: { type: 'string' },
        compare_to_competitors: { type: 'boolean', default: true },
        min_competitor_tps: { type: 'number', default: 2.0 }
      },
      required: ['channel_id']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/find-content-gaps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: true,
    cacheable: true,
    estimatedLatencyMs: 1200,
    costEstimate: 0.002
  });

  // Phase 2: Semantic Intelligence Tools (2)
  registry.register({
    name: 'calculate_pattern_significance',
    description: 'Validate semantic patterns using statistical analysis on embedding clusters',
    category: 'semantic',
    parameters: {
      type: 'object',
      properties: {
        video_ids: { type: 'array', items: { type: 'string' } },
        pattern_hypothesis: { type: 'string' },
        similarity_threshold: { type: 'number', default: 0.7 }
      },
      required: ['video_ids', 'pattern_hypothesis']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/calculate-pattern-significance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: false, // Pinecone rate limits
    cacheable: true,
    estimatedLatencyMs: 2000,
    costEstimate: 0.003
  });

  registry.register({
    name: 'find_correlated_features',
    description: 'Analyze which embedding dimensions correlate with performance',
    category: 'semantic',
    parameters: {
      type: 'object',
      properties: {
        video_ids: { type: 'array', items: { type: 'string' } },
        channel_id: { type: 'string' },
        min_tps: { type: 'number', default: 0 },
        include_thumbnails: { type: 'boolean', default: false }
      },
      required: []
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/find-correlated-features', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: false, // Pinecone rate limits
    cacheable: true,
    estimatedLatencyMs: 2500,
    costEstimate: 0.003
  });

  // Phase 2: Composite Tools (2)
  registry.register({
    name: 'get_comprehensive_video_analysis',
    description: 'Orchestrate all signals for unified semantic and performance analysis',
    category: 'composite',
    parameters: {
      type: 'object',
      properties: {
        video_id: { type: 'string' },
        include_semantic_neighbors: { type: 'boolean', default: true },
        include_visual_analysis: { type: 'boolean', default: true },
        include_temporal_patterns: { type: 'boolean', default: true },
        include_channel_context: { type: 'boolean', default: true }
      },
      required: ['video_id']
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/get-comprehensive-video-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: false, // Complex orchestration
    cacheable: true,
    estimatedLatencyMs: 5000,
    costEstimate: 0.005
  });

  registry.register({
    name: 'suggest_pattern_hypotheses',
    description: 'Discover patterns using embeddings across channels, topics, and formats',
    category: 'composite',
    parameters: {
      type: 'object',
      properties: {
        seed_video_ids: { type: 'array', items: { type: 'string' } },
        channel_id: { type: 'string' },
        min_tps_threshold: { type: 'number', default: 2.0 },
        search_across_channels: { type: 'boolean', default: true },
        max_hypotheses: { type: 'number', default: 5 }
      },
      required: []
    },
    handler: async (params: any, context: ToolContext) => {
      const response = await fetch('/api/tools/suggest-pattern-hypotheses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': context.requestId
        },
        body: JSON.stringify(params)
      });
      return response.json();
    },
    parallelSafe: false, // Complex pattern discovery
    cacheable: true,
    estimatedLatencyMs: 4000,
    costEstimate: 0.004
  });

  return registry;
}

// Export singleton instance
let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = createToolRegistry();
  }
  return registryInstance;
}