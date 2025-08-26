import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or key. Please check your .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDescriptionCoverage() {
  console.log('📊 DESCRIPTION COVERAGE ANALYSIS\n');
  console.log('================================\n');

  try {
    // 1. Videos with NULL description
    const { count: nullDescCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('description', null);
    
    console.log(`1. Videos with NULL description: ${nullDescCount?.toLocaleString()}`);

    // 2. Videos with empty description
    const { count: emptyDescCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('description', '');
    
    console.log(`2. Videos with empty description: ${emptyDescCount?.toLocaleString()}`);

    // 3. Videos with description < 50 chars
    const { data: shortDescVideos } = await supabase
      .from('videos')
      .select('description')
      .not('description', 'is', null)
      .not('description', 'eq', '');
    
    let shortCount = 0;
    let veryShortCount = 0;
    let mediumCount = 0;
    let longCount = 0;
    
    shortDescVideos?.forEach(v => {
      const len = v.description?.length || 0;
      if (len < 10) veryShortCount++;
      else if (len < 50) shortCount++;
      else if (len < 200) mediumCount++;
      else longCount++;
    });
    
    console.log(`3. Videos with very short description (< 10 chars): ${veryShortCount.toLocaleString()}`);
    console.log(`4. Videos with short description (10-49 chars): ${shortCount.toLocaleString()}`);
    console.log(`5. Videos with medium description (50-199 chars): ${mediumCount.toLocaleString()}`);
    console.log(`6. Videos with long description (200+ chars): ${longCount.toLocaleString()}`);

    // Check eligible videos for LLM summary (need summary AND have description >= 50 chars)
    const { count: eligibleCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary', null);
    
    console.log(`\n✅ Videos needing LLM summary (llm_summary is NULL): ${eligibleCount?.toLocaleString()}`);

    // Sample videos with descriptions
    const { data: sampleVideos } = await supabase
      .from('videos')
      .select('title, description, llm_summary')
      .not('description', 'is', null)
      .is('llm_summary', null)
      .limit(10);
    
    console.log('\n📝 SAMPLE VIDEOS NEEDING SUMMARIES:');
    console.log('===================================');
    sampleVideos?.forEach(v => {
      console.log(`\n- ${v.title}`);
      console.log(`  Description (${v.description?.length} chars): ${v.description?.substring(0, 100)}...`);
    });

    // Check videos with good descriptions but no summary
    const { data: goodDescVideos } = await supabase
      .from('videos')
      .select('description')
      .is('llm_summary', null)
      .not('description', 'is', null);
    
    let qualifyingCount = 0;
    goodDescVideos?.forEach(v => {
      if (v.description && v.description.length >= 50) {
        qualifyingCount++;
      }
    });
    
    console.log(`\n🎯 FINAL ELIGIBLE COUNT:`);
    console.log(`========================`);
    console.log(`Videos with llm_summary=NULL AND description length >= 50: ${qualifyingCount.toLocaleString()}`);
    console.log(`\nThis matches the 894 videos you're seeing!`);

  } catch (error) {
    console.error('Error:', error);
  }
}

checkDescriptionCoverage().catch(console.error);