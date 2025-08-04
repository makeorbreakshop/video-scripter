import fs from 'fs/promises';

async function generateSQL() {
  // Load the new hierarchy
  const newMapping = JSON.parse(
    await fs.readFile('./data/bertopic/better_topic_names_v3_proper_hierarchy.json', 'utf-8')
  );
  
  let sql = `-- Fast SQL update for BERTopic hierarchy v3
-- This updates all videos in a single pass using a temporary mapping table

-- Create temporary mapping table
CREATE TEMP TABLE topic_hierarchy_mapping (
  cluster_id INTEGER PRIMARY KEY,
  new_domain TEXT,
  new_niche TEXT,
  new_micro TEXT
);

-- Insert all mappings
INSERT INTO topic_hierarchy_mapping VALUES
`;

  // Generate INSERT values
  const values = [];
  Object.entries(newMapping.topics).forEach(([clusterId, topic]) => {
    const domain = topic.category.replace(/'/g, "''");
    const niche = topic.subcategory.replace(/'/g, "''");
    const micro = topic.name.replace(/'/g, "''");
    values.push(`(${clusterId}, '${domain}', '${niche}', '${micro}')`);
  });
  
  sql += values.join(',\n') + ';\n\n';
  
  sql += `-- Update all videos in a single query
UPDATE videos v
SET 
  topic_domain = COALESCE(m.new_domain, v.topic_domain),
  topic_niche = COALESCE(m.new_niche, v.topic_niche),
  topic_micro = COALESCE(m.new_micro, v.topic_micro)
FROM topic_hierarchy_mapping m
WHERE v.topic_cluster_id = m.cluster_id
  AND v.bertopic_version = 'v1_2025-08-01';

-- Handle outliers
UPDATE videos
SET 
  topic_domain = 'Outlier',
  topic_niche = 'Outlier',
  topic_micro = 'Outlier'
WHERE topic_cluster_id = -1
  AND bertopic_version = 'v1_2025-08-01';

-- Drop temporary table
DROP TABLE topic_hierarchy_mapping;

-- Show update counts
SELECT 
  topic_domain,
  topic_niche,
  COUNT(*) as video_count
FROM videos
WHERE bertopic_version = 'v1_2025-08-01'
GROUP BY topic_domain, topic_niche
ORDER BY topic_domain, topic_niche;`;
  
  await fs.writeFile('./sql/update-topic-hierarchy-complete.sql', sql);
  console.log('SQL file generated: ./sql/update-topic-hierarchy-complete.sql');
  console.log('This will update all videos in seconds instead of minutes!');
}

generateSQL().catch(console.error);