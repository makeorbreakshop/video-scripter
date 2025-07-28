#!/usr/bin/env node

/**
 * Audit our transcript downloads to see what we actually have
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function auditTranscripts() {
  console.log('🔍 Auditing Transcript Downloads\n');

  // Get all transcripts
  const { data: transcripts, error } = await supabase
    .from('transcripts')
    .select(`
      video_id,
      word_count,
      fetched_from,
      fetched_at,
      videos!inner(
        title,
        channel_name
      )
    `)
    .order('fetched_at', { ascending: true });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Total transcripts in database: ${transcripts.length}\n`);

  // Group by source
  const bySource = {};
  transcripts.forEach(t => {
    const source = t.fetched_from || 'unknown';
    bySource[source] = (bySource[source] || 0) + 1;
  });

  console.log('📊 Transcripts by source:');
  Object.entries(bySource).forEach(([source, count]) => {
    console.log(`  ${source}: ${count}`);
  });

  // Group by fetch date
  console.log('\n📅 Transcripts by date:');
  const byDate = {};
  transcripts.forEach(t => {
    const date = new Date(t.fetched_at).toLocaleDateString();
    byDate[date] = (byDate[date] || 0) + 1;
  });
  
  Object.entries(byDate)
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .forEach(([date, count]) => {
      console.log(`  ${date}: ${count} transcripts`);
    });

  // Show Supadata transcripts specifically
  const supadataTranscripts = transcripts.filter(t => t.fetched_from === 'supadata');
  console.log(`\n🎯 Supadata transcripts: ${supadataTranscripts.length}`);
  
  if (supadataTranscripts.length > 0) {
    console.log('\nSupadata transcript details:');
    supadataTranscripts.forEach((t, i) => {
      console.log(`${i + 1}. ${t.videos.title.substring(0, 50)}...`);
      console.log(`   Channel: ${t.videos.channel_name}`);
      console.log(`   Words: ${t.word_count}`);
      console.log(`   Fetched: ${new Date(t.fetched_at).toLocaleString()}`);
      console.log('');
    });
  }

  // Check for duplicates or test runs
  const videoIds = transcripts.map(t => t.video_id);
  const uniqueVideoIds = [...new Set(videoIds)];
  if (videoIds.length !== uniqueVideoIds.length) {
    console.log(`\n⚠️  Found ${videoIds.length - uniqueVideoIds.length} duplicate entries`);
  }

  // Summary
  console.log('\n📈 Summary:');
  console.log(`- Total unique videos with transcripts: ${uniqueVideoIds.length}`);
  console.log(`- Average words per transcript: ${Math.round(transcripts.reduce((sum, t) => sum + t.word_count, 0) / transcripts.length)}`);
  console.log(`- Supadata API credits actually used: 4 (according to dashboard)`);
  console.log(`- Discrepancy: We have ${supadataTranscripts.length} Supadata transcripts but dashboard shows 4 credits used`);
}

auditTranscripts();