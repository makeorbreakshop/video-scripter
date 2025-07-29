#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';

async function findDuplicates() {
  const batchFiles = [
    'llm-summaries-batch-1.jsonl',
    'llm-summaries-batch-2.jsonl', 
    'llm-summaries-batch-3.jsonl',
    'llm-summaries-batch-4.jsonl',
    'llm-summaries-batch-5.jsonl',
    'llm-summaries-batch-6.jsonl'
  ];

  for (const filename of batchFiles) {
    console.log(`\nChecking ${filename}...`);
    
    try {
      const seen = new Set();
      const duplicates = new Set();
      let lineNumber = 0;
      
      const fileStream = fs.createReadStream(filename);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        lineNumber++;
        try {
          const obj = JSON.parse(line);
          const id = obj.custom_id;
          
          if (seen.has(id)) {
            duplicates.add(id);
            console.log(`  Duplicate found at line ${lineNumber}: ${id}`);
          } else {
            seen.add(id);
          }
        } catch (e) {
          console.log(`  Error parsing line ${lineNumber}: ${e.message}`);
        }
      }
      
      console.log(`  Total lines: ${lineNumber}`);
      console.log(`  Unique IDs: ${seen.size}`);
      console.log(`  Duplicates: ${duplicates.size}`);
      
    } catch (error) {
      console.log(`  File not found or error: ${error.message}`);
    }
  }

  // Now check for duplicates across files
  console.log('\n\nChecking for duplicates ACROSS batch files...');
  const allIds = new Map(); // id -> [file1, file2, ...]
  
  for (const filename of batchFiles) {
    try {
      const fileStream = fs.createReadStream(filename);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        try {
          const obj = JSON.parse(line);
          const id = obj.custom_id;
          
          if (!allIds.has(id)) {
            allIds.set(id, []);
          }
          allIds.get(id).push(filename);
        } catch (e) {
          // Skip parsing errors
        }
      }
    } catch (error) {
      // Skip missing files
    }
  }
  
  let crossFileDuplicates = 0;
  for (const [id, files] of allIds) {
    if (files.length > 1) {
      crossFileDuplicates++;
      if (crossFileDuplicates <= 10) {
        console.log(`  ${id} appears in: ${files.join(', ')}`);
      }
    }
  }
  
  console.log(`\nTotal unique video IDs across all files: ${allIds.size}`);
  console.log(`IDs appearing in multiple files: ${crossFileDuplicates}`);
}

findDuplicates().catch(console.error);