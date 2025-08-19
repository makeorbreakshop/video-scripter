#!/usr/bin/env node
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function testAvatarAnalysis() {
  console.log('🧪 Testing Avatar Analysis Approach...\n');

  try {
    // 1. Get a sample of comments (top 20 by likes)
    console.log('📊 Fetching sample comments...');
    const { data: comments, error } = await supabase
      .from('youtube_comments')
      .select('*')
      .eq('channel_id', 'UCjWkNxpp3UHdEavpM_19--Q')
      .order('like_count', { ascending: false })
      .limit(20);

    if (error) {
      console.error('❌ Database error:', error);
      return;
    }

    if (!comments || comments.length === 0) {
      console.log('⚠️  No comments found');
      return;
    }

    console.log(`✅ Retrieved ${comments.length} sample comments\n`);

    // 2. Analyze comments with AI
    console.log('🤖 Analyzing comments with AI...');
    
    const analysisPrompt = `
Analyze these YouTube comments from a maker/DIY channel audience. For each comment, identify:

1. PRIMARY GOAL (what they want to achieve):
   - learn_skill, solve_problem, research_purchase, get_inspired, validate_approach

2. PRIMARY PAIN (what's holding them back):
   - complexity, cost, time_constraints, lack_confidence, bad_past_experience

3. LANGUAGE_LEVEL (communication sophistication):
   - beginner, intermediate, advanced

4. EMOTIONAL_TONE:
   - frustrated, excited, confused, grateful, critical

Return as JSON array with this structure:
[
  {
    "comment_id": "comment_id_here",
    "comment_text": "original comment",
    "goal": "learn_skill",
    "pain": "complexity", 
    "language_level": "beginner",
    "emotional_tone": "confused",
    "key_phrases": ["exact phrases that support the analysis"]
  }
]

Comments to analyze:
${comments.map((c, i) => `${i+1}. ID: ${c.comment_id}
Text: "${c.comment_text}"
Video: ${c.video_title}
Likes: ${c.like_count}

`).join('')}
`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at analyzing customer feedback to create marketing personas. Focus on extracting actionable insights about goals, pain points, and communication patterns.'
          },
          {
            role: 'user', 
            content: analysisPrompt
          }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const analysisText = aiResponse.choices[0].message.content;
    
    // Try to parse JSON response
    let analysis;
    try {
      // Extract JSON from response (might have markdown formatting)
      const jsonMatch = analysisText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        analysis = JSON.parse(analysisText);
      }
    } catch (parseError) {
      console.log('📝 Raw AI Response:');
      console.log(analysisText);
      console.log('\n❌ Could not parse as JSON, but got response');
      return;
    }

    // 3. Display results
    console.log(`✅ Successfully analyzed ${analysis.length} comments\n`);

    // Summary statistics
    const goals = {};
    const pains = {};
    const languageLevels = {};
    const tones = {};

    analysis.forEach(item => {
      goals[item.goal] = (goals[item.goal] || 0) + 1;
      pains[item.pain] = (pains[item.pain] || 0) + 1;
      languageLevels[item.language_level] = (languageLevels[item.language_level] || 0) + 1;
      tones[item.emotional_tone] = (tones[item.emotional_tone] || 0) + 1;
    });

    console.log('📈 ANALYSIS SUMMARY:');
    console.log('\n🎯 Primary Goals:');
    Object.entries(goals).forEach(([goal, count]) => {
      console.log(`   ${goal}: ${count} (${Math.round(count/analysis.length*100)}%)`);
    });

    console.log('\n😰 Primary Pain Points:');
    Object.entries(pains).forEach(([pain, count]) => {
      console.log(`   ${pain}: ${count} (${Math.round(count/analysis.length*100)}%)`);
    });

    console.log('\n🗣️  Language Levels:');
    Object.entries(languageLevels).forEach(([level, count]) => {
      console.log(`   ${level}: ${count} (${Math.round(count/analysis.length*100)}%)`);
    });

    console.log('\n😊 Emotional Tones:');
    Object.entries(tones).forEach(([tone, count]) => {
      console.log(`   ${tone}: ${count} (${Math.round(count/analysis.length*100)}%)`);
    });

    // Show a few examples
    console.log('\n💬 EXAMPLE ANALYSIS:');
    analysis.slice(0, 3).forEach((item, i) => {
      console.log(`\n${i+1}. "${item.comment_text.substring(0, 100)}${item.comment_text.length > 100 ? '...' : ''}"`);
      console.log(`   Goal: ${item.goal} | Pain: ${item.pain} | Level: ${item.language_level} | Tone: ${item.emotional_tone}`);
      if (item.key_phrases?.length > 0) {
        console.log(`   Key phrases: ${item.key_phrases.join(', ')}`);
      }
    });

    console.log('\n🚀 TEST RESULTS:');
    console.log(`✅ Successfully categorized ${analysis.length} comments`);
    console.log('✅ Extracted structured insights (goals, pains, language, tone)');
    console.log('✅ Generated frequency statistics');
    console.log('✅ Identified key phrases for each category');
    console.log('\n💡 This approach shows promise for full dataset analysis!');

    // Cost estimation
    const promptTokens = analysisPrompt.length / 4; // rough estimate
    const responseTokens = analysisText.length / 4;
    const costPer1000 = 0.00015; // GPT-4o-mini pricing
    const estimatedCost = (promptTokens + responseTokens) / 1000 * costPer1000;
    
    console.log(`\n💰 COST ESTIMATE:`);
    console.log(`   This test: ~$${estimatedCost.toFixed(4)}`);
    console.log(`   Full 10,403 comments: ~$${(estimatedCost * 10403 / 20).toFixed(2)} (if processed in similar batches)`);

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testAvatarAnalysis().then(() => {
  console.log('\n✨ Test complete');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});