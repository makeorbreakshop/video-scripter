import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Define all the niche mappings
const nicheMappings = [
  { niche: 'Woodworking', domain: 'DIY & Crafts', clusters: [0, 15, 51, 64, 124, 153, 173, 178, 185] },
  { niche: 'Metalworking', domain: 'DIY & Crafts', clusters: [57, 167, 170] },
  { niche: 'Workshop', domain: 'DIY & Crafts', clusters: [176, 179, 191, 196, 210, 214] },
  { niche: 'Digital Fabrication', domain: 'DIY & Crafts', clusters: [35] },
  { niche: 'Sewing & Textiles', domain: 'DIY & Crafts', clusters: [118] },
  { niche: 'Home DIY', domain: 'DIY & Crafts', clusters: [104] },
  { niche: 'Crafts', domain: 'DIY & Crafts', clusters: [116, 197] },
  { niche: 'Other', domain: 'DIY & Crafts', clusters: [138, 204] },
  
  { niche: 'Programming', domain: 'Technology', clusters: [59, 165, 175, 183] },
  { niche: 'Photography & Video', domain: 'Technology', clusters: [12, 41, 114, 143] },
  { niche: 'Electronics', domain: 'Technology', clusters: [112, 132, 155, 159] },
  { niche: '3D Printing', domain: 'Technology', clusters: [22, 97] },
  { niche: 'AI & Innovation', domain: 'Technology', clusters: [17, 202] },
  { niche: 'Audio Technology', domain: 'Technology', clusters: [10] },
  { niche: 'Gaming Tech', domain: 'Technology', clusters: [28] },
  { niche: 'Electric Vehicles', domain: 'Technology', clusters: [5, 33] },
  { niche: 'Mobile & Computing', domain: 'Technology', clusters: [154] },
  { niche: 'Tech Industry', domain: 'Technology', clusters: [43, 122] },
  { niche: 'Other', domain: 'Technology', clusters: [8, 90] },
  
  { niche: 'Digital Marketing', domain: 'Business', clusters: [9, 14, 34, 201] },
  { niche: 'E-commerce', domain: 'Business', clusters: [42, 68, 158, 193] },
  { niche: 'Entrepreneurship', domain: 'Business', clusters: [16, 168] },
  { niche: 'Finance & Trading', domain: 'Business', clusters: [1] },
  { niche: 'Business Strategy', domain: 'Business', clusters: [123] },
  { niche: 'Creative Business', domain: 'Business', clusters: [53] },
  { niche: 'Other', domain: 'Business', clusters: [32, 101, 128, 129, 145, 212] },
  
  { niche: 'Music Production', domain: 'Music', clusters: [29, 79, 83, 89] },
  { niche: 'Instruments', domain: 'Music', clusters: [6, 63, 85, 91, 166] },
  { niche: 'Music Gear', domain: 'Music', clusters: [77, 94] },
  { niche: 'Performance', domain: 'Music', clusters: [55, 211] },
  { niche: 'Music Business', domain: 'Music', clusters: [184, 188] },
  { niche: 'Music Theory', domain: 'Music', clusters: [209] },
  { niche: 'Other', domain: 'Music', clusters: [152, 194] },
  
  { niche: 'Gameplay', domain: 'Gaming', clusters: [18, 20, 93, 99, 109, 111, 135, 163] },
  
  { niche: 'Home & Organization', domain: 'Lifestyle', clusters: [2, 36, 117, 160, 169] },
  { niche: 'Alternative Living', domain: 'Lifestyle', clusters: [4, 125, 198] },
  { niche: 'Fashion & Beauty', domain: 'Lifestyle', clusters: [54, 126, 181, 205, 207] },
  { niche: 'Wellness', domain: 'Lifestyle', clusters: [56] },
  { niche: 'Family Life', domain: 'Lifestyle', clusters: [44, 136] },
  { niche: 'Daily Vlogs', domain: 'Lifestyle', clusters: [62] },
  { niche: 'Other', domain: 'Lifestyle', clusters: [27, 31, 50, 67, 121, 162, 164, 195] }
];

async function updateHierarchy() {
  console.log('Starting hierarchy update...');
  
  let totalUpdated = 0;
  
  // Update each niche mapping
  for (const mapping of nicheMappings) {
    console.log(`\nUpdating ${mapping.domain} > ${mapping.niche}...`);
    
    // Update in chunks of 10 clusters at a time
    for (let i = 0; i < mapping.clusters.length; i += 10) {
      const clusterBatch = mapping.clusters.slice(i, i + 10);
      
      const { error, count } = await supabase
        .from('videos')
        .update({ 
          topic_domain: mapping.domain,
          topic_niche: mapping.niche 
        })
        .in('topic_cluster_id', clusterBatch)
        .eq('bertopic_version', 'v1_2025-08-01');
        
      if (error) {
        console.error(`Error updating clusters ${clusterBatch}:`, error);
      } else {
        console.log(`  Updated clusters: ${clusterBatch.join(', ')}`);
        totalUpdated += count || 0;
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Update outliers
  console.log('\nUpdating outliers...');
  const { error: outlierError, count: outlierCount } = await supabase
    .from('videos')
    .update({ 
      topic_domain: 'Outlier',
      topic_niche: 'Outlier',
      topic_micro: 'Outlier'
    })
    .eq('topic_cluster_id', -1)
    .eq('bertopic_version', 'v1_2025-08-01');
    
  if (outlierError) {
    console.error('Error updating outliers:', outlierError);
  } else {
    console.log(`Updated ${outlierCount} outliers`);
    totalUpdated += outlierCount || 0;
  }
  
  console.log(`\nTotal videos updated: ${totalUpdated}`);
  console.log('\nDone! Remember to refresh the materialized view.');
}

updateHierarchy().catch(console.error);