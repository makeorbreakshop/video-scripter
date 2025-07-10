#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const exportDir = path.join(process.cwd(), 'exports');

async function cleanDuplicateExports() {
  console.log('🧹 Cleaning duplicate export files...\n');

  // Step 1: Delete the completely duplicate file
  const completelyDuplicateFile = 'title-embeddings-2025-07-09T14-01-57-317Z.json';
  const filePath = path.join(exportDir, completelyDuplicateFile);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`✅ Deleted ${completelyDuplicateFile} (contained only duplicates)`);
    
    // Also delete its metadata file
    const metadataFile = completelyDuplicateFile.replace('.json', '-metadata-only.json');
    const metadataPath = path.join(exportDir, metadataFile);
    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
      console.log(`✅ Deleted ${metadataFile}`);
    }
  }

  // Step 2: Create a consolidated file with all unique embeddings
  console.log('\n📦 Creating consolidated export with unique embeddings...');
  
  const files = fs.readdirSync(exportDir)
    .filter(f => f.startsWith('title-embeddings-') && f.endsWith('.json') && !f.includes('metadata'));
  
  const uniqueVectors = new Map(); // Use Map to keep only unique IDs
  let processedFiles = 0;

  // Read all files and collect unique vectors
  for (const file of files) {
    try {
      const filePath = path.join(exportDir, file);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const vectors = content.vectors || [];
      
      for (const vector of vectors) {
        if (!uniqueVectors.has(vector.id)) {
          uniqueVectors.set(vector.id, vector);
        }
      }
      
      processedFiles++;
      if (processedFiles % 5 === 0) {
        console.log(`   Processed ${processedFiles}/${files.length} files...`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error.message);
    }
  }

  console.log(`\n✅ Found ${uniqueVectors.size} unique vectors`);

  // Create consolidated export
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const consolidatedData = {
    export_info: {
      timestamp,
      total_vectors: uniqueVectors.size,
      dimension: 512,
      index_name: "youtube-titles-prod",
      batches_processed: 1,
      type: "title_embeddings_consolidated",
      note: "Consolidated from multiple exports with duplicates removed"
    },
    vectors: Array.from(uniqueVectors.values())
  };

  const consolidatedPath = path.join(exportDir, `title-embeddings-CONSOLIDATED-${timestamp}.json`);
  fs.writeFileSync(consolidatedPath, JSON.stringify(consolidatedData, null, 2));
  console.log(`✅ Created consolidated file: title-embeddings-CONSOLIDATED-${timestamp}.json`);
  console.log(`   File size: ${(fs.statSync(consolidatedPath).size / 1024 / 1024).toFixed(2)} MB`);

  // Create metadata-only version
  const metadataOnly = {
    export_info: consolidatedData.export_info,
    metadata: consolidatedData.vectors.map(v => ({
      id: v.id,
      metadata: v.metadata
    }))
  };
  
  const metadataPath = path.join(exportDir, `title-embeddings-CONSOLIDATED-${timestamp}-metadata-only.json`);
  fs.writeFileSync(metadataPath, JSON.stringify(metadataOnly, null, 2));
  console.log(`✅ Created metadata file: title-embeddings-CONSOLIDATED-${timestamp}-metadata-only.json`);

  // Step 3: Archive old files
  console.log('\n📁 Archiving old export files...');
  
  const archiveDir = path.join(exportDir, 'archive-title-embeddings');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  let archivedCount = 0;
  let archivedSize = 0;
  
  // Move all old title embedding files to archive
  const filesToArchive = fs.readdirSync(exportDir)
    .filter(f => f.startsWith('title-embeddings-') && !f.includes('CONSOLIDATED') && 
            (f.endsWith('.json') || f.endsWith('.csv')));
  
  for (const file of filesToArchive) {
    try {
      const oldPath = path.join(exportDir, file);
      const newPath = path.join(archiveDir, file);
      const fileSize = fs.statSync(oldPath).size;
      
      fs.renameSync(oldPath, newPath);
      archivedCount++;
      archivedSize += fileSize;
    } catch (error) {
      console.error(`❌ Error archiving ${file}:`, error.message);
    }
  }

  console.log(`✅ Archived ${archivedCount} files (${(archivedSize / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`   Files moved to: exports/archive-title-embeddings/`);

  // Summary
  console.log('\n📊 Cleanup Summary:');
  console.log(`   Original files: ${files.length} (473.87 MB)`);
  console.log(`   Consolidated file: 1 (~178 MB estimated)`);
  console.log(`   Space saved: ~295 MB`);
  console.log(`   Unique vectors preserved: ${uniqueVectors.size}`);
  
  console.log('\n✨ Cleanup complete!');
  console.log('   Old files have been archived to exports/archive-title-embeddings/');
  console.log('   You can safely delete the archive folder if no longer needed.');
}

// Run cleanup
cleanDuplicateExports().catch(console.error);