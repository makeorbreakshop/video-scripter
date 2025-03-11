# Project Guidelines and Best Practices

This document outlines the guidelines, conventions, and best practices for the Video Scripter project.

## Table of Contents
- [AI Integration](#ai-integration)
- [Database Management](#database-management)
- [Code Style and Architecture](#code-style-and-architecture)
- [Workflow and Version Control](#workflow-and-version-control)
- [Performance Optimization](#performance-optimization)

## AI Integration

### Claude API Usage

1. **Prefer AI SDK Over Direct API Calls**
   - Use `@ai-sdk/anthropic` and `ai` packages instead of direct Anthropic SDK
   - Benefits: unified interface, better streaming, easier provider switching
   - **Important Limitation**: The `generateObject` function from the AI SDK may not be compatible with some Claude models
   - For structured JSON responses with Claude, use this pattern:
     ```typescript
     import { anthropic } from '@ai-sdk/anthropic';
     import { generateText } from 'ai';
     
     const { text } = await generateText({
       model: anthropic('claude-3-7-sonnet-20250219'),
       system: "Output your response as valid JSON that follows the expected schema",
       messages: [{ role: 'user', content: prompt }],
       temperature: 0.3,
       maxTokens: 4000
     });
     
     try {
       // Parse the JSON text response
       const parsedData = JSON.parse(text);
       // Apply validation if needed
     } catch (error) {
       console.error('Failed to parse JSON response:', error);
     }
     ```

2. **Model Selection**
   - Default to `claude-3-5-sonnet` for balanced performance/cost
   - Use `claude-3-7-sonnet` only for complex analysis requiring highest reasoning
   - Consider `claude-3-haiku` for simpler, cost-effective operations

3. **Cost Optimization**
   - Track token usage with `estimateTokenCount` utility
   - Cache responses where applicable
   - Use progressive loading for large responses
   - Set appropriate `max_tokens` limits

4. **Structured Output**
   - Use `generateObject` instead of string parsing 
   - Define strong TypeScript interfaces for AI responses
   - Implement validation for AI-generated content

5. **Reasoning and Transparency**
   - Enable reasoning with `thinking: { type: 'enabled', budgetTokens: 10000 }`
   - Display reasoning process in debug UIs
   - Log reasoning tokens for debugging

6. **Error Handling**
   - Implement retry logic for transient errors
   - Gracefully degrade functionality on API failures
   - Provide clear user-facing error messages

## Database Management

### Database Structure

1. **Videos Table**
   - `id` (text): YouTube video ID as primary key
   - `channel_id` (text): YouTube channel ID
   - `title` (text): Video title
   - `description` (text): Video description
   - `published_at` (timestamptz): Publication date
   - `view_count` (integer): View count
   - `like_count` (integer): Like count
   - `comment_count` (integer): Comment count
   - `user_id` (uuid): Reference to auth.users
   - Additional metadata fields for analytics

2. **Chunks Table**
   - `id` (uuid): Primary key
   - `video_id` (text): Reference to videos table
   - `content` (text): Actual content text
   - `content_type` (text): Type of content ('transcript', 'comment_cluster', 'description')
   - `start_time` (float): Start timestamp for transcript chunks
   - `end_time` (float): End timestamp for transcript chunks
   - `embedding` (vector(1536)): Vector embedding for similarity search
   - `metadata` (jsonb): Additional context (title, section, etc.)
   - `user_id` (uuid): Reference to auth.users
   - `created_at` (timestamptz): Creation timestamp

### Comment Storage

1. **Comment Clusters**
   - Comments are stored as `comment_cluster` in the `content_type` field (NOT as 'comment')
   - Each cluster contains multiple related comments grouped by theme or topic
   - The `start_time` and `end_time` fields are NULL for comment clusters
   - The `content` field contains the summarized content of the grouped comments

2. **Comment Cluster Metadata**
   - `commentCount`: Number of comments in the cluster
   - `authorCount`: Number of unique authors in the cluster
   - `keywords`: Array of keywords/topics identified in the cluster
   - `averageLikeCount`: Average number of likes across comments in the cluster
   - `hasTimestampReferences`: Boolean indicating if comments reference specific timestamps
   - `timestamps`: Array of timestamps referenced in comments (if applicable)

3. **Querying Comment Clusters**
   ```typescript
   // Fetch all comment clusters for a video
   const { data, error } = await supabase
     .from('chunks')
     .select('content, metadata, created_at')
     .eq('video_id', 'YOUR_VIDEO_ID')
     .eq('content_type', 'comment_cluster')
     .order('created_at', { ascending: true });
   
   // Process comment clusters
   const formattedComments = data.map(cluster => {
     const commentCount = cluster.metadata?.commentCount || 'Unknown';
     const authorCount = cluster.metadata?.authorCount || 'Unknown';
     const keywords = cluster.metadata?.keywords?.join(', ') || 'None';
     const averageLikes = cluster.metadata?.averageLikeCount || 0;
     
     return `CLUSTER (${commentCount} comments, ${authorCount} authors): ${cluster.content}`;
   }).join('\n\n');
   ```