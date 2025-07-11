import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Get tracking summary
    const { data: summary } = await supabase
      .from('format_detection_feedback')
      .select('llm_was_used, keyword_confidence, created_at')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()); // Last 7 days
    
    if (!summary || summary.length === 0) {
      return NextResponse.json({
        keywordAccuracy: null,
        llmUsageRate: null,
        recommendedThreshold: 0.6,
        totalClassifications: 0,
        improvements: []
      });
    }
    
    // Calculate metrics
    const total = summary.length;
    const llmUsed = summary.filter(s => s.llm_was_used).length;
    const keywordOnly = total - llmUsed;
    const keywordAccuracy = ((keywordOnly / total) * 100).toFixed(1);
    const llmUsageRate = ((llmUsed / total) * 100).toFixed(1);
    
    // Get disagreement patterns
    const { data: disagreements } = await supabase
      .from('format_detection_feedback')
      .select('keyword_format, llm_format')
      .eq('llm_was_used', true)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    const patterns = {};
    disagreements?.forEach(d => {
      if (d.keyword_format !== d.llm_format) {
        const key = `${d.keyword_format} → ${d.llm_format}`;
        patterns[key] = (patterns[key] || 0) + 1;
      }
    });
    
    const topPatterns = Object.entries(patterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pattern, count]) => ({ pattern, count }));
    
    // Calculate recommended threshold
    const confidences = summary.map(s => s.keyword_confidence);
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const recommendedThreshold = Math.round((avgConfidence + 0.1) * 10) / 10; // Slightly above average
    
    return NextResponse.json({
      keywordAccuracy: parseFloat(keywordAccuracy),
      llmUsageRate: parseFloat(llmUsageRate),
      recommendedThreshold,
      totalClassifications: total,
      topCorrections: topPatterns,
      improvements: [
        `Keyword accuracy: ${keywordAccuracy}%`,
        `LLM usage reduced to ${llmUsageRate}%`,
        `${Object.keys(patterns).length} correction patterns identified`
      ]
    });
    
  } catch (error) {
    console.error('Error fetching classification insights:', error);
    return NextResponse.json({ error: 'Failed to fetch insights' }, { status: 500 });
  }
}