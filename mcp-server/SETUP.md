# MCP Server Setup & Usage Guide

## Installation & Setup

### 1. Install Dependencies
```bash
cd mcp-server
npm install
```

### 2. Build the TypeScript Code
```bash
npm run build
```

### 3. Test the Server Locally
```bash
# Run the existing test
node test-mcp.js

# Run comprehensive test suite
node test-suite.js

# Run with verbose output
node test-suite.js --verbose
```

## How to Run the MCP Server

### Option 1: Standalone Testing (Development)
```bash
# Build and run
npm run build
npm start

# Or use development mode with auto-reload
npm run dev
```

### Option 2: Integration with Claude Desktop

#### Step 1: Add to Claude Desktop Configuration

Edit your Claude Desktop config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add this configuration:

```json
{
  "mcpServers": {
    "video-scripter": {
      "command": "node",
      "args": [
        "/Users/brandoncullum/video-scripter/mcp-server/dist/index.js"
      ],
      "env": {
        "NEXT_PUBLIC_SUPABASE_URL": "your-supabase-url",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-key",
        "PINECONE_API_KEY": "your-pinecone-key",
        "PINECONE_INDEX_NAME": "your-index-name",
        "OPENAI_API_KEY": "your-openai-key"
      }
    }
  }
}
```

#### Step 2: Alternative - Use .env File

If you want to use your existing `.env` file instead of hardcoding credentials:

```json
{
  "mcpServers": {
    "video-scripter": {
      "command": "node",
      "args": [
        "--require",
        "dotenv/config",
        "/Users/brandoncullum/video-scripter/mcp-server/dist/index.js"
      ],
      "env": {
        "DOTENV_CONFIG_PATH": "/Users/brandoncullum/video-scripter/.env"
      }
    }
  }
}
```

#### Step 3: Restart Claude Desktop

1. Quit Claude Desktop completely
2. Restart Claude Desktop
3. The MCP tools should now be available

## Testing in Claude Desktop

Once configured, you can use these commands in Claude:

```
// Test basic pattern exploration
Use the explore_patterns tool to find YouTube patterns about "AI tools for content creation" with the hook "saves 10 hours per week" and frame "Efficiency Through Automation"

// Find cross-niche patterns
Use find_cross_niche_patterns to find videos about "transformation stories" excluding fitness and weight-loss niches

// Get pattern insights
Use get_pattern_insights to analyze these video IDs: ["qDy-1j5PcKU", "BxV14h0kFs0", "dQw4w9WgXcQ"]
```

## Available MCP Tools

### 1. `explore_patterns`
Intelligently explores title patterns using multiple search strategies.

**Parameters:**
- `core_concept` (required): Main video topic
- `current_hook` (required): Hook/angle being used
- `frame` (required): Psychological frame
- `channel_id` (optional): Your channel ID for personalized insights
- `exploration_depth` (optional): Search angles to explore (1-5, default: 3)
- `min_performance` (optional): Minimum performance score (default: 1.5)

### 2. `find_cross_niche_patterns`
Finds successful patterns across different niches sharing psychological triggers.

**Parameters:**
- `psychological_trigger` (required): The psychological angle
- `exclude_niches` (optional): Array of niches to exclude
- `min_performance` (optional): Minimum temporal performance score (default: 2.0)
- `limit` (optional): Maximum results (default: 30)

### 3. `get_pattern_insights`
Provides deep insights about what makes specific patterns successful.

**Parameters:**
- `pattern_examples` (required): Array of video IDs or titles
- `include_thumbnails` (optional): Include thumbnail URLs (default: false)

## Troubleshooting

### Common Issues

1. **"Cannot find module" errors**
   ```bash
   # Rebuild the project
   npm run build
   ```

2. **Environment variables not loading**
   ```bash
   # Check .env file exists in parent directory
   ls ../.env
   
   # Test with explicit path
   DOTENV_CONFIG_PATH=../.env node test-mcp.js
   ```

3. **Claude Desktop doesn't show tools**
   - Check the config file syntax (must be valid JSON)
   - Ensure all paths are absolute, not relative
   - Check Claude Desktop logs:
     - macOS: `~/Library/Logs/Claude/`
     - Windows: `%LOCALAPPDATA%\Claude\Logs\`
   - Restart Claude Desktop completely

4. **Supabase/Pinecone connection errors**
   - Verify API keys are correct
   - Check network connectivity
   - Ensure Supabase project is active
   - Verify Pinecone index exists

### Debug Mode

Run the server in debug mode to see detailed logs:

```bash
# Set DEBUG environment variable
DEBUG=* node dist/index.js

# Or modify the test script
DEBUG=* node test-suite.js
```

## Performance Expectations

- **explore_patterns**: ~1-3 seconds for depth=3
- **find_cross_niche_patterns**: ~500ms-1s
- **get_pattern_insights**: ~500ms-2s depending on video count
- Parallel operations should complete in <5 seconds

## Development Workflow

1. Make changes to TypeScript files in `src/`
2. Run tests locally: `npm run build && node test-suite.js`
3. Test in development mode: `npm run dev`
4. Build for production: `npm run build`
5. Update Claude Desktop config if needed
6. Restart Claude Desktop to load changes

## API Rate Limits

The server respects these rate limits:
- **Supabase**: 500 requests/second (shouldn't hit this)
- **Pinecone**: 100 requests/second per index
- **OpenAI Embeddings**: 3000 requests/minute
- **YouTube Data API**: Quota-based (managed by main app)

## Monitoring

Check server health:
```bash
# Test basic connectivity
node -e "console.log('Node version:', process.version)"

# Test environment loading
node -e "require('dotenv').config({path:'../.env'}); console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0,30) + '...')"

# Run quick health check
node test-mcp.js
```