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
        "NODE_ENV": "production"
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

## Development

### Run in Development Mode

```bash
npm run dev
```

### Test the Server

```bash
# Test directly with a sample request
node test-mcp.js
```

## How It Works

The MCP server:
1. Takes your concept and generates 10+ search angles
2. Performs parallel searches across your Pinecone indexes
3. Enriches results with Supabase performance data
4. Returns organized, raw data (not synthesized)
5. Lets Claude do the intelligent pattern analysis

This approach keeps the MCP server as a pure data orchestration layer while Claude handles the intelligence and context-aware synthesis.