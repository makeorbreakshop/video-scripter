# Search Logs

This folder contains detailed logs of every title generator search to help debug and improve the search process.

## Log Structure

Each search creates a timestamped log file with:
- Original query and expanded queries
- All video IDs and titles found in Pinecone search
- Performance analysis and tier distribution
- Claude prompt and discovered patterns
- Full debug data and timing information

## File Naming Convention

`search-log-YYYY-MM-DD-HH-MM-SS-concept.json`

Example: `search-log-2025-07-17-14-30-45-how-to-cook-a-steak.json`

## Analysis

Each log is analyzed for:
- Content relevance to query
- Video topic distribution
- Performance metrics
- Pattern quality
- Potential issues or improvements