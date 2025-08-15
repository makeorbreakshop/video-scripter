#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { explorePatternsTool } from './tools/explore-patterns.js';
import { findCrossNichePatternsTool } from './tools/find-cross-niche.js';
import { getPatternInsightsTool } from './tools/get-pattern-insights.js';
class VideoScripterMCP {
    server;
    constructor() {
        this.server = new Server({
            name: 'video-scripter-mcp',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
    }
    setupHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'explore_patterns',
                    description: 'Intelligently explore title patterns from your database using multiple search strategies',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            core_concept: {
                                type: 'string',
                                description: 'The main video topic/concept'
                            },
                            current_hook: {
                                type: 'string',
                                description: 'The hook/angle being used'
                            },
                            frame: {
                                type: 'string',
                                description: 'The psychological frame (e.g., "Strategic Tool Mastery")'
                            },
                            channel_id: {
                                type: 'string',
                                description: 'Optional: Your channel ID for personalized insights'
                            },
                            exploration_depth: {
                                type: 'number',
                                description: 'How many search angles to explore (1-5)',
                                default: 3
                            }
                        },
                        required: ['core_concept', 'current_hook', 'frame']
                    }
                },
                {
                    name: 'find_cross_niche_patterns',
                    description: 'Find successful patterns from different niches that share psychological triggers',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            psychological_trigger: {
                                type: 'string',
                                description: 'The psychological angle (e.g., "problem to solution", "fear of missing out")'
                            },
                            exclude_niches: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Niches to exclude from search'
                            },
                            min_performance: {
                                type: 'number',
                                description: 'Minimum temporal performance score',
                                default: 2.0
                            }
                        },
                        required: ['psychological_trigger']
                    }
                },
                {
                    name: 'get_pattern_insights',
                    description: 'Get deep insights about what makes a specific pattern successful',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            pattern_examples: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Video IDs or titles to analyze'
                            },
                            include_thumbnails: {
                                type: 'boolean',
                                description: 'Include thumbnail analysis',
                                default: false
                            }
                        },
                        required: ['pattern_examples']
                    }
                }
            ],
        }));
        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case 'explore_patterns':
                        return await explorePatternsTool(args);
                    case 'find_cross_niche_patterns':
                        return await findCrossNichePatternsTool(args);
                    case 'get_pattern_insights':
                        return await getPatternInsightsTool(args);
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${error.message}`
                        }
                    ],
                };
            }
        });
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Video Scripter MCP Server running...');
    }
}
const server = new VideoScripterMCP();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map