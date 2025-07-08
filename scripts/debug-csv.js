#!/usr/bin/env node

const fs = require('fs');
const csv = require('csv-parser');

console.log('🔍 Debugging CSV structure...');

let count = 0;
const results = [];

fs.createReadStream('cluster_results_20250708_143617.csv')
  .pipe(csv())
  .on('data', (row) => {
    count++;
    if (count <= 5) {
      console.log(`Row ${count}:`, {
        video_id: row.video_id,
        title: row.title?.substring(0, 50) + '...',
        cluster: row.cluster,
        cluster_type: typeof row.cluster,
        cluster_parsed: parseInt(row.cluster)
      });
    }
    
    if (row.cluster && !isNaN(parseInt(row.cluster))) {
      results.push({
        cluster: parseInt(row.cluster),
        title: row.title
      });
    }
  })
  .on('end', () => {
    console.log(`\nTotal rows processed: ${count}`);
    console.log(`Valid clusters found: ${results.length}`);
    
    if (results.length > 0) {
      console.log('\nFirst 5 valid clusters:');
      results.slice(0, 5).forEach((r, i) => {
        console.log(`${i + 1}. Cluster ${r.cluster}: "${r.title.substring(0, 50)}..."`);
      });
    }
  })
  .on('error', (error) => {
    console.error('Error:', error);
  });