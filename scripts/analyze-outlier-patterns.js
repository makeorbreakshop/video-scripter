#!/usr/bin/env node
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function analyzeOutlierPatterns() {
  console.log('🔍 Analyzing outlier patterns from May-June 2025...\n');
  
  try {
    // Load the high-performer dataset (10x+)
    const dataPath = path.join(path.dirname(__dirname), 'exports', 'outliers-10x-plus-may-june-2025-2025-08-16.json');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const videos = data.videos;
    
    console.log(`📊 Analyzing ${videos.length} high-performing videos (10x+)`);
    
    // Group by niche for pattern analysis
    const niches = {};
    videos.forEach(video => {
      if (!niches[video.topic_niche]) {
        niches[video.topic_niche] = [];
      }
      niches[video.topic_niche].push(video);
    });

    // Focus on niches with at least 5 videos for statistically meaningful patterns
    const significantNiches = Object.entries(niches)
      .filter(([_, vids]) => vids.length >= 5)
      .sort((a, b) => b[1].length - a[1].length);

    console.log(`\n🎯 Found ${significantNiches.length} niches with 5+ high performers:`);
    significantNiches.forEach(([niche, vids]) => {
      const avgScore = (vids.reduce((sum, v) => sum + parseFloat(v.performance_score), 0) / vids.length).toFixed(1);
      console.log(`  ${niche}: ${vids.length} videos (avg ${avgScore}x)`);
    });

    // Analyze patterns across all high performers
    console.log('\n🤖 Running LLM pattern analysis...');
    
    const patterns = await analyzeWithLLM(videos, significantNiches);
    
    // Save analysis results
    const timestamp = new Date().toISOString().split('T')[0];
    const analysisPath = path.join(path.dirname(__dirname), 'exports', `outlier-pattern-analysis-${timestamp}.json`);
    
    await fs.writeFile(analysisPath, JSON.stringify({
      metadata: {
        total_videos_analyzed: videos.length,
        analysis_date: new Date().toISOString(),
        performance_threshold: '10x+',
        significant_niches: significantNiches.length
      },
      patterns: patterns
    }, null, 2));
    
    console.log(`\n✅ Pattern analysis saved to: ${path.basename(analysisPath)}`);
    
    // Display key findings
    console.log('\n📋 Key Pattern Findings:');
    console.log('========================');
    patterns.forEach((pattern, i) => {
      const name = pattern['Pattern Name'] || pattern.pattern_name || 'Unknown Pattern';
      const desc = pattern['Description'] || pattern.description || 'No description';
      const evidence = pattern['Evidence Count'] || pattern.evidence_count || 'Unknown';
      const niches = pattern['Niches Count'] || pattern.niches_count || 'Unknown';
      const transferability = pattern['Transferability Score'] || pattern.transferability_score || 'Unknown';
      
      console.log(`\n${i + 1}. ${name}`);
      console.log(`   Description: ${desc}`);
      console.log(`   Evidence: ${evidence} videos across ${niches} niches`);
      console.log(`   Transferability: ${transferability}/10`);
    });

  } catch (error) {
    console.error('❌ Error analyzing patterns:', error);
    process.exit(1);
  }
}

async function analyzeWithLLM(videos, significantNiches) {
  const patterns = [];
  
  // Analyze cross-niche patterns
  console.log('  🔍 Analyzing cross-niche patterns...');
  
  // Create summary data for LLM analysis
  const summaryData = {
    total_videos: videos.length,
    niches: significantNiches.map(([niche, vids]) => ({
      niche,
      count: vids.length,
      avg_score: (vids.reduce((sum, v) => sum + parseFloat(v.performance_score), 0) / vids.length).toFixed(1),
      sample_titles: vids.slice(0, 5).map(v => v.title),
      formats: [...new Set(vids.map(v => v.format_type))],
      top_performers: vids
        .sort((a, b) => parseFloat(b.performance_score) - parseFloat(a.performance_score))
        .slice(0, 3)
        .map(v => ({
          title: v.title,
          score: v.performance_score,
          summary: v.llm_summary?.substring(0, 200) + '...'
        }))
    }))
  };
  
  const prompt = `
Analyze this dataset of 280 high-performing YouTube videos (10x+ their channel baseline) from May-June 2025.

Find 5-7 transferable patterns that explain why these videos significantly outperformed expectations across different niches.

Dataset Summary:
${JSON.stringify(summaryData, null, 2)}

For each pattern you identify:
1. Pattern Name (concise, memorable)
2. Description (what makes videos with this pattern successful)
3. Psychological Trigger (why audiences respond to this)
4. Evidence Count (how many videos show this pattern)
5. Niches Count (how many different niches this appears in)
6. Transferability Score (1-10, how applicable across niches)
7. Key Elements (3-5 specific elements that define this pattern)
8. Example Titles (2-3 actual titles that demonstrate this pattern)

Focus on patterns that:
- Appear across multiple niches (not niche-specific trends)
- Have clear psychological/behavioral explanations
- Are actionable for content creators
- Show consistent performance correlation

Return as JSON array of pattern objects.
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert YouTube content analyst specializing in viral pattern discovery. Analyze data objectively and identify transferable patterns that work across niches."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 4000
    });

    const analysis = response.choices[0].message.content;
    
    // Try to parse JSON response
    try {
      // Extract JSON from markdown code blocks if present
      let jsonText = analysis;
      const jsonMatch = analysis.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      
      const patternsData = JSON.parse(jsonText);
      return Array.isArray(patternsData) ? patternsData : [];
    } catch (parseError) {
      console.log('⚠️  LLM response parsing failed, trying alternative extraction...');
      
      // Alternative: look for JSON array in the response
      const jsonArrayMatch = analysis.match(/\[\s*{[\s\S]*}\s*\]/);
      if (jsonArrayMatch) {
        try {
          const patternsData = JSON.parse(jsonArrayMatch[0]);
          return Array.isArray(patternsData) ? patternsData : [];
        } catch (e) {
          console.log('⚠️  Alternative parsing also failed');
        }
      }
      
      // Fallback: extract patterns from text response
      console.log('\n📝 LLM Analysis Response:');
      console.log(analysis);
      
      return [{
        pattern_name: "Analysis Completed",
        description: "LLM analysis completed but requires manual pattern extraction",
        raw_analysis: analysis
      }];
    }
    
  } catch (error) {
    console.error('❌ Error calling LLM:', error);
    return [];
  }
}

// Run the analysis
analyzeOutlierPatterns();