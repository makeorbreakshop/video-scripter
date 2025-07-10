#!/usr/bin/env node

/**
 * Split the bulk SQL file into smaller chunks for Supabase SQL editor
 */

import fs from 'fs';
import path from 'path';

const sqlFile = '/Users/brandoncullum/video-scripter/exports/bulk-update-topics.sql';
const outputDir = '/Users/brandoncullum/video-scripter/exports/sql-chunks';

// Create output directory
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log('📂 Reading SQL file...');
const sqlContent = fs.readFileSync(sqlFile, 'utf8');

// Find the VALUES section
const valuesStart = sqlContent.indexOf('INSERT INTO tmp_topic_assignments');
const valuesEnd = sqlContent.lastIndexOf(');') + 2;

const beforeValues = sqlContent.substring(0, valuesStart);
const valuesSection = sqlContent.substring(valuesStart, valuesEnd);
const afterValues = sqlContent.substring(valuesEnd);

// Extract individual value rows
const valueRows = valuesSection
  .split('\n')
  .filter(line => line.trim().startsWith('('))
  .map(line => line.trim());

console.log(`📊 Found ${valueRows.length} rows to split`);

// Split into chunks of 10,000 rows
const chunkSize = 10000;
const chunks = [];

for (let i = 0; i < valueRows.length; i += chunkSize) {
  const chunk = valueRows.slice(i, Math.min(i + chunkSize, valueRows.length));
  chunks.push(chunk);
}

console.log(`📝 Creating ${chunks.length} SQL files...`);

// File 1: Setup (create table)
const setupSql = `-- Part 1: Setup
${beforeValues}`;
fs.writeFileSync(path.join(outputDir, '01-setup.sql'), setupSql);

// Files 2-N: Insert chunks
chunks.forEach((chunk, index) => {
  const isLast = index === chunks.length - 1;
  const chunkSql = `-- Part ${index + 2}: Insert rows ${index * chunkSize + 1} to ${Math.min((index + 1) * chunkSize, valueRows.length)}
INSERT INTO tmp_topic_assignments (video_id, topic_level_1, topic_level_2, topic_level_3) VALUES
${chunk.join('\n')};`;
  
  fs.writeFileSync(path.join(outputDir, `${String(index + 2).padStart(2, '0')}-insert-chunk-${index + 1}.sql`), chunkSql);
});

// Final file: Update and verify
const finalSql = `-- Part ${chunks.length + 2}: Update videos and verify
${afterValues}`;
fs.writeFileSync(path.join(outputDir, `${String(chunks.length + 2).padStart(2, '0')}-update-and-verify.sql`), finalSql);

console.log(`\n✅ SQL split into ${chunks.length + 2} files in: ${outputDir}`);
console.log('\n📋 Instructions:');
console.log('1. Go to Supabase SQL Editor');
console.log('2. Run each file in order:');
console.log('   - 01-setup.sql (creates temp table)');
console.log(`   - 02 through ${String(chunks.length + 1).padStart(2, '0')} insert chunks`);
console.log(`   - ${String(chunks.length + 2).padStart(2, '0')}-update-and-verify.sql (performs update)`);
console.log('\nEach file should be small enough for the SQL editor!');