# Video Scripter MCP Server

Local MCP server that provides intelligent pattern exploration tools for YouTube video analysis.

## Features

### Tools Available

1. **explore_patterns** - Main orchestration tool that:
   - Generates multiple search angles from your concept
   - Searches titles and summaries with different psychological angles
   - Finds cross-niche high performers
   - Identifies content gaps for your channel
   - Returns raw data for Claude to analyze

2. **find_cross_niche_patterns** - Specialized tool for finding patterns across different niches

3. **get_pattern_insights** - Deep analysis of specific video patterns

4. **search_outlier_packages** - Explicitly choose one of two different searches:
   - `topic`: semantically similar outliers about the same subject
   - `package_transfer`: unrelated-topic outliers whose complete title, thumbnail, click promise, and opening-story pattern may transfer to the working video

`package_transfer` uses semantic similarity as a negative filter, not a relevance score. It removes the nearest topical results, cheaply screens a diverse set of title-and-description cores, and sends only the promoted shortlist to Gemini 3.1 Flash-Lite with each source's real thumbnail. The response includes the source package, a proposed target translation, evidence requirements, deterministic claim guards, measured outlier provenance, and a usage-based cost estimate. It does not claim that packaging caused the source performance.

## Setup

### 1. Install Dependencies

```bash
cd mcp-server
npm install
```

### 2. Build the Server

```bash
npm run build
```

### 3. Configure Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "video-scripter": {
      "command": "node",
      "args": ["/Users/brandoncullum/video-scripter/mcp-server/dist/index.js"],
      "env": {
        "NODE_ENV": "production",
        "OPENAI_API_KEY": "...",
        "GEMINI_API_KEY": "...",
        "QDRANT_URL": "http://127.0.0.1:6333"
      }
    }
  }
}
```

### 4. Restart Claude Desktop

After updating the config, restart Claude Desktop to load the MCP server.

## Usage Example

In Claude, you can now use the tool like this:

```
Use the explore_patterns tool to find successful title patterns for:
- core_concept: "AI tools for laser engraving business"
- current_hook: "customer sent terrible photo but I could fix it with AI"
- frame: "Strategic Tool Mastery Over Skill Building"
```

Claude will receive organized data with:
- Multiple search results from different angles
- Cross-niche patterns
- Performance metrics
- Channel gaps (if channel_id provided)

For a same-topic outlier search:

```text
Use search_outlier_packages with:
- search_intent: topic
- target.title: Best Laser Cutter 2026
- target.description: A category guide based on experience with 47 machines
```

For cross-topic packaging inspiration:

```text
Use search_outlier_packages with:
- search_intent: package_transfer
- target.title: Best Laser Cutter 2026: Tested 47 Machines, Here's What to Buy
- target.description: Help a maker choose the right laser category for the jobs and materials they need
- target.thumbnail_url: https://i.ytimg.com/vi/VIDEO_ID/hqdefault.jpg (optional)
- target.available_evidence: footage of representative diode, CO2, and fiber machines
- target.hard_constraints: do not invent prices, percentages, controlled tests, or a universal winner
- package_hints: costly mistake, hidden reveal, reputation reversal (optional)
- top_k: 8
- max_cost_usd: 0.02
```

The target thumbnail is optional because an in-progress video may not have one yet. Every source candidate must have a real thumbnail; each result reports whether the target thumbnail was actually used.

## Development

### Run in Development Mode

```bash
npm run dev
```

### Test the Server

```bash
# Test directly with a sample request
node test-mcp.js

# Deterministic package-search contract and end-to-end dependency test
npm run test:package-search
```

## How It Works

The MCP server:
1. Takes your concept and generates 10+ search angles
2. Performs parallel searches across your Pinecone indexes
3. Enriches results with Supabase performance data
4. Returns organized, raw data (not synthesized)
5. Lets Claude do the intelligent pattern analysis

This approach keeps the MCP server as a pure data orchestration layer while Claude handles the intelligence and context-aware synthesis.
