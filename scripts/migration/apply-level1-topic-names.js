#!/usr/bin/env node

/**
 * Apply Level 1 improved topic names to database
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function applyLevel1TopicNames() {
  console.log('🔄 Applying Level 1 improved topic names...');
  
  const updates = [
    { level: 1, topic_id: 0, name: 'Woodworking & Carpentry' },
    { level: 1, topic_id: 1, name: '3D Printing & Design' },
    { level: 1, topic_id: 2, name: 'Food & Cooking' },
    { level: 1, topic_id: 3, name: 'Laser Tools & Engraving' },
    { level: 1, topic_id: 4, name: 'Coffee Tables & Furniture' },
    { level: 1, topic_id: 5, name: 'Epoxy & Resin Projects' },
    { level: 1, topic_id: -1, name: 'Uncategorized' }
  ];
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const update of updates) {
    const { error, count } = await supabase
      .from('topic_categories')
      .update({ name: update.name, updated_at: new Date().toISOString() })
      .eq('level', update.level)
      .eq('topic_id', update.topic_id);
    
    if (error) {
      console.error(`❌ Error updating Topic ${update.topic_id}:`, error.message);
      errorCount++;
    } else {
      console.log(`✅ Updated Level 1 Topic ${update.topic_id}: ${update.name} (${count} records)`);
      successCount++;
    }
  }
  
  console.log(`\n📊 Results: ${successCount} successful, ${errorCount} errors`);
  
  // Verify the updates
  console.log('\n🔍 Verifying Level 1 topic names...');
  const { data, error } = await supabase
    .from('topic_categories')
    .select('level, topic_id, name, video_count')
    .eq('level', 1)
    .order('video_count', { ascending: false });
  
  if (error) {
    console.error('❌ Error verifying updates:', error.message);
  } else {
    console.log('\n📋 Current Level 1 Topics:');
    for (const topic of data) {
      console.log(`   Topic ${topic.topic_id}: ${topic.name} (${topic.video_count || 0} videos)`);
    }
  }
}

applyLevel1TopicNames().catch(console.error);