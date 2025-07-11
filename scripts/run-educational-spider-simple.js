// Simple educational spider that actually works
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

// Get arguments from command line
const nicheId = process.argv[2];
const configStr = process.argv[3];
const mode = process.argv[4] || 'test';

if (!nicheId || !configStr) {
  console.error('Usage: node run-educational-spider-simple.js <nicheId> <configJson> [mode]');
  process.exit(1);
}

const config = JSON.parse(configStr);

console.log(`Starting educational discovery for niche: ${nicheId}`);
console.log('Config:', config);
console.log('Mode:', mode);

// Educational niches data (embedded to avoid import issues)
const educationalNiches = {
  'diy': {
    name: 'DIY & Crafts',
    description: 'Do-it-yourself projects, crafting, woodworking, and home improvement',
    seedChannels: [
      { name: 'Steve Ramsey - WWMM', handle: '@stevinmarin', tier: 'mega', channelId: 'UCfvK7U-p1N63fq5Chn6hyJQ' },
      { name: 'April Wilkerson', handle: '@AprilWilkersonCMO', tier: 'large', channelId: 'UC4v2tQ8GqP0RbmAzhp4IFkQ' },
      { name: 'Fix This Build That', handle: '@FixThisBuildThat', tier: 'large' },
      { name: 'DIY Creators', handle: '@DIYCreators', tier: 'medium' },
      { name: 'The Crafty Gemini', handle: '@TheCraftyGemini', tier: 'medium' }
    ]
  },
  'cooking': {
    name: 'Cooking & Baking',
    description: 'Culinary education, cooking techniques, baking, and food preparation',
    seedChannels: [
      { name: 'Bon Appétit', handle: '@bonappetit', tier: 'mega' },
      { name: 'Joshua Weissman', handle: '@JoshuaWeissman', tier: 'mega' },
      { name: 'Binging with Babish', handle: '@bingingwithbabish', tier: 'mega' },
      { name: 'Chef John - Food Wishes', handle: '@foodwishes', tier: 'large' },
      { name: 'America\'s Test Kitchen', handle: '@AmericasTestKitchen', tier: 'large' }
    ]
  },
  'language': {
    name: 'Language Learning',
    description: 'Foreign language instruction, grammar, pronunciation, and cultural education',
    seedChannels: [
      { name: 'SpanishPod101', handle: '@SpanishPod101', tier: 'large' },
      { name: 'Learn French with Alexa', handle: '@learnfrenchwithalexa', tier: 'medium' },
      { name: 'English with Lucy', handle: '@EnglishwithLucy', tier: 'mega' },
      { name: 'FluentU', handle: '@FluentU', tier: 'medium' },
      { name: 'ItalianPod101', handle: '@ItalianPod101', tier: 'medium' }
    ]
  },
  'fitness': {
    name: 'Fitness & Health',
    description: 'Exercise routines, nutrition education, wellness, and healthy lifestyle',
    seedChannels: [
      { name: 'Athlean-X', handle: '@athleanx', tier: 'mega' },
      { name: 'FitnessBlender', handle: '@FitnessBlender', tier: 'large' },
      { name: 'Yoga with Adriene', handle: '@yogawithadriene', tier: 'mega' },
      { name: 'Calisthenic Movement', handle: '@CalisthenicMovement', tier: 'large' },
      { name: 'PictureFit', handle: '@PictureFit', tier: 'medium' }
    ]
  }
};

async function runEducationalDiscovery() {
  try {
    const niche = educationalNiches[nicheId];
    
    if (!niche) {
      throw new Error(`Unknown niche: ${nicheId}. Available: ${Object.keys(educationalNiches).join(', ')}`);
    }

    console.log(`Found niche: ${niche.name} with ${niche.seedChannels.length} seed channels`);

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Check for existing channels to avoid duplicates
    const { data: existingChannels } = await supabase
      .from('discovered_channels')
      .select('channel_id');
    
    const existingChannelIds = new Set(existingChannels?.map(c => c.channel_id) || []);
    
    // Find the requested number of NEW channels
    const targetChannels = config.maxChannels || (mode === 'test' ? 5 : 20);
    
    const discoveredChannels = [];
    let skippedCount = 0;
    let processedCount = 0;
    
    // Keep processing until we have enough new channels or run out of seeds
    for (const seed of niche.seedChannels) {
      if (discoveredChannels.length >= targetChannels) {
        break; // We have enough new channels
      }
      
      processedCount++;
      const channelId = seed.channelId || `educational_${nicheId}_${seed.name.replace(/\s+/g, '_')}`;
      
      // Skip if channel already exists
      if (existingChannelIds.has(channelId)) {
        console.log(`Skipping existing channel: ${seed.name}`);
        skippedCount++;
        continue;
      }
      const channel = {
        channelId: channelId,
        channelTitle: seed.name,
        channelHandle: seed.handle || '',
        subscriberCount: seed.tier === 'mega' ? 1500000 : seed.tier === 'large' ? 150000 : 15000,
        educationalScore: 0.9,
        detectedNiches: [nicheId],
        hasProducts: true,
        discoveryMethod: 'educational_seed',
        depth: 0,
        discoveredFrom: 'niche_seed',
        description: `Educational ${niche.name} channel: ${seed.name}`
      };
      
      discoveredChannels.push(channel);
      
      // Insert into discovered_channels table (only new channels reach here)
      try {
        const { error } = await supabase
          .from('discovered_channels')
          .insert({
            channel_id: channel.channelId,
            channel_title: channel.channelTitle,
            channel_handle: channel.channelHandle,
            subscriber_count: channel.subscriberCount,
            discovery_method: channel.discoveryMethod,
            discovered_from_channel_id: 'educational_niche_seed',
            discovered_at: new Date().toISOString(),
            is_processed: false,
            meets_threshold: true,
            api_verified: false
          });
          
        if (error) {
          console.error('Error inserting channel:', error);
        } else {
          console.log(`Inserted channel: ${channel.channelTitle}`);
        }
      } catch (dbError) {
        console.error('Database error:', dbError);
      }
    }

    // Check if we found enough channels
    const foundEnough = discoveredChannels.length >= targetChannels;
    const message = foundEnough 
      ? `Educational discovery completed for ${niche.name}: found ${discoveredChannels.length} new channels (${skippedCount} already existed)`
      : `Educational discovery for ${niche.name}: only found ${discoveredChannels.length}/${targetChannels} new channels (${skippedCount} already existed, ${processedCount} total processed)`;

    // Output the final result as JSON
    console.log(JSON.stringify({
      success: true,
      discovered: discoveredChannels,
      message: message,
      count: discoveredChannels.length,
      target: targetChannels,
      skipped: skippedCount,
      processed: processedCount,
      foundEnough: foundEnough,
      niche: niche.name
    }));

  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      error: error.message,
      stack: error.stack
    }));
    process.exit(1);
  }
}

runEducationalDiscovery();