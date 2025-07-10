#!/usr/bin/env node

/**
 * Generate simple SQL UPDATE statements that can be run directly
 */

import fs from 'fs';
import csv from 'csv-parser';

const csvFile = '/Users/brandoncullum/video-scripter/exports/improved-topic-assignments-2025-07-10_13-40-28.csv';
const outputDir = '/Users/brandoncullum/video-scripter/exports/sql-updates';

// Create output directory
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function generateUpdates() {
  console.log('📂 Loading video assignments...');
  
  const assignments = [];
  
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvFile)
      .pipe(csv())
      .on('data', (row) => {
        const videoId = row.id;
        const level1 = parseInt(row.level_1___broad_domains_topic);
        const level2 = parseInt(row.level_2___niches_topic);
        const level3 = parseInt(row.level_3___micro_topics_topic);
        
        if (videoId && !isNaN(level1) && !isNaN(level2) && !isNaN(level3)) {
          assignments.push({ videoId, level1, level2, level3 });
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });
  
  console.log(`✅ Loaded ${assignments.length} assignments`);
  
  // Split into chunks of 1000 for manageable files
  const chunkSize = 1000;
  let fileIndex = 1;
  
  for (let i = 0; i < assignments.length; i += chunkSize) {
    const chunk = assignments.slice(i, i + chunkSize);
    
    let sql = `-- Update batch ${fileIndex} (${chunk.length} videos)\n`;
    sql += `-- Videos ${i + 1} to ${Math.min(i + chunkSize, assignments.length)}\n\n`;
    
    // Generate simple UPDATE statements
    chunk.forEach(a => {
      sql += `UPDATE videos SET topic_level_1 = ${a.level1}, topic_level_2 = ${a.level2}, topic_level_3 = ${a.level3} WHERE id = '${a.videoId}';\n`;
    });
    
    const filename = `${String(fileIndex).padStart(2, '0')}-update-batch-${fileIndex}.sql`;
    fs.writeFileSync(`${outputDir}/${filename}`, sql);
    
    console.log(`📝 Created ${filename} (${chunk.length} updates)`);
    fileIndex++;
  }
  
  // Create a verification file
  const verifySql = `-- Verification queries
SELECT 'Total videos with topics' as metric, COUNT(*) as count 
FROM videos WHERE topic_level_1 IS NOT NULL;

SELECT tc.name, COUNT(*) as video_count
FROM videos v
JOIN topic_categories tc ON tc.level = 1 AND tc.topic_id = v.topic_level_1
WHERE v.topic_level_1 IS NOT NULL
GROUP BY tc.topic_id, tc.name
ORDER BY COUNT(*) DESC;
`;
  
  fs.writeFileSync(`${outputDir}/99-verify-results.sql`, verifySql);
  
  console.log(`\n✅ Generated ${fileIndex - 1} SQL files in: ${outputDir}`);
  console.log('\n📋 You can now:');
  console.log('1. Run these in Supabase SQL editor (each file is small)');
  console.log('2. Or run them via the API using your existing connection');
}

generateUpdates().catch(console.error);