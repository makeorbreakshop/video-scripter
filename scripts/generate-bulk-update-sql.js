#!/usr/bin/env node

/**
 * Generate SQL file for bulk updating video topic assignments
 * Uses temporary table approach for maximum efficiency
 */

import fs from 'fs';
import csv from 'csv-parser';

class BulkUpdateSQLGenerator {
  constructor() {
    this.csvFile = '/Users/brandoncullum/video-scripter/exports/improved-topic-assignments-2025-07-10_13-40-28.csv';
    this.outputFile = '/Users/brandoncullum/video-scripter/exports/bulk-update-topics.sql';
    this.videoAssignments = [];
  }

  async loadAssignments() {
    console.log('📂 Loading improved BERTopic video assignments...');
    
    return new Promise((resolve, reject) => {
      const assignments = [];
      
      fs.createReadStream(this.csvFile)
        .pipe(csv())
        .on('data', (row) => {
          const videoId = row.id;
          const level1Topic = parseInt(row.level_1___broad_domains_topic);
          const level2Topic = parseInt(row.level_2___niches_topic);
          const level3Topic = parseInt(row.level_3___micro_topics_topic);
          
          if (videoId && !isNaN(level1Topic) && !isNaN(level2Topic) && !isNaN(level3Topic)) {
            assignments.push({
              video_id: videoId,
              level_1: level1Topic,
              level_2: level2Topic,
              level_3: level3Topic
            });
          }
        })
        .on('end', () => {
          this.videoAssignments = assignments;
          console.log(`✅ Loaded ${assignments.length} video topic assignments`);
          resolve();
        })
        .on('error', reject);
    });
  }

  generateSQL() {
    console.log('📝 Generating efficient bulk update SQL...');
    
    let sql = `-- Bulk Update Video Topic Assignments
-- Generated: ${new Date().toISOString()}
-- Total videos: ${this.videoAssignments.length}

BEGIN;

-- Create temporary table for topic assignments
CREATE TEMP TABLE tmp_topic_assignments (
    video_id VARCHAR(255) PRIMARY KEY,
    topic_level_1 INTEGER,
    topic_level_2 INTEGER,
    topic_level_3 INTEGER
);

-- Insert all assignments using VALUES (most efficient for this size)
INSERT INTO tmp_topic_assignments (video_id, topic_level_1, topic_level_2, topic_level_3) VALUES
`;

    // Generate VALUES clauses in chunks to avoid line length issues
    const values = this.videoAssignments.map((assignment, index) => {
      const isLast = index === this.videoAssignments.length - 1;
      return `('${assignment.video_id}', ${assignment.level_1}, ${assignment.level_2}, ${assignment.level_3})${isLast ? ';' : ''}`;
    });
    
    // Join with newlines every 100 values for readability
    for (let i = 0; i < values.length; i += 100) {
      sql += values.slice(i, i + 100).join(',\n') + '\n';
    }

    sql += `
-- Update videos table from temporary table (single operation)
UPDATE videos v
SET 
    topic_level_1 = t.topic_level_1,
    topic_level_2 = t.topic_level_2,
    topic_level_3 = t.topic_level_3,
    updated_at = NOW()
FROM tmp_topic_assignments t
WHERE v.id = t.video_id;

-- Get update statistics
SELECT 
    'Videos updated' as operation,
    COUNT(*) as count
FROM videos v
INNER JOIN tmp_topic_assignments t ON v.id = t.video_id;

-- Verify Level 1 distribution
SELECT 
    tc.topic_id,
    tc.name,
    COUNT(*) as video_count
FROM videos v
LEFT JOIN topic_categories tc ON tc.level = 1 AND tc.topic_id = v.topic_level_1
WHERE v.topic_level_1 IS NOT NULL
GROUP BY tc.topic_id, tc.name
ORDER BY COUNT(*) DESC
LIMIT 10;

-- Clean up
DROP TABLE tmp_topic_assignments;

COMMIT;

-- Summary query
SELECT 
    'Total videos with topic assignments' as metric,
    COUNT(*) as value
FROM videos
WHERE topic_level_1 IS NOT NULL;
`;

    return sql;
  }

  async generateCopyApproach() {
    console.log('📝 Generating COPY-based SQL (alternative approach)...');
    
    // First, create a CSV file formatted for COPY
    const copyDataFile = '/Users/brandoncullum/video-scripter/exports/topic-assignments-for-copy.csv';
    const csvContent = this.videoAssignments
      .map(a => `${a.video_id},${a.level_1},${a.level_2},${a.level_3}`)
      .join('\n');
    
    fs.writeFileSync(copyDataFile, csvContent);
    
    const copySql = `-- Bulk Update using COPY (fastest approach)
-- Generated: ${new Date().toISOString()}
-- Total videos: ${this.videoAssignments.length}

BEGIN;

-- Create temporary table
CREATE TEMP TABLE tmp_topic_assignments (
    video_id VARCHAR(255),
    topic_level_1 INTEGER,
    topic_level_2 INTEGER,
    topic_level_3 INTEGER
);

-- Use COPY to load data (execute this from psql or pgAdmin)
-- \\COPY tmp_topic_assignments FROM '${copyDataFile}' WITH (FORMAT csv);

-- Or use this if running from Supabase SQL editor:
-- You'll need to paste the CSV data between the $$ delimiters
COPY tmp_topic_assignments FROM STDIN WITH (FORMAT csv);
-- [PASTE CSV DATA HERE]
\\.

-- Update videos table
UPDATE videos v
SET 
    topic_level_1 = t.topic_level_1,
    topic_level_2 = t.topic_level_2,
    topic_level_3 = t.topic_level_3,
    updated_at = NOW()
FROM tmp_topic_assignments t
WHERE v.id = t.video_id;

COMMIT;
`;

    return { copySql, copyDataFile };
  }

  async run() {
    console.log('🚀 Generating Bulk Update SQL\n');
    
    try {
      await this.loadAssignments();
      
      // Generate main SQL with VALUES
      const sql = this.generateSQL();
      fs.writeFileSync(this.outputFile, sql);
      console.log(`✅ SQL file generated: ${this.outputFile}`);
      console.log(`   File size: ${(sql.length / 1024 / 1024).toFixed(2)} MB`);
      
      // Also generate COPY approach
      const { copySql, copyDataFile } = await this.generateCopyApproach();
      const copyOutputFile = '/Users/brandoncullum/video-scripter/exports/bulk-update-topics-copy.sql';
      fs.writeFileSync(copyOutputFile, copySql);
      console.log(`\n✅ Alternative COPY approach generated:`);
      console.log(`   SQL: ${copyOutputFile}`);
      console.log(`   Data: ${copyDataFile}`);
      
      console.log('\n📋 Next steps:');
      console.log('1. Open Supabase SQL editor');
      console.log('2. Paste and execute the SQL from one of these files:');
      console.log(`   - ${this.outputFile} (self-contained with VALUES)`);
      console.log(`   - ${copyOutputFile} (requires CSV data paste)`);
      console.log('3. The update will complete in seconds!');
      
    } catch (error) {
      console.error('❌ Generation failed:', error.message);
    }
  }
}

const generator = new BulkUpdateSQLGenerator();
generator.run();