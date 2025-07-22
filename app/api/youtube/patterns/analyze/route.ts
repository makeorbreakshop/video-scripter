import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const { logFile } = await request.json();
    
    if (!logFile) {
      // Get the most recent log file
      const logsDir = path.join(process.cwd(), 'search-logs');
      const files = await fs.readdir(logsDir);
      const searchLogs = files
        .filter(f => f.startsWith('search-log-') && f.endsWith('.json'))
        .sort()
        .reverse();
      
      if (searchLogs.length === 0) {
        return NextResponse.json({ error: 'No search logs found' }, { status: 404 });
      }
      
      const mostRecentLog = searchLogs[0];
      const logPath = path.join(logsDir, mostRecentLog);
      const logContent = await fs.readFile(logPath, 'utf-8');
      const logData = JSON.parse(logContent);
      
      return NextResponse.json(formatAnalysis(logData, mostRecentLog));
    } else {
      // Use specified log file
      const logPath = path.join(process.cwd(), 'search-logs', logFile);
      const logContent = await fs.readFile(logPath, 'utf-8');
      const logData = JSON.parse(logContent);
      
      return NextResponse.json(formatAnalysis(logData, logFile));
    }
  } catch (error) {
    console.error('Error analyzing pattern results:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to analyze results' 
    }, { status: 500 });
  }
}

function formatAnalysis(logData: any, fileName: string) {
  const analysis = {
    fileName,
    timestamp: logData.timestamp,
    concept: logData.concept,
    
    // Thread Expansion Analysis
    threadExpansion: {
      threads: logData.expandedQueriesByThread?.map((t: any) => ({
        name: t.threadName,
        queries: t.queries
      })) || [],
      totalQueries: logData.expandedQueries?.length || 0,
      uniqueQueries: [...new Set(logData.expandedQueries || [])].length
    },
    
    // Search Results Analysis
    searchResults: {
      totalVideosFound: logData.searchResults?.length || 0,
      uniqueChannels: [...new Set((logData.searchResults || []).map((v: any) => v.channelName))].length,
      performanceDistribution: getPerformanceDistribution(logData.searchResults || []),
      topPerformers: (logData.searchResults || [])
        .filter((v: any) => v.performanceRatio > 10)
        .sort((a: any, b: any) => b.performanceRatio - a.performanceRatio)
        .slice(0, 10)
        .map((v: any) => ({
          title: v.title,
          channel: v.channelName,
          performance: v.performanceRatio.toFixed(1) + 'x',
          similarity: v.similarityScore.toFixed(3)
        }))
    },
    
    // Clustering Analysis
    clustering: {
      totalClusters: logData.clusters?.length || 0,
      clusterSummary: (logData.clusters || []).map((c: any, idx: number) => ({
        id: idx + 1,
        type: c.is_wide ? 'WIDE' : 'DEEP',
        quality: (c.quality * 100).toFixed(0) + '%',
        size: c.videos.length,
        avgPerformance: c.avg_performance.toFixed(1) + 'x',
        sources: c.thread_sources.slice(0, 3).join(', ') + (c.thread_sources.length > 3 ? '...' : ''),
        topVideo: c.videos[0]?.title || 'N/A'
      }))
    },
    
    // Pattern Discovery Analysis
    patterns: {
      totalDiscovered: logData.discoveredPatterns?.length || 0,
      patterns: (logData.discoveredPatterns || []).map((p: any) => ({
        template: p.template,
        explanation: p.explanation,
        performance: p.performance_multiplier + 'x',
        examples: p.examples?.slice(0, 3) || [],
        sourceVideos: p.video_ids?.length || 0
      }))
    },
    
    // Final Suggestions Analysis
    suggestions: {
      total: logData.response?.suggestions?.length || 0,
      byPerformance: groupByPerformance(logData.response?.suggestions || []),
      templates: extractUniqueTemplates(logData.response?.suggestions || []),
      patternTypes: countPatternTypes(logData.response?.suggestions || [])
    },
    
    // Cost Analysis
    costs: logData.response?.debug?.costs || {},
    
    // Copy-Paste Summary
    summary: generateSummary(logData)
  };
  
  return analysis;
}

function getPerformanceDistribution(videos: any[]) {
  const ranges = {
    '0-1x': 0,
    '1-2x': 0,
    '2-5x': 0,
    '5-10x': 0,
    '10-20x': 0,
    '20x+': 0
  };
  
  videos.forEach(v => {
    const perf = v.performanceRatio || 0;
    if (perf < 1) ranges['0-1x']++;
    else if (perf < 2) ranges['1-2x']++;
    else if (perf < 5) ranges['2-5x']++;
    else if (perf < 10) ranges['5-10x']++;
    else if (perf < 20) ranges['10-20x']++;
    else ranges['20x+']++;
  });
  
  return ranges;
}

function groupByPerformance(suggestions: any[]) {
  return suggestions
    .sort((a, b) => b.pattern.performance_lift - a.pattern.performance_lift)
    .map(s => ({
      performance: s.pattern.performance_lift.toFixed(1) + 'x',
      title: s.title,
      pattern: s.pattern.name
    }));
}

function extractUniqueTemplates(suggestions: any[]) {
  const templates = new Set<string>();
  suggestions.forEach(s => {
    if (s.pattern.template) {
      templates.add(s.pattern.template);
    }
  });
  return Array.from(templates);
}

function countPatternTypes(suggestions: any[]) {
  const types: Record<string, number> = {};
  suggestions.forEach(s => {
    const type = s.pattern.pattern_type || 'UNKNOWN';
    types[type] = (types[type] || 0) + 1;
  });
  return types;
}

function generateSummary(logData: any) {
  const threads = logData.expandedQueriesByThread || [];
  const patterns = logData.discoveredPatterns || [];
  const suggestions = logData.response?.suggestions || [];
  
  return `
=== PATTERN GENERATION ANALYSIS ===
Concept: "${logData.concept}"
Date: ${new Date(logData.timestamp).toLocaleString()}

THREAD EXPANSION:
${threads.map((t: any) => `- ${t.threadName}: ${t.queries.join(', ')}`).join('\n')}

DISCOVERED PATTERNS (${patterns.length} total):
${patterns.map((p: any) => `- "${p.template}" (${p.performance_multiplier}x) - ${p.explanation}`).join('\n')}

FINAL SUGGESTIONS (${suggestions.length} total):
${suggestions.slice(0, 10).map((s: any) => `- "${s.title}" (${s.pattern.performance_lift.toFixed(1)}x)`).join('\n')}

ISSUE: All patterns seem to be variations of "[activity] project ideas that [benefit]"
`.trim();
}