# AI Agent Mode User Guide

## Overview

The AI Agent mode transforms your video analysis workflow from a fixed pipeline into an autonomous AI system that intelligently discovers patterns by reasoning about video performance and content.

## What Makes Agentic Mode Different

### Classic Mode (Skyscraper Analysis)
- Fixed 7-step analysis framework
- Predictable, structured output
- Manual analysis review
- Same process for every video

### AI Agent Mode
- **Autonomous reasoning**: GPT-5 agent decides what tools to use and how to analyze
- **Hypothesis-driven**: Forms theories about why videos perform well, then tests them
- **Dynamic tool selection**: Chooses from 18 specialized tools based on video context
- **Pattern discovery**: Identifies actionable insights instead of just describing content

## Getting Started

### 1. Enable AI Agent Mode

1. Navigate to `/database` page
2. Look for the **AI Agent** toggle in the header controls (next to the search bar)
3. Toggle from "Classic" to "Autonomous" mode
4. The toggle will show a purple checked state when active

### 2. Analyze a Video

1. Find a processed video in your video list
2. Click the three-dot menu (⋮) next to the video
3. Click **Analyze** (the button text updates based on agent mode)
4. The AI Agent debug panel will open automatically

### 3. Monitor Agent Progress

The debug panel shows real-time progress:

- **Progress Bar**: Overall completion percentage
- **Current Status**: What the agent is currently doing
- **Hypothesis**: The agent's current theory about the video's success
- **Tool Calls**: Which analysis tools the agent has used
- **Results**: Final pattern discovery with confidence score

## Understanding Agent Results

### Pattern Discovery Format

When successful, the agent generates patterns like:

> **Pattern Found**: "Videos that combine specific product comparisons with a creative process, like a fashion photoshoot, in specialized niches (e.g., photography) achieve a TPS >= 3.0 due to their high value both for educational and inspirational purposes"
> 
> **Confidence**: 75%  
> **Cost**: $0.085  
> **Duration**: 15s

### Key Metrics

- **Confidence**: How certain the agent is about the pattern (0-100%)
- **TPS (Temporal Performance Score)**: Performance compared to channel baseline at publish time
- **Cost**: OpenAI API costs for the analysis
- **Duration**: Time taken for complete analysis

## Agent Capabilities

### 18 Specialized Tools

The agent can autonomously choose from:

1. **get-video-bundle** - Core video data and performance metrics
2. **get-comprehensive-video-analysis** - Detailed content breakdown
3. **find-similar-videos** - Semantic similarity search
4. **find-correlated-features** - Statistical pattern detection
5. **get-competitor-analysis** - Compare with competitor videos
6. **analyze-thumbnail-elements** - Visual element analysis
7. **get-audience-segments** - Viewer demographic insights
8. **calculate-pattern-significance** - Statistical validation
9. **get-format-analysis** - Content format categorization
10. **get-topic-analysis** - Subject matter classification
11. **get-engagement-patterns** - Viewer behavior analysis
12. **analyze-title-elements** - Title optimization insights
13. **get-temporal-trends** - Time-based performance patterns
14. **cross-reference-database** - Database-wide pattern search
15. **get-channel-context** - Channel performance context
16. **analyze-content-structure** - Video organization analysis
17. **topic-lookup** - Topic cluster information
18. **suggest-pattern-hypotheses** - AI-suggested theories

### Budget Management

The agent operates within strict limits:
- **Max Tokens**: 100,000 (configurable)
- **Max Tool Calls**: 50 (configurable)  
- **Max Fanouts**: 2 (prevents infinite loops)
- **Timeout**: 60 seconds (configurable)

## Best Practices

### When to Use AI Agent Mode

✅ **Use Agent Mode For:**
- High-performing videos (TPS > 2.0) where you want to understand success factors
- Videos with unique content approaches you want to replicate
- Discovering patterns across your video library
- Finding actionable insights for content strategy

✅ **Use Classic Mode For:**
- Comprehensive content audits
- Structured analysis reports
- Videos where you need detailed breakdowns
- Systematic analysis workflows

### Optimizing Agent Performance

1. **Start with high-performers**: Agent finds better patterns in successful videos
2. **Ensure complete data**: Videos with full metadata, transcripts, and comments work best
3. **Review patterns critically**: 75%+ confidence patterns are typically actionable
4. **Cost awareness**: Each analysis costs $0.05-$0.15 depending on complexity

### Interpreting Results

**High Confidence (80%+)**
- Pattern likely applies to similar content
- Consider testing the insight in future videos
- Strong evidence supports the conclusion

**Medium Confidence (60-79%)**
- Pattern worth investigating further
- May apply to specific niches or contexts
- Validate with additional examples

**Low Confidence (<60%)**
- Insufficient evidence for the pattern
- Consider analyzing more similar videos
- May indicate unique, non-replicable factors

## Technical Details

### Model Routing
- **GPT-5**: Complex hypothesis generation and reasoning
- **GPT-5-mini**: Tool selection and validation tasks  
- **GPT-5-nano**: Simple enrichment and data processing

### Error Handling
The agent includes automatic fallbacks:
- Schema validation with repair functions
- Budget enforcement with graceful degradation
- Tool execution retries with exponential backoff
- Session state recovery for interrupted analyses

### Performance Monitoring
Monitor agent efficiency through:
- Cost per analysis (target: <$0.10)
- Success rate (target: >85%)
- Pattern confidence (target: >70% average)
- Analysis duration (target: <30 seconds)

## Troubleshooting

### Common Issues

**Agent Not Starting**
- Ensure OpenAI API key is configured
- Check that video has required metadata
- Verify database connectivity

**Low Confidence Results**
- Try videos with higher TPS scores (>2.0)
- Ensure video has transcript and comments
- Consider analyzing channel context first

**High Costs**
- Reduce maxTokens in options (default: 50,000)
- Lower maxToolCalls limit (default: 25)
- Use agent for high-value analyses only

**Timeouts**
- Increase timeoutMs in options (default: 60,000)
- Check video data completeness
- Monitor tool execution performance

### Debug Information

The agent provides detailed debugging:
- Turn-by-turn execution logs
- Tool call performance metrics
- Budget usage breakdown
- Session state snapshots

## Integration with Workflow

### Recommended Process

1. **Import Videos**: Use unified video import to ensure complete data
2. **Filter High Performers**: Focus on videos with TPS > 2.0
3. **Run Agent Analysis**: Use autonomous mode for pattern discovery
4. **Validate Patterns**: Cross-reference with channel strategy
5. **Apply Insights**: Test patterns in future content creation

### Pattern Library

Consider building a library of discovered patterns:
- Save high-confidence insights (>75%)
- Tag patterns by niche, format, or channel
- Track which patterns lead to successful content
- Share insights across team members

## Advanced Usage

### Custom Configuration

The agent accepts custom options:

```javascript
{
  maxTokens: 50000,     // Token budget limit
  maxToolCalls: 25,     // Tool execution limit  
  maxFanouts: 2,        // Exploration depth limit
  timeoutMs: 60000      // Maximum analysis time
}
```

### Batch Analysis

For analyzing multiple videos:
1. Enable agent mode
2. Process videos individually (parallel analysis not yet supported)
3. Compare patterns across results
4. Look for common themes and insights

## Future Enhancements

Planned improvements include:
- Multi-video pattern synthesis
- Pattern validation across channels
- Automated A/B testing suggestions
- Integration with thumbnail analysis
- Real-time performance tracking

---

**Need Help?** Check the debug panel logs for detailed execution information, or review the comprehensive testing guide at `/docs/AGENTIC_TESTING_GUIDE.md`.