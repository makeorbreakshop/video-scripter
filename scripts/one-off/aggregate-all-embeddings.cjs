const fs = require('fs');
const path = require('path');

async function aggregateEmbeddings() {
  console.log('📂 Aggregating all title embeddings from exports folder...\n');
  
  const exportsDir = './exports';
  const allEmbeddings = {};
  let totalFiles = 0;
  let totalVideos = 0;
  
  // Get all title embedding files
  const files = fs.readdirSync(exportsDir)
    .filter(f => f.startsWith('title-embeddings-') && f.endsWith('.json') && !f.includes('metadata-only'));
  
  console.log(`Found ${files.length} title embedding files to process\n`);
  
  // Process each file
  for (const file of files) {
    try {
      const filePath = path.join(exportsDir, file);
      console.log(`Processing: ${file}`);
      
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Check for embeddings or vectors array
      const embeddingArray = data.embeddings || data.vectors;
      
      if (embeddingArray && Array.isArray(embeddingArray)) {
        let fileCount = 0;
        
        for (const item of embeddingArray) {
          if (item.id && item.values && Array.isArray(item.values)) {
            // Store embedding with metadata
            allEmbeddings[item.id] = {
              id: item.id,
              values: item.values,
              metadata: item.metadata || {}
            };
            fileCount++;
          }
        }
        
        console.log(`  ✅ Added ${fileCount} embeddings`);
        totalFiles++;
      } else {
        console.log(`  ⚠️  No embeddings/vectors array found`);
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
  
  totalVideos = Object.keys(allEmbeddings).length;
  
  // Save aggregated embeddings
  const outputFile = './exports/title-embeddings-complete-aggregated.json';
  const output = {
    export_info: {
      timestamp: new Date().toISOString(),
      total_videos: totalVideos,
      files_processed: totalFiles,
      source_files: files.length
    },
    embeddings: Object.values(allEmbeddings)
  };
  
  console.log(`\n💾 Saving aggregated embeddings to ${outputFile}...`);
  fs.writeFileSync(outputFile, JSON.stringify(output));
  
  // Also save a smaller sample for testing
  const sampleOutput = {
    ...output,
    embeddings: output.embeddings.slice(0, 100)
  };
  fs.writeFileSync('./exports/title-embeddings-complete-sample.json', JSON.stringify(sampleOutput, null, 2));
  
  console.log('\n✨ Aggregation Complete!');
  console.log('======================');
  console.log(`📊 Total unique videos: ${totalVideos}`);
  console.log(`📁 Files processed: ${totalFiles}`);
  console.log(`📄 Output: ${outputFile}`);
  console.log(`🔍 Sample: ./exports/title-embeddings-complete-sample.json`);
  
  // Show some stats about coverage
  const videoIds = Object.keys(allEmbeddings);
  console.log(`\n📊 Sample video IDs:`);
  for (let i = 0; i < 5; i++) {
    const id = videoIds[i];
    const title = allEmbeddings[id].metadata?.title || 'No title';
    console.log(`  - ${id}: ${title.substring(0, 60)}...`);
  }
}

aggregateEmbeddings().catch(console.error);