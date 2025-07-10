#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const exportDir = path.join(process.cwd(), 'exports');

async function analyzeExports() {
  console.log('🔍 Analyzing export files for duplicates...\n');

  // Get all title embedding files
  const files = fs.readdirSync(exportDir)
    .filter(f => f.startsWith('title-embeddings-') && f.endsWith('.json') && !f.includes('metadata'));
  
  console.log(`📁 Found ${files.length} title embedding export files\n`);

  const fileStats = [];
  const allVideoIds = new Set();
  const videoIdsByFile = new Map();

  // Analyze each file
  for (const file of files) {
    try {
      const filePath = path.join(exportDir, file);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      const vectorCount = content.export_info?.total_vectors || 0;
      const vectors = content.vectors || [];
      const videoIds = vectors.map(v => v.id);
      
      // Track unique IDs
      const uniqueInFile = new Set(videoIds);
      const duplicatesInFile = videoIds.length - uniqueInFile.size;
      
      // Track which IDs appear in multiple files
      const newIds = [];
      const duplicateIds = [];
      
      for (const id of uniqueInFile) {
        if (allVideoIds.has(id)) {
          duplicateIds.push(id);
        } else {
          newIds.push(id);
          allVideoIds.add(id);
        }
      }
      
      videoIdsByFile.set(file, uniqueInFile);
      
      fileStats.push({
        file,
        timestamp: file.match(/\d{4}-\d{2}-\d{2}T[\d-]+Z/)[0],
        vectorCount,
        actualVectors: vectors.length,
        uniqueInFile: uniqueInFile.size,
        duplicatesInFile,
        newIds: newIds.length,
        duplicateFromOtherFiles: duplicateIds.length,
        fileSize: fs.statSync(filePath).size
      });
      
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error.message);
    }
  }

  // Sort by timestamp
  fileStats.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Display analysis
  console.log('📊 File Analysis (chronological order):\n');
  let totalSize = 0;
  let totalVectors = 0;
  
  for (const stat of fileStats) {
    console.log(`📄 ${stat.file}`);
    console.log(`   Timestamp: ${stat.timestamp}`);
    console.log(`   Vectors: ${stat.vectorCount} (${stat.newIds} new, ${stat.duplicateFromOtherFiles} duplicates)`);
    console.log(`   File size: ${(stat.fileSize / 1024 / 1024).toFixed(2)} MB`);
    
    totalSize += stat.fileSize;
    totalVectors += stat.vectorCount;
    
    if (stat.duplicateFromOtherFiles > 0) {
      console.log(`   ⚠️  Contains ${stat.duplicateFromOtherFiles} IDs that exist in earlier files`);
    }
    console.log('');
  }

  console.log('📈 Summary:');
  console.log(`   Total export files: ${files.length}`);
  console.log(`   Total vectors across all files: ${totalVectors.toLocaleString()}`);
  console.log(`   Unique video IDs: ${allVideoIds.size.toLocaleString()}`);
  console.log(`   Total file size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Duplicate vectors: ${(totalVectors - allVideoIds.size).toLocaleString()}`);

  // Find files that are complete duplicates (can be safely deleted)
  console.log('\n🗑️  Files that can be safely deleted (contain only duplicate IDs):');
  
  const filesToDelete = [];
  for (const stat of fileStats) {
    if (stat.newIds === 0 && stat.vectorCount > 0) {
      filesToDelete.push(stat.file);
      console.log(`   - ${stat.file} (${stat.vectorCount} vectors, all duplicates)`);
    }
  }

  if (filesToDelete.length === 0) {
    console.log('   None - all files contain at least some unique IDs');
  } else {
    console.log(`\n💾 Deleting these ${filesToDelete.length} files would save ${
      (fileStats.filter(s => filesToDelete.includes(s.file))
        .reduce((sum, s) => sum + s.fileSize, 0) / 1024 / 1024).toFixed(2)
    } MB`);
  }

  // Also check thumbnail exports
  console.log('\n\n📸 Thumbnail Export Analysis:');
  const thumbFiles = fs.readdirSync(exportDir)
    .filter(f => f.startsWith('thumbnail-embeddings-') && f.endsWith('.json') && !f.includes('metadata') && !f.includes('csv'));
  
  console.log(`   Found ${thumbFiles.length} thumbnail embedding files`);
  const thumbSize = thumbFiles.reduce((sum, f) => sum + fs.statSync(path.join(exportDir, f)).size, 0);
  console.log(`   Total size: ${(thumbSize / 1024 / 1024).toFixed(2)} MB`);

  return filesToDelete;
}

// Run analysis
analyzeExports().then(filesToDelete => {
  if (filesToDelete.length > 0) {
    console.log('\n\n❓ Would you like to delete the duplicate files? Run:');
    console.log('   node scripts/clean-duplicate-exports.js');
  }
});