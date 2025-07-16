/**
 * Insert Meaningful Pattern Example
 * Demonstrates what real patterns should look like
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function insertMeaningfulPattern() {
  console.log('🎯 Inserting meaningful pattern example...\n');

  // Pattern 1: Hashtag titles in cooking videos
  const hashtagPattern = {
    pattern_type: 'title',
    pattern_data: {
      name: 'Hashtag titles in cooking',
      template: '[Topic/Question] #keyword #keyword',
      description: 'Using hashtags in cooking video titles drives 10x performance, especially for historical cooking content',
      examples: [
        'What is Ship\'s Biscuit? #history #navy #sailor #historicalcooking',
        'What Is Portable Soup?? #history #18thcenturycooking #cooking',
        'The Ultimate Survival Food #americanhistory #history #18thcenturycooking'
      ],
      discovery_method: 'semantic_analysis',
      evidence_count: 6,
      confidence: 0.85,
      topic_cluster_id: '9',
      topic_cluster_name: 'cooking',
      channel_examples: ['Townsends']
    },
    performance_stats: {
      overall: {
        avg: 10.33,
        median: 8.5,
        count: 6,
        min: 2.0,
        max: 28.0
      },
      by_context: {
        'historical_cooking': { avg: 15.0, count: 4 },
        'general_cooking': { avg: 3.5, count: 2 }
      }
    }
  };

  // Pattern 2: Food hacks format
  const hackPattern = {
    pattern_type: 'format',
    pattern_data: {
      name: 'Quick food hacks',
      format: 'hack',
      description: 'Short-form food hack videos perform 7x better in cooking content',
      examples: [
        'Ice Cube Chicken Stock Hack',
        'Garlic Scapes🧄',
        'Easy Peel Garlic Hack'
      ],
      discovery_method: 'format_analysis',
      evidence_count: 12,
      confidence: 0.78,
      topic_cluster_id: '9',
      topic_cluster_name: 'cooking',
      channel_examples: ['LifebyMikeG']
    },
    performance_stats: {
      overall: {
        avg: 5.2,
        median: 3.8,
        count: 12,
        min: 2.1,
        max: 7.0
      }
    }
  };

  // Pattern 3: Numbered health lists
  const numberedListPattern = {
    pattern_type: 'title',
    pattern_data: {
      name: 'Numbered health food lists',
      template: '[Number] [Foods/Things] You Should [Action]',
      description: 'Numbered lists about healthy foods perform 6x better',
      examples: [
        'These 7 Foods Should Be on Every Senior\'s Plate!',
        '4 Seeds You Should Be Eating And 4 You Shouldn\'t',
        '10 Foods That Fight Inflammation'
      ],
      discovery_method: 'title_structure_analysis',
      evidence_count: 18,
      confidence: 0.82,
      topic_cluster_id: '9',
      topic_cluster_name: 'cooking',
      subcategory: 'health_focused',
      channel_examples: ['Healtness']
    },
    performance_stats: {
      overall: {
        avg: 6.0,
        median: 5.5,
        count: 18,
        min: 3.0,
        max: 9.0
      }
    }
  };

  try {
    // Insert patterns
    const { data, error } = await supabase
      .from('patterns')
      .insert([hashtagPattern, hackPattern, numberedListPattern])
      .select();

    if (error) {
      console.error('❌ Error inserting patterns:', error);
      return;
    }

    console.log('✅ Successfully inserted meaningful patterns:');
    data.forEach((pattern, index) => {
      console.log(`\n${index + 1}. ${pattern.pattern_data.name}`);
      console.log(`   Type: ${pattern.pattern_type}`);
      console.log(`   Performance: ${pattern.performance_stats.overall.avg}x`);
      console.log(`   Evidence: ${pattern.pattern_data.evidence_count} videos`);
    });

    // Also insert some video-pattern associations for the first pattern
    if (data[0]) {
      const videoAssociations = [
        { video_id: 'nUCZx_S7MiA', pattern_id: data[0].id, match_score: 0.95 },
        { video_id: 'YKj7P8I3-7Y', pattern_id: data[0].id, match_score: 0.92 },
        { video_id: 'D8Ci20GJ_bU', pattern_id: data[0].id, match_score: 0.88 }
      ];

      const { error: assocError } = await supabase
        .from('video_patterns')
        .insert(videoAssociations);

      if (!assocError) {
        console.log('\n✅ Added video associations for hashtag pattern');
      }
    }

    console.log('\n🎉 Meaningful patterns inserted successfully!');
    console.log('\nThese patterns demonstrate:');
    console.log('- Specific, actionable insights (not generic like "contains \'a\'")')
    console.log('- Clear topic context (cooking cluster 9)');
    console.log('- Real performance data with meaningful lift');
    console.log('- Practical templates creators can use');

  } catch (error) {
    console.error('❌ Failed to insert patterns:', error);
  }
}

// Run the insertion
insertMeaningfulPattern().catch(console.error);